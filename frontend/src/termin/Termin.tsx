import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    AlertTriangle,
    Calendar as CalendarIcon,
    Camera,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    ClipboardList,
    Download,
    FileText,
    Flag,
    Link2,
    Lock,
    Mail,
    Pencil,
    PlayCircle,
    Plus,
    Printer,
    RefreshCw,
    Search,
    StickyNote,
    Trash2,
    TrendingUp,
    Users,
    Wrench,
    X
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {
    api,
    AppointmentCategory,
    DayTask,
    saveBlob,
    ScheduleAppointment,
    SitePhotoOut,
    TimelineItem
} from '../services/api';
import DeadlineRadar from '../ideas/DeadlineRadar';
import {
    addDays,
    daysBetween,
    isoWeek,
    parseIsoDate,
    startOfToday,
    startOfWeek,
    toIsoDate,
    weekdayIndex
} from '../utils/dates';
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

// Ansichten; Beschriftung über die Übersetzung tm_view_<id>.
const VIEWS: View[] = ['day', 'week', 'month', 'year', 'deadlines'];

// Termin-Kategorien mit Farbe; Beschriftung über tm_cat_<kategorie>.
const CATEGORY: Record<AppointmentCategory, { color: string }> = {
    deadline: {color: '#dc2626'},
    milestone: {color: '#7c3aed'},
    inspection: {color: '#16a34a'},
    meeting: {color: '#2563eb'},
    delivery: {color: '#d97706'}
};

/** Wochentage Mo–So kurz, in der Sprache der Oberfläche (1.1.2024 war ein Montag). */
const weekdayNames = (locale: string) =>
    Array.from({length: 7}, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, {weekday: 'short'}));
/** Monatsnamen Januar–Dezember in der Sprache der Oberfläche. */
const monthNames = (locale: string) =>
    Array.from({length: 12}, (_, m) => new Date(2024, m, 1).toLocaleDateString(locale, {month: 'long'}));

const iso = toIsoDate;
const parseIso = parseIsoDate;
// Standard 'de-DE' für Texte, die in den deutschen Briefentwurf gehen; Oberfläche übergibt die Locale der Sprache.
const fmt = (d: Date, opts: Intl.DateTimeFormatOptions, locale = 'de-DE') => d.toLocaleDateString(locale, opts);
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
    const {t, tf, locale} = useLanguage();
    const catLabel = (c: AppointmentCategory) => t(`tm_cat_${c}`);
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const today = useMemo(todayDate, []);
    const todayIso = iso(today);

    // Startansicht: aus Navigation (z. B. /fristen → {view: 'deadlines'}), sonst Monat
    const navView = (useLocation().state as { view?: View } | null)?.view;
    const [view, setView] = useState<View>(navView && VIEWS.includes(navView) ? navView : 'month');
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
        setError(failed.length > 0 ? `${t('tm_load_partial')} ${failed[0].reason?.message ?? failed[0].reason}` : null);
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
                return fmt(anchor, {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'}, locale);
            case 'week':
                return `${t('tm_week_short')} ${isoWeek(rangeFrom)} • ${fmt(rangeFrom, {
                    day: '2-digit',
                    month: '2-digit'
                }, locale)} – ${fmt(rangeTo, {day: '2-digit', month: '2-digit', year: 'numeric'}, locale)}`;
            case 'month':
                return `${monthNames(locale)[anchor.getMonth()]} ${anchor.getFullYear()}`;
            case 'year':
                return String(anchor.getFullYear());
            case 'deadlines':
                return t('tm_deadlines_label');
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
            setModalError(err?.message || t('tm_save_failed'));
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
            setError(err?.message || t('tm_delete_failed'));
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
            setError(err?.message || t('tm_photo_upload_failed'));
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
            setError(err?.message || t('tm_photo_delete_failed'));
        }
    };

    /** Termine des sichtbaren Zeitraums als .ics (Outlook, Google, Apple) */
    const exportIcs = () => {
        const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
        const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EasyBuild//Terminplaner//DE'];
        allAppts
            .filter((a) => a.date >= iso(rangeFrom) && a.date <= iso(rangeTo))
            .forEach((a) => {
                const d = a.date.replace(/-/g, '');
                lines.push('BEGIN:VEVENT', `UID:${a.id}@baumanager`, `SUMMARY:${esc(a.title)}`);
                if (a.time) lines.push(`DTSTART:${d}T${a.time.slice(0, 5).replace(':', '')}00`);
                else lines.push(`DTSTART;VALUE=DATE:${d}`);
                const desc = [catLabel(a.category), a.trade, a.description, a.vobReference].filter(Boolean).join(' • ');
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
            alert(err?.message || t('tm_export_failed'));
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
                    </div>
                </div>
                <div className="tp-header-actions">
                    <button className="tp-btn" onClick={reload} title={t('btn_reload')}><RefreshCw size={14}
                                                                                                   className={loading ? 'tp-spin' : ''}/>
                    </button>
                    <button className="tp-btn" onClick={exportIcs} title={t('tm_ics_title')}>
                        <Download size={14}/> <span>.ics</span>
                    </button>
                    <button className="tp-btn" onClick={() => setShowIcsModal(true)} title={t('tm_connect_title')}>
                        <Link2 size={14}/> <span>{t('tm_connect')}</span>
                    </button>
                    <button className="tp-btn" onClick={() => window.print()} title={t('tm_print')}><Printer size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={() => openAdd(selected)}>
                        <Plus size={15}/> <span>{t('tm_appointment')}</span>
                    </button>
                </div>
            </div>

            {/* Kategorien-Farblegende */}
            {view !== 'deadlines' && (
                <div className="tp-layers">
                    {(Object.entries(CATEGORY) as [AppointmentCategory, { color: string }][]).map(([cat, info]) => (
                        <button
                            key={cat}
                            className={`tp-layer ${visibleCategories.has(cat) ? 'on' : ''}`}
                            style={{'--layer': info.color} as React.CSSProperties}
                            onClick={() => toggleCategory(cat)}
                            title={tf('tm_toggle_cat', {label: catLabel(cat)})}
                        >
                            <i/>{catLabel(cat)}
                        </button>
                    ))}
                </div>
            )}

            {/* Steuerleiste */}
            <div className="tp-toolbar">
                <div className="tp-segment" role="tablist" aria-label={t('tm_period')}>
                    {VIEWS.map((v) => (
                        <button key={v} className={view === v ? 'active' : ''} onClick={() => changeView(v)}>
                            {t(`tm_view_${v}`)}
                        </button>
                    ))}
                </div>
                <div className="tp-nav">
                    {view !== 'deadlines' && (
                        <>
                            <button className="tp-icon-btn" onClick={() => shift(-1)} aria-label={t('tm_back')}>
                                <ChevronLeft size={16}/></button>
                            <button className="tp-btn" onClick={goToday}>{t('tm_today')}</button>
                            <button className="tp-icon-btn" onClick={() => shift(1)} aria-label={t('tm_forward')}>
                                <ChevronRight size={16}/></button>
                        </>
                    )}
                    <span className="tp-range-label">{rangeLabel}</span>
                </div>
                <div className="tp-search">
                    <Search size={14}/>
                    <input placeholder={t('tm_search_ph')} value={search} onChange={(e) => setSearch(e.target.value)}/>
                    {search && <button className="tp-icon-btn small" onClick={() => setSearch('')}
                                       aria-label={t('tm_clear_search')}><X size={12}/></button>}
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
                {t('tm_footnote')}
            </div>
            </>}

            {/* Neuer / Bearbeiten Termin */}
            {showAdd && (
                <div className="tp-modal-overlay" onClick={() => !saving && setShowAdd(false)}>
                    <form className="tp-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitAdd}>
                        <div className="tp-modal-header">
                            <strong>{editingId ? t('tm_edit_appt') : t('tm_new_appt')}</strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setShowAdd(false)}
                                    disabled={saving} aria-label={t('btn_close')}><X size={16}/></button>
                        </div>
                        <div className="tp-form-grid">
                            <label className="span-2">{t('tm_f_title')}
                                <input className="form-input" required autoFocus value={form.title}
                                       onChange={(e) => setForm({...form, title: e.target.value})}/>
                            </label>
                            <label>{t('tm_f_date')}
                                <input className="form-input" type="date" required value={form.date} onChange={(e) => setForm({...form, date: e.target.value})}/>
                            </label>
                            <label>{t('tm_f_time')}
                                <input className="form-input" type="time" value={form.time ?? ''} onChange={(e) => setForm({...form, time: e.target.value})}/>
                            </label>
                            <label>{t('tm_f_category')}
                                <select className="form-input" value={form.category}
                                        onChange={(e) => setForm({...form, category: e.target.value as AppointmentCategory})}>
                                    {(Object.keys(CATEGORY) as AppointmentCategory[]).map((k) => <option key={k}
                                                                                                         value={k}>{catLabel(k)}</option>)}
                                </select>
                            </label>
                            <label>{t('tm_f_trade')}
                                <input className="form-input" value={form.trade ?? ''} onChange={(e) => setForm({...form, trade: e.target.value})}/>
                            </label>
                            <label className="span-2">{t('tm_f_desc')}
                                <textarea className="form-textarea" rows={2} value={form.description ?? ''}
                                          onChange={(e) => setForm({...form, description: e.target.value})}/>
                            </label>
                            <label>{t('tm_f_vob')}
                                <input className="form-input" placeholder={t('tm_f_vob_ph')}
                                       value={form.vobReference ?? ''}
                                       onChange={(e) => setForm({...form, vobReference: e.target.value})}/>
                            </label>
                            <label className="tp-check">
                                <input type="checkbox" checked={!!form.isUrgent} onChange={(e) => setForm({...form, isUrgent: e.target.checked})}/>
                                {t('tm_f_urgent')}
                            </label>
                        </div>
                        {modalError && <div className="tp-error">{modalError}</div>}
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}
                                    disabled={saving}>{t('btn_cancel')}</button>
                            <button type="submit" className="btn btn-primary"
                                    disabled={saving}>{saving ? t('tm_saving') : t('btn_save')}</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Hinweis-Modal bei Bearbeitungs-Klick auf automatischen Termin */}
            {autoInfo && (
                <div className="tp-modal-overlay" onClick={() => setAutoInfo(null)}>
                    <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="tp-modal-header">
                            <strong><Lock size={15} style={{verticalAlign: '-2px', marginRight: 6}}/>{t('tm_auto_appt')}
                            </strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setAutoInfo(null)}
                                    aria-label={t('btn_close')}><X size={16}/></button>
                        </div>
                        <div className="tp-auto-box">
                            <strong>{autoInfo.title}</strong>
                            <div className="tp-appt-meta">
                                {fmt(parseIso(autoInfo.date), {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric'
                                }, locale)}
                                {' • '}{catLabel(autoInfo.category)}
                                {autoInfo.sourceLabel ? ` • ${t('tm_source')} ${autoInfo.sourceLabel}` : ''}
                            </div>
                            {autoInfo.description && <div>{autoInfo.description}</div>}
                            {autoInfo.vobReference && <div className="tp-appt-meta">VOB: {autoInfo.vobReference}</div>}
                        </div>
                        <p className="tp-auto-hint">
                            {autoInfo.source === 'workforce'
                                ? t('tm_auto_workforce')
                                : t('tm_auto_plan')}
                        </p>
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary"
                                    onClick={() => setAutoInfo(null)}>{t('btn_close')}</button>
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
                                    <Mail size={14}/> {t('tm_create_delay')}
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
                                    {t('tm_to_plan')}
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
                            <button type="button" className="tp-icon-btn" onClick={() => setActivePhoto(null)}
                                    aria-label={t('btn_close')}><X size={16}/></button>
                        </div>
                        <img
                            src={api.getPhotoFileUrl(activePhoto)}
                            alt={activePhoto.caption}
                            style={{width: '100%', maxHeight: '420px', objectFit: 'contain', borderRadius: '8px', background: '#0f172a'}}
                        />
                        <div className="tp-auto-box">
                            <div className="tp-appt-meta">
                                {t('tm_photo_date')} {fmt(parseIso(activePhoto.report_date), {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric'
                            }, locale)}
                                {' • '}{t('tm_file')} {activePhoto.file_name}
                            </div>
                            {activePhoto.diary_text &&
                                <div><strong>{t('tm_diary_entry')}</strong> {activePhoto.diary_text}</div>}
                            {activePhoto.issues.length > 0 && (
                                <div style={{color: '#b91c1c', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px'}}>
                                    <AlertTriangle size={13}/> {activePhoto.issues.join(' • ')}
                                </div>
                            )}
                        </div>
                        <div className="tp-modal-actions">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{color: '#dc2626'}}
                                onClick={() => handleDeletePhoto(activePhoto)}
                            >
                                <Trash2 size={14}/> {t('tm_delete_photo')}
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
                                {t('tm_open_in_report')}
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
                            <strong><Link2 size={15}
                                           style={{verticalAlign: '-2px', marginRight: 6}}/>{t('tm_connect_modal')}
                            </strong>
                            <button type="button" className="tp-icon-btn" onClick={() => setShowIcsModal(false)}
                                    aria-label={t('btn_close')}><X size={16}/></button>
                        </div>
                        <p className="tp-auto-hint">
                            {t('tm_connect_hint')}
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
                                {icsCopied ? t('btn_copied') : t('tm_copy_url')}
                            </button>
                        </div>
                        <div className="tp-modal-actions">
                            <button type="button" className="btn btn-secondary"
                                    onClick={() => setShowIcsModal(false)}>{t('btn_close')}</button>
                            <a className="btn btn-primary" href={icsFeedUrl} target="_blank" rel="noreferrer">
                                <Download size={14}/> {t('tm_download_all')}
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
    const {t, tf} = useLanguage();
    const warn = warningCount(d);
    const late = d.tasks.some((tk) => tk.isOverdue || tk.status === 'delayed');
    return (
        <div className="tp-badges">
            {d.reports.length > 0 && <span className="tp-badge report" title={t('tm_badge_report')}><FileText
                size={10}/>{!compact && t('tm_badge_report_short')}</span>}
            {d.photos.length > 0 &&
                <span className="tp-badge photo" title={tf('tm_badge_photos', {n: d.photos.length})}><Camera
                    size={10}/>{d.photos.length}</span>}
            {d.defects.length > 0 && <span className="tp-badge defect" title={t('tm_badge_defects')}><Wrench
                size={10}/>{d.defects.length}</span>}
            {warn > 0 &&
                <span className="tp-badge alert" title={t('tm_badge_warnings')}><AlertTriangle size={10}/>{warn}</span>}
            {d.tasks.length > 0 && (
                <span className={`tp-badge task ${late ? 'late' : ''}`} title={t('tm_badge_tasks')}><ClipboardList
                    size={10}/>{d.tasks.length}</span>
            )}
        </div>
    );
};

const MonthGrid: React.FC<{
    anchor: Date; from: Date; todayIso: string; selected: string; dayData: DayDataFn; onSelect: (d: string, toDay?: boolean) => void;
}> = ({anchor, from, todayIso, selected, dayData, onSelect}) => {
    const {t, tf, locale} = useLanguage();
    const cells = Array.from({length: 42}, (_, n) => addDays(from, n));
    const visible = cells[35].getMonth() === anchor.getMonth() ? cells : cells.slice(0, 35);
    return (
        <div className="tp-month">
            {weekdayNames(locale).map((w) => <div key={w} className="tp-month-head">{w}</div>)}
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
                                <span key={a.id} className="tp-chip"
                                      style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}
                                      title={t(`tm_cat_${a.category}`)}>
                                    {a.time ? `${a.time.slice(0, 5)} ` : ''}{a.title}
                                </span>
                            ))}
                            {shownTasks.map((tk) => (
                                <span key={tk.taskId} className={`tp-chip task ${tk.status} ${tk.isOverdue ? 'overdue' : ''}`}>
                                    {tk.isStart ? '▶ ' : tk.isEnd ? '◼ ' : ''}{tk.title}
                                </span>
                            ))}
                            {rest > 0 && <span className="tp-more">{tf('tm_more', {n: rest})}</span>}
                        </div>
                    </button>
                );
            })}
        </div>
    );
};

const WeekColumns: React.FC<{
    from: Date; todayIso: string; selected: string; dayData: DayDataFn; onSelect: (d: string, toDay?: boolean) => void;
}> = ({from, todayIso, selected, dayData, onSelect}) => {
    const {t, tf, locale} = useLanguage();
    return (
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
                        <span>{weekdayNames(locale)[weekdayIndex(day)]}</span>
                        <strong>{fmt(day, {day: '2-digit', month: '2-digit'}, locale)}</strong>
                    </div>
                    <DayBadges d={d}/>
                    {d.appts.map((a) => (
                        <div key={a.id} className="tp-card appt" style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}>
                            <div className="tp-card-title">{a.time ? `${a.time.slice(0, 5)} • ` : ''}{a.title}</div>
                            <div
                                className="tp-card-meta">{t(`tm_cat_${a.category}`)}{a.isUrgent ? t('tm_urgent_suffix') : ''}</div>
                        </div>
                    ))}
                    {d.tasks.map((tk) => (
                        <div key={tk.taskId} className={`tp-card task ${tk.status} ${tk.isOverdue ? 'overdue' : ''}`}>
                            <div className="tp-card-title">{tk.isStart ? '▶ ' : tk.isEnd ? '◼ ' : ''}{tk.title}</div>
                            <div className="tp-card-meta">
                                {tk.company || tk.trade || '–'}{tk.plannedWorkforce ? ` • ${tk.plannedWorkforce} ${t('tm_persons_short')}` : ''} • {tf('tm_actual_plan', {
                                actual: tk.actualPercent,
                                plan: tk.planPercent
                            })}
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
};

const YearGrid: React.FC<{
    year: number; todayIso: string; selected: string; dayData: DayDataFn;
    onSelect: (d: string, toDay?: boolean) => void; onMonth: (m: number) => void;
}> = ({year, todayIso, selected, dayData, onSelect, onMonth}) => {
    const {t, tf, locale} = useLanguage();
    return (
    <div className="tp-year-wrap">
        <div className="tp-year">
            {monthNames(locale).map((name, m) => {
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
                            title={tf('tm_year_day_title', {
                                date: fmt(day, {
                                    weekday: 'short',
                                    day: '2-digit',
                                    month: '2-digit'
                                }, locale),
                                reports: d.reports.length,
                                defects: d.defects.length,
                                tasks: d.tasks.length,
                                appts: d.appts.length,
                                photos: d.photos.length
                            })}
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
                                <span title={t('tm_stat_reports')}><FileText size={10}/>{reports}</span>
                                <span title={t('tm_badge_defects')}><Wrench size={10}/>{defects}</span>
                                <span title={t('tm_badge_warnings')}><AlertTriangle size={10}/>{warns}</span>
                                <span title={t('tm_stat_task_days')}><ClipboardList size={10}/>{tasks}</span>
                            </div>
                        </div>
                        <div className="tp-year-grid">
                            {weekdayNames(locale).map((w) => <span key={w} className="tp-year-wd">{w[0]}</span>)}
                            {cells}
                        </div>
                    </div>
                );
            })}
        </div>
        <div className="tp-legend">
            <span><i style={{background: '#22c55e'}}/>{t('tm_legend_report')}</span>
            <span><i style={{background: '#f59e0b'}}/>{t('tm_legend_one')}</span>
            <span><i style={{background: '#dc2626'}}/>{t('tm_legend_many')}</span>
            <span><i style={{background: '#bfdbfe'}}/>{t('tm_legend_low')}</span>
            <span><i style={{background: '#1d4ed8'}}/>{t('tm_legend_high')}</span>
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

const TimelineRow: React.FC<{ it: TimelineItem; navigate: ReturnType<typeof useNavigate> }> = ({it, navigate}) => {
    const {t} = useLanguage();
    return (
    <div className={`tp-tl ${it.severity ?? 'info'}`}>
        <div className="tp-tl-top">
            <span className="tp-tl-title">{TYPE_ICON[it.type]} {it.title}</span>
            {it.time && <span className="tp-tl-time">{it.time}</span>}
        </div>
        <div className="tp-tl-sum">{it.summary}</div>
        <div className="tp-tl-foot">
            <span>{t('tm_source')} {it.source}</span>
            {it.type === 'notice' && it.refId != null && (
                <button className="tp-link"
                        onClick={() => navigate('/drafts', {state: {noticeId: it.refId}})}>{t('tm_open_letter')}</button>
            )}
            {it.type === 'alert' && (
                <button className="tp-link danger" onClick={() => navigate('/drafts', {state: {type: 'delay', keywords: `${it.title}. ${it.summary} (Quelle: ${it.source})`}})}>
                    <Mail size={11}/> {t('tm_letter')}
                </button>
            )}
        </div>
    </div>
    );
};

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
    const {t, tf, locale} = useLanguage();
    const d = parseIso(date);
    const report = data.reports[0];
    const events = [...data.notes, ...data.notices, ...data.progress, ...data.alerts].sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
    const weekend = weekdayIndex(d) >= 5;
    const dateDe = fmt(d, {day: '2-digit', month: '2-digit', year: 'numeric'});

    const photoBlock = (
        <div className="tp-block">
            <div className="tp-block-head">
                <span><Camera size={13}/> {tf('tm_photos_n', {n: data.photos.length})}</span>
                <label className="tp-link" style={{cursor: 'pointer'}}>
                    <Plus size={11}/> {uploadingPhoto ? t('tm_uploading') : t('tm_add_photo')}
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
                <p className="tp-muted">{t('tm_no_photos')}</p>
            ) : (
                <div className="tp-photo-grid">
                    {data.photos.map((p) => (
                        <div key={p.id} className="tp-photo-card" onClick={() => onOpenPhoto(p)}>
                            <img src={api.getPhotoFileUrl(p)} alt={p.caption} className="tp-photo-thumb"/>
                            <div className="tp-photo-body">
                                <div className="tp-photo-caption" title={p.caption}>{p.caption}</div>
                                {p.issues.length > 0 && (
                                    <div className="tp-photo-issue" title={p.issues.join(', ')} style={{display: 'flex', alignItems: 'center', gap: '3px'}}>
                                        <AlertTriangle size={11} style={{flexShrink: 0}}/>
                                        <span>{p.issues[0]}</span>
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="tp-photo-del"
                                title={t('tm_delete_photo')}
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
            <h3><CheckCircle2 size={14}/> {t('tm_what_happened')}</h3>

            <div className="tp-block">
                <div className="tp-block-head">
                    <span><FileText size={13}/> {t('tm_daily_report')}</span>
                    {report ? (
                        <div className="tp-block-actions">
                            <button className="tp-link"
                                    onClick={() => navigate('/reports', {state: {date}})}>{t('tm_open')}</button>
                            <button className="tp-link" onClick={() => onExport(date, 'pdf')}>PDF</button>
                            <button className="tp-link" onClick={() => onExport(date, 'docx')}>Word</button>
                        </div>
                    ) : (
                        !weekend && <button className="tp-link"
                                            onClick={() => navigate('/reports', {state: {date}})}>{t('tm_create_report')}</button>
                    )}
                </div>
                {report ? (
                    <p className="tp-text">{report.summary}</p>
                ) : (
                    <p className="tp-muted">{weekend ? t('tm_weekend_no_report') : t('tm_no_report')}</p>
                )}
            </div>

            {photoBlock}

            <div className="tp-block">
                <div className="tp-block-head"><span><Wrench size={13}/> {tf('tm_defects_n', {n: data.defects.length})}</span>
                </div>
                {data.defects.length === 0
                    ? <p className="tp-muted">{t('tm_no_defects')}</p>
                    : data.defects.map((it) => <TimelineRow key={it.id} it={it} navigate={navigate}/>)}
            </div>

            {events.length > 0 && (
                <div className="tp-block">
                    <div className="tp-block-head"><span><StickyNote size={13}/> {tf('tm_events_n', {n: events.length})}</span>
                    </div>
                    {events.map((it) => <TimelineRow key={it.id} it={it} navigate={navigate}/>)}
                </div>
            )}
        </section>
    );

    const plan = (
        <section className="tp-section">
            <h3><ClipboardList size={14}/> {rel === 'past' ? t('tm_what_planned') : t('tm_what_todo')}</h3>
            <div className="tp-block">
                <div className="tp-block-head"><span><ClipboardList
                    size={13}/> {tf('tm_works_n', {n: data.tasks.length})}</span></div>
                {data.tasks.length === 0 ? <p className="tp-muted">{t('tm_no_tasks')}</p> : data.tasks.map((tk) => (
                    <div key={tk.taskId} className={`tp-task ${tk.isOverdue ? 'overdue' : tk.status}`}>
                        <div className="tp-task-top">
                            <strong>{tk.code ? `${tk.code} ` : ''}{tk.title}</strong>
                            <span className={`tp-status ${tk.isOverdue ? 'overdue' : tk.status}`}>
                                {tk.isOverdue ? t('tm_st_remaining') : tk.status === 'delayed' ? t('tm_st_delayed') : tk.status === 'warning' ? t('tm_st_warning') : t('tm_st_ok')}
                            </span>
                        </div>
                        <div className="tp-task-meta">
                            {tk.isStart && <span><PlayCircle size={11}/> {t('tm_start')}</span>}
                            {tk.isEnd && <span><Flag size={11}/> {t('tm_planned_end')}</span>}
                            {(tk.company || tk.trade) && <span>{tk.company || tk.trade}</span>}
                            {tk.plannedWorkforce != null &&
                                <span><Users size={11}/> {tf('tm_planned_persons', {n: tk.plannedWorkforce})}</span>}
                        </div>
                        <div className="tp-progress"
                             title={tf('tm_actual_plan_pct', {actual: tk.actualPercent, plan: tk.planPercent})}>
                            <div className="tp-progress-fill" style={{width: `${Math.min(100, tk.actualPercent)}%`}}/>
                            <div className="tp-progress-plan" style={{left: `${Math.min(100, tk.planPercent)}%`}}/>
                        </div>
                        <div className="tp-task-foot">
                            <span>{tf('tm_actual_plan_pct', {actual: tk.actualPercent, plan: tk.planPercent})}</span>
                            {(tk.status === 'delayed' || tk.isOverdue) && (
                                <button
                                    className="tp-link danger"
                                    onClick={() => navigate('/drafts', {
                                        // Bewusst Deutsch: Stichworte für den deutschen VOB/B-Briefentwurf
                                        state: {
                                            type: 'delay',
                                            keywords: `${tk.title}: Soll ${tk.planPercent} %, Ist ${tk.actualPercent} % am ${dateDe}. Quelle: ${tk.source}`
                                        }
                                    })}
                                >
                                    <Mail size={11}/> {t('tm_hindrance')}
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="tp-block">
                <div className="tp-block-head">
                    <span><CalendarIcon size={13}/> {tf('tm_appts_n', {n: data.appts.length})}</span>
                    <button className="tp-link" onClick={onAdd}><Plus size={11}/> {t('tm_appointment')}</button>
                </div>
                {data.appts.length === 0 ? <p className="tp-muted">{t('tm_no_appts')}</p> : data.appts.map((a) => {
                    const isAuto = !a.editable;
                    return (
                        <div key={a.id} className={`tp-appt ${isAuto ? 'auto' : ''}`} style={{'--c': CATEGORY[a.category]?.color} as React.CSSProperties}>
                            <div className="tp-appt-top">
                                <strong>
                                    {a.time ? `${a.time.slice(0, 5)} • ` : ''}{a.title}
                                    {isAuto && (
                                        <span className="tp-auto-badge"
                                              title={tf('tm_auto_from', {src: a.sourceLabel || t('tm_schedule')})}>
                                            <Lock size={9}/> {t('tm_auto')}
                                        </span>
                                    )}
                                </strong>
                                <div className="tp-appt-actions">
                                    <button
                                        className="tp-icon-btn small"
                                        title={isAuto ? t('tm_auto_hint_title') : t('tm_edit_appt')}
                                        onClick={() => onEdit(a)}
                                    >
                                        <Pencil size={11}/>
                                    </button>
                                    {!isAuto && (
                                        <button className="tp-icon-btn small" title={t('tm_delete_appt')}
                                                onClick={() => onDelete(a)}>
                                            <Trash2 size={11}/>
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="tp-appt-meta">
                                {t(`tm_cat_${a.category}`)}
                                {a.trade ? ` • ${a.trade}` : ''}
                                {a.isUrgent ? t('tm_urgent_suffix') : ''}
                                {isAuto && a.sourceLabel ? ` • ${a.sourceLabel}` : ''}
                            </div>
                            {a.description && <div className="tp-appt-desc">{a.description}</div>}
                            {a.vobReference && <div className="tp-appt-meta">VOB: {a.vobReference}</div>}
                            {a.category === 'deadline' && (
                                <button className="tp-link danger" onClick={() => navigate('/drafts', {
                                    state: {type: 'delay', keywords: [a.title, a.description, `Frist: ${dateDe}`].filter(Boolean).join('. ')}
                                })}>
                                    <Mail size={11}/> {t('tm_vob_letter')}
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
                    <div className="tp-detail-date">{fmt(d, {
                        weekday: 'long',
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric'
                    }, locale)}</div>
                    <span className={`tp-rel ${rel}`}>{t(`tm_rel_${rel}`)}</span>
                </div>
                {onOpenDay && <button className="tp-link" onClick={onOpenDay}>{t('tm_day_view')}</button>}
            </div>
            <div className={large ? 'tp-detail-cols' : 'tp-detail-stack'}>
                {plan}
                {rel !== 'future' && past}
            </div>
        </div>
    );
};

export default Termin;
