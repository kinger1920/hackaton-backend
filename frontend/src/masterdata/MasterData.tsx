import React, {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    Building2,
    FileText,
    CalendarRange,
    Plus,
    Pencil,
    Trash2,
    Download,
    Eye,
    X,
    UploadCloud,
    RefreshCw,
    FileSearch,
    ListTree,
    CheckCircle2,
    PauseCircle,
    BookOpen
} from 'lucide-react';
import PlanTasksPanel from './PlanTasksPanel';
import {formatDe} from '../utils/dates';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {
    api,
    saveBlob,
    Company,
    CompanyCreate,
    CompanyType,
    Contract,
    ContractParseResponse,
    ContractText,
    ConstructionPlan
} from '../services/api';

const PARSED_FIELD_LABELS: Record<string, string> = {
    planned_workforce: 'Sollstärke (Arbeiter)',
    contractor_name: 'Vertragspartner',
    trade: 'Gewerk',
    vob_special: 'VOB-Besonderheiten',
    execution_start: 'Ausführungsbeginn',
    execution_end: 'Ausführungsende / Fertigstellung'
};
import '@frontend/src/index.css';
import './MasterData.css';

/**
 * Stammdaten: Firmen (/companies), Verträge als PDF (/contracts) und Bauzeitenpläne (/plans).
 * Alles direkt gegen das Backend – keine lokalen Daten.
 */

type Tab = 'companies' | 'contracts' | 'plans';

const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
    own: 'Eigenes Unternehmen',
    client: 'Auftraggeber',
    subcontractor: 'Nachunternehmer'
};

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
                    <Building2 size={15}/> <span>Firmen</span>
                </button>
                <button className={`masterdata-tab ${tab === 'contracts' ? 'active' : ''}`} onClick={() => setTab('contracts')}>
                    <FileText size={15}/> <span>Verträge</span>
                </button>
                <button className={`masterdata-tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>
                    <CalendarRange size={15}/> <span>Bauzeitenpläne</span>
                </button>
            </div>

            {error && (
                <div className="masterdata-error">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} title="Schließen"><X size={14}/></button>
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
            onError(err?.message || 'Firmen konnten nicht geladen werden');
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
            onError(err?.message || 'Firma konnte nicht gespeichert werden');
        }
    };

    const handleDelete = async (c: Company) => {
        if (!window.confirm(`Firma "${c.name}" wirklich löschen?`)) return;
        try {
            await api.deleteCompany(c.id);
            load();
        } catch (err: any) {
            onError(err?.message || 'Firma konnte nicht gelöscht werden');
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
                    <option value="">Alle Firmenarten</option>
                    {Object.entries(COMPANY_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                    ))}
                </select>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title="Neu laden">
                        <RefreshCw size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={startCreate}>
                        <Plus size={16}/> <span>Firma anlegen</span>
                    </button>
                </div>
            </div>

            {form && (
                <form onSubmit={handleSubmit} className="masterdata-form">
                    <h3>{editingId !== null ? 'Firma bearbeiten' : 'Neue Firma'}</h3>
                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label">Name *</label>
                            <input
                                className="form-input"
                                required
                                autoFocus
                                value={form.name}
                                onChange={(e) => setForm({...form, name: e.target.value})}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Firmenart</label>
                            <select
                                className="form-input"
                                value={form.company_type}
                                onChange={(e) => setForm({...form, company_type: e.target.value as CompanyType})}
                            >
                                {Object.entries(COMPANY_TYPE_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                ))}
                            </select>
                        </div>
                        {field('trade', 'Gewerk')}
                        {field('contact_person', 'Ansprechpartner')}
                        {field('phone', 'Telefon', 'tel')}
                        {field('email', 'E-Mail', 'email')}
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">Adresse (für Briefköpfe)</label>
                            <input className="form-input" value={form.address ?? ''} onChange={(e) => setForm({...form, address: e.target.value})}/>
                        </div>
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">VOB-Regelungen / BVB</label>
                            <textarea className="form-textarea" rows={2} value={form.vob_rules ?? ''} onChange={(e) => setForm({...form, vob_rules: e.target.value})}/>
                        </div>
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">Notizen</label>
                            <textarea className="form-textarea" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({...form, notes: e.target.value})}/>
                        </div>
                    </div>
                    <div className="masterdata-form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Abbrechen</button>
                        <button type="submit" className="btn btn-primary">Speichern</button>
                    </div>
                </form>
            )}

            {companies.length === 0 && !loading ? (
                <div className="masterdata-empty">Noch keine Firmen angelegt.</div>
            ) : (
                <div className="masterdata-list">
                    {companies.map((c) => (
                        <div key={c.id} className="masterdata-row">
                            <div className="masterdata-row-main">
                                <div className="masterdata-row-title">
                                    {c.name} <span className="badge badge-info">{COMPANY_TYPE_LABELS[c.company_type] ?? c.company_type}</span>
                                </div>
                                <div className="masterdata-row-meta">
                                    {[c.trade, c.contact_person, c.phone, c.email].filter(Boolean).join(' • ') || '–'}
                                </div>
                                {c.address && <div className="masterdata-row-meta">{c.address}</div>}
                                {c.vob_rules && <div className="masterdata-row-meta">VOB: {c.vob_rules}</div>}
                            </div>
                            <div className="masterdata-row-actions">
                                <button className="btn btn-secondary" onClick={() => startEdit(c)} title="Bearbeiten"><Pencil size={14}/></button>
                                <button className="btn btn-danger" onClick={() => handleDelete(c)} title="Löschen"><Trash2 size={14}/></button>
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

    const handleParse = async (c: Contract) => {
        setParsingId(c.id);
        try {
            setParseView({contract: c, result: await api.parseContract(c.id)});
        } catch (err: any) {
            onError(err?.message || 'Vertrag konnte nicht ausgelesen werden');
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
            onError(err?.message || 'Übernahme fehlgeschlagen');
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            setContracts(await api.listContracts(projectId));
        } catch (err: any) {
            onError(err?.message || 'Verträge konnten nicht geladen werden');
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
                    onError('Bitte eine Vertrags-PDF auswählen.');
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
            onError(err?.message || 'Vertrag konnte nicht gespeichert werden');
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
            onError(err?.message || 'Vertragsstatus konnte nicht geändert werden');
        }
    };

    const handleDelete = async (c: Contract) => {
        if (!window.confirm(`Vertrag "${c.title}" inkl. PDF wirklich löschen?`)) return;
        try {
            await api.deleteContract(c.id);
            load();
        } catch (err: any) {
            onError(err?.message || 'Vertrag konnte nicht gelöscht werden');
        }
    };

    const handleDownload = async (c: Contract) => {
        try {
            saveBlob(await api.downloadContractFile(c.id), c.file_name || `Vertrag_${c.id}.pdf`);
        } catch (err: any) {
            onError(err?.message || 'Download fehlgeschlagen');
        }
    };

    const handleShowText = async (c: Contract) => {
        try {
            setTextView(await api.getContractText(c.id));
        } catch (err: any) {
            onError(err?.message || 'Text konnte nicht geladen werden');
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
                            <span>{isActive ? 'Aktiv' : 'Inaktiv'}</span>
                        </span>
                    </div>
                    <div className="masterdata-row-meta">
                        {[c.contractor_name, c.trade, c.planned_workforce != null ? `Soll ${c.planned_workforce} Arbeiter` : null]
                            .filter(Boolean).join(' • ') || '–'}
                    </div>
                    <div className="masterdata-row-meta">
                        {c.file_name || 'ohne Datei'} • {c.file_name ? 'hochgeladen' : 'angelegt'} {formatDate(c.uploaded_at)}
                        {c.extracted_text ? ` • ${c.extracted_text.length.toLocaleString('de-DE')} Zeichen ausgelesen` : ' • kein Text erkannt'}
                    </div>
                    {c.vob_notes && <div className="masterdata-row-meta">VOB: {c.vob_notes}</div>}
                </div>
                <div className="masterdata-row-actions">
                    <button
                        className="btn btn-primary contract-summary-btn"
                        onClick={() => navigate('/summary', {state: {contractId: c.id, contractTitle: c.title}})}
                        title="Vertrag im Zusammenfassungs-Tab zusammenfassen"
                    >
                        <BookOpen size={14}/> <span>Vertrag zusammenfassen</span>
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleToggleActive(c)}
                        title={isActive ? 'Vertrag als inaktiv markieren' : 'Vertrag wieder aktivieren'}
                    >
                        {isActive ? <PauseCircle size={14}/> : <CheckCircle2 size={14}/>}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleParse(c)}
                        disabled={parsingId === c.id || !c.extracted_text}
                        title={c.extracted_text
                            ? 'Sollstärke, Firma, Gewerk und Fristen auslesen'
                            : c.file_name
                                ? 'Kein Text im PDF (Scan?)'
                                : 'Keine Datei hinterlegt – zum Auslesen den Vertrag als PDF hochladen'}
                    >
                        {parsingId === c.id ? <RefreshCw size={14}/> : <FileSearch size={14}/>}
                    </button>
                    <button className="btn btn-secondary" onClick={() => handleShowText(c)} title="Ausgelesenen Text anzeigen"><Eye size={14}/></button>
                    <button className="btn btn-secondary" onClick={() => handleDownload(c)} disabled={!c.file_name}
                            title={c.file_name ? 'PDF herunterladen' : 'Keine Datei hinterlegt (z. B. Demo- oder Projektformular-Vertrag)'}><Download size={14}/></button>
                    <button className="btn btn-secondary" onClick={() => startEdit(c)} title="Bearbeiten"><Pencil size={14}/></button>
                    <button className="btn btn-danger" onClick={() => handleDelete(c)} title="Löschen"><Trash2 size={14}/></button>
                </div>
            </div>
        );
    };

    return (
        <div className="card masterdata-card">
            <div className="masterdata-toolbar">
                <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    <div className="masterdata-filter-pills" role="tablist" aria-label="Vertragsstatus filtern">
                        <button
                            type="button"
                            className={`masterdata-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('all')}
                        >
                            Alle ({contracts.length})
                        </button>
                        <button
                            type="button"
                            className={`masterdata-filter-pill ${statusFilter === 'active' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('active')}
                        >
                            Aktive Verträge ({activeContracts.length})
                        </button>
                        <button
                            type="button"
                            className={`masterdata-filter-pill ${statusFilter === 'inactive' ? 'active' : ''}`}
                            onClick={() => setStatusFilter('inactive')}
                        >
                            Inaktive Verträge ({inactiveContracts.length})
                        </button>
                    </div>
                    <span className="masterdata-hint">
                        Aktive Verträge werden ausgelesen und bei Sollstärke-Prüfungen sowie VOB-Hinweisen berücksichtigt.
                    </span>
                </div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title="Neu laden">
                        <RefreshCw size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm({...EMPTY_CONTRACT}); }}>
                        <UploadCloud size={16}/> <span>Vertrag hochladen</span>
                    </button>
                </div>
            </div>

            {form && (
                <form onSubmit={handleSubmit} className="masterdata-form">
                    <h3>{editingId !== null ? 'Vertrag bearbeiten' : 'Vertrag hochladen (PDF)'}</h3>
                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label">Titel *</label>
                            <input className="form-input" required autoFocus placeholder="z. B. Nachunternehmervertrag Rohbau"
                                   value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Vertragspartner</label>
                            <input className="form-input" value={form.contractor_name} onChange={(e) => setForm({...form, contractor_name: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Gewerk</label>
                            <input className="form-input" value={form.trade} onChange={(e) => setForm({...form, trade: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Vertragliche Sollstärke (Arbeiter)</label>
                            <input className="form-input" type="number" min={0} value={form.planned_workforce}
                                   onChange={(e) => setForm({...form, planned_workforce: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Status</label>
                            <select
                                className="form-input"
                                value={form.is_active ? 'active' : 'inactive'}
                                onChange={(e) => setForm({...form, is_active: e.target.value === 'active'})}
                            >
                                <option value="active">Aktiver Vertrag</option>
                                <option value="inactive">Inaktiver Vertrag</option>
                            </select>
                        </div>
                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label">VOB-Besonderheiten</label>
                            <textarea className="form-textarea" rows={2} value={form.vob_notes} onChange={(e) => setForm({...form, vob_notes: e.target.value})}/>
                        </div>
                        {editingId === null && (
                            <div className="form-group" style={{gridColumn: 'span 2'}}>
                                <label className="form-label">Vertrags-PDF *</label>
                                <input className="form-input" type="file" accept="application/pdf,.pdf" required
                                       onChange={(e) => setForm({...form, file: e.target.files?.[0] ?? null})}/>
                            </div>
                        )}
                    </div>
                    <div className="masterdata-form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Abbrechen</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Lade hoch…' : 'Speichern'}</button>
                    </div>
                </form>
            )}

            {contracts.length === 0 && !loading ? (
                <div className="masterdata-empty">Für dieses Projekt sind noch keine Verträge hinterlegt.</div>
            ) : (
                <div className="masterdata-contract-sections">
                    {(statusFilter === 'all' || statusFilter === 'active') && (
                        <div className="masterdata-section">
                            <div className="masterdata-section-header">
                                <span>Aktive Verträge</span>
                                <span className="count">{activeContracts.length}</span>
                            </div>
                            {activeContracts.length === 0 ? (
                                <div className="masterdata-empty">Keine aktiven Verträge vorhanden.</div>
                            ) : (
                                <div className="masterdata-list">{activeContracts.map(renderContractRow)}</div>
                            )}
                        </div>
                    )}

                    {(statusFilter === 'all' || statusFilter === 'inactive') && (
                        <div className="masterdata-section">
                            <div className="masterdata-section-header">
                                <span>Inaktive Verträge</span>
                                <span className="count">{inactiveContracts.length}</span>
                            </div>
                            {inactiveContracts.length === 0 ? (
                                <div className="masterdata-empty">Keine inaktiven Verträge vorhanden.</div>
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
                                <strong>Vertrag ausgelesen: {parseView.contract.title}</strong>
                                <div style={{fontSize: '12px', color: 'var(--text-muted)'}}>
                                    Ausgelesener Vorschlag – wird erst nach Klick gespeichert
                                </div>
                            </div>
                            <button onClick={() => setParseView(null)} style={{background: 'none', border: 'none', cursor: 'pointer'}}><X size={16}/></button>
                        </div>
                        <div className="masterdata-list" style={{marginTop: '12px'}}>
                            {Object.keys(parseView.result.fields).length === 0 && (
                                <div className="masterdata-empty">Keine Angaben im Vertragstext gefunden.</div>
                            )}
                            {Object.entries(parseView.result.fields).map(([key, f]) => (
                                <div key={key} className="masterdata-row">
                                    <div className="masterdata-row-main">
                                        <div className="masterdata-row-title">
                                            {PARSED_FIELD_LABELS[key] ?? key}: {String(f.value)}
                                            {key === 'planned_workforce' && parseView.result.current_planned_workforce != null &&
                                                parseView.result.current_planned_workforce !== f.value && (
                                                    <span className="badge badge-info">bisher {parseView.result.current_planned_workforce}</span>
                                                )}
                                        </div>
                                        <div className="masterdata-row-meta">Fundstelle: „{f.src}“</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="masterdata-form-actions" style={{marginTop: '12px'}}>
                            <button className="btn btn-secondary" onClick={() => setParseView(null)}>Verwerfen</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleApplyParse}
                                disabled={Object.keys(parseView.result.suggested_patch).length === 0}
                            >
                                In Vertrag übernehmen
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
                        <pre className="masterdata-pre">{textView.extracted_text || 'Kein Text extrahiert (evtl. eingescanntes PDF).'}</pre>
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
            onError(err?.message || 'Pläne konnten nicht geladen werden');
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
            onError(err?.message || 'Plan konnte nicht gespeichert werden');
        }
    };

    const handleDelete = async (p: ConstructionPlan) => {
        if (!window.confirm(`Plan "${p.title}" inkl. aller Vorgänge wirklich löschen? Die Soll/Ist-Analyse nutzt diese Vorgänge.`)) return;
        try {
            await api.deletePlan(p.id);
            load();
        } catch (err: any) {
            onError(err?.message || 'Plan konnte nicht gelöscht werden');
        }
    };

    return (
        <div className="card masterdata-card">
            <div className="masterdata-toolbar">
                <span className="masterdata-hint">Die Vorgänge eines Plans sind die Grundlage der Soll/Ist-Analyse und des Dashboards.</span>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title="Neu laden">
                        <RefreshCw size={14}/>
                    </button>
                    <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm({title: '', version: '1.0'}); }}>
                        <Plus size={16}/> <span>Plan anlegen</span>
                    </button>
                </div>
            </div>

            {form && (
                <form onSubmit={handleSubmit} className="masterdata-form">
                    <h3>{editingId !== null ? 'Plan bearbeiten' : 'Neuer Bauzeitenplan'}</h3>
                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label">Titel *</label>
                            <input className="form-input" required autoFocus placeholder="z. B. Bauzeitenplan Rohbau"
                                   value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}/>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Version</label>
                            <input className="form-input" value={form.version} onChange={(e) => setForm({...form, version: e.target.value})}/>
                        </div>
                    </div>
                    <div className="masterdata-form-actions">
                        <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Abbrechen</button>
                        <button type="submit" className="btn btn-primary">Speichern</button>
                    </div>
                </form>
            )}

            {plans.length === 0 && !loading ? (
                <div className="masterdata-empty">Für dieses Projekt ist noch kein Bauzeitenplan hinterlegt.</div>
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
                                        {p.file_name ? `${p.file_name} • ` : ''}angelegt {formatDate(p.uploaded_at)}
                                    </div>
                                </div>
                                <div className="masterdata-row-actions">
                                    <button
                                        className={`btn ${openPlanId === p.id ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setOpenPlanId(openPlanId === p.id ? null : p.id)}
                                        title="Vorgänge anzeigen, bearbeiten, importieren"
                                    >
                                        <ListTree size={14}/> <span>Vorgänge</span>
                                    </button>
                                    <button className="btn btn-secondary" title="Bearbeiten"
                                            onClick={() => { setEditingId(p.id); setForm({title: p.title, version: p.version || ''}); }}>
                                        <Pencil size={14}/>
                                    </button>
                                    <button className="btn btn-danger" onClick={() => handleDelete(p)} title="Löschen"><Trash2 size={14}/></button>
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
