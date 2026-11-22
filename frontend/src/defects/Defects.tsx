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
import {useLanguage} from '../context/LanguageContext';
import '../ideas/Ideas.css';
import './Defects.css';

/**
 * Mängelmanagement: Mängel mit Ort (Haus/Ebene), Firma, Frist und Status
 * (offen → in Bearbeitung → behoben → abgenommen). Backend: /api/defects.
 * Navigation hierher: {newDefect: {house, level}} öffnet das Formular vorbefüllt (aus Baufortschritt),
 * {focusId} hebt einen Mangel hervor.
 */

type Tab = 'open' | 'overdue' | 'behoben' | 'abgenommen' | 'all';

// Anzeigetexte für Tabs, Status, nächsten Schritt und Priorität kommen aus den Übersetzungen
// (def_tab_<key>, def_status_<status>, def_next_<status>, def_prio_<prio>).
const TABS: Tab[] = ['open', 'overdue', 'behoben', 'abgenommen', 'all'];

const STATUSES: DefectStatus[] = ['offen', 'in_bearbeitung', 'behoben', 'abgenommen'];

const NEXT_STEP: Partial<Record<DefectStatus, DefectStatus>> = {
    offen: 'in_bearbeitung',
    in_bearbeitung: 'behoben',
    behoben: 'abgenommen'
};

const PRIORITIES: DefectPriority[] = ['hoch', 'mittel', 'niedrig'];

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

// Standard 'de-DE': Texte für den (deutschen) Briefentwurf; in der Oberfläche wird die Locale der Sprache übergeben.
const fmt = (iso: string | null | undefined, locale = 'de-DE') =>
    iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }) : '–';

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
    // tx statt t, weil `t` hier schon als Variablenname (Tabs, Timeout) benutzt wird.
    const {t: tx, tf, locale} = useLanguage();
    const fmtUi = (iso: string | null | undefined) => fmt(iso, locale);
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
            setError(err?.message || tx('def_load_failed'));
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
            setError(err?.message || tx('def_status_failed'));
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (d: Defect) => {
        if (!window.confirm(tf('def_confirm_delete', {title: d.title}))) return;
        try {
            await api.deleteDefect(d.id);
            await load();
        } catch (err: any) {
            setError(err?.message || tx('def_delete_failed'));
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
            setError(err?.message || tx('def_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const writeNotice = (d: Defect) => {
        if (d.notice_id) {
            navigate('/drafts', {state: {noticeId: d.notice_id}});
            return;
        }
        // Bewusst Deutsch: Diese Stichworte gehen in den deutschen VOB/B-Briefentwurf.
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
            setError(err?.message || tx('def_export_failed'));
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
                        <h1>{tx('def_title')}</h1>
                    </div>
                </div>
                <div className="defects-header-actions">
                    <button className="btn btn-secondary" onClick={() => exportList('docx')} disabled={exporting !== null}
                            title={tx('def_export_word_title')}>
                        <Download size={14}/> <span>{exporting === 'docx' ? '…' : 'Word'}</span>
                    </button>
                    <button className="btn btn-secondary" onClick={() => exportList('pdf')} disabled={exporting !== null}
                            title={tx('def_export_pdf_title')}>
                        <FileText size={14}/> <span>{exporting === 'pdf' ? '…' : 'PDF'}</span>
                    </button>
                    <button className="btn btn-primary" onClick={() => setForm(emptyForm())}>
                        <Plus size={14}/> <span>{tx('def_add')}</span>
                    </button>
                </div>
            </div>

            {error && (
                <div className="defects-error" role="alert">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError(null)} aria-label={tx('def_close_hint')}><X
                        size={14}/></button>
                </div>
            )}

            {summary && (
                <div className="defects-kpis">
                    <div className="defects-kpi"><span>{tx('def_tab_open')}</span><strong>{summary.open}</strong></div>
                    <div className={`defects-kpi${summary.overdue ? ' is-danger' : ''}`}>
                        <span>{tx('def_tab_overdue')}</span><strong>{summary.overdue}</strong></div>
                    <div className="defects-kpi">
                        <span>{tx('def_tab_behoben')}</span><strong>{summary.by_status.behoben}</strong></div>
                    <div className="defects-kpi is-success">
                        <span>{tx('def_tab_abgenommen')}</span><strong>{summary.by_status.abgenommen}</strong></div>
                    {latePerCompany.length > 0 && (
                        <div className="defects-kpi defects-kpi-wide">
                            <span>{tx('def_overdue_by_company')}</span>
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
                <div className="masterdata-filter-pills defects-tabs" role="tablist" aria-label={tx('def_filter_aria')}>
                    {TABS.map((k) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k}
                                className={`idea-tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
                            {tx(`def_tab_${k}`)}{tabCount(k) !== null ? ` (${tabCount(k)})` : ''}
                        </button>
                    ))}
                </div>
                <div className="defects-filter-row">
                    <label className="defects-search">
                        <Search size={14}/>
                        <input className="form-input" placeholder={tx('def_search_ph')} value={search}
                               onChange={(e) => setSearch(e.target.value)} aria-label={tx('def_search_aria')}/>
                    </label>
                    <select className="form-input" value={company} onChange={(e) => setCompany(e.target.value)}
                            aria-label={tx('def_company')}>
                        <option value="">{tx('def_all_companies')}</option>
                        {companyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {houseOptions.length > 0 && (
                        <select className="form-input" value={house} onChange={(e) => setHouse(e.target.value)}
                                aria-label={tx('def_house')}>
                            <option value="">{tx('def_all_houses')}</option>
                            {houseOptions.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                    )}
                </div>
            </div>

            {form && (
                <form className="card defects-form" onSubmit={save}>
                    <div className="defects-form-head">
                        <strong>{form.id === null ? tx('def_new') : tf('def_edit_n', {id: form.id})}</strong>
                        <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}
                                aria-label={tx('def_close_form')}><X size={14}/></button>
                    </div>
                    <div className="defects-form-grid">
                        <label className="defects-field defects-field-wide">
                            <span>{tx('def_f_title')}</span>
                            <input ref={firstField} className="form-input" required maxLength={200} value={form.title}
                                   placeholder={tx('def_f_title_ph')}
                                   onChange={(e) => setForm({...form, title: e.target.value})}/>
                        </label>
                        <label className="defects-field defects-field-wide">
                            <span>{tx('def_f_desc')}</span>
                            <textarea className="form-input" rows={2} value={form.description}
                                      onChange={(e) => setForm({...form, description: e.target.value})}/>
                        </label>
                        <label className="defects-field">
                            <span>{tx('def_f_location')}</span>
                            <input className="form-input" list="defect-places" value={form.location}
                                   placeholder={tx('def_f_location_ph')}
                                   onChange={(e) => setForm({...form, location: e.target.value})}/>
                            <datalist id="defect-places">{places.map((p) => <option key={p} value={p}/>)}</datalist>
                        </label>
                        <label className="defects-field">
                            <span>{tx('def_f_company')}</span>
                            <input className="form-input" list="defect-companies" value={form.company}
                                   onChange={(e) => {
                                       const name = e.target.value;
                                       const c = companies.find((x) => x.name === name);
                                       setForm({...form, company: name, trade: form.trade || c?.trade || ''});
                                   }}/>
                            <datalist id="defect-companies">{companyOptions.map((c) => <option key={c} value={c}/>)}</datalist>
                        </label>
                        <label className="defects-field">
                            <span>{tx('def_f_trade')}</span>
                            <input className="form-input" value={form.trade} onChange={(e) => setForm({...form, trade: e.target.value})}/>
                        </label>
                        <label className="defects-field">
                            <span>{tx('def_f_priority')}</span>
                            <select className="form-input" value={form.priority}
                                    onChange={(e) => setForm({...form, priority: e.target.value as DefectPriority})}>
                                {PRIORITIES.map((p) => <option key={p} value={p}>{tx(`def_prio_${p}`)}</option>)}
                            </select>
                        </label>
                        <label className="defects-field">
                            <span>{tx('def_f_found')}</span>
                            <input type="date" className="form-input" value={form.found_date}
                                   onChange={(e) => setForm({...form, found_date: e.target.value})}/>
                        </label>
                        <label className="defects-field">
                            <span>{tx('def_f_deadline')}</span>
                            <input type="date" className="form-input" value={form.deadline}
                                   onChange={(e) => setForm({...form, deadline: e.target.value})}/>
                        </label>
                        {form.id !== null && (
                            <label className="defects-field">
                                <span>{tx('def_f_status')}</span>
                                <select className="form-input" value={form.status}
                                        onChange={(e) => setForm({...form, status: e.target.value as DefectStatus})}>
                                    {STATUSES.map((s) => <option key={s} value={s}>{tx(`def_status_${s}`)}</option>)}
                                </select>
                            </label>
                        )}
                        <label className="defects-field">
                            <span>{tx('def_f_photo')}</span>
                            <span className="defects-photo-input">
                                <Camera size={14}/>
                                <input type="file" accept="image/*" capture="environment"
                                       onChange={(e) => setForm({...form, photoFile: e.target.files?.[0] ?? null})}/>
                            </span>
                            {form.photo_id && !form.photoFile &&
                                <small className="bp-muted">{tx('def_f_photo_exists')}</small>}
                        </label>
                    </div>
                    <div className="defects-form-actions">
                        <button type="button" className="btn btn-secondary"
                                onClick={() => setForm(null)}>{tx('btn_cancel')}</button>
                        <button type="submit" className="btn btn-primary" disabled={saving || !form.title.trim()}>
                            {saving ? tx('def_saving') : tx('btn_save')}
                        </button>
                    </div>
                </form>
            )}

            {visible.length === 0 ? (
                <div className="idea-empty">
                    {defects.length === 0
                        ? tx('def_empty_none')
                        : tx('def_empty_filter')}
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
                                       title={tx('def_photo_open')}>
                                        <img src={api.getPhotoFileUrl(d.photo_id)}
                                             alt={tf('def_photo_alt', {title: d.title})} loading="lazy"/>
                                    </a>
                                )}
                                <div className="defect-main">
                                    <div className="defect-title-row">
                                        <strong className="defect-title">#{d.id} {d.title}</strong>
                                        <span
                                            className={`defect-status status-${d.status}`}>{tx(`def_status_${d.status}`)}</span>
                                        {d.priority === 'hoch' &&
                                            <span className="defect-prio">{tx('def_prio_high_badge')}</span>}
                                    </div>
                                    <div className="defect-meta">
                                        {placeOf(d) && <span><Building2 size={12}/> {placeOf(d)}</span>}
                                        {locationDetail(d) && <span>{locationDetail(d)}</span>}
                                        <span>{d.company || tx('def_company_open')}{d.trade ? ` (${d.trade})` : ''}</span>
                                    </div>
                                    {d.description && <div className="defect-desc">{d.description}</div>}
                                    <div className="defect-dates">
                                        <span>{tf('def_found_on', {date: fmtUi(d.found_date)})}</span>
                                        {d.deadline && (
                                            <span className={d.is_overdue ? 'defect-late' : undefined}>
                                                {d.is_overdue && <AlertTriangle
                                                    size={12}/>} {tf('def_deadline_on', {date: fmtUi(d.deadline)})}
                                                {d.is_overdue ? (d.days_overdue === 1 ? tx('def_days_overdue_1') : tf('def_days_overdue_n', {n: d.days_overdue})) : ''}
                                            </span>
                                        )}
                                        {d.resolved_date &&
                                            <span>{tf('def_fixed_on', {date: fmtUi(d.resolved_date)})}</span>}
                                        {d.accepted_date && <span><CheckCircle2
                                            size={12}/> {tf('def_accepted_on', {date: fmtUi(d.accepted_date)})}</span>}
                                    </div>
                                    <div className="defect-actions">
                                        {next && (
                                            <button className="btn btn-primary" disabled={busyId === d.id}
                                                    onClick={() => setStatus(d, next)}>
                                                {tx(`def_next_${d.status}`)}
                                            </button>
                                        )}
                                        {d.status !== 'offen' && (
                                            <button className="btn btn-secondary" disabled={busyId === d.id} onClick={() => setStatus(d, 'offen')}
                                                    title={tx('def_reopen_title')}>
                                                {tx('def_reopen')}
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" onClick={() => writeNotice(d)}
                                                title={d.notice_id ? tx('def_notice_open_title') : tx('def_notice_write_title')}>
                                            <Mail size={13}/>
                                            <span>{d.notice_id ? tx('def_notice_open') : tx('def_notice_write')}</span>
                                        </button>
                                        {d.house && (
                                            <button className="btn btn-secondary" onClick={() => navigate('/fortschritt', {state: {house: d.house, level: d.level}})}
                                                    title={tx('def_show_progress')}>
                                                <Building2 size={13}/>
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" onClick={() => edit(d)}
                                                title={tx('btn_edit')} aria-label={tf('def_edit_aria', {id: d.id})}>
                                            <Pencil size={13}/>
                                        </button>
                                        <button className="btn btn-danger" onClick={() => remove(d)}
                                                title={tx('btn_delete')} aria-label={tf('def_delete_aria', {id: d.id})}>
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
