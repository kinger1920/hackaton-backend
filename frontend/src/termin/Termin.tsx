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
    Pencil,
    Lock,
    Flag,
    PlayCircle,
    CheckCircle2
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {api, AppointmentCategory, DayTask, saveBlob, ScheduleAppointment, SitePhotoOut, TimelineItem} from '../services/api';
import DeadlineRadar from '../ideas/DeadlineRadar';
import {addDays, daysBetween, formatDe, isoWeek, parseIsoDate, startOfToday, startOfWeek, toIsoDate, weekdayIndex} from '../utils/dates';
import '@frontend/src/index.css';
import './Termin.css';

/**
 * Terminplaner & Kalender – alles auf einer Seite, komplett über das Backend.
 *  Vergangenheit:   GET /api/timeline      (Berichte, Notizen, Briefe/Mängel, Fortschritt, Warnungen; max. 92 Tage je Abruf)
 *  Planung:         GET /api/schedule      (Arbeiten je Werktag aus dem Bauzeitenplan + manuelle & automatische Termine; max. 31 Tage je Abruf)
 *  Eigene Termine:  POST/PATCH/DELETE /api/appointments (manuelle Termine in der DB; automatische Termine bleiben read-only mit Quellenhinweis)
 *  Fotos:           GET/POST/DELETE /api/photos (Baustellenfotos je Kalendertag inkl. KI-/Offline-Beschreibung)
 */

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

type View = 'day' | 'week' | 'month' | 'year' | 'deadlines';

type Appt = ScheduleAppointment;

interface DayInfo {
    tasks: DayTask[];
    appts: Appt[];
    reports: TimelineItem[];
    notes: TimelineItem[];
    notices: TimelineItem[];
    progress: TimelineItem[];
    alerts: TimelineItem[];
    defects: TimelineItem[];
    photos: SitePhotoOut[];
}

type DayDataFn = (d: string) => DayInfo;

const VIEWS: { id: View; label: string }[] = [
    {id: 'day', label: 'Tag'},
    {id: 'week', label: 'Woche'},
    {id: 'month', label: 'Monat'},
    {id: 'year', label: 'Jahr'},
    {id: 'deadlines', label: 'Fristen'}
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

const iso = toIsoDate;
const parseIso = parseIsoDate;
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => formatDe(d, opts);
const todayDate = startOfToday;

/** Ist ein Timeline-Eintrag ein Mangel? (Mängelrüge-Brief oder Diktat "Mangel") */
const isDefect = (it: TimelineItem) => /m[äa]ngel/i.test(`${it.title} ${it.summary}`);
const warningCount = (d: DayInfo) =>
    d.alerts.length + [...d.reports, ...d.notes].filter((it) => it.severity === 'warning' || it.severity === 'critical').length;

function rangeFor(view: View, anchor: Date): [Date, Date] {
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
    const [visibleCategories, setVisibleCategories] = useState<Set<AppointmentCategory>>(
        () => new Set(Object.keys(CATEGORY) as AppointmentCategory[])
    );
    const [search, setSearch] = useState('');

    // Daten (akkumuliert über alle geladenen Zeiträume)
    const [tasksByDay, setTasksByDay] = useState<Record<string, DayTask[]>>({});
    const [items, setItems] = useState<Record<string, TimelineItem>>({});
    const [backendAppts, setBackendAppts] = useState<Record<string, ScheduleAppointment>>({});
    const [photosById, setPhotosById] = useState<Record<number, SitePhotoOut>>({});
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [activePhoto, setActivePhoto] = useState<SitePhotoOut | null>(null);
    const [showIcsModal, setShowIcsModal] = useState(false);
    const [icsCopied, setIcsCopied] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const loaded = useRef<Set<string>>(new Set());

    // Manuelle Termine (anlegen / bearbeiten) & Hinweis-Modal für automatische Termine
    const [showAdd, setShowAdd] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [modalError, setModalError] = useState<string | null>(null);
    const [autoInfo, setAutoInfo] = useState<Appt | null>(null);
    const emptyForm = (date: string): SiteAppointment => ({
        id: '', projectId, title: '', date, time: '09:00', category: 'meeting', trade: '', description: '', vobReference: '', isUrgent: false
    });
    const [form, setForm] = useState<SiteAppointment>(emptyForm(todayIso));

    const [rangeFrom, rangeTo] = rangeFor(view, anchor);
    const rangeKey = `${iso(rangeFrom)}:${iso(rangeTo)}`;

    // Projektwechsel → alles zurücksetzen & ggf. noch vorhandene alte localStorage-Termine einmalig ins Backend migrieren
    useEffect(() => {
        loaded.current.clear();
        setTasksByDay({});
        setItems({});
        setBackendAppts({});
        setPhotosById({});
        setError(null);
        setAutoInfo(null);
        setActivePhoto(null);

        const legacyKey = `siteAppointments_${projectId}`;
        try {
            const raw = localStorage.getItem(legacyKey);
            if (raw) {
                const legacyList: SiteAppointment[] = JSON.parse(raw);
                if (Array.isArray(legacyList) && legacyList.length > 0) {
                    Promise.all(
                        legacyList.map((a) =>
                            api.createAppointment({
                                projectId,
                                title: a.title,
                                date: a.date,
                                time: a.time || null,
                                category: a.category || 'meeting',
                                trade: a.trade || null,
                                description: a.description || null,
                                vobReference: a.vobReference || null,
                                isUrgent: !!a.isUrgent
                            })
                        )
                    )
                        .then((migrated) => {
                            localStorage.removeItem(legacyKey);
                            setBackendAppts((prev) => {
                                const next = {...prev};
                                migrated.forEach((m) => (next[m.id] = m));
                                return next;
                            });
                        })
                        .catch(() => undefined);
                } else {
                    localStorage.removeItem(legacyKey);
                }
            }
        } catch {
            // ignore
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
        const photoKey = `${projectId}:ph:${iso(from)}:${iso(to)}`;
        if (!loaded.current.has(photoKey)) {
            loaded.current.add(photoKey);
            jobs.push(
                api.listPhotos(projectId, iso(from), iso(to)).then((list) => {
                    setPhotosById((prev) => {
                        const next = {...prev};
                        list.forEach((p) => (next[p.id] = p));
                        return next;
                    });
                }).catch((err) => {
                    loaded.current.delete(photoKey);
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
        setPhotosById({});
        loadRange(rangeFrom, rangeTo);
    };

    // ---------- abgeleitete Daten ----------
    const q = search.trim().toLowerCase();
    const matches = (text: string) => !q || text.toLowerCase().includes(q);

    const allAppts: Appt[] = useMemo(() => Object.values(backendAppts), [backendAppts]);

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

    const photosByDay = useMemo(() => {
        const map: Record<string, SitePhotoOut[]> = {};
        Object.values(photosById).forEach((p) => {
            (map[p.report_date] ??= []).push(p);
        });
        Object.values(map).forEach((l) => l.sort((a, b) => b.id - a.id));
        return map;
    }, [photosById]);

    /** Alles zu einem Tag, gefiltert nach Termin-Kategorie + Suche */
    const dayData: DayDataFn = (d) => {
        const its = (itemsByDay[d] ?? []).filter((it) => matches(`${it.title} ${it.summary}`));
        const pick = (type: TimelineItem['type']) =>
            its.filter((it) => it.type === type && !isDefect(it));
        return {
            tasks: (tasksByDay[d] ?? []).filter((tk) => matches(`${tk.title} ${tk.trade ?? ''} ${tk.company ?? ''}`)),
            appts: (apptsByDay[d] ?? []).filter((a) => visibleCategories.has(a.category) && matches(`${a.title} ${a.description ?? ''}`)),
            reports: pick('report'),
            notes: pick('note'),
            notices: pick('notice'),
            progress: pick('progress'),
            alerts: pick('alert'),
            defects: its.filter(isDefect),
            photos: (photosByDay[d] ?? []).filter((p) => matches(`${p.caption} ${p.diary_text} ${p.issues.join(' ')}`))
        };
    };

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
        if (v !== 'deadlines') setAnchor(parseIso(selected));
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
        }
    })();

    // ---------- Aktionen ----------
    const toggleCategory = (c: AppointmentCategory) => {
        setVisibleCategories((prev) => {
            const next = new Set(prev);
            if (next.has(c)) next.delete(c);
            else next.add(c);
            return next;
        });
    };

    const openAdd = (date: string) => {
        setEditingId(null);
        setModalError(null);
        setForm(emptyForm(date));
        setShowAdd(true);
    };

    const openEdit = (a: Appt) => {
        if (!a.editable) {
            setAutoInfo(a);
            return;
        }
        setEditingId(a.id);
        setModalError(null);
        setForm({
            id: a.id,
            projectId,
            title: a.title,
            date: a.date,
            time: a.time ?? '',
            category: a.category,
            trade: a.trade ?? '',
            description: a.description ?? '',
            vobReference: a.vobReference ?? '',
            isUrgent: !!a.isUrgent
        });
        setShowAdd(true);
    };

    const submitAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.title.trim() || saving) return;
        setSaving(true);
        setModalError(null);
        try {
            const payload = {
                title: form.title.trim(),
                date: form.date,
                time: form.time?.trim() || null,
                category: form.category,
                trade: form.trade?.trim() || null,
                description: form.description?.trim() || null,
                vobReference: form.vobReference?.trim() || null,
                isUrgent: !!form.isUrgent
            };
            const saved = editingId
                ? await api.updateAppointment(editingId, payload)
                : await api.createAppointment({projectId, ...payload});
            setBackendAppts((prev) => ({...prev, [saved.id]: saved}));
            setShowAdd(false);
            setEditingId(null);
            setSelected(saved.date);
        } catch (err: any) {
            setModalError(err?.message || 'Termin konnte nicht gespeichert werden');
        } finally {
            setSaving(false);
        }
    };

    const deleteAppt = async (a: Appt) => {
        if (!a.editable) {
            setAutoInfo(a);
            return;
        }
        try {
            await api.deleteAppointment(a.id);
            setBackendAppts((prev) => {
                const next = {...prev};
                delete next[a.id];
                return next;
            });
        } catch (err: any) {
            setError(err?.message || 'Termin konnte nicht gelöscht werden');
        }
    };

    const handleUploadPhotos = async (date: string, files: FileList | null) => {
        if (!files || files.length === 0) return;
        setUploadingPhoto(true);
        setError(null);
        try {
            const uploaded = await Promise.all(
                Array.from(files).map((file) => api.uploadPhoto(file, projectId, date))
            );
            setPhotosById((prev) => {
                const next = {...prev};
                uploaded.forEach((p) => (next[p.id] = p));
                return next;
            });
        } catch (err: any) {
            setError(err?.message || 'Foto konnte nicht hochgeladen werden');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const handleDeletePhoto = async (photo: SitePhotoOut) => {
        try {
            await api.deletePhoto(photo.id);
            setPhotosById((prev) => {
                const next = {...prev};
                delete next[photo.id];
                return next;
            });
            if (activePhoto?.id === photo.id) setActivePhoto(null);
        } catch (err: any) {
            setError(err?.message || 'Foto konnte nicht gelöscht werden');
        }
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

    // ---------- Darstellung ----------
    const sel = dayData(selected);
    const selRel: 'past' | 'today' | 'future' = selected < todayIso ? 'past' : selected === todayIso ? 'today' : 'future';
    const icsFeedUrl = api.getScheduleIcsUrl(projectId);

    return (
        <div className="tp-page">
            {/* Kopfzeile */}
            <div className="tp-header">
                <div className="tp-title-group">
                    <div className="tp-title-icon"><CalendarIcon size={22}/></div>
                    <div>
                        <h1 className="tp-title">{t('nav_termin', 'Terminplaner')}</h1>
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
                    <button className="tp-btn" onClick={() => setShowIcsModal(true)} title="Live-Kalender-Abo (Outlook/Google/Apple) über Backend-Feed">
                        <Link2 size={14}/> <span>Kalender verbinden</span>
                    </button>
                    <button className="tp-btn" onClick={() => window.print()} title="Drucken"><Printer size={14}/></button>
                    <button className="btn btn-primary" onClick={() => openAdd(selected)}>
                        <Plus size={15}/> <span>Termin</span>
                    </button>
                </div>
            </div>

            {/* Kategorien-Farblegende */}
            {view !== 'deadlines' && (
                <div className="tp-layers">
                    {(Object.entries(CATEGORY) as [AppointmentCategory, { label: string; color: string }][]).map(([cat, info]) => (
                        <button
                            key={cat}
                            className={`tp-layer ${visibleCategories.has(cat) ? 'on' : ''}`}
                            style={{'--layer': info.color} as React.CSSProperties}
                            onClick={() => toggleCategory(cat)}
                            title={`${info.label} ein-/ausblenden`}
                        >
                            <i/>{info.label}
                        </button>
                    ))}
                </div>
            )}

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
                    {view !== 'deadlines' && (
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
                    <input placeholder="Suchen: Vorgang, Firma, Termin, Foto…" value={search} onChange={(e) => setSearch(e.target.value)}/>
                    {search && <button className="tp-icon-btn small" onClick={() => setSearch('')} aria-label="Suche leeren"><X size={12}/></button>}
                </div>
            </div>

            {/* Fristen-Ansicht */}
            {view === 'deadlines' && <DeadlineRadar embedded/>}

            {view !== 'deadlines' && <>
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
                                   onAdd={() => openAdd(selected)} onEdit={openEdit} onDelete={deleteAppt}
                                   onUploadPhotos={(files) => handleUploadPhotos(selected, files)}
                                   onDeletePhoto={handleDeletePhoto} onOpenPhoto={setActivePhoto}
                                   uploadingPhoto={uploadingPhoto} large/>
                    )}
                    {view === 'year' && (
                        <YearGrid year={anchor.getFullYear()} todayIso={todayIso} selected={selected} dayData={dayData}
                                  onSelect={selectDay}
                                  onMonth={(m) => {
                                      setAnchor(new Date(anchor.getFullYear(), m, 1));
                                      setView('month');
                                  }}/>
                    )}
                </div>

                {view !== 'day' && (
                    <aside className="tp-side">
                        <DayDetail date={selected} rel={selRel} data={sel} navigate={navigate} onExport={exportReport}
                                   onAdd={() => openAdd(selected)} onEdit={openEdit} onDelete={deleteAppt}
                                   onUploadPhotos={(files) => handleUploadPhotos(selected, files)}
                                   onDeletePhoto={handleDeletePhoto} onOpenPhoto={setActivePhoto}
                                   uploadingPhoto={uploadingPhoto}
                                   onOpenDay={() => selectDay(selected, true)}/>
                    </aside>
                )}
            </div>

            <div className="tp-footnote">
                Quellen: Bautagesberichte, Diktate, Briefe, Fotos, Bauzeitenplan und manuelle Termine aus dem Backend.
                Klick auf einen Tag zeigt Details, Doppelklick öffnet die Tagesansicht. Automatische Termine sind entsprechend gekennzeichnet.
            </div>
            </>}

            {/* Neuer / Bearbeiten Termin */}
            {showAdd && (
                <div className="tp-modal-overlay" onClick={() => !saving && setShowAdd(false)}>
                    <form className="tp-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitAdd}>
                        <div className="tp-modal-header">
                            <strong>{editingId ? 'Termin bearbeiten' : 'Neuer Termin / Frist'}</strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setShowAdd(false)} disabled={saving} aria-label="Schließen"><X size={16}/></button>
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
                        {modalError && <div className="tp-error">{modalError}</div>}
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)} disabled={saving}>Abbrechen</button>
                            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Speichert…' : 'Speichern'}</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Hinweis-Modal bei Bearbeitungs-Klick auf automatischen Termin */}
            {autoInfo && (
                <div className="tp-modal-overlay" onClick={() => setAutoInfo(null)}>
                    <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="tp-modal-header">
                            <strong><Lock size={15} style={{verticalAlign: '-2px', marginRight: 6}}/>Automatischer Termin</strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setAutoInfo(null)} aria-label="Schließen"><X size={16}/></button>
                        </div>
                        <div className="tp-auto-box">
                            <strong>{autoInfo.title}</strong>
                            <div className="tp-appt-meta">
                                {fmt(parseIso(autoInfo.date), {day: '2-digit', month: '2-digit', year: 'numeric'})}
                                {' • '}{CATEGORY[autoInfo.category]?.label}
                                {autoInfo.sourceLabel ? ` • Quelle: ${autoInfo.sourceLabel}` : ''}
                            </div>
                            {autoInfo.description && <div>{autoInfo.description}</div>}
                            {autoInfo.vobReference && <div className="tp-appt-meta">⚖️ {autoInfo.vobReference}</div>}
                        </div>
                        <p className="tp-auto-hint">
                            {autoInfo.source === 'workforce'
                                ? 'Dieser Hinweis wird automatisch aus dem Sollstärke-Check (Vertrag vs. Tagesbericht) berechnet und kann im Kalender nicht direkt bearbeitet werden. Sobald eine Behinderungsanzeige angelegt ist, verschwindet er automatisch.'
                                : 'Dieser Termin wird automatisch aus dem Bauzeitenplan berechnet und kann im Kalender nicht direkt bearbeitet werden. Änderungen am Start- oder Enddatum bitte direkt im Bauzeitenplan vornehmen.'}
                        </p>
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setAutoInfo(null)}>Schließen</button>
                            {autoInfo.source === 'workforce' ? (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => {
                                        const info = autoInfo;
                                        setAutoInfo(null);
                                        navigate('/drafts', {
                                            state: {type: 'delay', keywords: [info.title, info.description].filter(Boolean).join('. ')}
                                        });
                                    }}
                                >
                                    <Mail size={14}/> Behinderungsanzeige erstellen
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setAutoInfo(null);
                                        navigate('/stammdaten', {state: {tab: 'plans'}});
                                    }}
                                >
                                    Zum Bauzeitenplan
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Foto-Lightbox */}
            {activePhoto && (
                <div className="tp-modal-overlay" onClick={() => setActivePhoto(null)}>
                    <div className="tp-modal" style={{maxWidth: '680px'}} onClick={(e) => e.stopPropagation()}>
                        <div className="tp-modal-header">
                            <strong><Camera size={15} style={{verticalAlign: '-2px', marginRight: 6}}/>{activePhoto.caption}</strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setActivePhoto(null)} aria-label="Schließen"><X size={16}/></button>
                        </div>
                        <img
                            src={api.getPhotoFileUrl(activePhoto)}
                            alt={activePhoto.caption}
                            style={{width: '100%', maxHeight: '420px', objectFit: 'contain', borderRadius: '8px', background: '#0f172a'}}
                        />
                        <div className="tp-auto-box">
                            <div className="tp-appt-meta">
                                Aufnahmedatum: {fmt(parseIso(activePhoto.report_date), {day: '2-digit', month: '2-digit', year: 'numeric'})}
                                {' • '}Datei: {activePhoto.file_name}
                                {' • '}Analyse: {activePhoto.mode === 'ai' ? 'KI' : 'Regelbasiert'}
                            </div>
                            {activePhoto.diary_text && <div><strong>Tagebuch-Eintrag:</strong> {activePhoto.diary_text}</div>}
                            {activePhoto.issues.length > 0 && (
                                <div style={{color: '#b91c1c', fontWeight: 600}}>⚠️ {activePhoto.issues.join(' • ')}</div>
                            )}
                        </div>
                        <div className="tp-modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{color: '#dc2626'}}
                                onClick={() => handleDeletePhoto(activePhoto)}
                            >
                                <Trash2 size={14}/> Foto löschen
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => {
                                    const dt = activePhoto.report_date;
                                    setActivePhoto(null);
                                    navigate('/reports', {state: {date: dt}});
                                }}
                            >
                                Im Tagesbericht öffnen
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Kalender-Abo (.ics Feed) Modal */}
            {showIcsModal && (
                <div className="tp-modal-overlay" onClick={() => setShowIcsModal(false)}>
                    <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="tp-modal-header">
                            <strong><Link2 size={15} style={{verticalAlign: '-2px', marginRight: 6}}/>Kalender verbinden (Outlook / Google / Apple)</strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setShowIcsModal(false)} aria-label="Schließen"><X size={16}/></button>
                        </div>
                        <p className="tp-auto-hint">
                            Über diese Live-iCalendar-URL können alle Projekttermine (manuelle Termine, Bauzeitenplan-Meilensteine und VOB-Fristen) direkt in Outlook, Google Calendar oder Apple Kalender abonniert oder heruntergeladen werden:
                        </p>
                        <div style={{display: 'flex', gap: '8px'}}>
                            <input className="form-input" readOnly value={icsFeedUrl} onFocus={(e) => e.target.select()}/>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                    navigator.clipboard.writeText(icsFeedUrl);
                                    setIcsCopied(true);
                                    setTimeout(() => setIcsCopied(false), 2500);
                                }}
                            >
                                {icsCopied ? 'Kopiert!' : 'URL kopieren'}
                            </button>
                        </div>
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowIcsModal(false)}>Schließen</button>
                            <a className="btn btn-primary" href={icsFeedUrl} target="_blank" rel="noreferrer">
                                <Download size={14}/> Kompletten Projekt-Kalender (.ics) laden
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// =====================================================================
// Teil-Komponenten
// =====================================================================

/** Kleine Markierungen für eine Tageszelle */
const DayBadges: React.FC<{ d: DayInfo; compact?: boolean }> = ({d, compact}) => {
    const warn = warningCount(d);
    const late = d.tasks.some((tk) => tk.isOverdue || tk.status === 'delayed');
    return (
        <div className="tp-badges">
            {d.reports.length > 0 && <span className="tp-badge report" title="Bautagesbericht"><FileText size={10}/>{!compact && 'Bericht'}</span>}
            {d.photos.length > 0 && <span className="tp-badge photo" title={`${d.photos.length} Foto(s)`}><Camera size={10}/>{d.photos.length}</span>}
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
            const empty = d.tasks.length + d.appts.length + d.reports.length + d.defects.length + d.photos.length === 0;
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
                            title={`${fmt(day, {weekday: 'short', day: '2-digit', month: '2-digit'})}: ${d.reports.length} Bericht(e), ${d.defects.length} Mängel, ${d.tasks.length} Vorgänge, ${d.appts.length} Termine, ${d.photos.length} Fotos`}
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
            <span>Quelle: {it.source}</span>
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
    onEdit: (a: Appt) => void;
    onDelete: (a: Appt) => void;
    onUploadPhotos: (files: FileList | null) => void;
    onDeletePhoto: (p: SitePhotoOut) => void;
    onOpenPhoto: (p: SitePhotoOut) => void;
    uploadingPhoto?: boolean;
    onOpenDay?: () => void;
    large?: boolean;
}> = ({date, rel, data, navigate, onExport, onAdd, onEdit, onDelete, onUploadPhotos, onDeletePhoto, onOpenPhoto, uploadingPhoto, onOpenDay, large}) => {
    const d = parseIso(date);
    const report = data.reports[0];
    const events = [...data.notes, ...data.notices, ...data.progress, ...data.alerts].sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
    const weekend = weekdayIndex(d) >= 5;
    const dateDe = fmt(d, {day: '2-digit', month: '2-digit', year: 'numeric'});

    const photoBlock = (
        <div className="tp-block">
            <div className="tp-block-head">
                <span><Camera size={13}/> Fotos ({data.photos.length})</span>
                <label className="tp-link" style={{cursor: 'pointer'}}>
                    <Plus size={11}/> {uploadingPhoto ? 'Lädt…' : 'Foto hinzufügen'}
                    <input
                        type="file"
                        accept="image/*"
                        multiple
                        style={{display: 'none'}}
                        disabled={uploadingPhoto}
                        onChange={(e) => {
                            onUploadPhotos(e.target.files);
                            e.target.value = '';
                        }}
                    />
                </label>
            </div>
            {data.photos.length === 0 ? (
                <p className="tp-muted">Noch keine Fotos für diesen Tag hinterlegt.</p>
            ) : (
                <div className="tp-photo-grid">
                    {data.photos.map((p) => (
                        <div key={p.id} className="tp-photo-card" onClick={() => onOpenPhoto(p)}>
                            <img src={api.getPhotoFileUrl(p)} alt={p.caption} className="tp-photo-thumb"/>
                            <div className="tp-photo-body">
                                <div className="tp-photo-caption" title={p.caption}>{p.caption}</div>
                                {p.issues.length > 0 && (
                                    <div className="tp-photo-issue" title={p.issues.join(', ')}>⚠️ {p.issues[0]}</div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="tp-photo-del"
                                title="Foto löschen"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeletePhoto(p);
                                }}
                            >
                                <Trash2 size={11}/>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

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

            {photoBlock}

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
                {data.appts.length === 0 ? <p className="tp-muted">Keine Termine.</p> : data.appts.map((a) => {
                    const isAuto = !a.editable;
                    return (
                        <div key={a.id} className={`tp-appt ${isAuto ? 'auto' : ''}`} style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}>
                            <div className="tp-appt-top">
                                <strong>
                                    {a.time ? `${a.time.slice(0, 5)} • ` : ''}{a.title}
                                    {isAuto && (
                                        <span className="tp-auto-badge" title={`Automatisch aus ${a.sourceLabel || 'Bauzeitenplan'}`}>
                                            <Lock size={9}/> automatisch
                                        </span>
                                    )}
                                </strong>
                                <div className="tp-appt-actions">
                                    <button
                                        className="tp-icon-btn small"
                                        title={isAuto ? 'Automatischer Termin – Hinweis anzeigen' : 'Termin bearbeiten'}
                                        onClick={() => onEdit(a)}
                                    >
                                        <Pencil size={11}/>
                                    </button>
                                    {!isAuto && (
                                        <button className="tp-icon-btn small" title="Termin löschen" onClick={() => onDelete(a)}>
                                            <Trash2 size={11}/>
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="tp-appt-meta">
                                {CATEGORY[a.category]?.label}
                                {a.trade ? ` • ${a.trade}` : ''}
                                {a.isUrgent ? ' • dringend' : ''}
                                {isAuto && a.sourceLabel ? ` • ${a.sourceLabel}` : ''}
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
                    );
                })}
            </div>

            {rel === 'future' && photoBlock}
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
                {plan}
                {rel !== 'future' && past}
            </div>
        </div>
    );
};

export default Termin;
