import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    AlertTriangle,
    Building2,
    CalendarClock,
    ClipboardList,
    FileText,
    Mail,
    MapPin,
    Pause,
    Play,
    TrendingUp
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api, BuildingEvent, BuildingProgress, BuildingTask} from '../services/api';
import {ComingSoonNote} from '../components/ComingSoon';
import {addDays, daysBetween, parseIsoDate, startOfToday} from '../utils/dates';
import {useLanguage} from '../context/LanguageContext';
import './Ideas.css';

/**
 * Baufortschritt als 2,5D-Gebäude: Häuser × Ebenen (Gründung … Dach), eingefärbt nach Soll/Ist am gewählten Tag,
 * Mängel rot markiert, darunter der Bauablauf „was ist wann dran“.
 * Daten: GET /api/progress/building (Plan, gemeldete Fortschritte, Ereignisse mit Ort) – der Zustand je Stichtag
 * wird hier berechnet, mit denselben Formeln wie services/analysis.py (Soll linear über Werktage,
 * Verzug = (Soll % − Ist %) × Dauer). Nach dem letzten Tagesbericht gibt es keine Ist-Werte → Prognose.
 */

type TaskState = 'planned' | 'forecast' | 'ontrack' | 'warning' | 'delayed' | 'done';

const STATE_COLORS: Record<TaskState, string> = {
    planned: '#94a3b8',
    forecast: '#60a5fa',
    ontrack: '#2563eb',
    warning: '#f59e0b',
    delayed: '#ea580c',
    done: '#16a34a'
};

// Anzeigetexte: pm_state_<state>, pm_event_<kind>, def_status_<status> in den Übersetzungen.

const SEVERITY: TaskState[] = ['planned', 'done', 'forecast', 'ontrack', 'warning', 'delayed'];
const DEFECT_COLOR = '#dc2626';
const NOTICE_COLOR = '#f59e0b';
const RECENT_DAYS = 10; // Vorkommnisse/Behinderungen so lange am Bauteil markieren
const DEFECT_STATUSES = ['offen', 'in_bearbeitung', 'behoben', 'abgenommen'];
// Interner Schlüssel für Vorgänge ohne Haus (auch Teil gespeicherter Orte); angezeigt wird pm_site.
const SITE = 'Baufeld';


// ---------------------------------------------------------------- Soll/Ist (wie services/analysis.py)

const d = (s: string) => parseIsoDate(s);

function workdays(a: Date, b: Date): number {
    if (b < a) return 0;
    let n = 0;
    for (let x = new Date(a); x <= b; x = addDays(x, 1)) {
        const wd = x.getDay();
        if (wd !== 0 && wd !== 6) n++;
    }
    return n;
}

function planPercent(t: BuildingTask, ref: Date): number {
    if (!t.plannedStart || !t.plannedEnd) return 0;
    const start = d(t.plannedStart);
    const end = d(t.plannedEnd);
    const total = Math.max(workdays(start, end), 1);
    if (ref < start) return 0;
    const elapsed = workdays(start, ref < end ? ref : end);
    return Math.round(Math.min(elapsed / total, 1) * 100);
}

function actualPercent(t: BuildingTask, ref: Date): number {
    if (t.actualEnd && d(t.actualEnd) <= ref) return 100;
    let pct = 0;
    for (const p of t.history) {
        if (d(p.date) <= ref) pct = p.percent;
        else break;
    }
    return pct;
}

const delayDays = (t: BuildingTask, plan: number, actual: number) =>
    Math.round(Math.max(0, ((plan - actual) / 100) * t.durationDays) * 10) / 10;

interface TaskView {
    task: BuildingTask;
    plan: number;
    actual: number;
    delay: number;
    state: TaskState;
}

function evaluate(t: BuildingTask, ref: Date, lastReport: Date): TaskView {
    const future = ref > lastReport;
    const evalDate = future ? lastReport : ref;
    const actual = actualPercent(t, evalDate);
    const plan = planPercent(t, ref);
    const delay = delayDays(t, planPercent(t, evalDate), actual);
    let state: TaskState;
    if (actual >= 100) state = 'done';
    else if (delay >= 1) state = 'delayed';
    else if (delay > 0) state = 'warning';
    else if (plan === 0 && actual === 0) state = 'planned';
    else state = future ? 'forecast' : 'ontrack';
    return {task: t, plan, actual, delay, state};
}

interface CellView {
    key: string;
    house: string;
    level: string;
    tasks: TaskView[];
    state: TaskState;
    actual: number;
    plan: number;
    started: boolean;
    defects: BuildingEvent[];
    recent: BuildingEvent[];
}

const cellKey = (house: string | null, level: string | null) => `${house ?? SITE}|${level ?? ''}`;

function aggregate(house: string, level: string, tasks: TaskView[], defects: BuildingEvent[], recent: BuildingEvent[]): CellView {
    const weight = (v: TaskView) => Math.max(v.task.durationDays, 1);
    const total = tasks.reduce((s, v) => s + weight(v), 0) || 1;
    const actual = Math.round(tasks.reduce((s, v) => s + v.actual * weight(v), 0) / total);
    const plan = Math.round(tasks.reduce((s, v) => s + v.plan * weight(v), 0) / total);
    const active = tasks.filter((v) => v.state !== 'planned' && v.state !== 'done');
    let state: TaskState = 'planned';
    if (active.length > 0) {
        state = active.reduce((w, v) => (SEVERITY.indexOf(v.state) > SEVERITY.indexOf(w) ? v.state : w), active[0].state);
    } else if (tasks.some((v) => v.state === 'done')) {
        state = 'done';
    }
    const started = tasks.some((v) => v.state !== 'planned');
    return {key: cellKey(house, level), house, level, tasks, state, actual, plan, started, defects, recent};
}

const fmt = (iso: string | null | undefined, locale = 'de-DE') => (iso ? d(iso).toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
}) : '–');

// ---------------------------------------------------------------- 2,5D-Geometrie

const FACE_W = 190;
const DX = 54; // Tiefe nach rechts
const DY = -32; // Tiefe nach oben
const HOUSE_GAP = 64;
const LEVEL_H = (level: string) => (level === 'Gründung' ? 22 : level === 'Dach' ? 20 : 40);

export const ProgressMap: React.FC = () => {
    const navigate = useNavigate();
    const {activeProject} = useProjects();
    // tx statt t, weil `t` hier schon für Vorgänge (BuildingTask) benutzt wird.
    const {t: tx, tf, locale} = useLanguage();
    const fmtUi = (iso: string | null | undefined) => fmt(iso, locale);
    const stateLabel = (s: TaskState) => tx(`pm_state_${s}`);
    const eventLabel = (k: BuildingEvent['kind']) => tx(`pm_event_${k}`);
    const houseName = (h: string) => (h === SITE ? tx('pm_site') : h);
    const projectId = Number(activeProject.id);
    const legacyStorageKey = `progressZones_${projectId}`;

    const [data, setData] = useState<BuildingProgress | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dayIndex, setDayIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const location = useLocation();
    // Aus der Mängelliste: {house, level} → diese Ebene vorauswählen
    const navTarget = (location.state as { house?: string | null; level?: string | null } | null) ?? null;
    const [selected, setSelected] = useState<string | null>(navTarget?.house ? `${navTarget.house}|${navTarget.level ?? ''}` : null);

    const today = useMemo(startOfToday, []);

    const load = useCallback(async (keepDay = false) => {
        setLoading(true);
        try {
            const res = await api.getBuildingProgress(projectId);
            // Einmalige Migration alter localStorage-Zonen (Zuordnung je Vorgangscode) ins Backend
            try {
                const raw = localStorage.getItem(legacyStorageKey);
                if (raw) {
                    const legacy: Record<string, string> = JSON.parse(raw);
                    localStorage.removeItem(legacyStorageKey);
                    await Promise.all(res.tasks
                        .filter((t) => !t.location && legacy[t.code ?? String(t.id)])
                        .map((t) => api.updatePlanTask(t.planId, t.id, {location: legacy[t.code ?? String(t.id)]}).catch(() => undefined)));
                }
            } catch {
                // ignore
            }
            setData(res);
            setError(null);
            if (!keepDay && res.rangeFrom) {
                // Start: letzter Berichtstag (sonst heute), innerhalb des Zeitbereichs
                const from = d(res.rangeFrom);
                const target = res.lastReportDate ? d(res.lastReportDate) : today;
                const max = res.rangeTo ? daysBetween(from, d(res.rangeTo)) : 0;
                setDayIndex(Math.min(Math.max(daysBetween(from, target), 0), max));
            }
        } catch (err: any) {
            setError(err?.message || tx('pm_unavailable'));
        } finally {
            setLoading(false);
        }
    }, [projectId, legacyStorageKey, today]);

    useEffect(() => {
        if (!navTarget?.house) setSelected(null);
        setPlaying(false);
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]);

    const rangeFrom = data?.rangeFrom ? d(data.rangeFrom) : today;
    const rangeTo = data?.rangeTo ? d(data.rangeTo) : today;
    const maxIndex = Math.max(daysBetween(rangeFrom, rangeTo), 0);
    const refDate = addDays(rangeFrom, Math.min(dayIndex, maxIndex));
    const lastReport = data?.lastReportDate ? d(data.lastReportDate) : today;
    const isForecast = refDate > lastReport;

    // Abspielen: ein Kalendertag pro 120 ms
    useEffect(() => {
        if (!playing) return;
        const timer = window.setInterval(() => {
            setDayIndex((i) => {
                if (i >= maxIndex) {
                    setPlaying(false);
                    return i;
                }
                return i + 1;
            });
        }, 120);
        return () => window.clearInterval(timer);
    }, [playing, maxIndex]);

    const views = useMemo(() => (data?.tasks ?? []).map((t) => evaluate(t, refDate, lastReport)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [data, refDate.getTime(), lastReport.getTime()]);

    const eventsUntil = useMemo(() => (data?.events ?? []).filter((e) => d(e.date) <= refDate),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [data, refDate.getTime()]);

    const isRecent = (e: BuildingEvent) => e.kind !== 'defect' && daysBetween(d(e.date), refDate) < RECENT_DAYS;
    // Mangel ist am Stichtag offen, solange er nicht behoben/abgenommen ist
    const isOpenDefect = (e: BuildingEvent) => e.kind === 'defect' && (!e.resolvedDate || d(e.resolvedDate) > refDate);

    const cells = useMemo(() => {
        const map = new Map<string, CellView>();
        if (!data) return map;
        for (const house of data.houses) {
            for (const level of data.levels) {
                const tasks = views.filter((v) => v.task.house === house && v.task.level === level);
                const evs = eventsUntil.filter((e) => e.house === house && e.level === level);
                map.set(cellKey(house, level), aggregate(house, level, tasks,
                    evs.filter(isOpenDefect), evs.filter(isRecent)));
            }
        }
        const siteTasks = views.filter((v) => !v.task.house);
        const siteEvents = eventsUntil.filter((e) => !e.house);
        map.set(cellKey(null, null), aggregate(SITE, '', siteTasks,
            siteEvents.filter(isOpenDefect), siteEvents.filter(isRecent)));
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, views, eventsUntil]);

    const selectedCell = selected ? cells.get(selected) ?? null : null;
    const openDefects = eventsUntil.filter(isOpenDefect);
    const overall = useMemo(() => {
        const withPlan = views.filter((v) => v.task.durationDays > 0);
        const total = withPlan.reduce((s, v) => s + v.task.durationDays, 0) || 1;
        return {
            actual: Math.round(withPlan.reduce((s, v) => s + v.actual * v.task.durationDays, 0) / total),
            plan: Math.round(withPlan.reduce((s, v) => s + v.plan * v.task.durationDays, 0) / total),
            maxDelay: Math.max(0, ...views.map((v) => v.delay))
        };
    }, [views]);

    const nextUp = views
        .filter((v) => v.state !== 'done')
        .flatMap((v) => {
            const items: { v: TaskView; date: Date; what: 'start' | 'end' }[] = [];
            if (v.task.plannedStart) items.push({v, date: d(v.task.plannedStart), what: 'start'});
            if (v.task.plannedEnd) items.push({v, date: d(v.task.plannedEnd), what: 'end'});
            return items;
        })
        .filter((x) => x.date > refDate && x.date <= addDays(refDate, 14))
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 8);

    const placeOptions = useMemo(() => {
        const opts = (data?.houses ?? []).flatMap((h) => (data?.levels ?? []).map((l) => `${h} · ${l}`));
        return [...opts, `${SITE} · Baustelleneinrichtung`];
    }, [data]);

    const assignPlace = async (t: BuildingTask, value: string) => {
        let place = value;
        if (value === '__new') {
            place = window.prompt(tx('pm_place_prompt'), t.location ?? '')?.trim() ?? '';
            if (!place) return;
        }
        try {
            await api.updatePlanTask(t.planId, t.id, {location: place});
            await load(true);
        } catch (err: any) {
            setError(err?.message || tx('pm_place_failed'));
        }
    };

    const openEvent = (e: BuildingEvent) => {
        if (e.defectId) navigate('/maengel', {state: {focusId: e.defectId}});
        else if (e.noticeId) navigate('/drafts', {state: {noticeId: e.noticeId}});
        else if (e.reportDate) navigate('/reports', {state: {date: e.reportDate}});
    };

    // ---------------------------------------------------------------- Gebäude (SVG)

    const houses = data?.houses ?? [];
    const levels = data?.levels ?? [];
    const buildingH = levels.reduce((s, l) => s + LEVEL_H(l), 0);
    const padX = 24;
    const top = 44 + -DY;
    const groundY = top + buildingH;
    const svgW = padX * 2 + houses.length * (FACE_W + DX) + Math.max(houses.length - 1, 0) * HOUSE_GAP;
    const svgH = groundY + 54;
    const site = cells.get(cellKey(null, null));

    const renderCell = (cell: CellView, x: number, y: number, h: number, isTop: boolean) => {
        const color = STATE_COLORS[cell.state];
        const ghost = !cell.started;
        const hasDefect = cell.defects.length > 0;
        const isSel = selected === cell.key;
        const empty = cell.tasks.length === 0 && !hasDefect && cell.recent.length === 0;
        const faceFill = ghost ? 'transparent' : color;
        const stroke = isSel ? 'var(--text-main)' : hasDefect ? DEFECT_COLOR : ghost ? '#94a3b8' : color;
        const strokeW = isSel ? 3 : hasDefect ? 2.5 : 1.2;
        const dash = ghost && !hasDefect ? '5 4' : undefined;
        const fillW = Math.round((FACE_W * cell.actual) / 100);
        const label = `${houseName(cell.house)} · ${cell.level}: ${cell.tasks.length ? tf('pm_cell_label', {
            actual: cell.actual,
            plan: cell.plan,
            state: stateLabel(cell.state)
        }) : tx('pm_no_tasks')}${hasDefect ? `, ${tf('pm_n_defects', {n: cell.defects.length})}` : ''}`;
        return (
            <g
                key={cell.key}
                className={`bp-cell${empty ? ' is-empty' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={isSel}
                onClick={() => setSelected(cell.key)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(cell.key);
                    }
                }}
            >
                <title>{label}</title>
                {/* Seite */}
                <polygon
                    points={`${x + FACE_W},${y} ${x + FACE_W + DX},${y + DY} ${x + FACE_W + DX},${y + DY + h} ${x + FACE_W},${y + h}`}
                    fill={faceFill} fillOpacity={ghost ? 0 : 0.42} stroke={stroke} strokeWidth={1} strokeDasharray={dash}
                />
                {/* Dach-/Deckenfläche nur sichtbar, wenn darüber nichts gebaut ist */}
                {isTop && (
                    <polygon
                        points={`${x},${y} ${x + DX},${y + DY} ${x + FACE_W + DX},${y + DY} ${x + FACE_W},${y}`}
                        fill={faceFill} fillOpacity={ghost ? 0 : 0.28} stroke={stroke} strokeWidth={1} strokeDasharray={dash}
                    />
                )}
                {/* Front: Tönung + Ist-Füllung */}
                <rect x={x} y={y} width={FACE_W} height={h} fill={faceFill} fillOpacity={ghost ? 0.03 : 0.16}/>
                {!ghost && fillW > 0 && (
                    <rect x={x} y={y} width={fillW} height={h} fill={color} fillOpacity={0.62}/>
                )}
                {/* Soll-Linie */}
                {!ghost && cell.plan > 0 && cell.plan < 100 && (
                    <line x1={x + (FACE_W * cell.plan) / 100} x2={x + (FACE_W * cell.plan) / 100} y1={y + 2} y2={y + h - 2}
                          stroke="var(--text-main)" strokeWidth={1.5} strokeDasharray="3 2"/>
                )}
                {hasDefect && (
                    <rect x={x} y={y} width={FACE_W} height={h} fill="url(#bp-defect-hatch)"/>
                )}
                <rect x={x} y={y} width={FACE_W} height={h} fill="none" stroke={stroke} strokeWidth={strokeW} strokeDasharray={dash}/>
                {h >= 30 ? (
                    <>
                        <text x={x + 8} y={y + 16} className="bp-text-strong">{cell.level}</text>
                        <text x={x + 8} y={y + 31} className="bp-text">
                            {cell.tasks.length ? `${cell.actual} %${cell.started ? '' : tx('pm_planned_suffix')}` : '–'}
                        </text>
                    </>
                ) : (
                    <text x={x + 8} y={y + h / 2 + 4} className="bp-text-strong">
                        {cell.level}{cell.tasks.length ? ` · ${cell.actual} %` : ''}
                    </text>
                )}
                {hasDefect && (
                    <g>
                        <circle cx={x + FACE_W - 13} cy={y + h / 2} r={9} fill={DEFECT_COLOR}/>
                        <text x={x + FACE_W - 13} y={y + h / 2 + 4} textAnchor="middle" className="bp-badge">
                            {cell.defects.length > 1 ? cell.defects.length : '!'}
                        </text>
                    </g>
                )}
                {cell.recent.length > 0 && (
                    <g>
                        <circle cx={x + FACE_W - (hasDefect ? 35 : 13)} cy={y + h / 2} r={8} fill={NOTICE_COLOR}/>
                        <text x={x + FACE_W - (hasDefect ? 35 : 13)} y={y + h / 2 + 4} textAnchor="middle" className="bp-badge">
                            {cell.recent.length}
                        </text>
                    </g>
                )}
            </g>
        );
    };

    const renderBuilding = () => (
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="bp-svg" role="group" aria-label={tx('pm_building_aria')}>
            <defs>
                <pattern id="bp-defect-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="8" stroke={DEFECT_COLOR} strokeWidth="3" strokeOpacity="0.45"/>
                </pattern>
            </defs>
            {/* Baufeld (Boden) – Vorgänge/Ereignisse ohne Hauszuordnung */}
            {site && (
                <g
                    className="bp-cell"
                    role="button"
                    tabIndex={0}
                    aria-label={tf('pm_site_aria', {n: site.tasks.length})}
                    onClick={() => setSelected(site.key)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(site.key);
                        }
                    }}
                >
                    <polygon
                        points={`${padX - 14},${groundY + 14} ${padX - 14 + DX},${groundY + 14 + DY} ${svgW - padX + 14},${groundY + 14 + DY} ${svgW - padX + 14 - DX},${groundY + 14}`}
                        fill={site.started ? STATE_COLORS[site.state] : '#94a3b8'} fillOpacity={0.12}
                        stroke={selected === site.key ? 'var(--text-main)' : site.defects.length ? DEFECT_COLOR : '#94a3b8'}
                        strokeWidth={selected === site.key ? 2.5 : 1} strokeDasharray="6 4"
                    />
                    <text x={padX} y={groundY + 32} className="bp-text">
                        {tx('pm_site')}{site.tasks.length ? (site.tasks.length === 1 ? tx('pm_site_tasks_1') : tf('pm_site_tasks_n', {n: site.tasks.length})) : ''}
                        {site.defects.length ? ` · ${tf('pm_n_defects', {n: site.defects.length})}` : ''}
                    </text>
                </g>
            )}
            {houses.map((house, hi) => {
                const x = padX + hi * (FACE_W + DX + HOUSE_GAP);
                // höchste Ebene, die schon begonnen ist (oder die oberste) → deren Deckenfläche sichtbar
                let y = groundY;
                const placed = levels.map((level) => {
                    const h = LEVEL_H(level);
                    y -= h;
                    return {level, y, h};
                });
                const startedIdx = placed.map((p) => cells.get(cellKey(house, p.level))?.started ?? false);
                const highestStarted = startedIdx.lastIndexOf(true);
                return (
                    <g key={house}>
                        <text x={x + (FACE_W + DX) / 2} y={top - -DY - 22} textAnchor="middle" className="bp-house">{house}</text>
                        {placed.map((p, li) => {
                            const cell = cells.get(cellKey(house, p.level));
                            if (!cell) return null;
                            const isTop = li === placed.length - 1 || li === highestStarted;
                            return renderCell(cell, x, p.y, p.h, isTop);
                        })}
                    </g>
                );
            })}
        </svg>
    );

    // ---------------------------------------------------------------- Bauablauf (Gantt)

    const spanDays = Math.max(daysBetween(rangeFrom, rangeTo), 1);
    const pos = (iso: string) => `${(daysBetween(rangeFrom, d(iso)) / spanDays) * 100}%`;
    const refPos = `${(Math.min(dayIndex, maxIndex) / spanDays) * 100}%`;
    const months: { label: string; left: string }[] = [];
    for (let m = new Date(rangeFrom.getFullYear(), rangeFrom.getMonth() + 1, 1); m <= rangeTo; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
        months.push({
            label: m.toLocaleDateString(locale, {month: 'short', year: '2-digit'}),
            left: `${(daysBetween(rangeFrom, m) / spanDays) * 100}%`
        });
    }
    const ganttGroups = [...houses, SITE].map((house) => ({
        house,
        rows: views
            .filter((v) => (house === SITE ? !v.task.house : v.task.house === house))
            .sort((a, b) => (levels.indexOf(a.task.level ?? '') - levels.indexOf(b.task.level ?? ''))
                || (a.task.plannedStart ?? '').localeCompare(b.task.plannedStart ?? ''))
    })).filter((g) => g.rows.length > 0);

    // ---------------------------------------------------------------- Render

    const hasTasks = (data?.tasks.length ?? 0) > 0;

    return (
        <div className="idea-page">
            <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><TrendingUp size={22}/></div>
                    <div>
                        <h1>{tx('pm_title')}</h1>
                    </div>
                </div>
            </div>

            {error && <ComingSoonNote>{`${tx('pm_unavailable')}: ${error}`}</ComingSoonNote>}

            {!loading && data && !hasTasks && (
                <div className="idea-empty">
                    {tx('pm_empty')}
                    <div style={{marginTop: '10px'}}>
                        <button className="btn btn-primary"
                                onClick={() => navigate('/stammdaten')}>{tx('pm_to_masterdata')}</button>
                    </div>
                </div>
            )}

            {hasTasks && (
                <>
                    <div className="progress-plan-card">
                        <div className="progress-slider-row">
                            <button className="btn btn-secondary" onClick={() => {
                                if (!playing && dayIndex >= maxIndex) setDayIndex(0);
                                setPlaying((p) => !p);
                            }} title={playing ? tx('pm_pause') : tx('pm_play')}
                                    aria-label={playing ? tx('pm_pause') : tx('pm_play')}>
                                {playing ? <Pause size={14}/> : <Play size={14}/>}
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={maxIndex}
                                value={Math.min(dayIndex, maxIndex)}
                                aria-label={tx('pm_ref_date')}
                                onChange={(e) => {
                                    setPlaying(false);
                                    setDayIndex(Number(e.target.value));
                                }}
                            />
                            <strong style={{whiteSpace: 'nowrap'}}>
                                {refDate.toLocaleDateString(locale, {
                                    weekday: 'short',
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric'
                                })}
                            </strong>
                            {data?.lastReportDate && (
                                <button className="idea-tab" onClick={() => {
                                    setPlaying(false);
                                    setDayIndex(daysBetween(rangeFrom, lastReport));
                                }} title={tx('pm_jump_last_title')}>{tx('pm_last_report')}</button>
                            )}
                        </div>
                        <div className="bp-kpis">
                            <span>{tx('pm_actual')} <strong>{overall.actual} %</strong> · {tx('pm_plan')}
                                <strong>{overall.plan} %</strong></span>
                            <span>{tx('pm_max_delay')}
                                <strong>{overall.maxDelay.toLocaleString(locale)} {tx('pm_wd')}</strong></span>
                            <span style={{color: openDefects.length ? DEFECT_COLOR : undefined}}>
                                {tx('pm_defects_until')} <strong>{openDefects.length}</strong>
                            </span>
                            {isForecast && (
                                <span className="bp-forecast-hint">
                                    <CalendarClock
                                        size={12}/> {tf('pm_forecast', {date: lastReport.toLocaleDateString(locale)})}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="progress-layout">
                        <div className="progress-plan-card">
                            <div className="bp-building">{renderBuilding()}</div>
                            <div className="progress-legend">
                                {(Object.keys(STATE_COLORS) as TaskState[]).map((s) => (
                                    <span key={s}><i style={{background: STATE_COLORS[s]}}/> {stateLabel(s)}</span>
                                ))}
                                <span><i style={{background: DEFECT_COLOR}}/> {tx('pm_legend_defect')}</span>
                                <span><i style={{background: NOTICE_COLOR}}/> {tf('pm_legend_event', {n: RECENT_DAYS})}</span>
                            </div>
                            <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>
                                {tx('pm_legend_hint')}
                            </div>
                        </div>

                        <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                            <div className="progress-detail">
                                {selectedCell ? (
                                    <>
                                        <strong style={{fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px'}}>
                                            {selectedCell.house === SITE ? <MapPin size={15}/> : <Building2 size={15}/>}
                                            {houseName(selectedCell.house)}{selectedCell.level ? ` · ${selectedCell.level}` : ''}
                                        </strong>
                                        {selectedCell.tasks.length === 0 && (
                                            <span style={{
                                                color: 'var(--text-muted)',
                                                fontSize: '12px'
                                            }}>{tx('pm_no_tasks_level')}</span>
                                        )}
                                        {selectedCell.tasks.map((v) => (
                                            <div key={v.task.id} className="bp-task">
                                                <div style={{display: 'flex', justifyContent: 'space-between', gap: '8px'}}>
                                                    <span style={{fontWeight: 700}}>{v.task.title}</span>
                                                    <span className="bp-pill"
                                                          style={{background: STATE_COLORS[v.state]}}>{stateLabel(v.state)}</span>
                                                </div>
                                                <div className="bp-muted">
                                                    {[v.task.code, v.task.trade, v.task.company].filter(Boolean).join(' · ')}
                                                </div>
                                                <div className="bp-bar" aria-hidden="true">
                                                    <div className="bp-bar-fill" style={{width: `${v.actual}%`, background: STATE_COLORS[v.state]}}/>
                                                    {v.plan > 0 && <div className="bp-bar-plan" style={{left: `${v.plan}%`}}/>}
                                                </div>
                                                <div style={{fontSize: '12px'}}>
                                                    {tf('pm_task_line', {
                                                        plan: v.plan,
                                                        actual: v.actual
                                                    })}{v.delay > 0 ? tf('pm_delay_suffix', {n: v.delay.toLocaleString(locale)}) : ''}
                                                </div>
                                                <div className="bp-muted">{tf('pm_plan_range', {
                                                    from: fmtUi(v.task.plannedStart),
                                                    to: fmtUi(v.task.plannedEnd)
                                                })}</div>
                                                <div style={{display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center'}}>
                                                    <select
                                                        className="form-input"
                                                        style={{width: 'auto', fontSize: '11px', padding: '3px 6px'}}
                                                        value=""
                                                        onChange={(e) => e.target.value && assignPlace(v.task, e.target.value)}
                                                        title={tf('pm_place_title', {place: v.task.location || tx('pm_not_set')})}
                                                        aria-label={tf('pm_place_aria', {title: v.task.title})}
                                                    >
                                                        <option value="">{tx('pm_change_place')}</option>
                                                        {placeOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                                                        <option value="__new">{tx('pm_own_place')}</option>
                                                    </select>
                                                    {(v.state === 'delayed' || v.state === 'warning') && (
                                                        <button
                                                            className="btn btn-primary"
                                                            style={{fontSize: '11px', padding: '4px 8px', backgroundColor: '#b91c1c'}}
                                                            onClick={() => navigate('/drafts', {
                                                                state: {
                                                                    type: 'delay',
                                                                    // Bewusst Deutsch: Stichworte für den deutschen VOB/B-Briefentwurf
                                                                    keywords: `${v.task.title} (${selectedCell.house} · ${selectedCell.level}): Soll ${v.plan} %, Ist ${v.actual} % am ${refDate.toLocaleDateString('de-DE')} (${v.delay} AT Verzug).`
                                                                }
                                                            })}
                                                        >
                                                            <Mail size={11}/> {tx('pm_delay_notice')}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {(() => {
                                            const evs = eventsUntil.filter((e) => cellKey(e.house, e.level) === selectedCell.key
                                                || (selectedCell.house === SITE && !e.house));
                                            return evs.length > 0 && (
                                                <div style={{borderTop: '1px solid var(--border-light)', paddingTop: '8px'}}>
                                                    <strong style={{fontSize: '13px'}}>{tx('pm_events_until')}</strong>
                                                    {evs.slice().reverse().map((e) => (
                                                        <button key={e.id} type="button" className="bp-event" onClick={() => openEvent(e)}
                                                                disabled={!e.defectId && !e.noticeId && !e.reportDate}
                                                                title={e.defectId ? tx('pm_open_defect_list') : e.noticeId ? tx('pm_open_letter') : e.reportDate ? tx('pm_open_report') : undefined}>
                                                            <span className="bp-pill" style={{background: e.kind !== 'defect' ? NOTICE_COLOR : isOpenDefect(e) ? DEFECT_COLOR : STATE_COLORS.done}}>
                                                                {eventLabel(e.kind)}{e.kind === 'defect' && e.status ? ` · ${DEFECT_STATUSES.includes(e.status) ? tx(`def_status_${e.status}`) : e.status}` : ''}
                                                            </span>
                                                            <span className="bp-event-text">
                                                                <strong>{fmtUi(e.date)}</strong> {e.title}
                                                                <span className="bp-muted"> · {e.source}{e.status ? ` (${e.status})` : ''}</span>
                                                            </span>
                                                            {e.defectId ? <ClipboardList size={12}/> : e.noticeId ? <Mail size={12}/> : e.reportDate ? <FileText size={12}/> : null}
                                                        </button>
                                                    ))}
                                                </div>
                                            );
                                        })()}

                                        {selectedCell.house !== SITE && (
                                            <button
                                                className="btn btn-secondary"
                                                style={{fontSize: '12px', alignSelf: 'flex-start'}}
                                                onClick={() => navigate('/maengel', {
                                                    state: {newDefect: {house: selectedCell.house, level: selectedCell.level}}
                                                })}
                                            >
                                                <AlertTriangle size={12}/> {tx('pm_add_defect')}
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <span style={{color: 'var(--text-muted)'}}>{tx('pm_select_hint')}</span>
                                )}
                            </div>

                            <div className="progress-detail">
                                <strong>{tx('pm_next_14')}</strong>
                                {nextUp.length === 0 &&
                                    <span style={{color: 'var(--text-muted)'}}>{tx('pm_nothing_planned')}</span>}
                                {nextUp.map(({v, date, what}) => (
                                    <button key={`${v.task.id}-${what}`} type="button" className="bp-next"
                                            onClick={() => setSelected(cellKey(v.task.house, v.task.house ? v.task.level : null))}>
                                        <span>
                                            <strong>{tx(`pm_what_${what}`)}</strong> {v.task.title}
                                            <span
                                                className="bp-muted"> ({v.task.house ? `${v.task.house} · ${v.task.level}` : tx('pm_site')})</span>
                                        </span>
                                        <strong
                                            style={{whiteSpace: 'nowrap'}}>{date.toLocaleDateString(locale)}</strong>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="progress-plan-card">
                        <strong style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                            <CalendarClock size={15}/> {tx('pm_gantt_title')}
                        </strong>
                        <div className="bp-gantt">
                            <div className="bp-gantt-row bp-gantt-head">
                                <div className="bp-gantt-label"/>
                                <div className="bp-gantt-track">
                                    {months.map((m) => <span key={m.label} className="bp-gantt-month" style={{left: m.left}}>{m.label}</span>)}
                                    <span className="bp-gantt-ref" style={{left: refPos}}/>
                                </div>
                            </div>
                            {ganttGroups.map((g) => (
                                <React.Fragment key={g.house}>
                                    <div className="bp-gantt-group">{houseName(g.house)}</div>
                                    {g.rows.map((v) => {
                                        const t = v.task;
                                        const key = cellKey(t.house, t.house ? t.level : null);
                                        // Mängel zuletzt zeichnen → liegen oben, wenn mehrere Ereignisse auf denselben Tag fallen
                                        const evs = eventsUntil.filter((e) => e.taskIds.includes(t.id))
                                            .sort((a, b) => Number(a.kind === 'defect') - Number(b.kind === 'defect'));
                                        return (
                                            <button key={t.id} type="button"
                                                    className={`bp-gantt-row${selected === key ? ' is-selected' : ''}`}
                                                    onClick={() => setSelected(key)}
                                                    title={tf('pm_gantt_row_title', {
                                                        title: t.title,
                                                        from: fmtUi(t.plannedStart),
                                                        to: fmtUi(t.plannedEnd),
                                                        actual: v.actual
                                                    })}>
                                                <span className="bp-gantt-label">
                                                    <span className="bp-gantt-level">{t.level ?? ''}</span> {t.title}
                                                </span>
                                                <span className="bp-gantt-track">
                                                    {t.plannedStart && t.plannedEnd && (
                                                        <span className="bp-gantt-bar" style={{
                                                            left: pos(t.plannedStart),
                                                            width: `max(4px, calc(${pos(t.plannedEnd)} - ${pos(t.plannedStart)} + ${100 / spanDays}%))`,
                                                            borderColor: STATE_COLORS[v.state]
                                                        }}>
                                                            <span style={{width: `${v.actual}%`, background: STATE_COLORS[v.state]}}/>
                                                        </span>
                                                    )}
                                                    {evs.map((e) => (
                                                        <span key={e.id} className="bp-gantt-dot" style={{
                                                            left: pos(e.date),
                                                            background: e.kind === 'defect' ? DEFECT_COLOR : NOTICE_COLOR
                                                        }}
                                                              title={`${eventLabel(e.kind)} ${fmtUi(e.date)}: ${e.title}`}/>
                                                    ))}
                                                    <span className="bp-gantt-ref" style={{left: refPos}}/>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ProgressMap;
