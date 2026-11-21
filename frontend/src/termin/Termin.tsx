import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    Plus,
    Printer,
    Download,
    X,
    Mail,
    FileText,
    Camera,
    AlertTriangle,
    Wrench,
    StickyNote,
    TrendingUp,
    ClipboardList,
    Users,
    Search,
    RefreshCw,
    Link2,
    Trash2,
    Flag,
    PlayCircle,
    CheckCircle2
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {api, AppointmentCategory, DayTask, saveBlob, ScheduleAppointment, TimelineItem} from '../services/api';
import {ComingSoonBadge} from '../components/ComingSoon';
import DeadlineRadar from '../ideas/DeadlineRadar';
import {addDays, daysBetween, formatDe, isoWeek, parseIsoDate, startOfToday, startOfWeek, toIsoDate, weekdayIndex} from '../utils/dates';
import '@frontend/src/index.css';
import './Termin.css';

/**
 * Terminplaner & Kalender – alles auf einer Seite.
 *  Vergangenheit: GET /api/timeline  (Berichte, Notizen, Briefe/Mängel, Fortschritt, Warnungen; max. 92 Tage je Abruf)
 *  Planung:       GET /api/schedule  (Arbeiten je Werktag aus dem Bauzeitenplan + Termine; max. 31 Tage je Abruf)
 *  Eigene Termine: lokal (localStorage `siteAppointments_<projectId>`), bis es einen Backend-Endpunkt zum Anlegen gibt.
 *  Fotos: Backend folgt (Idee #1).
 */

// Format der lokal gespeicherten Termine (wird auch vom Fristen-Radar gelesen)
export type EventCategory = AppointmentCategory;

export interface SiteAppointment {
    id: string;
    projectId: string | number;
    title: string;
    date: string; // YYYY-MM-DD
    time?: string;
    category: EventCategory;
    trade?: string;
    description?: string;
    vobReference?: string;
    isUrgent?: boolean;
}

type View = 'day' | 'week' | 'month' | 'year' | 'all' | 'deadlines';
type Layer = 'tasks' | 'appointments' | 'report' | 'defect' | 'note' | 'notice' | 'progress' | 'alert' | 'photos';

interface Appt extends ScheduleAppointment {
    local?: boolean;
}

interface DayInfo {
    tasks: DayTask[];
    appts: Appt[];
    reports: TimelineItem[];
    notes: TimelineItem[];
    notices: TimelineItem[];
    progress: TimelineItem[];
    alerts: TimelineItem[];
    defects: TimelineItem[];
}

type DayDataFn = (d: string) => DayInfo;

const VIEWS: { id: View; label: string }[] = [
    {id: 'day', label: 'Tag'},
    {id: 'week', label: 'Woche'},
    {id: 'month', label: 'Monat'},
    {id: 'year', label: 'Jahr'},
    {id: 'all', label: 'Gesamt'},
    {id: 'deadlines', label: 'Fristen'}
];

const LAYERS: { id: Layer; label: string; color: string; soon?: boolean }[] = [
    {id: 'tasks', label: 'Arbeiten (Plan)', color: '#2563eb'},
    {id: 'appointments', label: 'Termine', color: '#7c3aed'},
    {id: 'report', label: 'Berichte', color: '#0f766e'},
    {id: 'defect', label: 'Mängel', color: '#dc2626'},
    {id: 'notice', label: 'Briefe', color: '#b45309'},
    {id: 'note', label: 'Notizen', color: '#475569'},
    {id: 'progress', label: 'Fortschritt', color: '#16a34a'},
    {id: 'alert', label: 'Warnungen', color: '#ea580c'},
    {id: 'photos', label: 'Fotos', color: '#0891b2', soon: true}
];

const CATEGORY: Record<AppointmentCategory, { label: string; color: string }> = {
    deadline: {label: 'Frist', color: '#dc2626'},
    milestone: {label: 'Meilenstein', color: '#7c3aed'},
    inspection: {label: 'Abnahme/Prüfung', color: '#16a34a'},
    meeting: {label: 'Besprechung', color: '#2563eb'},
    delivery: {label: 'Lieferung/Logistik', color: '#d97706'}
};

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Datums-Helfer: gemeinsam in utils/dates.ts (Kurz-Aliasse für diese Datei)
const iso = toIsoDate;
const parseIso = parseIsoDate;
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => formatDe(d, opts);
const todayDate = startOfToday;

/** Ist ein Timeline-Eintrag ein Mangel? (Mängelrüge-Brief oder Diktat "Mangel") */
const isDefect = (it: TimelineItem) => /m[äa]ngel/i.test(`${it.title} ${it.summary}`);
const warningCount = (d: DayInfo) =>
    d.alerts.length + [...d.reports, ...d.notes].filter((it) => it.severity === 'warning' || it.severity === 'critical').length;

function rangeFor(view: View, anchor: Date, projectStart: Date, projectEnd: Date): [Date, Date] {
    switch (view) {
        case 'day':
            return [anchor, anchor];
        case 'week': {
            const s = startOfWeek(anchor);
            return [s, addDays(s, 6)];
        }
        case 'month': {
            const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
            const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
            return [startOfWeek(first), addDays(startOfWeek(last), 6)]; // ganzes Monatsraster
        }
        case 'year':
            return [new Date(anchor.getFullYear(), 0, 1), new Date(anchor.getFullYear(), 11, 31)];
        case 'all':
            return [projectStart, projectEnd];
        case 'deadlines':
            return [anchor, anchor]; // Fristen-Ansicht lädt ihre Daten selbst
    }
}

/** Teilt [from, to] in Blöcke von max. `size` Tagen */
function chunks(from: Date, to: Date, size: number): [Date, Date][] {
    const out: [Date, Date][] = [];
    let s = from;
    while (s <= to) {
        const e = addDays(s, size - 1) < to ? addDays(s, size - 1) : to;
        out.push([s, e]);
        s = addDays(e, 1);
    }
    return out;
}

export const Termin: React.FC = () => {
    const navigate = useNavigate();
    const {t} = useLanguage();
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const today = useMemo(todayDate, []);
    const todayIso = iso(today);

    // Startansicht: aus Navigation (z. B. /fristen → {view: 'deadlines'}), sonst Monat
    const navView = (useLocation().state as { view?: View } | null)?.view;
    const [view, setView] = useState<View>(navView && VIEWS.some((v) => v.id === navView) ? navView : 'month');
    const [anchor, setAnchor] = useState<Date>(today);
    const [selected, setSelected] = useState<string>(todayIso);
    const [layers, setLayers] = useState<Set<Layer>>(new Set(LAYERS.filter((l) => !l.soon).map((l) => l.id)));
    const [search, setSearch] = useState('');

    // Daten (akkumuliert über alle geladenen Zeiträume)
    const [tasksByDay, setTasksByDay] = useState<Record<string, DayTask[]>>({});
    const [items, setItems] = useState<Record<string, TimelineItem>>({});
    const [backendAppts, setBackendAppts] = useState<Record<string, ScheduleAppointment>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loaded = useRef<Set<string>>(new Set());

    // Eigene Termine (lokal)
    const storageKey = `siteAppointments_${projectId}`;
    const [localAppts, setLocalAppts] = useState<SiteAppointment[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const emptyForm = (date: string): SiteAppointment => ({
        id: '', projectId, title: '', date, time: '09:00', category: 'meeting', trade: '', description: '', vobReference: '', isUrgent: false
    });
    const [form, setForm] = useState<SiteAppointment>(emptyForm(todayIso));

    // Projektzeitraum für "Gesamt" (Projekt-Start/-Ende, sonst ±6 Monate um heute; max. 2 Jahre)
    const [projectStart, projectEnd] = useMemo(() => {
        const s = activeProject.start_date ? parseIso(activeProject.start_date) : addDays(today, -180);
        let e = activeProject.end_date ? parseIso(activeProject.end_date) : addDays(today, 180);
        if (e < s) e = addDays(s, 180);
        if (daysBetween(s, e) > 730) e = addDays(s, 730);
        return [s, e];
    }, [activeProject.start_date, activeProject.end_date, today]);

    const [rangeFrom, rangeTo] = rangeFor(view, anchor, projectStart, projectEnd);
    const rangeKey = `${iso(rangeFrom)}:${iso(rangeTo)}`;

    // Projektwechsel → alles zurücksetzen
    useEffect(() => {
        loaded.current.clear();
        setTasksByDay({});
        setItems({});
        setBackendAppts({});
        setError(null);
        try {
            setLocalAppts(JSON.parse(localStorage.getItem(storageKey) || '[]'));
        } catch {
            setLocalAppts([]);
        }
    }, [projectId]);

    // Daten für den sichtbaren Zeitraum nachladen (in Blöcken, bereits Geladenes wird übersprungen)
    const loadRange = async (from: Date, to: Date) => {
        const jobs: Promise<void>[] = [];
        const tlTo = to < today ? to : today; // Timeline nur bis heute
        if (from <= tlTo) {
            for (const [s, e] of chunks(from, tlTo, 92)) {
                const key = `${projectId}:tl:${iso(s)}:${iso(e)}`;
                if (loaded.current.has(key)) continue;
                loaded.current.add(key);
                jobs.push(
                    api.getTimeline(projectId, iso(s), iso(e)).then((tl) => {
                        setItems((prev) => {
                            const next = {...prev};
                            tl.items.forEach((it) => (next[it.id] = it));
                            return next;
                        });
                    }).catch((err) => {
                        loaded.current.delete(key);
                        throw err;
                    })
                );
            }
        }
        for (const [s, e] of chunks(from, to, 31)) {
            const key = `${projectId}:sc:${iso(s)}:${iso(e)}`;
            if (loaded.current.has(key)) continue;
            loaded.current.add(key);
            jobs.push(
                api.getSchedule(projectId, iso(s), daysBetween(s, e) + 1).then((sc) => {
                    setTasksByDay((prev) => {
                        const next = {...prev};
                        sc.days.forEach((d) => (next[d.date] = d.tasks));
                        return next;
                    });
                    setBackendAppts((prev) => {
                        const next = {...prev};
                        sc.appointments.forEach((a) => (next[a.id] = a));
                        return next;
                    });
                }).catch((err) => {
                    loaded.current.delete(key);
                    throw err;
                })
            );
        }
        if (jobs.length === 0) return;
        setLoading(true);
        const results = await Promise.allSettled(jobs);
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        setError(failed.length > 0 ? `Einige Daten konnten nicht geladen werden: ${failed[0].reason?.message ?? failed[0].reason}` : null);
        setLoading(false);
    };

    useEffect(() => {
        loadRange(rangeFrom, rangeTo);
    }, [projectId, rangeKey]);

    const reload = () => {
        loaded.current.clear();
        setTasksByDay({});
        setItems({});
        setBackendAppts({});
        loadRange(rangeFrom, rangeTo);
    };

    // ---------- abgeleitete Daten ----------
    const q = search.trim().toLowerCase();
    const matches = (text: string) => !q || text.toLowerCase().includes(q);

    const allAppts: Appt[] = useMemo(() => {
        const local: Appt[] = localAppts.map((a) => ({
            id: a.id,
            projectId,
            title: a.title,
            date: a.date,
            time: a.time ?? null,
            category: a.category,
            trade: a.trade ?? null,
            description: a.description ?? null,
            vobReference: a.vobReference ?? null,
            isUrgent: a.isUrgent ?? false,
            local: true
        }));
        return [...Object.values(backendAppts), ...local];
    }, [backendAppts, localAppts, projectId]);

    const itemsByDay = useMemo(() => {
        const map: Record<string, TimelineItem[]> = {};
        Object.values(items).forEach((it) => {
            (map[it.date] ??= []).push(it);
        });
        Object.values(map).forEach((list) => list.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '')));
        return map;
    }, [items]);

    const apptsByDay = useMemo(() => {
        const map: Record<string, Appt[]> = {};
        allAppts.forEach((a) => (map[a.date] ??= []).push(a));
        Object.values(map).forEach((l) => l.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')));
        return map;
    }, [allAppts]);

    /** Alles zu einem Tag, gefiltert nach Ebenen + Suche */
    const dayData: DayDataFn = (d) => {
        const its = (itemsByDay[d] ?? []).filter((it) => matches(`${it.title} ${it.summary}`));
        const defectsOn = layers.has('defect');
        const pick = (type: TimelineItem['type'], layer: Layer) =>
            layers.has(layer) ? its.filter((it) => it.type === type && !(defectsOn && isDefect(it))) : [];
        return {
            tasks: layers.has('tasks') ? (tasksByDay[d] ?? []).filter((tk) => matches(`${tk.title} ${tk.trade ?? ''} ${tk.company ?? ''}`)) : [],
            appts: layers.has('appointments') ? (apptsByDay[d] ?? []).filter((a) => matches(`${a.title} ${a.description ?? ''}`)) : [],
            reports: pick('report', 'report'),
            notes: pick('note', 'note'),
            notices: pick('notice', 'notice'),
            progress: pick('progress', 'progress'),
            alerts: pick('alert', 'alert'),
            defects: defectsOn ? its.filter(isDefect) : []
        };
    };

    // Kennzahlen für den sichtbaren Zeitraum
    const stats = useMemo(() => {
        let reports = 0, defects = 0, warnings = 0, appts = 0;
        const taskIds = new Set<number>();
        const overdue = new Set<number>();
        for (let d = rangeFrom; d <= rangeTo; d = addDays(d, 1)) {
            const dd = dayData(iso(d));
            reports += dd.reports.length;
            defects += dd.defects.length;
            warnings += warningCount(dd);
            appts += dd.appts.length;
            dd.tasks.forEach((tk) => {
                taskIds.add(tk.taskId);
                if (tk.isOverdue) overdue.add(tk.taskId);
            });
        }
        return {reports, defects, warnings, appts, tasks: taskIds.size, overdue: overdue.size};
    }, [itemsByDay, tasksByDay, apptsByDay, layers, q, rangeKey]);

    // ---------- Navigation ----------
    const shift = (dir: -1 | 1) => {
        const a = new Date(anchor);
        if (view === 'day') a.setDate(a.getDate() + dir);
        if (view === 'week') a.setDate(a.getDate() + 7 * dir);
        if (view === 'month') a.setMonth(a.getMonth() + dir, 1);
        if (view === 'year') a.setFullYear(a.getFullYear() + dir);
        setAnchor(a);
        if (view === 'day' || view === 'week') setSelected(iso(view === 'week' ? startOfWeek(a) : a));
    };

    const goToday = () => {
        setAnchor(today);
        setSelected(todayIso);
    };

    const selectDay = (d: string, switchToDay = false) => {
        setSelected(d);
        if (switchToDay) {
            setAnchor(parseIso(d));
            setView('day');
        }
    };

    const changeView = (v: View) => {
        setView(v);
        if (v !== 'all' && v !== 'deadlines') setAnchor(parseIso(selected));
    };

    const rangeLabel = (() => {
        switch (view) {
            case 'day':
                return fmt(anchor, {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'});
            case 'week':
                return `KW ${isoWeek(rangeFrom)} • ${fmt(rangeFrom, {day: '2-digit', month: '2-digit'})} – ${fmt(rangeTo, {day: '2-digit', month: '2-digit', year: 'numeric'})}`;
            case 'month':
                return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
            case 'year':
                return String(anchor.getFullYear());
            case 'deadlines':
                return 'Fristen aus Briefen, Bauzeitenplan und Terminen';
            case 'all':
                return `Projektlaufzeit ${fmt(projectStart, {month: '2-digit', year: 'numeric'})} – ${fmt(projectEnd, {month: '2-digit', year: 'numeric'})}`;
        }
    })();

    // ---------- Aktionen ----------
    const toggleLayer = (l: Layer) => {
        setLayers((prev) => {
            const next = new Set(prev);
            if (next.has(l)) next.delete(l);
            else next.add(l);
            return next;
        });
    };

    const saveLocal = (list: SiteAppointment[]) => {
        setLocalAppts(list);
        try {
            localStorage.setItem(storageKey, JSON.stringify(list));
        } catch {
            // ignore
        }
    };

    const openAdd = (date: string) => {
        setForm(emptyForm(date));
        setShowAdd(true);
    };

    const submitAdd = (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.title.trim()) return;
        saveLocal([...localAppts, {...form, id: `local-${Date.now()}`, title: form.title.trim()}]);
        setShowAdd(false);
        setSelected(form.date);
    };

    /** Termine des sichtbaren Zeitraums als .ics (Outlook, Google, Apple) */
    const exportIcs = () => {
        const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
        const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SiteAI Assistant//Terminplaner//DE'];
        allAppts
            .filter((a) => a.date >= iso(rangeFrom) && a.date <= iso(rangeTo))
            .forEach((a) => {
                const d = a.date.replace(/-/g, '');
                lines.push('BEGIN:VEVENT', `UID:${a.id}@siteai`, `SUMMARY:${esc(a.title)}`);
                if (a.time) lines.push(`DTSTART:${d}T${a.time.slice(0, 5).replace(':', '')}00`);
                else lines.push(`DTSTART;VALUE=DATE:${d}`);
                const desc = [CATEGORY[a.category]?.label, a.trade, a.description, a.vobReference].filter(Boolean).join(' • ');
                if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
                lines.push('END:VEVENT');
            });
        lines.push('END:VCALENDAR');
        saveBlob(new Blob([lines.join('\r\n')], {type: 'text/calendar'}), `Termine_${activeProject.number || projectId}_${iso(rangeFrom)}.ics`);
    };

    const exportReport = async (date: string, format: 'pdf' | 'docx') => {
        try {
            saveBlob(await api.downloadReportExport(date, format, projectId), `Bautagesbericht_${date}.${format}`);
        } catch (err: any) {
            alert(err?.message || 'Export fehlgeschlagen');
        }
    };

    const deleteLocal = (id: string) => saveLocal(localAppts.filter((a) => a.id !== id));

    // ---------- Darstellung ----------
    const sel = dayData(selected);
    const selRel: 'past' | 'today' | 'future' = selected < todayIso ? 'past' : selected === todayIso ? 'today' : 'future';

    return (
        <div className="tp-page">
            {/* Kopfzeile */}
            <div className="tp-header">
                <div className="tp-title-group">
                    <div className="tp-title-icon"><CalendarIcon size={22}/></div>
                    <div>
                        <h1 className="tp-title">{t('nav_termin', 'Terminplaner & Kalender')}</h1>
                        <p className="tp-sub">
                            Rückblick (Berichte, Mängel, Fotos) und Planung (Arbeiten je Tag, Termine) • <strong>{activeProject.name}</strong>
                        </p>
                    </div>
                </div>
                <div className="tp-header-actions">
                    <button className="tp-btn" onClick={reload} title="Neu laden"><RefreshCw size={14} className={loading ? 'tp-spin' : ''}/></button>
                    <button className="tp-btn" onClick={exportIcs} title="Termine des Zeitraums als .ics exportieren (Outlook/Google/Apple)">
                        <Download size={14}/> <span>.ics</span>
                    </button>
                    <button className="tp-btn" disabled title="Kalender-Abo (Outlook/Google) – Backend folgt">
                        <Link2 size={14}/> <span>Kalender verbinden</span> <ComingSoonBadge label="folgt"/>
                    </button>
                    <button className="tp-btn" onClick={() => window.print()} title="Drucken"><Printer size={14}/></button>
                    <button className="btn btn-primary" onClick={() => openAdd(selected)}>
                        <Plus size={15}/> <span>Termin</span>
                    </button>
                </div>
            </div>

            {/* Steuerleiste */}
            <div className="tp-toolbar">
                <div className="tp-segment" role="tablist" aria-label="Zeitraum">
                    {VIEWS.map((v) => (
                        <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => changeView(v.id)}>
                            {v.label}
                        </button>
                    ))}
                </div>
                <div className="tp-nav">
                    {view !== 'all' && view !== 'deadlines' && (
                        <>
                            <button className="tp-icon-btn" onClick={() => shift(-1)} aria-label="Zurück"><ChevronLeft size={16}/></button>
                            <button className="tp-btn" onClick={goToday}>Heute</button>
                            <button className="tp-icon-btn" onClick={() => shift(1)} aria-label="Weiter"><ChevronRight size={16}/></button>
                        </>
                    )}
                    <span className="tp-range-label">{rangeLabel}</span>
                </div>
                <div className="tp-search">
                    <Search size={14}/>
                    <input placeholder="Suchen: Vorgang, Firma, Termin…" value={search} onChange={(e) => setSearch(e.target.value)}/>
                    {search && <button className="tp-icon-btn small" onClick={() => setSearch('')} aria-label="Suche leeren"><X size={12}/></button>}
                </div>
            </div>

            {/* Fristen-Ansicht (früher eigene Seite „Fristen-Radar“) */}
            {view === 'deadlines' && <DeadlineRadar embedded/>}

            {view !== 'deadlines' && <>
            {/* Ebenen */}
            <div className="tp-layers">
                {LAYERS.map((l) => (
                    <button
                        key={l.id}
                        className={`tp-layer ${layers.has(l.id) ? 'on' : ''}`}
                        style={{'--layer': l.color} as React.CSSProperties}
                        onClick={() => !l.soon && toggleLayer(l.id)}
                        disabled={l.soon}
                        title={l.soon ? 'Fotos: Backend folgt' : `${l.label} ein-/ausblenden`}
                    >
                        <i/>{l.label}{l.soon && <ComingSoonBadge label="folgt"/>}
                    </button>
                ))}
            </div>

            {/* Kennzahlen für den Zeitraum */}
            <div className="tp-kpis">
                <Kpi icon={<FileText size={15}/>} label="Bautagesberichte" value={stats.reports}/>
                <Kpi icon={<Wrench size={15}/>} label="Mängel" value={stats.defects} tone={stats.defects > 0 ? 'danger' : undefined}/>
                <Kpi icon={<AlertTriangle size={15}/>} label="Warnungen" value={stats.warnings} tone={stats.warnings > 0 ? 'warning' : undefined}/>
                <Kpi icon={<ClipboardList size={15}/>} label="Vorgänge geplant" value={stats.tasks}/>
                <Kpi icon={<Flag size={15}/>} label="Überfällig" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : undefined}/>
                <Kpi icon={<CalendarIcon size={15}/>} label="Termine" value={stats.appts}/>
            </div>

            {error && <div className="tp-error">{error}</div>}

            <div className="tp-body">
                <div className="tp-main">
                    {view === 'month' && (
                        <MonthGrid anchor={anchor} from={rangeFrom} todayIso={todayIso} selected={selected} dayData={dayData} onSelect={selectDay}/>
                    )}
                    {view === 'week' && (
                        <WeekColumns from={rangeFrom} todayIso={todayIso} selected={selected} dayData={dayData} onSelect={selectDay}/>
                    )}
                    {view === 'day' && (
                        <DayDetail date={selected} rel={selRel} data={sel} navigate={navigate} onExport={exportReport}
                                   onAdd={() => openAdd(selected)} onDeleteLocal={deleteLocal} large/>
                    )}
                    {view === 'year' && (
                        <YearGrid year={anchor.getFullYear()} todayIso={todayIso} selected={selected} dayData={dayData}
                                  onSelect={selectDay}
                                  onMonth={(m) => {
                                      setAnchor(new Date(anchor.getFullYear(), m, 1));
                                      setView('month');
                                  }}/>
                    )}
                    {view === 'all' && (
                        <ProjectGantt from={rangeFrom} to={rangeTo} today={today} tasksByDay={tasksByDay}
                                      itemsByDay={itemsByDay} showTasks={layers.has('tasks')} matches={matches}
                                      onSelect={(d) => selectDay(d)}/>
                    )}
                </div>

                {view !== 'day' && (
                    <aside className="tp-side">
                        <DayDetail date={selected} rel={selRel} data={sel} navigate={navigate} onExport={exportReport}
                                   onAdd={() => openAdd(selected)} onDeleteLocal={deleteLocal}
                                   onOpenDay={() => selectDay(selected, true)}/>
                    </aside>
                )}
            </div>

            <div className="tp-footnote">
                Quellen: Bautagesberichte, Diktate, Briefe und Bauzeitenplan aus dem Backend (Timeline & Terminplan).
                Klick auf einen Tag zeigt Details, Doppelklick öffnet die Tagesansicht. Eigene Termine werden vorerst lokal gespeichert.
            </div>
            </>}

            {/* Neuer Termin */}
            {showAdd && (
                <div className="tp-modal-overlay" onClick={() => setShowAdd(false)}>
                    <form className="tp-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitAdd}>
                        <div className="tp-modal-header">
                            <strong>Neuer Termin / Frist</strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setShowAdd(false)} aria-label="Schließen"><X size={16}/></button>
                        </div>
                        <div className="tp-form-grid">
                            <label className="span-2">Bezeichnung *
                                <input className="form-input" required autoFocus value={form.title}
                                       onChange={(e) => setForm({...form, title: e.target.value})}/>
                            </label>
                            <label>Datum
                                <input className="form-input" type="date" required value={form.date} onChange={(e) => setForm({...form, date: e.target.value})}/>
                            </label>
                            <label>Uhrzeit
                                <input className="form-input" type="time" value={form.time ?? ''} onChange={(e) => setForm({...form, time: e.target.value})}/>
                            </label>
                            <label>Kategorie
                                <select className="form-input" value={form.category}
                                        onChange={(e) => setForm({...form, category: e.target.value as AppointmentCategory})}>
                                    {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                            </label>
                            <label>Gewerk / Firma
                                <input className="form-input" value={form.trade ?? ''} onChange={(e) => setForm({...form, trade: e.target.value})}/>
                            </label>
                            <label className="span-2">Beschreibung
                                <textarea className="form-textarea" rows={2} value={form.description ?? ''}
                                          onChange={(e) => setForm({...form, description: e.target.value})}/>
                            </label>
                            <label>VOB-Bezug
                                <input className="form-input" placeholder="z. B. § 6 Abs. 1 VOB/B" value={form.vobReference ?? ''}
                                       onChange={(e) => setForm({...form, vobReference: e.target.value})}/>
                            </label>
                            <label className="tp-check">
                                <input type="checkbox" checked={!!form.isUrgent} onChange={(e) => setForm({...form, isUrgent: e.target.checked})}/>
                                Dringend
                            </label>
                        </div>
                        <div className="tp-modal-note">
                            Wird vorerst nur lokal in diesem Browser gespeichert <ComingSoonBadge label="Sync: Backend folgt"/>
                        </div>
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>Abbrechen</button>
                            <button type="submit" className="btn btn-primary">Speichern</button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

// =====================================================================
// Teil-Komponenten
// =====================================================================

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: number; tone?: 'danger' | 'warning' }> = ({icon, label, value, tone}) => (
    <div className={`tp-kpi ${tone ?? ''}`}>
        <div className="tp-kpi-icon">{icon}</div>
        <div>
            <div className="tp-kpi-value">{value}</div>
            <div className="tp-kpi-label">{label}</div>
        </div>
    </div>
);

/** Kleine Markierungen für eine Tageszelle */
const DayBadges: React.FC<{ d: DayInfo; compact?: boolean }> = ({d, compact}) => {
    const warn = warningCount(d);
    const late = d.tasks.some((tk) => tk.isOverdue || tk.status === 'delayed');
    return (
        <div className="tp-badges">
            {d.reports.length > 0 && <span className="tp-badge report" title="Bautagesbericht"><FileText size={10}/>{!compact && 'Bericht'}</span>}
            {d.defects.length > 0 && <span className="tp-badge defect" title="Mängel"><Wrench size={10}/>{d.defects.length}</span>}
            {warn > 0 && <span className="tp-badge alert" title="Warnungen"><AlertTriangle size={10}/>{warn}</span>}
            {d.tasks.length > 0 && (
                <span className={`tp-badge task ${late ? 'late' : ''}`} title="geplante Vorgänge"><ClipboardList size={10}/>{d.tasks.length}</span>
            )}
        </div>
    );
};

const MonthGrid: React.FC<{
    anchor: Date; from: Date; todayIso: string; selected: string; dayData: DayDataFn; onSelect: (d: string, toDay?: boolean) => void;
}> = ({anchor, from, todayIso, selected, dayData, onSelect}) => {
    const cells = Array.from({length: 42}, (_, n) => addDays(from, n));
    const visible = cells[35].getMonth() === anchor.getMonth() ? cells : cells.slice(0, 35);
    return (
        <div className="tp-month">
            {WEEKDAYS.map((w) => <div key={w} className="tp-month-head">{w}</div>)}
            {visible.map((day) => {
                const k = iso(day);
                const d = dayData(k);
                const outside = day.getMonth() !== anchor.getMonth();
                const weekend = weekdayIndex(day) >= 5;
                const max = 3;
                const shownAppts = d.appts.slice(0, 2);
                const shownTasks = d.tasks.slice(0, Math.max(0, max - shownAppts.length));
                const rest = d.appts.length + d.tasks.length - shownAppts.length - shownTasks.length;
                return (
                    <button
                        key={k}
                        className={`tp-cell ${outside ? 'outside' : ''} ${weekend ? 'weekend' : ''} ${k < todayIso ? 'past' : ''} ${k === todayIso ? 'today' : ''} ${k === selected ? 'selected' : ''}`}
                        onClick={() => onSelect(k)}
                        onDoubleClick={() => onSelect(k, true)}
                    >
                        <div className="tp-cell-top">
                            <span className="tp-cell-num">{day.getDate()}</span>
                            <DayBadges d={d} compact/>
                        </div>
                        <div className="tp-cell-items">
                            {shownAppts.map((a) => (
                                <span key={a.id} className="tp-chip" style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}>
                                    {a.time ? `${a.time.slice(0, 5)} ` : ''}{a.title}
                                </span>
                            ))}
                            {shownTasks.map((tk) => (
                                <span key={tk.taskId} className={`tp-chip task ${tk.status} ${tk.isOverdue ? 'overdue' : ''}`}>
                                    {tk.isStart ? '▶ ' : tk.isEnd ? '◼ ' : ''}{tk.title}
                                </span>
                            ))}
                            {rest > 0 && <span className="tp-more">+{rest} weitere</span>}
                        </div>
                    </button>
                );
            })}
        </div>
    );
};

const WeekColumns: React.FC<{
    from: Date; todayIso: string; selected: string; dayData: DayDataFn; onSelect: (d: string, toDay?: boolean) => void;
}> = ({from, todayIso, selected, dayData, onSelect}) => (
    <div className="tp-week">
        {Array.from({length: 7}, (_, n) => addDays(from, n)).map((day) => {
            const k = iso(day);
            const d = dayData(k);
            const past = k < todayIso;
            const empty = d.tasks.length + d.appts.length + d.reports.length + d.defects.length === 0;
            return (
                <div
                    key={k}
                    className={`tp-week-col ${k === todayIso ? 'today' : ''} ${k === selected ? 'selected' : ''} ${past ? 'past' : ''} ${weekdayIndex(day) >= 5 ? 'weekend' : ''}`}
                    onClick={() => onSelect(k)}
                    onDoubleClick={() => onSelect(k, true)}
                >
                    <div className="tp-week-head">
                        <span>{WEEKDAYS[weekdayIndex(day)]}</span>
                        <strong>{fmt(day, {day: '2-digit', month: '2-digit'})}</strong>
                    </div>
                    <DayBadges d={d}/>
                    {d.appts.map((a) => (
                        <div key={a.id} className="tp-card appt" style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}>
                            <div className="tp-card-title">{a.time ? `${a.time.slice(0, 5)} • ` : ''}{a.title}</div>
                            <div className="tp-card-meta">{CATEGORY[a.category]?.label}{a.isUrgent ? ' • dringend' : ''}</div>
                        </div>
                    ))}
                    {d.tasks.map((tk) => (
                        <div key={tk.taskId} className={`tp-card task ${tk.status} ${tk.isOverdue ? 'overdue' : ''}`}>
                            <div className="tp-card-title">{tk.isStart ? '▶ ' : tk.isEnd ? '◼ ' : ''}{tk.title}</div>
                            <div className="tp-card-meta">
                                {tk.company || tk.trade || '–'}{tk.plannedWorkforce ? ` • ${tk.plannedWorkforce} P.` : ''} • Ist {tk.actualPercent} / Soll {tk.planPercent} %
                            </div>
                        </div>
                    ))}
                    {past && [...d.defects, ...d.reports].map((it) => (
                        <div key={it.id} className={`tp-card past ${isDefect(it) ? 'defect' : 'report'}`}>
                            <div className="tp-card-title">{it.title}</div>
                            <div className="tp-card-meta">{it.summary}</div>
                        </div>
                    ))}
                    {empty && <div className="tp-empty-small">—</div>}
                </div>
            );
        })}
    </div>
);

const YearGrid: React.FC<{
    year: number; todayIso: string; selected: string; dayData: DayDataFn;
    onSelect: (d: string, toDay?: boolean) => void; onMonth: (m: number) => void;
}> = ({year, todayIso, selected, dayData, onSelect, onMonth}) => (
    <div className="tp-year-wrap">
        <div className="tp-year">
            {MONTHS.map((name, m) => {
                const offset = weekdayIndex(new Date(year, m, 1));
                const len = new Date(year, m + 1, 0).getDate();
                let reports = 0, defects = 0, warns = 0, tasks = 0;
                const cells = Array.from({length: len}, (_, n) => {
                    const day = new Date(year, m, n + 1);
                    const k = iso(day);
                    const d = dayData(k);
                    const w = warningCount(d) + d.defects.length;
                    reports += d.reports.length;
                    defects += d.defects.length;
                    warns += warningCount(d);
                    tasks += d.tasks.length;
                    // Vergangenheit: grün = Bericht, orange/rot = Probleme • Zukunft: blau nach Menge geplanter Arbeit
                    let bg = '';
                    if (k <= todayIso) {
                        if (w > 1) bg = '#dc2626';
                        else if (w === 1) bg = '#f59e0b';
                        else if (d.reports.length > 0) bg = '#22c55e';
                    } else {
                        const load = d.tasks.length + d.appts.length;
                        if (load >= 4) bg = '#1d4ed8';
                        else if (load >= 2) bg = '#60a5fa';
                        else if (load === 1) bg = '#bfdbfe';
                    }
                    return (
                        <button
                            key={k}
                            className={`tp-year-day ${bg ? 'filled' : ''} ${k === todayIso ? 'today' : ''} ${k === selected ? 'selected' : ''}`}
                            style={{background: bg || undefined, gridColumnStart: n === 0 ? offset + 1 : undefined}}
                            onClick={() => onSelect(k)}
                            onDoubleClick={() => onSelect(k, true)}
                            title={`${fmt(day, {weekday: 'short', day: '2-digit', month: '2-digit'})}: ${d.reports.length} Bericht(e), ${d.defects.length} Mängel, ${d.tasks.length} Vorgänge, ${d.appts.length} Termine`}
                        >
                            {n + 1}
                        </button>
                    );
                });
                return (
                    <div key={name} className="tp-year-month">
                        <div className="tp-year-month-head">
                            <button className="tp-year-title" onClick={() => onMonth(m)}>{name}</button>
                            <div className="tp-year-stats">
                                <span title="Berichte"><FileText size={10}/>{reports}</span>
                                <span title="Mängel"><Wrench size={10}/>{defects}</span>
                                <span title="Warnungen"><AlertTriangle size={10}/>{warns}</span>
                                <span title="geplante Vorgangs-Tage"><ClipboardList size={10}/>{tasks}</span>
                            </div>
                        </div>
                        <div className="tp-year-grid">
                            {WEEKDAYS.map((w) => <span key={w} className="tp-year-wd">{w[0]}</span>)}
                            {cells}
                        </div>
                    </div>
                );
            })}
        </div>
        <div className="tp-legend">
            <span><i style={{background: '#22c55e'}}/>Bericht</span>
            <span><i style={{background: '#f59e0b'}}/>1 Problem</span>
            <span><i style={{background: '#dc2626'}}/>mehrere Probleme</span>
            <span><i style={{background: '#bfdbfe'}}/>wenig geplant</span>
            <span><i style={{background: '#1d4ed8'}}/>viel geplant</span>
        </div>
    </div>
);

/** Gesamt: Balkenplan aller Vorgänge über die Projektlaufzeit + Aktivität je Monat */
const ProjectGantt: React.FC<{
    from: Date; to: Date; today: Date;
    tasksByDay: Record<string, DayTask[]>; itemsByDay: Record<string, TimelineItem[]>;
    showTasks: boolean; matches: (s: string) => boolean; onSelect: (d: string) => void;
}> = ({from, to, today, tasksByDay, itemsByDay, showTasks, matches, onSelect}) => {
    const total = Math.max(1, daysBetween(from, to) + 1);
    const frac = (d: Date) => Math.min(Math.max(daysBetween(from, d), 0), total) / total;
    const pct = (d: Date) => `${frac(d) * 100}%`;

    const bars = useMemo(() => {
        const map = new Map<number, { t: DayTask; start: string; end: string; last: DayTask }>();
        Object.entries(tasksByDay).forEach(([date, tasks]) => {
            tasks.forEach((tk) => {
                const cur = map.get(tk.taskId);
                if (!cur) map.set(tk.taskId, {t: tk, start: date, end: date, last: tk});
                else {
                    if (date < cur.start) cur.start = date;
                    if (date > cur.end) {
                        cur.end = date;
                        cur.last = tk;
                    }
                }
            });
        });
        return Array.from(map.values())
            .filter((b) => matches(`${b.t.title} ${b.t.trade ?? ''} ${b.t.company ?? ''}`))
            .sort((a, b) => a.start.localeCompare(b.start));
    }, [tasksByDay, matches]);

    const months: Date[] = [];
    for (let m = new Date(from.getFullYear(), from.getMonth(), 1); m <= to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);

    const activity = months.map((m) => {
        let reports = 0, problems = 0;
        const end = new Date(m.getFullYear(), m.getMonth() + 1, 0);
        for (let d = m; d <= end; d = addDays(d, 1)) {
            (itemsByDay[iso(d)] ?? []).forEach((it) => {
                if (it.type === 'report') reports++;
                if (it.type === 'alert' || isDefect(it)) problems++;
            });
        }
        return {reports, problems};
    });
    const maxAct = Math.max(1, ...activity.map((a) => Math.max(a.reports, a.problems)));
    const todayFrac = frac(today);

    return (
        <div className="tp-gantt">
            <div className="tp-gantt-row scale">
                <div className="tp-gantt-label"/>
                <div className="tp-gantt-track">
                    {months.map((m) => (
                        <span key={m.toISOString()} className="tp-gantt-month" style={{left: pct(m)}}>{fmt(m, {month: 'short', year: '2-digit'})}</span>
                    ))}
                    <div className="tp-gantt-today" style={{left: `${todayFrac * 100}%`}} title="Heute"/>
                </div>
            </div>

            <div className="tp-gantt-row activity">
                <div className="tp-gantt-label"><strong>Aktivität</strong><span>Berichte / Probleme je Monat</span></div>
                <div className="tp-gantt-track">
                    {months.map((m, idx) => {
                        const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
                        const end = next < to ? next : addDays(to, 1);
                        const a = activity[idx];
                        return (
                            <div key={m.toISOString()} className="tp-act" style={{left: pct(m), width: `${(frac(end) - frac(m)) * 100}%`}}
                                 title={`${fmt(m, {month: 'long', year: 'numeric'})}: ${a.reports} Berichte, ${a.problems} Warnungen/Mängel`}>
                                <div className="tp-act-bar report" style={{height: `${(a.reports / maxAct) * 100}%`}}/>
                                <div className="tp-act-bar problem" style={{height: `${(a.problems / maxAct) * 100}%`}}/>
                            </div>
                        );
                    })}
                    <div className="tp-gantt-today" style={{left: `${todayFrac * 100}%`}}/>
                </div>
            </div>

            {showTasks && bars.length === 0 && (
                <div className="tp-empty">Keine Vorgänge im Bauzeitenplan (Stammdaten → Bauzeitenpläne).</div>
            )}
            {showTasks && bars.map((b) => {
                const s = parseIso(b.start);
                const e = addDays(parseIso(b.end), 1);
                return (
                    <div key={b.t.taskId} className="tp-gantt-row">
                        <div className="tp-gantt-label" title={b.t.title}>
                            <strong>{b.t.code ? `${b.t.code} ` : ''}{b.t.title}</strong>
                            <span>{b.last.company || b.t.trade || ''}</span>
                        </div>
                        <div className="tp-gantt-track">
                            <button
                                className={`tp-gantt-bar ${b.last.isOverdue ? 'overdue' : b.last.status}`}
                                style={{left: pct(s), width: `max(4px, ${(frac(e) - frac(s)) * 100}%)`}}
                                onClick={() => onSelect(b.start)}
                                title={`${b.t.title}: ${fmt(s, {day: '2-digit', month: '2-digit'})} – ${fmt(parseIso(b.end), {day: '2-digit', month: '2-digit', year: 'numeric'})} • Ist ${b.last.actualPercent} %`}
                            >
                                <span className="tp-gantt-fill" style={{width: `${Math.min(100, b.last.actualPercent)}%`}}/>
                            </button>
                            <div className="tp-gantt-today" style={{left: `${todayFrac * 100}%`}}/>
                        </div>
                    </div>
                );
            })}
            <div className="tp-legend">
                <span><i style={{background: '#3b82f6'}}/>im Plan</span>
                <span><i style={{background: '#f59e0b'}}/>Achtung</span>
                <span><i style={{background: '#dc2626'}}/>Verzug / Restarbeiten</span>
                <span><i style={{background: '#0f172a', width: '2px'}}/>Heute</span>
                <span>Dunkle Füllung = Ist-Fortschritt</span>
            </div>
        </div>
    );
};

const TYPE_ICON: Record<TimelineItem['type'], React.ReactNode> = {
    report: <FileText size={12}/>,
    note: <StickyNote size={12}/>,
    notice: <Mail size={12}/>,
    progress: <TrendingUp size={12}/>,
    alert: <AlertTriangle size={12}/>
};

const TimelineRow: React.FC<{ it: TimelineItem; navigate: ReturnType<typeof useNavigate> }> = ({it, navigate}) => (
    <div className={`tp-tl ${it.severity ?? 'info'}`}>
        <div className="tp-tl-top">
            <span className="tp-tl-title">{TYPE_ICON[it.type]} {it.title}</span>
            {it.time && <span className="tp-tl-time">{it.time}</span>}
        </div>
        <div className="tp-tl-sum">{it.summary}</div>
        <div className="tp-tl-foot">
            <span>🔍 {it.source}</span>
            {it.type === 'notice' && it.refId != null && (
                <button className="tp-link" onClick={() => navigate('/drafts', {state: {noticeId: it.refId}})}>Brief öffnen</button>
            )}
            {it.type === 'alert' && (
                <button className="tp-link danger" onClick={() => navigate('/drafts', {state: {type: 'delay', keywords: `${it.title}. ${it.summary} (Quelle: ${it.source})`}})}>
                    <Mail size={11}/> Brief
                </button>
            )}
        </div>
    </div>
);

/** Rechte Spalte bzw. Tagesansicht: alles zu einem Tag */
const DayDetail: React.FC<{
    date: string;
    rel: 'past' | 'today' | 'future';
    data: DayInfo;
    navigate: ReturnType<typeof useNavigate>;
    onExport: (date: string, f: 'pdf' | 'docx') => void;
    onAdd: () => void;
    onDeleteLocal: (id: string) => void;
    onOpenDay?: () => void;
    large?: boolean;
}> = ({date, rel, data, navigate, onExport, onAdd, onDeleteLocal, onOpenDay, large}) => {
    const d = parseIso(date);
    const report = data.reports[0];
    const events = [...data.notes, ...data.notices, ...data.progress, ...data.alerts].sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
    const weekend = weekdayIndex(d) >= 5;
    const dateDe = fmt(d, {day: '2-digit', month: '2-digit', year: 'numeric'});

    const past = (
        <section className="tp-section">
            <h3><CheckCircle2 size={14}/> Was passiert ist</h3>

            <div className="tp-block">
                <div className="tp-block-head">
                    <span><FileText size={13}/> Bautagesbericht</span>
                    {report ? (
                        <div className="tp-block-actions">
                            <button className="tp-link" onClick={() => navigate('/reports', {state: {date}})}>Öffnen</button>
                            <button className="tp-link" onClick={() => onExport(date, 'pdf')}>PDF</button>
                            <button className="tp-link" onClick={() => onExport(date, 'docx')}>Word</button>
                        </div>
                    ) : (
                        !weekend && <button className="tp-link" onClick={() => navigate('/reports', {state: {date}})}>Bericht anlegen</button>
                    )}
                </div>
                {report ? (
                    <p className="tp-text">{report.summary}</p>
                ) : (
                    <p className="tp-muted">{weekend ? 'Wochenende – kein Bericht.' : 'Kein Bericht für diesen Tag.'}</p>
                )}
            </div>

            <div className="tp-block">
                <div className="tp-block-head">
                    <span><Camera size={13}/> Fotos</span>
                    <ComingSoonBadge/>
                </div>
                <div className="tp-photo-placeholder">
                    <button className="tp-btn" disabled title="Foto-Galerie je Tag – Backend folgt"><Camera size={13}/> Fotos anzeigen</button>
                    <button className="tp-btn" onClick={() => navigate('/reports', {state: {date}})} title="Fotos im Tagesbericht hochladen">
                        <Plus size={13}/> Foto hinzufügen
                    </button>
                </div>
            </div>

            <div className="tp-block">
                <div className="tp-block-head"><span><Wrench size={13}/> Mängel ({data.defects.length})</span></div>
                {data.defects.length === 0
                    ? <p className="tp-muted">Keine Mängel erfasst.</p>
                    : data.defects.map((it) => <TimelineRow key={it.id} it={it} navigate={navigate}/>)}
            </div>

            {events.length > 0 && (
                <div className="tp-block">
                    <div className="tp-block-head"><span><StickyNote size={13}/> Ereignisse ({events.length})</span></div>
                    {events.map((it) => <TimelineRow key={it.id} it={it} navigate={navigate}/>)}
                </div>
            )}
        </section>
    );

    const plan = (
        <section className="tp-section">
            <h3><ClipboardList size={14}/> {rel === 'past' ? 'Was geplant war' : 'Was zu tun ist'}</h3>
            <div className="tp-block">
                <div className="tp-block-head"><span><ClipboardList size={13}/> Arbeiten laut Bauzeitenplan ({data.tasks.length})</span></div>
                {data.tasks.length === 0 ? <p className="tp-muted">Keine Vorgänge geplant.</p> : data.tasks.map((tk) => (
                    <div key={tk.taskId} className={`tp-task ${tk.isOverdue ? 'overdue' : tk.status}`}>
                        <div className="tp-task-top">
                            <strong>{tk.code ? `${tk.code} ` : ''}{tk.title}</strong>
                            <span className={`tp-status ${tk.isOverdue ? 'overdue' : tk.status}`}>
                                {tk.isOverdue ? 'Restarbeiten' : tk.status === 'delayed' ? 'Verzug' : tk.status === 'warning' ? 'Achtung' : 'im Plan'}
                            </span>
                        </div>
                        <div className="tp-task-meta">
                            {tk.isStart && <span><PlayCircle size={11}/> Start</span>}
                            {tk.isEnd && <span><Flag size={11}/> Soll-Ende</span>}
                            {(tk.company || tk.trade) && <span>{tk.company || tk.trade}</span>}
                            {tk.plannedWorkforce != null && <span><Users size={11}/> Soll {tk.plannedWorkforce} P.</span>}
                        </div>
                        <div className="tp-progress" title={`Ist ${tk.actualPercent} % • Soll ${tk.planPercent} %`}>
                            <div className="tp-progress-fill" style={{width: `${Math.min(100, tk.actualPercent)}%`}}/>
                            <div className="tp-progress-plan" style={{left: `${Math.min(100, tk.planPercent)}%`}}/>
                        </div>
                        <div className="tp-task-foot">
                            <span>Ist {tk.actualPercent} % • Soll {tk.planPercent} %</span>
                            {(tk.status === 'delayed' || tk.isOverdue) && (
                                <button
                                    className="tp-link danger"
                                    onClick={() => navigate('/drafts', {
                                        state: {type: 'delay', keywords: `${tk.title}: Soll ${tk.planPercent} %, Ist ${tk.actualPercent} % am ${dateDe}. Quelle: ${tk.source}`}
                                    })}
                                >
                                    <Mail size={11}/> Behinderung
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="tp-block">
                <div className="tp-block-head">
                    <span><CalendarIcon size={13}/> Termine ({data.appts.length})</span>
                    <button className="tp-link" onClick={onAdd}><Plus size={11}/> Termin</button>
                </div>
                {data.appts.length === 0 ? <p className="tp-muted">Keine Termine.</p> : data.appts.map((a) => (
                    <div key={a.id} className="tp-appt" style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}>
                        <div className="tp-appt-top">
                            <strong>{a.time ? `${a.time.slice(0, 5)} • ` : ''}{a.title}</strong>
                            {a.local && (
                                <button className="tp-icon-btn small" title="Lokalen Termin löschen" onClick={() => onDeleteLocal(a.id)}>
                                    <Trash2 size={11}/>
                                </button>
                            )}
                        </div>
                        <div className="tp-appt-meta">
                            {CATEGORY[a.category]?.label}{a.trade ? ` • ${a.trade}` : ''}{a.isUrgent ? ' • dringend' : ''}{a.local ? ' • lokal' : ''}
                        </div>
                        {a.description && <div className="tp-appt-desc">{a.description}</div>}
                        {a.vobReference && <div className="tp-appt-meta">⚖️ {a.vobReference}</div>}
                        {a.category === 'deadline' && (
                            <button className="tp-link danger" onClick={() => navigate('/drafts', {
                                state: {type: 'delay', keywords: [a.title, a.description, `Frist: ${dateDe}`].filter(Boolean).join('. ')}
                            })}>
                                <Mail size={11}/> VOB-Brief
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );

    return (
        <div className={`tp-detail ${large ? 'large' : ''}`}>
            <div className="tp-detail-head">
                <div>
                    <div className="tp-detail-date">{fmt(d, {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'})}</div>
                    <span className={`tp-rel ${rel}`}>{rel === 'past' ? 'Rückblick' : rel === 'today' ? 'Heute' : 'Planung'}</span>
                </div>
                {onOpenDay && <button className="tp-link" onClick={onOpenDay}>Tagesansicht →</button>}
            </div>
            <div className={large ? 'tp-detail-cols' : 'tp-detail-stack'}>
                {rel === 'future' ? plan : past}
                {rel !== 'future' && plan}
            </div>
        </div>
    );
};

export default Termin;
