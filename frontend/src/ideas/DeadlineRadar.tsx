import React, {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {AlarmClock, RefreshCw, Mail, CalendarDays, Layers, FileText} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api, NoticeOut, PlanAnalysis, ScheduleAppointment} from '../services/api';
import {parseAnyDate, startOfToday, todayIso} from '../utils/dates';
import {useLanguage} from '../context/LanguageContext';
import './Ideas.css';

/**
 * Idee #3: Fristen-Radar.
 * Sammelt Fristen aus vorhandenen Backend-Daten (Briefe, Vorgänge, manuelle + automatische Termine).
 */

type Kind = 'notice' | 'task' | 'appointment';

interface DeadlineItem {
    id: string;
    kind: Kind;
    title: string;
    detail: string;
    due: Date;
    source: string;
    noticeId?: number;
    vob?: string;
}

/** Übersetzungsfunktionen aus dem LanguageContext, weil die Helfer unten außerhalb der Komponente liegen. */
interface I18n {
    t: (key: string) => string;
    tf: (key: string, vars: Record<string, string | number>) => string;
    locale: string;
}

const NOTICE_TYPES = ['delay', 'cost', 'defect', 'concern'];

const parseDate = parseAnyDate;

function daysUntil(d: Date): number {
    return Math.round((d.getTime() - startOfToday().getTime()) / 86400000);
}

function fromNotices(notices: NoticeOut[], {t, tf, locale}: I18n): DeadlineItem[] {
    const items: DeadlineItem[] = [];
    notices.forEach((n) => {
        const label = NOTICE_TYPES.includes(n.type) ? t(`ld_type_${n.type}`) : n.type;
        const deadline = parseDate(n.fields?.deadline?.value);
        if (deadline) {
            items.push({
                id: `n-${n.id}-deadline`,
                kind: 'notice',
                title: tf('dr_deadline_from', {label, id: n.id}),
                detail: n.title || n.subject || '',
                due: deadline,
                source: tf('dr_letter_src', {id: n.id, status: n.status}),
                noticeId: n.id,
                vob: n.type === 'defect' ? '§ 4 Abs. 7 / § 13 Abs. 5 VOB/B' : undefined
            });
        }
        // Behinderungsanzeige muss "unverzüglich" raus – offener Entwurf zum Ereignisdatum = fällig
        const event = parseDate(n.fields?.start_date?.value);
        if (n.type === 'delay' && n.status === 'Entwurf' && event) {
            items.push({
                id: `n-${n.id}-unverzueglich`,
                kind: 'notice',
                title: tf('dr_delay_unapproved', {id: n.id}),
                detail: t('dr_delay_detail'),
                due: event,
                source: tf('dr_letter_event', {id: n.id, date: event.toLocaleDateString(locale)}),
                noticeId: n.id,
                vob: '§ 6 Abs. 1 VOB/B'
            });
        }
    });
    return items;
}

function fromAnalysis(a: PlanAnalysis | null, {t, tf, locale}: I18n): DeadlineItem[] {
    if (!a) return [];
    return a.workPackages
        .filter((wp) => wp.actualPercent < 100)
        .map((wp): DeadlineItem | null => {
            const due = parseDate(wp.planDate);
            return due
                ? {
                      id: `t-${wp.id}`,
                      kind: 'task' as Kind,
                      title: tf('dr_planned_end', {name: wp.name}),
                      detail: `${wp.trade}${wp.subcontractor ? ` • ${wp.subcontractor}` : ''} • ${tf('dr_actual_pct', {pct: wp.actualPercent})}` +
                          (wp.delayDays > 0 ? ` • ${tf('dr_delay_days', {days: wp.delayDays.toLocaleString(locale)})}` : ''),
                      due,
                      source: t('dr_src_plan')
                  }
                : null;
        })
        .filter((x): x is DeadlineItem => x !== null);
}

function appointmentToDeadline(ap: ScheduleAppointment, {t, tf}: I18n): DeadlineItem | null {
    const due = parseDate(ap.date);
    if (!due) return null;
    const src = ap.source === 'manual' ? t('dr_src_manual') : tf('dr_src_auto', {label: ap.sourceLabel || t('dr_automatic')});
    return {
        id: `ap-${ap.id}`,
        kind: 'appointment',
        title: ap.title,
        detail: ap.description || '',
        due,
        source: src,
        vob: ap.vobReference ?? undefined
    };
}

/** `embedded`: im Terminplaner (Ansicht „Fristen“) – ohne eigenen Seitenkopf */
export const DeadlineRadar: React.FC<{ embedded?: boolean }> = ({embedded = false}) => {
    const navigate = useNavigate();
    const i18n = useLanguage();
    const {t, tf, locale} = i18n;
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const [notices, setNotices] = useState<NoticeOut[]>([]);
    // Rohdaten speichern, damit die Texte beim Sprachwechsel neu übersetzt werden.
    const [scheduled, setScheduled] = useState<ScheduleAppointment[]>([]);
    const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<'all' | Kind>('all');

    const load = async () => {
        setLoading(true);
        const from = todayIso();
        const [n, a, s, m] = await Promise.allSettled([
            api.listNotices(projectId),
            api.getAnalysis(projectId, 'all'),
            api.getSchedule(projectId, from, 31), // Fristen/Abnahmen der nächsten 31 Tage aus dem Terminplan
            api.listAppointments(projectId)       // alle manuellen Termine des Projekts aus dem Backend
        ]);
        const byId = new Map<string, ScheduleAppointment>();
        if (s.status === 'fulfilled') {
            s.value.appointments
                .filter((ap) => ap.category === 'deadline' || ap.category === 'inspection')
                .forEach((ap) => byId.set(ap.id, ap));
        }
        if (m.status === 'fulfilled') {
            m.value
                .filter((ap) => ap.category === 'deadline' || ap.category === 'inspection')
                .forEach((ap) => byId.set(ap.id, ap));
        }
        setScheduled(Array.from(byId.values()));
        setNotices(n.status === 'fulfilled' ? n.value : []);
        setAnalysis(a.status === 'fulfilled' ? a.value : null);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, [projectId]);

    const items = useMemo(() => {
        const fromSchedule = scheduled
            .map((ap) => appointmentToDeadline(ap, i18n))
            .filter((x): x is DeadlineItem => x !== null);
        const all = [...fromNotices(notices, i18n), ...fromAnalysis(analysis, i18n), ...fromSchedule];
        return all
            .filter((i) => filter === 'all' || i.kind === filter)
            .sort((x, y) => x.due.getTime() - y.due.getTime());
    }, [notices, analysis, scheduled, filter, i18n.language]);

    const overdue = items.filter((i) => daysUntil(i.due) < 0).length;
    const soon = items.filter((i) => daysUntil(i.due) >= 0 && daysUntil(i.due) <= 3).length;

    return (
        <div className="idea-page">
            {!embedded && <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><AlarmClock size={22}/></div>
                    <div>
                        <h1>{t('dr_title')}</h1>
                    </div>
                </div>
                <button className="btn btn-secondary" onClick={load} disabled={loading}>
                    <RefreshCw size={14}/> <span>{t('ld_refresh')}</span>
                </button>
            </div>}

            <div className="idea-kpis">
                <div className="idea-kpi danger"><span>{overdue}</span>{t('dr_overdue')}</div>
                <div className="idea-kpi warning"><span>{soon}</span>{t('dr_soon')}</div>
                <div className="idea-kpi"><span>{items.length}</span>{t('dr_total')}</div>
            </div>

            <div className="idea-tabs">
                {(['all', 'notice', 'task', 'appointment'] as const).map((k) => (
                    <button key={k} className={`idea-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                        {t(`dr_tab_${k}`)}
                    </button>
                ))}
            </div>

            <div className="idea-list">
                {items.length === 0 && !loading && <div className="idea-empty">{t('dr_empty')}</div>}
                {items.map((i) => {
                    const d = daysUntil(i.due);
                    const state = d < 0 ? 'overdue' : d <= 3 ? 'soon' : 'ok';
                    return (
                        <div key={i.id} className={`idea-row deadline-${state}`}>
                            <div className="deadline-date">
                                <strong>{i.due.toLocaleDateString(locale, {day: '2-digit', month: '2-digit'})}</strong>
                                <span>{d < 0 ? tf('dr_days_overdue', {n: -d}) : d === 0 ? t('dr_today') : tf('dr_in_days', {n: d})}</span>
                            </div>
                            <div className="idea-row-main">
                                <div className="idea-row-title">
                                    {i.kind === 'notice' ? <Mail size={13}/> : i.kind === 'task' ? <Layers size={13}/> : <CalendarDays size={13}/>}
                                    {i.title}
                                </div>
                                {i.detail && <div className="idea-row-meta">{i.detail}</div>}
                                <div className="idea-row-meta">
                                    <FileText size={11}/> {i.source}{i.vob ? ` • ${i.vob}` : ''}
                                </div>
                            </div>
                            {i.noticeId && (
                                <button className="btn btn-secondary" onClick={() => navigate('/drafts', {state: {noticeId: i.noticeId}})}>
                                    {t('dr_open_letter')}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DeadlineRadar;
