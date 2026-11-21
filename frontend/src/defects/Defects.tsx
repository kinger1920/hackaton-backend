import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    AlertTriangle,
    Building2,
    Camera,
    CheckCircle2,
    ClipboardList,
    Download,
    FileText,
    Mail,
    Pencil,
    Plus,
    Search,
    Trash2,
    X
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api, Company, Defect, DefectPriority, DefectStatus, DefectSummary, saveBlob} from '../services/api';
import {addDays, startOfToday, toIsoDate} from '../utils/dates';
import '../ideas/Ideas.css';
import './Defects.css';

/**
 * Mängelmanagement: Mängel mit Ort (Haus/Ebene), Firma, Frist und Status
 * (offen → in Bearbeitung → behoben → abgenommen). Backend: /api/defects.
 * Navigation hierher: {newDefect: {house, level}} öffnet das Formular vorbefüllt (aus Baufortschritt),
 * {focusId} hebt einen Mangel hervor.
 */

type Tab = 'open' | 'overdue' | 'behoben' | 'abgenommen' | 'all';

const TABS: { key: Tab; label: string }[] = [
    {key: 'open', label: 'Offen'},
    {key: 'overdue', label: 'Überfällig'},
    {key: 'behoben', label: 'Wartet auf Abnahme'},
    {key: 'abgenommen', label: 'Abgenommen'},
    {key: 'all', label: 'Alle'}
];

const STATUS_LABELS: Record<DefectStatus, string> = {
    offen: 'offen',
    in_bearbeitung: 'in Bearbeitung',
    behoben: 'behoben',
    abgenommen: 'abgenommen'
};

const NEXT_STEP: Partial<Record<DefectStatus, { to: DefectStatus; label: string }>> = {
    offen: {to: 'in_bearbeitung', label: 'In Bearbeitung'},
    in_bearbeitung: {to: 'behoben', label: 'Als behoben melden'},
    behoben: {to: 'abgenommen', label: 'Abnehmen'}
};

const PRIORITY_LABELS: Record<DefectPriority, string> = {hoch: 'hoch', mittel: 'mittel', niedrig: 'niedrig'};

interface FormState {
    id: number | null;
    title: string;
    description: string;
    location: string;
    company: string;
    trade: string;
    priority: DefectPriority;
    status: DefectStatus;
    found_date: string;
    deadline: string;
    photo_id: number | null;
    photoFile: File | null;
}

const fmt = (iso: string | null | undefined) =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric'}) : '–';

const placeOf = (d: Defect) => [d.house, d.level].filter(Boolean).join(' · ');

/** Ort ohne das schon angezeigte "Haus · Ebene" – "Haus B · Gründung, Sockel Feld 3" → "Sockel Feld 3" */
const locationDetail = (d: Defect): string => {
    const loc = (d.location ?? '').trim();
    const place = placeOf(d);
    if (!loc || loc === place) return '';
    return place && loc.startsWith(place) ? loc.slice(place.length).replace(/^[\s,·–-]+/, '') : loc;
};

export const Defects: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const navState = (location.state as { newDefect?: { house?: string | null; level?: string | null }; focusId?: number } | null) ?? null;

    const [defects, setDefects] = useState<Defect[]>([]);
    const [summary, setSummary] = useState<DefectSummary | null>(null);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [places, setPlaces] = useState<string[]>([]);
    const [tab, setTab] = useState<Tab>('open');
    const [company, setCompany] = useState('');
    const [house, setHouse] = useState('');
    const [search, setSearch] = useState('');
    const [form, setForm] = useState<FormState | null>(null);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [focusId, setFocusId] = useState<number | null>(navState?.focusId ?? null);
    const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
    const firstField = useRef<HTMLInputElement>(null);

    const today = useMemo(startOfToday, []);

    const emptyForm = useCallback((loc = ''): FormState => ({
        id: null, title: '', description: '', location: loc, company: '', trade: '', priority: 'mittel', status: 'offen',
        found_date: toIsoDate(today), deadline: toIsoDate(addDays(today, 7)), photo_id: null, photoFile: null
    }), [today]);

    const load = useCallback(async () => {
        try {
            const [rows, sum] = await Promise.all([api.listDefects(projectId), api.getDefectSummary(projectId)]);
            setDefects(rows);
            setSummary(sum);
            setError(null);
        } catch (err: any) {
            setError(err?.message || 'Mängel konnten nicht geladen werden');
        }
    }, [projectId]);

    useEffect(() => {
        load();
        api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
        api.getBuildingProgress(projectId)
            .then((b) => setPlaces(b.houses.flatMap((h) => b.levels.map((l) => `${h} · ${l}`))))
            .catch(() => setPlaces([]));
    }, [load, projectId]);

    // Aus dem Baufortschritt: Formular mit Ort öffnen
    useEffect(() => {
        if (navState?.newDefect) {
            const loc = [navState.newDefect.house, navState.newDefect.level].filter(Boolean).join(' · ');
            setForm(emptyForm(loc));
            navigate(location.pathname, {replace: true, state: null});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (form) window.setTimeout(() => firstField.current?.focus(), 0);
    }, [form?.id, form === null]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!focusId) return;
        const el = document.getElementById(`defect-${focusId}`);
        if (el) {
            el.scrollIntoView({behavior: 'smooth', block: 'center'});
            const t = window.setTimeout(() => setFocusId(null), 2500);
            return () => window.clearTimeout(t);
        }
    }, [focusId, defects]);

    const companyOptions = useMemo(() => {
        const names = new Set<string>();
        companies.filter((c) => c.company_type !== 'client').forEach((c) => names.add(c.name));
        defects.forEach((d) => d.company && names.add(d.company));
        return Array.from(names).sort((a, b) => a.localeCompare(b, 'de'));
    }, [companies, defects]);

    const houseOptions = useMemo(() => Array.from(new Set(defects.map((d) => d.house).filter(Boolean) as string[])).sort(),
        [defects]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return defects.filter((d) => {
            if (tab === 'open' && !(d.status === 'offen' || d.status === 'in_bearbeitung')) return false;
            if (tab === 'overdue' && !d.is_overdue) return false;
            if (tab === 'behoben' && d.status !== 'behoben') return false;
            if (tab === 'abgenommen' && d.status !== 'abgenommen') return false;
            if (company && (d.company ?? '') !== company) return false;
            if (house && d.house !== house) return false;
            if (q && ![d.title, d.description, d.location, d.company, d.trade, placeOf(d)].some((v) => (v ?? '').toLowerCase().includes(q))) return false;
            return true;
        });
    }, [defects, tab, company, house, search]);

    const tabCount = (t: Tab) => {
        if (!summary) return null;
        if (t === 'open') return summary.open;
        if (t === 'overdue') return summary.overdue;
        if (t === 'behoben') return summary.by_status.behoben;
        if (t === 'abgenommen') return summary.by_status.abgenommen;
        return summary.total;
    };

    const setStatus = async (d: Defect, status: DefectStatus) => {
        setBusyId(d.id);
        try {
            await api.updateDefect(d.id, {status});
            await load();
        } catch (err: any) {
            setError(err?.message || 'Status konnte nicht geändert werden');
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (d: Defect) => {
        if (!window.confirm(`Mangel „${d.title}“ löschen? Das lässt sich nicht rückgängig machen.`)) return;
        try {
            await api.deleteDefect(d.id);
            await load();
        } catch (err: any) {
            setError(err?.message || 'Mangel konnte nicht gelöscht werden');
        }
    };

    const edit = (d: Defect) => setForm({
        id: d.id, title: d.title, description: d.description ?? '', location: d.location ?? placeOf(d),
        company: d.company ?? '', trade: d.trade ?? '', priority: d.priority, status: d.status,
        found_date: d.found_date, deadline: d.deadline ?? '', photo_id: d.photo_id, photoFile: null
    });

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form || !form.title.trim()) return;
        setSaving(true);
        try {
            let photoId = form.photo_id;
            if (form.photoFile) {
                const photo = await api.uploadPhoto(form.photoFile, projectId, form.found_date || toIsoDate(today),
                    `Mangel: ${form.title.trim()}`);
                photoId = photo.id;
            }
            const payload = {
                title: form.title.trim(),
                description: form.description.trim() || null,
                location: form.location.trim() || null,
                company: form.company.trim() || null,
                trade: form.trade.trim() || null,
                priority: form.priority,
                status: form.status,
                found_date: form.found_date || null,
                deadline: form.deadline || null,
                photo_id: photoId,
                // Ort geändert → Haus/Ebene neu erkennen lassen
                ...(form.id === null ? {} : {house: null, level: null})
            };
            const saved = form.id === null
                ? await api.createDefect({project_id: projectId, ...payload, source: form.photoFile ? 'foto' : 'manuell'})
                : await api.updateDefect(form.id, payload);
            setForm(null);
            setFocusId(saved.id);
            if (tab !== 'all' && !(tab === 'open' && (saved.status === 'offen' || saved.status === 'in_bearbeitung'))) setTab('all');
            await load();
        } catch (err: any) {
            setError(err?.message || 'Mangel konnte nicht gespeichert werden');
        } finally {
            setSaving(false);
        }
    };

    const writeNotice = (d: Defect) => {
        if (d.notice_id) {
            navigate('/drafts', {state: {noticeId: d.notice_id}});
            return;
        }
        const parts = [
            `Mangel: ${d.title}`,
            d.description,
            `Ort: ${d.location || placeOf(d) || 'bitte ergänzen'}`,
            d.company ? `Firma: ${d.company}` : null,
            d.deadline ? (d.is_overdue ? `Frist ${fmt(d.deadline)} abgelaufen, Mangel nicht beseitigt – Nachfrist setzen` : `Beseitigung bis ${fmt(d.deadline)}`) : null,
            `festgestellt am ${fmt(d.found_date)}`
        ].filter(Boolean);
        navigate('/drafts', {state: {type: 'defect', keywords: parts.join('. ')}});
    };

    const exportList = async (format: 'pdf' | 'docx') => {
        setExporting(format);
        try {
            const status = tab === 'all' ? 'all' : tab === 'overdue' ? 'open' : tab;
            const blob = await api.downloadDefectList(projectId, format, status === 'all' ? '' : status, company || undefined);
            saveBlob(blob, `Maengelliste_${toIsoDate(today)}.${format}`);
        } catch (err: any) {
            setError(err?.message || 'Export fehlgeschlagen');
        } finally {
            setExporting(null);
        }
    };

    const latePerCompany = (summary?.by_company ?? []).filter((c) => c.overdue > 0);

    return (
        <div className="idea-page">
            <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><ClipboardList size={22}/></div>
                    <div>
                        <h1>Mängel</h1>
                    </div>
                </div>
                <div className="defects-header-actions">
                    <button className="btn btn-secondary" onClick={() => exportList('docx')} disabled={exporting !== null}
                            title="Mängelliste der aktuellen Auswahl als Word">
                        <Download size={14}/> <span>{exporting === 'docx' ? '…' : 'Word'}</span>
                    </button>
                    <button className="btn btn-secondary" onClick={() => exportList('pdf')} disabled={exporting !== null}
                            title="Mängelliste der aktuellen Auswahl als PDF">
                        <FileText size={14}/> <span>{exporting === 'pdf' ? '…' : 'PDF'}</span>
                    </button>
                    <button className="btn btn-primary" onClick={() => setForm(emptyForm())}>
                        <Plus size={14}/> <span>Mangel erfassen</span>
                    </button>
                </div>
            </div>

            {error && (
                <div className="defects-error" role="alert">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError(null)} aria-label="Hinweis schließen"><X size={14}/></button>
                </div>
            )}

            {summary && (
                <div className="defects-kpis">
                    <div className="defects-kpi"><span>Offen</span><strong>{summary.open}</strong></div>
                    <div className={`defects-kpi${summary.overdue ? ' is-danger' : ''}`}><span>Überfällig</span><strong>{summary.overdue}</strong></div>
                    <div className="defects-kpi"><span>Wartet auf Abnahme</span><strong>{summary.by_status.behoben}</strong></div>
                    <div className="defects-kpi is-success"><span>Abgenommen</span><strong>{summary.by_status.abgenommen}</strong></div>
                    {latePerCompany.length > 0 && (
                        <div className="defects-kpi defects-kpi-wide">
                            <span>Überfällig nach Firma</span>
                            <div className="defects-company-chips">
                                {latePerCompany.map((c) => (
                                    <button key={c.company} type="button" className="defects-chip" onClick={() => {
                                        setTab('overdue');
                                        setCompany(c.company === 'ohne Firma' ? '' : c.company);
                                    }}>
                                        {c.company} · {c.overdue}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="card defects-filters">
                <div className="masterdata-filter-pills defects-tabs" role="tablist" aria-label="Mängel filtern">
                    {TABS.map((t) => (
                        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                                className={`idea-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                            {t.label}{tabCount(t.key) !== null ? ` (${tabCount(t.key)})` : ''}
                        </button>
                    ))}
                </div>
                <div className="defects-filter-row">
                    <label className="defects-search">
                        <Search size={14}/>
                        <input className="form-input" placeholder="Suchen (Titel, Ort, Firma)…" value={search}
                               onChange={(e) => setSearch(e.target.value)} aria-label="Mängel durchsuchen"/>
                    </label>
                    <select className="form-input" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Firma">
                        <option value="">Alle Firmen</option>
                        {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {houseOptions.length > 0 && (
                        <select className="form-input" value={house} onChange={(e) => setHouse(e.target.value)} aria-label="Haus">
                            <option value="">Alle Häuser</option>
                            {houseOptions.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                    )}
                </div>
            </div>

            {form && (
                <form className="card defects-form" onSubmit={save}>
                    <div className="defects-form-head">
                        <strong>{form.id === null ? 'Neuer Mangel' : `Mangel #${form.id} bearbeiten`}</strong>
                        <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} aria-label="Formular schließen"><X size={14}/></button>
                    </div>
                    <div className="defects-form-grid">
                        <label className="defects-field defects-field-wide">
                            <span>Mangel *</span>
                            <input ref={firstField} className="form-input" required maxLength={200} value={form.title}
                                   placeholder="z. B. Kiesnest am Sockel, Riss in Wand"
                                   onChange={(e) => setForm({...form, title: e.target.value})}/>
                        </label>
                        <label className="defects-field defects-field-wide">
                            <span>Beschreibung</span>
                            <textarea className="form-input" rows={2} value={form.description}
                                      onChange={(e) => setForm({...form, description: e.target.value})}/>
                        </label>
                        <label className="defects-field">
                            <span>Ort</span>
                            <input className="form-input" list="defect-places" value={form.location}
                                   placeholder="Haus B · EG, Raum 0.12"
                                   onChange={(e) => setForm({...form, location: e.target.value})}/>
                            <datalist id="defect-places">{places.map((p) => <option key={p} value={p}/>)}</datalist>
                        </label>
                        <label className="defects-field">
                            <span>Verantwortliche Firma</span>
                            <input className="form-input" list="defect-companies" value={form.company}
                                   onChange={(e) => {
                                       const name = e.target.value;
                                       const c = companies.find((x) => x.name === name);
                                       setForm({...form, company: name, trade: form.trade || c?.trade || ''});
                                   }}/>
                            <datalist id="defect-companies">{companyOptions.map((c) => <option key={c} value={c}/>)}</datalist>
                        </label>
                        <label className="defects-field">
                            <span>Gewerk</span>
                            <input className="form-input" value={form.trade} onChange={(e) => setForm({...form, trade: e.target.value})}/>
                        </label>
                        <label className="defects-field">
                            <span>Priorität</span>
                            <select className="form-input" value={form.priority}
                                    onChange={(e) => setForm({...form, priority: e.target.value as DefectPriority})}>
                                {(Object.keys(PRIORITY_LABELS) as DefectPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                            </select>
                        </label>
                        <label className="defects-field">
                            <span>Festgestellt am</span>
                            <input type="date" className="form-input" value={form.found_date}
                                   onChange={(e) => setForm({...form, found_date: e.target.value})}/>
                        </label>
                        <label className="defects-field">
                            <span>Frist zur Beseitigung</span>
                            <input type="date" className="form-input" value={form.deadline}
                                   onChange={(e) => setForm({...form, deadline: e.target.value})}/>
                        </label>
                        {form.id !== null && (
                            <label className="defects-field">
                                <span>Status</span>
                                <select className="form-input" value={form.status}
                                        onChange={(e) => setForm({...form, status: e.target.value as DefectStatus})}>
                                    {(Object.keys(STATUS_LABELS) as DefectStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                                </select>
                            </label>
                        )}
                        <label className="defects-field">
                            <span>Foto</span>
                            <span className="defects-photo-input">
                                <Camera size={14}/>
                                <input type="file" accept="image/*" capture="environment"
                                       onChange={(e) => setForm({...form, photoFile: e.target.files?.[0] ?? null})}/>
                            </span>
                            {form.photo_id && !form.photoFile && <small className="bp-muted">Foto vorhanden – neues ersetzt es</small>}
                        </label>
                    </div>
                    <div className="defects-form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Abbrechen</button>
                        <button type="submit" className="btn btn-primary" disabled={saving || !form.title.trim()}>
                            {saving ? 'Speichert…' : 'Speichern'}
                        </button>
                    </div>
                </form>
            )}

            {visible.length === 0 ? (
                <div className="idea-empty">
                    {defects.length === 0
                        ? 'Noch keine Mängel erfasst. Mit „Mangel erfassen“ anlegen – oder im Baufortschritt eine Ebene wählen.'
                        : 'Keine Mängel für diese Auswahl.'}
                </div>
            ) : (
                <div className="defects-list">
                    {visible.map((d) => {
                        const next = NEXT_STEP[d.status];
                        return (
                            <article key={d.id} id={`defect-${d.id}`}
                                     className={`card defect-card status-${d.status}${d.is_overdue ? ' is-overdue' : ''}${focusId === d.id ? ' is-focus' : ''}`}>
                                {d.photo_id && (
                                    <a className="defect-photo" href={api.getPhotoFileUrl(d.photo_id)} target="_blank" rel="noreferrer"
                                       title="Foto in neuem Tab öffnen">
                                        <img src={api.getPhotoFileUrl(d.photo_id)} alt={`Foto zu ${d.title}`} loading="lazy"/>
                                    </a>
                                )}
                                <div className="defect-main">
                                    <div className="defect-title-row">
                                        <strong className="defect-title">#{d.id} {d.title}</strong>
                                        <span className={`defect-status status-${d.status}`}>{STATUS_LABELS[d.status]}</span>
                                        {d.priority === 'hoch' && <span className="defect-prio">Priorität hoch</span>}
                                    </div>
                                    <div className="defect-meta">
                                        {placeOf(d) && <span><Building2 size={12}/> {placeOf(d)}</span>}
                                        {locationDetail(d) && <span>{locationDetail(d)}</span>}
                                        <span>{d.company || 'Firma offen'}{d.trade ? ` (${d.trade})` : ''}</span>
                                    </div>
                                    {d.description && <div className="defect-desc">{d.description}</div>}
                                    <div className="defect-dates">
                                        <span>festgestellt {fmt(d.found_date)}</span>
                                        {d.deadline && (
                                            <span className={d.is_overdue ? 'defect-late' : undefined}>
                                                {d.is_overdue && <AlertTriangle size={12}/>} Frist {fmt(d.deadline)}
                                                {d.is_overdue ? ` – ${d.days_overdue} Tag${d.days_overdue === 1 ? '' : 'e'} überfällig` : ''}
                                            </span>
                                        )}
                                        {d.resolved_date && <span>behoben {fmt(d.resolved_date)}</span>}
                                        {d.accepted_date && <span><CheckCircle2 size={12}/> abgenommen {fmt(d.accepted_date)}</span>}
                                    </div>
                                    <div className="defect-actions">
                                        {next && (
                                            <button className="btn btn-primary" disabled={busyId === d.id} onClick={() => setStatus(d, next.to)}>
                                                {next.label}
                                            </button>
                                        )}
                                        {d.status !== 'offen' && (
                                            <button className="btn btn-secondary" disabled={busyId === d.id} onClick={() => setStatus(d, 'offen')}
                                                    title="Zurück auf offen (z. B. Abnahme verweigert)">
                                                Wieder offen
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" onClick={() => writeNotice(d)}
                                                title={d.notice_id ? 'Verknüpfte Mängelrüge öffnen' : 'Mängelrüge / Nachfrist als Briefentwurf'}>
                                            <Mail size={13}/> <span>{d.notice_id ? 'Mängelrüge öffnen' : 'Mängelrüge schreiben'}</span>
                                        </button>
                                        {d.house && (
                                            <button className="btn btn-secondary" onClick={() => navigate('/fortschritt', {state: {house: d.house, level: d.level}})}
                                                    title="Im Baufortschritt zeigen">
                                                <Building2 size={13}/>
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" onClick={() => edit(d)} title="Bearbeiten" aria-label={`Mangel ${d.id} bearbeiten`}>
                                            <Pencil size={13}/>
                                        </button>
                                        <button className="btn btn-danger" onClick={() => remove(d)} title="Löschen" aria-label={`Mangel ${d.id} löschen`}>
                                            <Trash2 size={13}/>
                                        </button>
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Defects;
