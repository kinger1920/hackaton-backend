import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    BookOpen,
    Building2,
    CalendarRange,
    CheckCircle2,
    Download,
    Eye,
    FileSearch,
    FileText,
    ListTree,
    Paperclip,
    PauseCircle,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
    UploadCloud,
    X
} from 'lucide-react';
import PlanTasksPanel from './PlanTasksPanel';
import {formatDe} from '../utils/dates';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {
    api,
    Company,
    CompanyCreate,
    CompanyType,
    ConstructionPlan,
    Contract,
    ContractParseResponse,
    ContractText,
    saveBlob
} from '../services/api';
import '@frontend/src/index.css';
import './MasterData.css';

// Felder, die POST /api/contracts/{id}/parse liefern kann; Anzeigetext über md_pf_<feld>.
const PARSED_FIELDS = ['planned_workforce', 'contractor_name', 'trade', 'vob_special', 'execution_start', 'execution_end'];

/**
 * Stammdaten: Firmen (/companies), Verträge als PDF (/contracts) und Bauzeitenpläne (/plans).
 * Alles direkt gegen das Backend – keine lokalen Daten.
 */

type Tab = 'companies' | 'contracts' | 'plans';

// Firmenarten des Backends; Anzeigetext über md_ct_<art>.
const COMPANY_TYPES: CompanyType[] = ['own', 'client', 'subcontractor'];

const EMPTY_COMPANY: CompanyCreate = {
    name: '',
    company_type: 'subcontractor',
    trade: '',
    address: '',
    contact_person: '',
    phone: '',
    email: '',
    vob_rules: '',
    notes: ''
};

// Leere Strings als null senden, damit das Backend keine "" speichert
function cleanCompany(data: CompanyCreate): CompanyCreate {
    const out: any = {...data};
    Object.keys(out).forEach((k) => {
        if (typeof out[k] === 'string' && out[k].trim() === '' && k !== 'name') out[k] = null;
    });
    return out;
}

const formatDate = (v?: string | null) => formatDe(v);

export const MasterData: React.FC = () => {
    const {t} = useLanguage();
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const navTab = (useLocation().state as { tab?: Tab } | null)?.tab;
    const [tab, setTab] = useState<Tab>(
        navTab === 'companies' || navTab === 'contracts' || navTab === 'plans' ? navTab : 'companies'
    );
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="masterdata-container">
            <div className="masterdata-header">
                <div className="tp-title-group">
                    <div className="tp-title-icon"><Building2 size={22}/></div>
                    <div>
                        <h1>{t('nav_masterdata', 'Stammdaten')}</h1>
                    </div>
                </div>
            </div>

            <div className="masterdata-tabs">
                <button className={`masterdata-tab ${tab === 'companies' ? 'active' : ''}`} onClick={() => setTab('companies')}>
                    <Building2 size={15}/> <span>{t('md_tab_companies')}</span>
                </button>
                <button className={`masterdata-tab ${tab === 'contracts' ? 'active' : ''}`} onClick={() => setTab('contracts')}>
                    <FileText size={15}/> <span>{t('md_tab_contracts')}</span>
                </button>
                <button className={`masterdata-tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>
                    <CalendarRange size={15}/> <span>{t('md_tab_plans')}</span>
                </button>
            </div>

            {error && (
                <div className="masterdata-error">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} title={t('btn_close')}><X size={14}/></button>
                </div>
            )}

            {tab === 'companies' && <CompaniesTab onError={setError}/>}
            {tab === 'contracts' && <ContractsTab projectId={projectId} onError={setError}/>}
            {tab === 'plans' && <PlansTab projectId={projectId} onError={setError}/>}
        </div>
    );
};

// ==========================================
// Firmen
// ==========================================
const CompaniesTab: React.FC<{ onError: (msg: string) => void }> = ({onError}) => {
    const {t, tf} = useLanguage();
    const companyTypeLabel = (ct: string) => (COMPANY_TYPES.includes(ct as CompanyType) ? t(`md_ct_${ct}`) : ct);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [filter, setFilter] = useState<CompanyType | ''>('');
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<CompanyCreate | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            setCompanies(await api.listCompanies(filter ? {company_type: filter} : undefined));
        } catch (err: any) {
            onError(err?.message || t('md_companies_load_failed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [filter]);

    const startCreate = () => {
        setEditingId(null);
        setForm({...EMPTY_COMPANY});
    };

    const startEdit = (c: Company) => {
        const {id, created_at, updated_at, ...rest} = c;
        setEditingId(id);
        setForm({...EMPTY_COMPANY, ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v ?? '']))} as CompanyCreate);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form || !form.name.trim()) return;
        try {
            if (editingId !== null) await api.updateCompany(editingId, cleanCompany(form));
            else await api.createCompany(cleanCompany(form));
            setForm(null);
            setEditingId(null);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_company_save_failed'));
        }
    };

    const handleDelete = async (c: Company) => {
        if (!window.confirm(tf('md_company_confirm_delete', {name: c.name}))) return;
        try {
            await api.deleteCompany(c.id);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_company_delete_failed'));
        }
    };

    const field = (key: keyof CompanyCreate, label: string, type = 'text') => (
        <div className="form-group">
            <label className="form-label">{label}</label>
            <input
                className="form-input"
                type={type}
                value={(form?.[key] as string) ?? ''}
                onChange={(e) => setForm((f) => (f ? {...f, [key]: e.target.value} : f))}
            />
        </div>
    );

    return (
        <div className="card masterdata-card">
            <div className="masterdata-toolbar">
                <select className="form-input" style={{maxWidth: '220px'}} value={filter} onChange={(e) => setFilter(e.target.value as CompanyType | '')}>
                    <option value="">{t('md_all_company_types')}</option>
                    {COMPANY_TYPES.map((k) => (
                        <option key={k} value={k}>{companyTypeLabel(k)}</option>
                    ))}
                </select>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title={t('btn_reload')}>
                        <RefreshCw size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={startCreate}>
                        <Plus size={16}/> <span>{t('md_add_company')}</span>
                    </button>
                </div>
            </div>

            {form && (
                <form onSubmit={handleSubmit} className="masterdata-form">
                    <h3>{editingId !== null ? t('md_edit_company') : t('md_new_company')}</h3>
                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label">{t('md_name_req')}</label>
                            <input
                                className="form-input"
                                required
                                autoFocus
                                value={form.name}
                                onChange={(e) => setForm({...form, name: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('md_company_type')}</label>
                            <select
                                className="form-input"
                                value={form.company_type}
                                onChange={(e) => setForm({...form, company_type: e.target.value as CompanyType})}
                            >
                                {COMPANY_TYPES.map((k) => (
                                    <option key={k} value={k}>{companyTypeLabel(k)}</option>
                                ))}
                            </select>
                        </div>
                        {field('trade', t('md_pf_trade'))}
                        {field('contact_person', t('md_contact_person'))}
                        {field('phone', t('md_phone'), 'tel')}
                        {field('email', t('md_email'), 'email')}
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">{t('md_address')}</label>
                            <input className="form-input" value={form.address ?? ''} onChange={(e) => setForm({...form, address: e.target.value})}/>
                        </div>
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">{t('md_vob_rules')}</label>
                            <textarea className="form-textarea" rows={2} value={form.vob_rules ?? ''} onChange={(e) => setForm({...form, vob_rules: e.target.value})}/>
                        </div>
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">{t('md_notes')}</label>
                            <textarea className="form-textarea" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({...form, notes: e.target.value})}/>
                        </div>
                    </div>
                    <div className="masterdata-form-actions">
                        <button type="button" className="btn btn-secondary"
                                onClick={() => setForm(null)}>{t('btn_cancel')}</button>
                        <button type="submit" className="btn btn-primary">{t('btn_save')}</button>
                    </div>
                </form>
            )}

            {companies.length === 0 && !loading ? (
                <div className="masterdata-empty">{t('md_no_companies')}</div>
            ) : (
                <div className="masterdata-list">
                    {companies.map((c) => (
                        <div key={c.id} className="masterdata-row">
                            <div className="masterdata-row-main">
                                <div className="masterdata-row-title">
                                    {c.name} <span
                                    className="badge badge-info">{companyTypeLabel(c.company_type)}</span>
                                </div>
                                <div className="masterdata-row-meta">
                                    {[c.trade, c.contact_person, c.phone, c.email].filter(Boolean).join(' • ') || '–'}
                                </div>
                                {c.address && <div className="masterdata-row-meta">{c.address}</div>}
                                {c.vob_rules && <div className="masterdata-row-meta">VOB: {c.vob_rules}</div>}
                            </div>
                            <div className="masterdata-row-actions">
                                <button className="btn btn-secondary" onClick={() => startEdit(c)}
                                        title={t('btn_edit')}><Pencil size={14}/></button>
                                <button className="btn btn-danger" onClick={() => handleDelete(c)}
                                        title={t('btn_delete')}><Trash2 size={14}/></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ==========================================
// Verträge (PDF-Upload + Textextraktion)
// ==========================================
interface ContractForm {
    title: string;
    contractor_name: string;
    trade: string;
    planned_workforce: string;
    vob_notes: string;
    is_active: boolean;
    file: File | null;
}

const EMPTY_CONTRACT: ContractForm = {
    title: '',
    contractor_name: '',
    trade: '',
    planned_workforce: '',
    vob_notes: '',
    is_active: true,
    file: null
};

type ContractStatusFilter = 'all' | 'active' | 'inactive';

const ContractsTab: React.FC<{ projectId: number; onError: (msg: string) => void }> = ({projectId, onError}) => {
    const navigate = useNavigate();
    const {t, tf, locale} = useLanguage();
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [statusFilter, setStatusFilter] = useState<ContractStatusFilter>('all');
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<ContractForm | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [textView, setTextView] = useState<ContractText | null>(null);
    // POST /api/contracts/{id}/parse – Vorschlag mit Fundstellen, Übernahme per PATCH
    const [parseView, setParseView] = useState<{ contract: Contract; result: ContractParseResponse } | null>(null);
    const [parsingId, setParsingId] = useState<number | null>(null);
    const [attachingId, setAttachingId] = useState<number | null>(null);

    const handleParse = async (c: Contract) => {
        setParsingId(c.id);
        try {
            setParseView({contract: c, result: await api.parseContract(c.id)});
        } catch (err: any) {
            onError(err?.message || t('md_contract_parse_failed'));
        } finally {
            setParsingId(null);
        }
    };

    const handleApplyParse = async () => {
        if (!parseView) return;
        try {
            await api.updateContract(parseView.contract.id, parseView.result.suggested_patch as any);
            setParseView(null);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_apply_failed'));
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            setContracts(await api.listContracts(projectId));
        } catch (err: any) {
            onError(err?.message || t('md_contracts_load_failed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [projectId]);

    const startEdit = (c: Contract) => {
        setEditingId(c.id);
        setForm({
            title: c.title,
            contractor_name: c.contractor_name ?? '',
            trade: c.trade ?? '',
            planned_workforce: c.planned_workforce != null ? String(c.planned_workforce) : '',
            vob_notes: c.vob_notes ?? '',
            is_active: c.is_active !== false,
            file: null
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form || !form.title.trim()) return;
        const workforce = form.planned_workforce.trim() ? parseInt(form.planned_workforce, 10) : undefined;
        setSaving(true);
        try {
            if (editingId !== null) {
                await api.updateContract(editingId, {
                    title: form.title.trim(),
                    contractor_name: form.contractor_name.trim() || null,
                    trade: form.trade.trim() || null,
                    planned_workforce: workforce ?? null,
                    vob_notes: form.vob_notes.trim() || null,
                    is_active: form.is_active
                });
            } else {
                if (!form.file) {
                    onError(t('md_pick_pdf'));
                    return;
                }
                await api.uploadContract({
                    project_id: projectId,
                    title: form.title.trim(),
                    file: form.file,
                    contractor_name: form.contractor_name.trim() || undefined,
                    trade: form.trade.trim() || undefined,
                    planned_workforce: workforce,
                    vob_notes: form.vob_notes.trim() || undefined,
                    is_active: form.is_active
                });
            }
            setForm(null);
            setEditingId(null);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_contract_save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (c: Contract) => {
        const nextActive = c.is_active === false;
        try {
            await api.updateContract(c.id, {is_active: nextActive});
            load();
        } catch (err: any) {
            onError(err?.message || t('md_contract_status_failed'));
        }
    };

    const handleDelete = async (c: Contract) => {
        if (!window.confirm(tf('md_contract_confirm_delete', {title: c.title}))) return;
        try {
            await api.deleteContract(c.id);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_contract_delete_failed'));
        }
    };

    // PUT /contracts/{id}/file – PDF nachträglich anhängen (z. B. Demo-/Projektformular-Verträge) oder ersetzen
    const handleAttachFile = async (c: Contract, file: File | undefined) => {
        if (!file) return;
        if (c.file_name && !window.confirm(tf('md_replace_file', {old: c.file_name, new: file.name}))) return;
        setAttachingId(c.id);
        try {
            await api.attachContractFile(c.id, file);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_attach_failed'));
        } finally {
            setAttachingId(null);
        }
    };

    const handleDownload = async (c: Contract) => {
        try {
            saveBlob(await api.downloadContractFile(c.id), c.file_name || `Vertrag_${c.id}.pdf`);
        } catch (err: any) {
            onError(err?.message || t('md_download_failed'));
        }
    };

    const handleShowText = async (c: Contract) => {
        try {
            setTextView(await api.getContractText(c.id));
        } catch (err: any) {
            onError(err?.message || t('md_text_failed'));
        }
    };

    const activeContracts = contracts.filter((c) => c.is_active !== false);
    const inactiveContracts = contracts.filter((c) => c.is_active === false);

    const renderContractRow = (c: Contract) => {
        const isActive = c.is_active !== false;
        return (
            <div key={c.id} className={`masterdata-row ${isActive ? '' : 'is-inactive'}`}>
                <div className="masterdata-row-main">
                    <div className="masterdata-row-title">
                        <span>{c.title}</span>
                        <span className={`contract-status-badge ${isActive ? 'active' : 'inactive'}`}>
                            {isActive ? <CheckCircle2 size={11}/> : <PauseCircle size={11}/>}
                            <span>{isActive ? t('md_active') : t('md_inactive')}</span>
                        </span>
                    </div>
                    <div className="masterdata-row-meta">
                        {[c.contractor_name, c.trade, c.planned_workforce != null ? tf('md_planned_workers', {n: c.planned_workforce}) : null]
                            .filter(Boolean).join(' • ') || '–'}
                    </div>
                    <div className="masterdata-row-meta">
                        {c.file_name || t('md_no_file')} • {c.file_name ? t('md_uploaded') : t('md_created')} {formatDate(c.uploaded_at)}
                        {c.extracted_text ? tf('md_chars_read', {n: c.extracted_text.length.toLocaleString(locale)}) : t('md_no_text')}
                    </div>
                    {c.vob_notes && <div className="masterdata-row-meta">VOB: {c.vob_notes}</div>}
                </div>
                <div className="masterdata-row-actions">
                    <button
                        className="btn btn-primary contract-summary-btn"
                        onClick={() => navigate('/summary', {state: {contractId: c.id, contractTitle: c.title}})}
                        title={t('md_summarize_title')}
                    >
                        <BookOpen size={14}/> <span>{t('md_summarize')}</span>
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleToggleActive(c)}
                        title={isActive ? t('md_mark_inactive') : t('md_reactivate')}
                    >
                        {isActive ? <PauseCircle size={14}/> : <CheckCircle2 size={14}/>}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleParse(c)}
                        disabled={parsingId === c.id || !c.extracted_text}
                        title={c.extracted_text
                            ? t('md_parse_title')
                            : c.file_name
                                ? t('md_parse_no_text')
                                : t('md_parse_no_file')}
                    >
                        {parsingId === c.id ? <RefreshCw size={14}/> : <FileSearch size={14}/>}
                    </button>
                    <button className="btn btn-secondary" onClick={() => handleShowText(c)} title={t('md_show_text')}>
                        <Eye size={14}/></button>
                    <button className="btn btn-secondary" onClick={() => handleDownload(c)} disabled={!c.file_name}
                            title={c.file_name ? t('md_download_pdf') : t('md_no_file_title')}><Download size={14}/>
                    </button>
                    <label
                        className={`btn btn-secondary${attachingId === c.id ? ' is-disabled' : ''}`}
                        title={c.file_name ? t('md_replace_pdf') : t('md_attach_pdf')}
                        aria-disabled={attachingId === c.id}
                        style={{cursor: attachingId === c.id ? 'wait' : 'pointer'}}
                    >
                        {attachingId === c.id ? <RefreshCw size={14}/> : <Paperclip size={14}/>}
                        <input
                            type="file"
                            accept="application/pdf,.pdf"
                            hidden
                            disabled={attachingId === c.id}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                handleAttachFile(c, file);
                            }}
                        />
                    </label>
                    <button className="btn btn-secondary" onClick={() => startEdit(c)} title={t('btn_edit')}><Pencil
                        size={14}/></button>
                    <button className="btn btn-danger" onClick={() => handleDelete(c)} title={t('btn_delete')}><Trash2
                        size={14}/></button>
                </div>
            </div>
        );
    };

    return (
        <div className="card masterdata-card">
            <div className="masterdata-toolbar">
                <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    <div className="masterdata-filter-pills" role="tablist" aria-label={t('md_filter_aria')}>
                        <button
                            type="button"
                            className={`masterdata-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('all')}
                        >
                            {tf('md_all_n', {n: contracts.length})}
                        </button>
                        <button
                            type="button"
                            className={`masterdata-filter-pill ${statusFilter === 'active' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('active')}
                        >
                            {tf('md_active_n', {n: activeContracts.length})}
                        </button>
                        <button
                            type="button"
                            className={`masterdata-filter-pill ${statusFilter === 'inactive' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('inactive')}
                        >
                            {tf('md_inactive_n', {n: inactiveContracts.length})}
                        </button>
                    </div>
                    <span className="masterdata-hint">
                        {t('md_active_hint')}
                    </span>
                </div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title={t('btn_reload')}>
                        <RefreshCw size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm({...EMPTY_CONTRACT}); }}>
                        <UploadCloud size={16}/> <span>{t('md_upload_contract')}</span>
                    </button>
                </div>
            </div>

            {form && (
                <form onSubmit={handleSubmit} className="masterdata-form">
                    <h3>{editingId !== null ? t('md_edit_contract') : t('md_upload_contract_pdf')}</h3>
                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label">{t('md_title_req')}</label>
                            <input className="form-input" required autoFocus placeholder={t('md_contract_title_ph')}
                                   value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('md_pf_contractor_name')}</label>
                            <input className="form-input" value={form.contractor_name} onChange={(e) => setForm({...form, contractor_name: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('md_pf_trade')}</label>
                            <input className="form-input" value={form.trade} onChange={(e) => setForm({...form, trade: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('md_contract_workforce')}</label>
                            <input className="form-input" type="number" min={0} value={form.planned_workforce}
                                   onChange={(e) => setForm({...form, planned_workforce: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('md_status')}</label>
                            <select
                                className="form-input"
                                value={form.is_active ? 'active' : 'inactive'}
                                onChange={(e) => setForm({...form, is_active: e.target.value === 'active'})}
                            >
                                <option value="active">{t('md_active_contract')}</option>
                                <option value="inactive">{t('md_inactive_contract')}</option>
                            </select>
                        </div>
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">{t('md_pf_vob_special')}</label>
                            <textarea className="form-textarea" rows={2} value={form.vob_notes} onChange={(e) => setForm({...form, vob_notes: e.target.value})}/>
                        </div>
                        {editingId === null && (
                            <div className="form-group" style={{gridColumn: 'span 2'}}>
                                <label className="form-label">{t('md_contract_pdf_req')}</label>
                                <input className="form-input" type="file" accept="application/pdf,.pdf" required
                                       onChange={(e) => setForm({...form, file: e.target.files?.[0] ?? null})}/>
                            </div>
                        )}
                    </div>
                    <div className="masterdata-form-actions">
                        <button type="button" className="btn btn-secondary"
                                onClick={() => setForm(null)}>{t('btn_cancel')}</button>
                        <button type="submit" className="btn btn-primary"
                                disabled={saving}>{saving ? t('md_uploading') : t('btn_save')}</button>
                    </div>
                </form>
            )}

            {contracts.length === 0 && !loading ? (
                <div className="masterdata-empty">{t('md_no_contracts')}</div>
            ) : (
                <div className="masterdata-contract-sections">
                    {(statusFilter === 'all' || statusFilter === 'active') && (
                        <div className="masterdata-section">
                            <div className="masterdata-section-header">
                                <span>{t('md_active_contracts')}</span>
                                <span className="count">{activeContracts.length}</span>
                            </div>
                            {activeContracts.length === 0 ? (
                                <div className="masterdata-empty">{t('md_no_active')}</div>
                            ) : (
                                <div className="masterdata-list">{activeContracts.map(renderContractRow)}</div>
                            )}
                        </div>
                    )}

                    {(statusFilter === 'all' || statusFilter === 'inactive') && (
                        <div className="masterdata-section">
                            <div className="masterdata-section-header">
                                <span>{t('md_inactive_contracts')}</span>
                                <span className="count">{inactiveContracts.length}</span>
                            </div>
                            {inactiveContracts.length === 0 ? (
                                <div className="masterdata-empty">{t('md_no_inactive')}</div>
                            ) : (
                                <div className="masterdata-list">{inactiveContracts.map(renderContractRow)}</div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {parseView && (
                <div className="modal-overlay" onClick={() => setParseView(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth: '760px'}}>
                        <div className="modal-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <div>
                                <strong>{tf('md_parsed_title', {title: parseView.contract.title})}</strong>
                                <div style={{fontSize: '12px', color: 'var(--text-muted)'}}>
                                    {t('md_parsed_hint')}
                                </div>
                            </div>
                            <button onClick={() => setParseView(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}><X size={16}/></button>
                        </div>
                        <div className="masterdata-list" style={{marginTop: '12px'}}>
                            {Object.keys(parseView.result.fields).length === 0 && (
                                <div className="masterdata-empty">{t('md_parsed_none')}</div>
                            )}
                            {Object.entries(parseView.result.fields).map(([key, f]) => (
                                <div key={key} className="masterdata-row">
                                    <div className="masterdata-row-main">
                                        <div className="masterdata-row-title">
                                            {PARSED_FIELDS.includes(key) ? t(`md_pf_${key}`) : key}: {String(f.value)}
                                            {key === 'planned_workforce' && parseView.result.current_planned_workforce != null &&
                                                parseView.result.current_planned_workforce !== f.value && (
                                                    <span
                                                        className="badge badge-info">{tf('md_previously', {n: parseView.result.current_planned_workforce})}</span>
                                                )}
                                        </div>
                                        <div className="masterdata-row-meta">{t('md_source')} „{f.src}“</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="masterdata-form-actions" style={{marginTop: '12px'}}>
                            <button className="btn btn-secondary"
                                    onClick={() => setParseView(null)}>{t('md_discard')}</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleApplyParse}
                                disabled={Object.keys(parseView.result.suggested_patch).length === 0}
                            >
                                {t('md_apply_contract')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {textView && (
                <div className="modal-overlay" onClick={() => setTextView(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth: '760px'}}>
                        <div className="modal-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <strong>{textView.title}</strong>
                            <button onClick={() => setTextView(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}><X size={16}/></button>
                        </div>
                        <pre className="masterdata-pre">{textView.extracted_text || t('md_no_text_extracted')}</pre>
                    </div>
                </div>
            )}
        </div>
    );
};

// ==========================================
// Bauzeitenpläne
// ==========================================
const PlansTab: React.FC<{ projectId: number; onError: (msg: string) => void }> = ({projectId, onError}) => {
    const {t, tf} = useLanguage();
    const [plans, setPlans] = useState<ConstructionPlan[]>([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<{ title: string; version: string } | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [openPlanId, setOpenPlanId] = useState<number | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const list = await api.listPlans(projectId);
            setPlans(list);
            setOpenPlanId((prev) => (prev !== null && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? null));
        } catch (err: any) {
            onError(err?.message || t('md_plans_load_failed'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [projectId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form || !form.title.trim()) return;
        try {
            if (editingId !== null) {
                await api.updatePlan(editingId, {title: form.title.trim(), version: form.version.trim() || undefined});
            } else {
                await api.createPlan({project_id: projectId, title: form.title.trim(), version: form.version.trim() || '1.0'});
            }
            setForm(null);
            setEditingId(null);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_plan_save_failed'));
        }
    };

    const handleDelete = async (p: ConstructionPlan) => {
        if (!window.confirm(tf('md_plan_confirm_delete', {title: p.title}))) return;
        try {
            await api.deletePlan(p.id);
            load();
        } catch (err: any) {
            onError(err?.message || t('md_plan_delete_failed'));
        }
    };

    return (
        <div className="card masterdata-card">
            <div className="masterdata-toolbar">
                <span className="masterdata-hint">{t('md_plans_hint')}</span>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title={t('btn_reload')}>
                        <RefreshCw size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm({title: '', version: '1.0'}); }}>
                        <Plus size={16}/> <span>{t('md_add_plan')}</span>
                    </button>
                </div>
            </div>

            {form && (
                <form onSubmit={handleSubmit} className="masterdata-form">
                    <h3>{editingId !== null ? t('md_edit_plan') : t('md_new_plan')}</h3>
                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label">{t('md_title_req')}</label>
                            <input className="form-input" required autoFocus placeholder={t('md_plan_title_ph')}
                                   value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">{t('md_version')}</label>
                            <input className="form-input" value={form.version} onChange={(e) => setForm({...form, version: e.target.value})}/>
                        </div>
                    </div>
                    <div className="masterdata-form-actions">
                        <button type="button" className="btn btn-secondary"
                                onClick={() => setForm(null)}>{t('btn_cancel')}</button>
                        <button type="submit" className="btn btn-primary">{t('btn_save')}</button>
                    </div>
                </form>
            )}

            {plans.length === 0 && !loading ? (
                <div className="masterdata-empty">{t('md_no_plans')}</div>
            ) : (
                <div className="masterdata-list">
                    {plans.map((p) => (
                        <div key={p.id} className="masterdata-plan">
                            <div className="masterdata-row">
                                <div className="masterdata-row-main">
                                    <div className="masterdata-row-title">
                                        {p.title} <span className="badge badge-info">v{p.version || '1.0'}</span>
                                    </div>
                                    <div className="masterdata-row-meta">
                                        {p.file_name ? `${p.file_name} • ` : ''}{tf('md_created_on', {date: formatDate(p.uploaded_at)})}
                                    </div>
                                </div>
                                <div className="masterdata-row-actions">
                                    <button
                                        className={`btn ${openPlanId === p.id ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setOpenPlanId(openPlanId === p.id ? null : p.id)}
                                        title={t('md_tasks_title')}
                                    >
                                        <ListTree size={14}/> <span>{t('md_tasks')}</span>
                                    </button>
                                    <button className="btn btn-secondary" title={t('btn_edit')}
                                            onClick={() => { setEditingId(p.id); setForm({title: p.title, version: p.version || ''}); }}>
                                        <Pencil size={14}/>
                                    </button>
                                    <button className="btn btn-danger" onClick={() => handleDelete(p)}
                                            title={t('btn_delete')}><Trash2 size={14}/></button>
                                </div>
                            </div>
                            {openPlanId === p.id && <PlanTasksPanel planId={p.id} onError={onError}/>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default MasterData;
