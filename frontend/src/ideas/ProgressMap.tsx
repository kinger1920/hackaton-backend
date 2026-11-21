import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {TrendingUp, Play, Pause, Mail, MapPin} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api, PlanAnalysis, WorkPackage} from '../services/api';
import {ComingSoonNote} from '../components/ComingSoon';
import {addDays, parseAnyDate, startOfToday, toIsoDate} from '../utils/dates';
import './Ideas.css';

/**
 * Idee #7: Live-Baufortschritt auf (schematischem) Grundriss mit Zeitregler.
 * Daten: GET /api/analysis?period=all&ref_date=… liefert Soll/Ist je Vorgang zu jedem Stichtag.
 * Ort der Vorgänge: direkt am Vorgang im Backend gespeichert (`PlanTask.location`, via PATCH /api/plans/{planId}/tasks/{taskId}),
 * ansonsten aus dem Titel abgeleitet ("Achse B", "Haus C", "1. OG").
 */

type ZoneState = 'notstarted' | 'ontrack' | 'warning' | 'delayed' | 'done';

const STATE_COLORS: Record<ZoneState, string> = {
    notstarted: '#cbd5e1',
    ontrack: '#3b82f6',
    warning: '#f59e0b',
    delayed: '#dc2626',
    done: '#16a34a'
};

const STATE_LABELS: Record<ZoneState, string> = {
    notstarted: 'noch nicht dran',
    ontrack: 'planmäßig in Arbeit',
    warning: 'leichter Verzug',
    delayed: 'kritischer Verzug',
    done: 'fertig'
};

const ZONE_PATTERNS: RegExp[] = [
    /\b(Achse\s+[A-Z0-9]+(?:\s*[-–]\s*[A-Z0-9]+)?)/i,
    /\b(Haus\s+[A-Z0-9]+)/i,
    /\b(Bauteil\s+[A-Z0-9]+)/i,
    /\b(\d+\.\s?OG|EG|UG|KG|Dach(?:geschoss)?|Tiefgarage)\b/i
];

function deriveZone(name: string): string {
    for (const rx of ZONE_PATTERNS) {
        const m = name.match(rx);
        if (m) return m[1].replace(/\s+/g, ' ');
    }
    return 'Allgemein';
}

function wpState(wp: WorkPackage): ZoneState {
    if (wp.actualPercent >= 100) return 'done';
    if (wp.planPercent === 0 && wp.actualPercent === 0) return 'notstarted';
    if (wp.status === 'delayed') return 'delayed';
    if (wp.status === 'warning') return 'warning';
    return 'ontrack';
}

const SEVERITY: ZoneState[] = ['done', 'notstarted', 'ontrack', 'warning', 'delayed'];

const parseDe = (d: string) => parseAnyDate(d);
const iso = toIsoDate;

export const ProgressMap: React.FC = () => {
    const navigate = useNavigate();
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const legacyStorageKey = `progressZones_${projectId}`;

    const [base, setBase] = useState<PlanAnalysis | null>(null);      // heute – für den Zeitbereich
    const [current, setCurrent] = useState<PlanAnalysis | null>(null); // gewählter Stichtag
    const [dayOffset, setDayOffset] = useState(0);                     // Tage relativ zu heute
    const [playing, setPlaying] = useState(false);
    const [selectedZone, setSelectedZone] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [zoneOverrides, setZoneOverrides] = useState<Record<string, string>>({});
    const cache = useRef<Map<string, PlanAnalysis>>(new Map());

    const today = useMemo(startOfToday, []);

    // Zeitbereich: 3 Wochen vor dem frühesten Soll-Ende bis 1 Woche nach dem spätesten
    const range = useMemo(() => {
        const ends = (base?.workPackages ?? []).map((w) => parseDe(w.planDate)).filter((d): d is Date => d !== null);
        if (ends.length === 0) return {min: -30, max: 14};
        const first = new Date(Math.min(...ends.map((d) => d.getTime())));
        const last = new Date(Math.max(...ends.map((d) => d.getTime())));
        const min = Math.min(-7, Math.round((addDays(first, -21).getTime() - today.getTime()) / 86400000));
        const max = Math.max(7, Math.round((addDays(last, 7).getTime() - today.getTime()) / 86400000));
        return {min, max};
    }, [base, today]);

    const refDate = addDays(today, dayOffset);

    useEffect(() => {
        cache.current.clear();
        setSelectedZone(null);
        setZoneOverrides({});
        api.getAnalysis(projectId, 'all', iso(today))
            .then((a) => {
                setBase(a);
                setCurrent(a);
                cache.current.set(iso(today), a);
                setError(null);

                // Einmalige Migration alter localStorage-Zonen ins Backend
                try {
                    const raw = localStorage.getItem(legacyStorageKey);
                    if (raw) {
                        const legacyMap: Record<string, string> = JSON.parse(raw);
                        localStorage.removeItem(legacyStorageKey);
                        a.workPackages.forEach((wp) => {
                            const legacyZone = legacyMap[wp.id];
                            if (legacyZone && wp.planId && wp.taskId && !wp.location) {
                                api.updatePlanTask(wp.planId, wp.taskId, {location: legacyZone}).catch(() => undefined);
                                setZoneOverrides((prev) => ({...prev, [wp.id]: legacyZone}));
                            }
                        });
                    }
                } catch {
                    // ignore
                }
            })
            .catch((err) => setError(err?.message || 'Analyse nicht verfügbar'));
    }, [projectId]);

    // Stichtag geändert → Analyse für diesen Tag laden (gecacht, leicht entprellt)
    useEffect(() => {
        const key = iso(refDate);
        const hit = cache.current.get(key);
        if (hit) {
            setCurrent(hit);
            return;
        }
        const timer = window.setTimeout(() => {
            api.getAnalysis(projectId, 'all', key)
                .then((a) => {
                    cache.current.set(key, a);
                    setCurrent(a);
                })
                .catch(() => undefined);
        }, 150);
        return () => window.clearTimeout(timer);
    }, [dayOffset, projectId]);

    // Abspielen: 1 Tag pro 400 ms
    useEffect(() => {
        if (!playing) return;
        const timer = window.setInterval(() => {
            setDayOffset((d) => {
                if (d >= range.max) {
                    setPlaying(false);
                    return d;
                }
                return d + 1;
            });
        }, 400);
        return () => window.clearInterval(timer);
    }, [playing, range.max]);

    const zoneOf = (wp: WorkPackage) => zoneOverrides[wp.id] || wp.location || deriveZone(wp.name);

    const zones = useMemo(() => {
        const map = new Map<string, WorkPackage[]>();
        (current?.workPackages ?? []).forEach((wp) => {
            const z = zoneOf(wp);
            map.set(z, [...(map.get(z) ?? []), wp]);
        });
        return Array.from(map.entries())
            .map(([name, wps]) => {
                const state = wps.map(wpState).reduce((worst, s) => (SEVERITY.indexOf(s) > SEVERITY.indexOf(worst) ? s : worst), 'done' as ZoneState);
                const actual = Math.round(wps.reduce((s, w) => s + w.actualPercent, 0) / wps.length);
                const plan = Math.round(wps.reduce((s, w) => s + w.planPercent, 0) / wps.length);
                return {name, wps, state, actual, plan};
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'de', {numeric: true}));
    }, [current, zoneOverrides]);

    const nextUp = (current?.workPackages ?? [])
        .filter((w) => w.actualPercent < 100)
        .map((w) => ({w, end: parseDe(w.planDate)}))
        .filter((x) => x.end && x.end >= refDate && x.end <= addDays(refDate, 14))
        .sort((a, b) => a.end!.getTime() - b.end!.getTime())
        .slice(0, 6);

    const setZoneFor = async (wp: WorkPackage, zone: string) => {
        setZoneOverrides((prev) => ({...prev, [wp.id]: zone}));
        if (wp.planId && wp.taskId) {
            try {
                await api.updatePlanTask(wp.planId, wp.taskId, {location: zone});
                cache.current.clear();
            } catch (err: any) {
                setError(err?.message || 'Bereich konnte nicht im Backend gespeichert werden');
            }
        }
    };

    // Schematischer Grundriss: Zonen als Raster
    const cols = Math.min(4, Math.max(1, zones.length));
    const rows = Math.max(1, Math.ceil(zones.length / cols));
    const cellW = 180;
    const cellH = 110;
    const gap = 12;
    const width = cols * cellW + (cols + 1) * gap;
    const height = rows * cellH + (rows + 1) * gap;
    const selected = zones.find((z) => z.name === selectedZone) ?? null;

    return (
        <div className="idea-page">
            <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><TrendingUp size={22}/></div>
                    <div>
                        <h1>Baufortschritt</h1>
                        <p>Was wann wo gebaut werden muss – und was schon gebaut ist • {activeProject.name}</p>
                    </div>
                </div>
            </div>

            {error && <ComingSoonNote>{`Soll/Ist-Daten nicht verfügbar: ${error}`}</ComingSoonNote>}

            <div className="progress-layout">
                <div className="progress-plan-card">
                    <div className="progress-slider-row">
                        <button className="btn btn-secondary" onClick={() => setPlaying((p) => !p)} title="Bauablauf abspielen">
                            {playing ? <Pause size={14}/> : <Play size={14}/>}
                        </button>
                        <input
                            type="range"
                            min={range.min}
                            max={range.max}
                            value={dayOffset}
                            onChange={(e) => {
                                setPlaying(false);
                                setDayOffset(Number(e.target.value));
                            }}
                        />
                        <strong>{refDate.toLocaleDateString('de-DE', {weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'})}</strong>
                        {dayOffset !== 0 && (
                            <button className="idea-tab" onClick={() => setDayOffset(0)}>Heute</button>
                        )}
                    </div>

                    <div className="progress-legend">
                        {(Object.keys(STATE_COLORS) as ZoneState[]).map((s) => (
                            <span key={s}><i style={{background: STATE_COLORS[s]}}/> {STATE_LABELS[s]}</span>
                        ))}
                    </div>

                    {zones.length === 0 ? (
                        <div className="idea-empty">Keine Vorgänge – Bauzeitenplan unter Stammdaten anlegen.</div>
                    ) : (
                        <svg viewBox={`0 0 ${width} ${height}`} style={{width: '100%', height: 'auto'}} role="img" aria-label="Schematischer Grundriss">
                            <rect x={0} y={0} width={width} height={height} rx={10} fill="#f8fafc" stroke="#cbd5e1" strokeDasharray="6 4"/>
                            {zones.map((z, idx) => {
                                const c = idx % cols;
                                const r = Math.floor(idx / cols);
                                const x = gap + c * (cellW + gap);
                                const y = gap + r * (cellH + gap);
                                const color = STATE_COLORS[z.state];
                                const isSel = z.name === selectedZone;
                                return (
                                    <g key={z.name} className="progress-zone" onClick={() => setSelectedZone(z.name)}>
                                        <rect x={x} y={y} width={cellW} height={cellH} rx={8} fill="white" stroke={isSel ? '#0f172a' : color} strokeWidth={isSel ? 3 : 2}/>
                                        <rect
                                            x={x + 2}
                                            y={y + 2 + (cellH - 4) * (1 - z.actual / 100)}
                                            width={cellW - 4}
                                            height={(cellH - 4) * (z.actual / 100)}
                                            rx={6}
                                            fill={color}
                                            opacity={0.35}
                                        />
                                        <line
                                            x1={x + 4}
                                            x2={x + cellW - 4}
                                            y1={y + 2 + (cellH - 4) * (1 - z.plan / 100)}
                                            y2={y + 2 + (cellH - 4) * (1 - z.plan / 100)}
                                            stroke="#0f172a"
                                            strokeDasharray="4 3"
                                            strokeWidth={1}
                                        />
                                        <text x={x + 10} y={y + 22} fontSize={14} fontWeight={700} fill="#0f172a">{z.name}</text>
                                        <text x={x + 10} y={y + 42} fontSize={11} fill="#334155">Ist {z.actual}% • Soll {z.plan}%</text>
                                        <text x={x + 10} y={y + 58} fontSize={11} fill="#64748b">{z.wps.length} Vorgang{z.wps.length === 1 ? '' : 'e'}</text>
                                        <circle cx={x + cellW - 16} cy={y + 16} r={6} fill={color}/>
                                    </g>
                                );
                            })}
                        </svg>
                    )}
                    <div style={{fontSize: '11px', color: 'var(--text-muted)'}}>
                        Füllung = Ist-Fortschritt, gestrichelte Linie = Soll laut Plan am gewählten Tag. Quelle: Bauzeitenplan + Tagesberichte.
                    </div>
                </div>

                <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
                    <div className="progress-detail">
                        {selected ? (
                            <>
                                <strong style={{fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px'}}>
                                    <MapPin size={15}/> {selected.name}
                                </strong>
                                {selected.wps.map((wp) => (
                                    <div key={wp.id} style={{borderTop: '1px solid var(--border-light)', paddingTop: '8px'}}>
                                        <div style={{fontWeight: 700}}>{wp.name}</div>
                                        <div style={{fontSize: '12px', color: 'var(--text-muted)'}}>
                                            {wp.trade}{wp.subcontractor ? ` • ${wp.subcontractor}` : ''}
                                        </div>
                                        <div style={{fontSize: '12px'}}>
                                            Soll {wp.planPercent}% • Ist {wp.actualPercent}% • {STATE_LABELS[wpState(wp)]}
                                            {wp.delayDays > 0 ? ` • ${wp.delayDays.toLocaleString('de-DE')} AT Verzug` : ''}
                                        </div>
                                        <div style={{fontSize: '12px', color: 'var(--text-muted)'}}>
                                            Soll-Ende {wp.planDate} • Ist {wp.actualDate}
                                        </div>
                                        <div style={{display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center'}}>
                                            <select
                                                className="form-input"
                                                style={{width: 'auto', fontSize: '11px', padding: '3px 6px'}}
                                                value={zoneOf(wp)}
                                                onChange={(e) => {
                                                    const v = e.target.value === '__new'
                                                        ? window.prompt('Neuer Bereich (z. B. "Haus C", "Achse D", "2. OG"):')?.trim() || zoneOf(wp)
                                                        : e.target.value;
                                                    setZoneFor(wp, v);
                                                    setSelectedZone(v);
                                                }}
                                                title="Bereich zuordnen (im Backend am Vorgang gespeichert)"
                                            >
                                                {Array.from(new Set([...zones.map((z) => z.name), zoneOf(wp)])).map((z) => (
                                                    <option key={z} value={z}>{z}</option>
                                                ))}
                                                <option value="__new">+ neuer Bereich…</option>
                                            </select>
                                            {(wp.status === 'delayed' || wp.status === 'warning') && (
                                                <button
                                                    className="btn btn-primary"
                                                    style={{fontSize: '11px', padding: '4px 8px', backgroundColor: '#b91c1c'}}
                                                    onClick={() =>
                                                        navigate('/drafts', {
                                                            state: {
                                                                type: 'delay',
                                                                keywords: `${wp.name}: Soll ${wp.planPercent} %, Ist ${wp.actualPercent} % am ${refDate.toLocaleDateString('de-DE')} (${wp.delayDays} AT Verzug). Bereich ${zoneOf(wp)}.`
                                                            }
                                                        })
                                                    }
                                                >
                                                    <Mail size={11}/> Behinderungsanzeige
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </>
                        ) : (
                            <span style={{color: 'var(--text-muted)'}}>Bereich im Grundriss anklicken für Details.</span>
                        )}
                    </div>

                    <div className="progress-detail">
                        <strong>Als Nächstes fällig (14 Tage)</strong>
                        {nextUp.length === 0 && <span style={{color: 'var(--text-muted)'}}>Nichts fällig.</span>}
                        {nextUp.map(({w, end}) => (
                            <div key={w.id} style={{display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px'}}>
                                <span>{w.name} <span style={{color: 'var(--text-muted)'}}>({zoneOf(w)})</span></span>
                                <strong style={{whiteSpace: 'nowrap'}}>{end!.toLocaleDateString('de-DE')}</strong>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProgressMap;
