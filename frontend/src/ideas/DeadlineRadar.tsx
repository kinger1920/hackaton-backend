import React, {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {AlarmClock, RefreshCw, Mail, CalendarDays, Layers, FileText} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api, NoticeOut, PlanAnalysis} from '../services/api';
import {ComingSoonNote} from '../components/ComingSoon';
import './Ideas.css';

/**
 * Idee #3: Fristen-Radar.
 * Sammelt Fristen aus vorhandenen Daten (Briefe, Vorgänge, Termine) – ohne Backend-Änderung.
 * Später (Backend): Fristen automatisch aus VOB-Regeln + Versanddatum berechnen, Erinnerungen.
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

const TYPE_LABEL: Record<string, string> = {
    delay: 'Behinderungsanzeige',
    cost: 'Mehrkostenanmeldung',
    defect: 'Mängelrüge',
    concern: 'Bedenkenanmeldung'
};

function parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const v = value.trim().replace(/^Prognose\s+/i, '');
    const de = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const d = de ? new Date(Number(de[3]), Number(de[2]) - 1, Number(de[1])) : new Date(v.length === 10 ? `${v}T00:00:00` : v);
    return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function daysUntil(d: Date): number {
    return Math.round((d.getTime() - startOfToday().getTime()) / 86400000);
}

function fromNotices(notices: NoticeOut[]): DeadlineItem[] {
    const items: DeadlineItem[] = [];
    notices.forEach((n) => {
        const label = TYPE_LABEL[n.type] ?? n.type;
        const deadline = parseDate(n.fields?.deadline?.value);
        if (deadline) {
            items.push({
                id: `n-${n.id}-deadline`,
                kind: 'notice',
                title: `Frist aus ${label} #${n.id}`,
                detail: n.title || n.subject || '',
                due: deadline,
                source: `Brief #${n.id} (${n.status})`,
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
                title: `Behinderungsanzeige #${n.id} noch nicht freigegeben`,
                detail: 'Anzeige muss unverzüglich schriftlich zugehen – sonst droht Verlust von Ansprüchen.',
                due: event,
                source: `Brief #${n.id} • Ereignis ${event.toLocaleDateString('de-DE')}`,
                noticeId: n.id,
                vob: '§ 6 Abs. 1 VOB/B'
            });
        }
    });
    return items;
}

function fromAnalysis(a: PlanAnalysis | null): DeadlineItem[] {
    if (!a) return [];
    return a.workPackages
        .filter((wp) => wp.actualPercent < 100)
        .map((wp): DeadlineItem | null => {
            const due = parseDate(wp.planDate);
            return due
                ? {
                      id: `t-${wp.id}`,
                      kind: 'task' as Kind,
                      title: `Soll-Ende: ${wp.name}`,
                      detail: `${wp.trade}${wp.subcontractor ? ` • ${wp.subcontractor}` : ''} • Ist ${wp.actualPercent} %` +
                          (wp.delayDays > 0 ? ` • ${wp.delayDays.toLocaleString('de-DE')} AT Verzug` : ''),
                      due,
                      source: 'Bauzeitenplan / Tagesberichte'
                  }
                : null;
        })
        .filter((x): x is DeadlineItem => x !== null);
}

function fromAppointments(projectId: number): DeadlineItem[] {
    try {
        const raw = localStorage.getItem(`siteAppointments_${projectId}`);
        const list: any[] = raw ? JSON.parse(raw) : [];
        return list
            .filter((ev) => ev.category === 'deadline')
            .map((ev): DeadlineItem | null => {
                const due = parseDate(ev.date);
                return due
                    ? {
                          id: `a-${ev.id}`,
                          kind: 'appointment' as Kind,
                          title: ev.title,
                          detail: ev.description || '',
                          due,
                          source: 'Terminplaner',
                          vob: ev.vobReference
                      }
                    : null;
            })
            .filter((x): x is DeadlineItem => x !== null);
    } catch {
        return [];
    }
}

export const DeadlineRadar: React.FC = () => {
    const navigate = useNavigate();
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const [notices, setNotices] = useState<NoticeOut[]>([]);
    const [scheduled, setScheduled] = useState<DeadlineItem[]>([]);
    const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<'all' | Kind>('all');

    const load = async () => {
        setLoading(true);
        const t0 = new Date();
        const from = `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, '0')}-${String(t0.getDate()).padStart(2, '0')}`;
        const [n, a, s] = await Promise.allSettled([
            api.listNotices(projectId),
            api.getAnalysis(projectId, 'all'),
            api.getSchedule(projectId, from, 31) // Fristen/Abnahmen der nächsten 31 Tage aus dem Terminplan
        ]);
        setScheduled(
            s.status === 'fulfilled'
                ? s.value.appointments
                      .filter((ap) => ap.category === 'deadline' || ap.category === 'inspection')
                      .map((ap) => ({
                          id: `s-${ap.id}`,
                          kind: 'appointment' as Kind,
                          title: ap.title,
                          detail: ap.description || '',
                          due: parseDate(ap.date)!,
                          source: 'Terminplan (Backend)',
                          vob: ap.vobReference ?? undefined
                      }))
                      .filter((x) => x.due)
                : []
        );
        setNotices(n.status === 'fulfilled' ? n.value : []);
        setAnalysis(a.status === 'fulfilled' ? a.value : null);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, [projectId]);

    const items = useMemo(() => {
        const all = [...fromNotices(notices), ...fromAnalysis(analysis), ...scheduled, ...fromAppointments(projectId)];
        return all
            .filter((i) => filter === 'all' || i.kind === filter)
            .sort((x, y) => x.due.getTime() - y.due.getTime());
    }, [notices, analysis, scheduled, projectId, filter]);

    const overdue = items.filter((i) => daysUntil(i.due) < 0).length;
    const soon = items.filter((i) => daysUntil(i.due) >= 0 && daysUntil(i.due) <= 3).length;

    return (
        <div className="idea-page">
            <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><AlarmClock size={22}/></div>
                    <div>
                        <h1>Fristen-Radar</h1>
                        <p>Alle Fristen aus Briefen, Bauzeitenplan und Terminen für <strong>{activeProject.name}</strong></p>
                    </div>
                </div>
                <button className="btn btn-secondary" onClick={load} disabled={loading}>
                    <RefreshCw size={14}/> <span>Aktualisieren</span>
                </button>
            </div>

            <div className="idea-kpis">
                <div className="idea-kpi danger"><span>{overdue}</span>überfällig</div>
                <div className="idea-kpi warning"><span>{soon}</span>in ≤ 3 Tagen</div>
                <div className="idea-kpi"><span>{items.length}</span>Fristen gesamt</div>
            </div>

            <div className="idea-tabs">
                {([['all', 'Alle'], ['notice', 'Briefe'], ['task', 'Vorgänge'], ['appointment', 'Termine']] as const).map(([k, label]) => (
                    <button key={k} className={`idea-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                        {label}
                    </button>
                ))}
            </div>

            <div className="idea-list">
                {items.length === 0 && !loading && <div className="idea-empty">Keine Fristen gefunden.</div>}
                {items.map((i) => {
                    const d = daysUntil(i.due);
                    const state = d < 0 ? 'overdue' : d <= 3 ? 'soon' : 'ok';
                    return (
                        <div key={i.id} className={`idea-row deadline-${state}`}>
                            <div className="deadline-date">
                                <strong>{i.due.toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit'})}</strong>
                                <span>{d < 0 ? `${-d} T überfällig` : d === 0 ? 'heute' : `in ${d} T`}</span>
                            </div>
                            <div className="idea-row-main">
                                <div className="idea-row-title">
                                    {i.kind === 'notice' ? <Mail size={13}/> : i.kind === 'task' ? <Layers size={13}/> : <CalendarDays size={13}/>}
                                    {i.title}
                                </div>
                                {i.detail && <div className="idea-row-meta">{i.detail}</div>}
                                <div className="idea-row-meta">
                                    <FileText size={11}/> {i.source}{i.vob ? ` • ⚖️ ${i.vob}` : ''}
                                </div>
                            </div>
                            {i.noticeId && (
                                <button className="btn btn-secondary" onClick={() => navigate('/drafts', {state: {noticeId: i.noticeId}})}>
                                    Brief öffnen
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <ComingSoonNote endpoint="GET /api/deadlines?project_id=">
                Später mit Backend: Fristen automatisch aus VOB/B-Regeln und dem Zugangsdatum berechnen (z. B. Mängelfrist ab Zugang),
                Fristen aus Verträgen übernehmen und Erinnerungen per E-Mail/Push senden. Aktuell werden vorhandene Daten
                (Briefe, Bauzeitenplan, Terminplaner) ausgewertet.
            </ComingSoonNote>
        </div>
    );
};

export default DeadlineRadar;
