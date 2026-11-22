import React, {useEffect, useState} from 'react';
import {
    Activity,
    Briefcase,
    Building2,
    CalendarRange,
    CheckCircle2,
    ChevronRight,
    Euro,
    FileSignature,
    FolderKanban,
    HardHat,
    Hash,
    MapPin,
    Pencil,
    Phone,
    Plus,
    Ruler,
    ShieldCheck,
    ShieldOff,
    Trash2,
    Users,
    X
} from 'lucide-react';
import {Contractor, Project, useProjects} from '@/context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import '@frontend/src/index.css';
import './Projects.css';

const PHASES = [
    'Tiefbau & Erdarbeiten',
    'Rohbau',
    'Dach & Fassade',
    'TGA & Haustechnik',
    'Innenausbau',
    'Außenanlagen & Abnahme'
];

const CONSTRUCTION_TYPES = [
    'Massivbau',
    'Stahlbetonbau',
    'Stahlbau',
    'Holzbau',
    'Fertigteilbau',
    'Mischbauweise'
];

const CONTRACT_TYPES = [
    'Einheitspreisvertrag',
    'Pauschalvertrag',
    'Stundenlohnvertrag',
    'GU-Vertrag',
    'GMP-Vertrag'
];

// Form state keeps numbers as strings so inputs can be empty while typing
interface ContractorForm {
    name: string;
    trade: string;
    required_workers: string;
    phone: string;
}

interface ProjectForm {
    name: string;
    number: string;
    client: string;
    location: string;
    phase: string;
    status: Project['status'];
    description: string;
    construction_volume_eur: string;
    budget_eur: string;
    gross_floor_area_m2: string;
    gross_volume_m3: string;
    construction_type: string;
    start_date: string;
    end_date: string;
    contract_type: string;
    vob_b_agreed: boolean;
    vob_notes: string;
    contractors: ContractorForm[];
}

const EMPTY_CONTRACTOR: ContractorForm = {name: '', trade: '', required_workers: '', phone: ''};

const EMPTY_FORM: ProjectForm = {
    name: '',
    number: '',
    client: '',
    location: '',
    phase: 'Rohbau',
    status: 'Aktiv',
    description: '',
    construction_volume_eur: '',
    budget_eur: '',
    gross_floor_area_m2: '',
    gross_volume_m3: '',
    construction_type: '',
    start_date: '',
    end_date: '',
    contract_type: 'Einheitspreisvertrag',
    vob_b_agreed: true,
    vob_notes: '',
    contractors: []
};

const parseNumber = (value: string): number | null => {
    const cleaned = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
};

const formatEur = (value?: number | null) =>
    value == null
        ? null
        : new Intl.NumberFormat('de-DE', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0}).format(value);

const formatNumber = (value?: number | null) =>
    value == null ? null : new Intl.NumberFormat('de-DE', {maximumFractionDigits: 0}).format(value);

const formatDate = (iso?: string, locale = 'de-DE') => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale);
};

export const Projects: React.FC = () => {
    const {t, tf, tv, locale} = useLanguage();
    const {projects, activeProjectId, setActiveProjectId, addProject, updateProject, deleteProject} = useProjects();

    const [showCreateForm, setShowCreateForm] = useState(false);
    // null = neues Projekt anlegen, sonst ID des Projekts, das bearbeitet wird (PATCH)
    const [editingId, setEditingId] = useState<number | null>(null);
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
    const [formData, setFormData] = useState<ProjectForm>(EMPTY_FORM);

    const selectedProject = selectedProjectId !== null
        ? projects.find((p) => p.id === selectedProjectId) ?? null
        : null;

    useEffect(() => {
        if (selectedProjectId === null) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelectedProjectId(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedProjectId]);

    const set = <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) =>
        setFormData((prev) => ({...prev, [key]: value}));

    const updateContractor = (index: number, key: keyof ContractorForm, value: string) =>
        setFormData((prev) => ({
            ...prev,
            contractors: prev.contractors.map((c, i) => (i === index ? {...c, [key]: value} : c))
        }));

    const addContractor = () =>
        setFormData((prev) => ({...prev, contractors: [...prev.contractors, {...EMPTY_CONTRACTOR}]}));

    const removeContractor = (index: number) =>
        setFormData((prev) => ({...prev, contractors: prev.contractors.filter((_, i) => i !== index)}));

    const closeForm = () => {
        setFormData(EMPTY_FORM);
        setEditingId(null);
        setShowCreateForm(false);
    };

    const numToField = (n?: number | null) => (n == null ? '' : String(n));

    const startEdit = (proj: Project) => {
        setFormData({
            name: proj.name,
            number: proj.number ?? '',
            client: proj.client ?? '',
            location: proj.location ?? '',
            phase: proj.phase || 'Rohbau',
            status: proj.status,
            description: proj.description ?? '',
            construction_volume_eur: numToField(proj.construction_volume_eur),
            budget_eur: numToField(proj.budget_eur),
            gross_floor_area_m2: numToField(proj.gross_floor_area_m2),
            gross_volume_m3: numToField(proj.gross_volume_m3),
            construction_type: proj.construction_type ?? '',
            start_date: proj.start_date ?? '',
            end_date: proj.end_date ?? '',
            contract_type: proj.contract_type || 'Einheitspreisvertrag',
            vob_b_agreed: proj.vob_b_agreed ?? true,
            vob_notes: proj.vob_notes ?? '',
            contractors: (proj.contractors ?? []).map((c) => ({
                name: c.name,
                trade: c.trade,
                required_workers: numToField(c.required_workers),
                phone: c.phone
            }))
        });
        setEditingId(proj.id);
        setShowCreateForm(true);
        document.querySelector('.app-scroll')?.scrollTo({top: 0, behavior: 'smooth'});
        window.scrollTo({top: 0, behavior: 'smooth'});
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        const contractors: Contractor[] = formData.contractors
            .filter((c) => c.name.trim())
            .map((c) => ({
                name: c.name.trim(),
                trade: c.trade.trim(),
                required_workers: parseNumber(c.required_workers),
                phone: c.phone.trim()
            }));

        try {
            const payload: Omit<Project, 'id'> = {
                name: formData.name.trim(),
                number:
                    formData.number.trim() ||
                    `PRJ-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
                client: formData.client.trim(),
                location: formData.location.trim(),
                phase: formData.phase,
                status: formData.status,
                description: formData.description.trim(),
                construction_volume_eur: parseNumber(formData.construction_volume_eur),
                budget_eur: parseNumber(formData.budget_eur),
                gross_floor_area_m2: parseNumber(formData.gross_floor_area_m2),
                gross_volume_m3: parseNumber(formData.gross_volume_m3),
                construction_type: formData.construction_type,
                start_date: formData.start_date,
                end_date: formData.end_date,
                contract_type: formData.contract_type,
                vob_b_agreed: formData.vob_b_agreed,
                vob_notes: formData.vob_notes.trim(),
                contractors
            };
            if (editingId !== null) {
                await updateProject(editingId, payload);
            } else {
                await addProject(payload);
            }
            closeForm();
        } catch (err: any) {
            console.error(err);
            alert(err?.message?.includes('HTTP') || !err?.message
                ? t('proj_save_failed_backend')
                : err.message);
        }
    };

    return (
        <div className="projects-wrapper">
            {/* Header Bar */}
            <div className="projects-header-actions">
                <div className="tp-title-group">
                    <div className="tp-title-icon"><FolderKanban size={22}/></div>
                    <div className="projects-title-group">
                        <h1>{t('proj_title')}</h1>
                    </div>
                </div>

                <button
                    className="btn btn-primary"
                    onClick={() => {
                        if (showCreateForm) {
                            closeForm();
                        } else {
                            setSelectedProjectId(null);
                            setShowCreateForm(true);
                        }
                    }}
                >
                    {showCreateForm ? <X size={18}/> : <Plus size={18}/>}
                    <span>{showCreateForm ? t('btn_cancel') : t('proj_btn_create')}</span>
                </button>
            </div>

            {/* Create Project Form Card */}
            {showCreateForm && (
                <form onSubmit={handleCreate} className="create-project-card">
                    <div className="create-project-header">
                        <h2 className="create-project-title">
                            <Building2 size={20} color="var(--color-primary)"/>
                            <span>{editingId !== null ? t('proj_btn_edit_title') : t('proj_btn_create')}</span>
                        </h2>
                    </div>

                    {/* 1. Stammdaten */}
                    <section className="form-section">
                        <h3 className="form-section-title">
                            <Briefcase size={16}/>
                            <span>{t('proj_sec_master')}</span>
                        </h3>
                        <div className="form-grid-2">
                            <div className="form-group">
                                <label className="form-label" htmlFor="projName">{t('proj_form_name')} *</label>
                                <input
                                    id="projName"
                                    className="form-input"
                                    type="text"
                                    required
                                    placeholder={t('proj_form_name')}
                                    value={formData.name}
                                    onChange={(e) => set('name', e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projNum">{t('proj_form_nr')}</label>
                                <input
                                    id="projNum"
                                    className="form-input"
                                    type="text"
                                    placeholder="PRJ-..."
                                    value={formData.number}
                                    onChange={(e) => set('number', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projClient">{t('proj_form_client')} *</label>
                                <input
                                    id="projClient"
                                    className="form-input"
                                    type="text"
                                    required
                                    placeholder={t('proj_form_client')}
                                    value={formData.client}
                                    onChange={(e) => set('client', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projLoc">{t('proj_form_location')} *</label>
                                <input
                                    id="projLoc"
                                    className="form-input"
                                    type="text"
                                    required
                                    placeholder={t('proj_form_location')}
                                    value={formData.location}
                                    onChange={(e) => set('location', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projPhase">{t('proj_form_phase')}</label>
                                <select
                                    id="projPhase"
                                    className="form-input"
                                    value={formData.phase}
                                    onChange={(e) => set('phase', e.target.value)}
                                >
                                    {PHASES.map((p) => <option key={p} value={p}>{tv(p)}</option>)}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projStatus">{t('proj_form_status')}</label>
                                <select
                                    id="projStatus"
                                    className="form-input"
                                    value={formData.status}
                                    onChange={(e) => set('status', e.target.value as Project['status'])}
                                >
                                    <option value="Aktiv">{tv('Aktiv')}</option>
                                    <option value="In Planung">{tv('In Planung')}</option>
                                    <option value="Abgeschlossen">{tv('Abgeschlossen')}</option>
                                </select>
                            </div>

                            <div className="form-group form-span-2">
                                <label className="form-label" htmlFor="projDesc">{t('proj_form_desc')}</label>
                                <textarea
                                    id="projDesc"
                                    className="form-textarea"
                                    rows={2}
                                    placeholder={t('proj_form_desc_ph')}
                                    value={formData.description}
                                    onChange={(e) => set('description', e.target.value)}
                                />
                            </div>
                        </div>
                    </section>

                    {/* 2. Kennzahlen & Kosten */}
                    <section className="form-section">
                        <h3 className="form-section-title">
                            <Euro size={16}/>
                            <span>{t('proj_sec_figures')}</span>
                        </h3>
                        <div className="form-grid-2">
                            <div className="form-group">
                                <label className="form-label" htmlFor="projVolume">{t('proj_form_volume')}</label>
                                <input
                                    id="projVolume"
                                    className="form-input"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="z. B. 18.500.000"
                                    value={formData.construction_volume_eur}
                                    onChange={(e) => set('construction_volume_eur', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projBudget">{t('proj_form_budget')}</label>
                                <input
                                    id="projBudget"
                                    className="form-input"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="z. B. 16.200.000"
                                    value={formData.budget_eur}
                                    onChange={(e) => set('budget_eur', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projArea">{t('proj_form_area')}</label>
                                <input
                                    id="projArea"
                                    className="form-input"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="z. B. 9.800"
                                    value={formData.gross_floor_area_m2}
                                    onChange={(e) => set('gross_floor_area_m2', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projCubic">{t('proj_form_cubic')}</label>
                                <input
                                    id="projCubic"
                                    className="form-input"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="z. B. 41.500"
                                    value={formData.gross_volume_m3}
                                    onChange={(e) => set('gross_volume_m3', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projType">{t('proj_form_type')}</label>
                                <select
                                    id="projType"
                                    className="form-input"
                                    value={formData.construction_type}
                                    onChange={(e) => set('construction_type', e.target.value)}
                                >
                                    <option value="">{t('proj_form_type_none')}</option>
                                    {CONSTRUCTION_TYPES.map((c) => <option key={c} value={c}>{tv(c)}</option>)}
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* 3. Bauzeit */}
                    <section className="form-section">
                        <h3 className="form-section-title">
                            <CalendarRange size={16}/>
                            <span>{t('proj_sec_schedule')}</span>
                        </h3>
                        <div className="form-grid-2">
                            <div className="form-group">
                                <label className="form-label" htmlFor="projStart">{t('proj_form_start')}</label>
                                <input
                                    id="projStart"
                                    className="form-input"
                                    type="date"
                                    value={formData.start_date}
                                    onChange={(e) => set('start_date', e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" htmlFor="projEnd">{t('proj_form_end')}</label>
                                <input
                                    id="projEnd"
                                    className="form-input"
                                    type="date"
                                    min={formData.start_date || undefined}
                                    value={formData.end_date}
                                    onChange={(e) => set('end_date', e.target.value)}
                                />
                            </div>
                        </div>
                    </section>

                    {/* 4. Vertrag & VOB */}
                    <section className="form-section">
                        <h3 className="form-section-title">
                            <FileSignature size={16}/>
                            <span>{t('proj_sec_contract')}</span>
                        </h3>
                        <div className="form-grid-2">
                            <div className="form-group">
                                <label className="form-label" htmlFor="projContract">{t('proj_form_contract_type')}</label>
                                <select
                                    id="projContract"
                                    className="form-input"
                                    value={formData.contract_type}
                                    onChange={(e) => set('contract_type', e.target.value)}
                                >
                                    {CONTRACT_TYPES.map((c) => <option key={c} value={c}>{tv(c)}</option>)}
                                </select>
                            </div>

                            <div className="form-group form-group-center">
                                <label className="checkbox-row">
                                    <input
                                        type="checkbox"
                                        checked={formData.vob_b_agreed}
                                        onChange={(e) => set('vob_b_agreed', e.target.checked)}
                                    />
                                    <span>{t('proj_form_vob')}</span>
                                </label>
                            </div>

                            <div className="form-group form-span-2">
                                <label className="form-label" htmlFor="projVobNotes">{t('proj_form_vob_notes')}</label>
                                <textarea
                                    id="projVobNotes"
                                    className="form-textarea"
                                    rows={3}
                                    placeholder={t('proj_form_vob_notes_ph')}
                                    value={formData.vob_notes}
                                    onChange={(e) => set('vob_notes', e.target.value)}
                                />
                            </div>
                        </div>
                    </section>

                    {/* 5. Firmen / Nachunternehmer */}
                    <section className="form-section">
                        <div className="form-section-head">
                            <div>
                                <h3 className="form-section-title">
                                    <HardHat size={16}/>
                                    <span>{t('proj_sec_contractors')}</span>
                                </h3>
                                <p className="form-section-hint">{t('proj_sec_contractors_hint')}</p>
                            </div>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={addContractor}>
                                <Plus size={14}/>
                                <span>{t('proj_c_add')}</span>
                            </button>
                        </div>

                        {formData.contractors.length === 0 ? (
                            <div className="contractor-empty">{t('proj_c_empty')}</div>
                        ) : (
                            <div className="contractor-list">
                                <div className="contractor-row contractor-row-head">
                                    <span>{t('proj_c_name')}</span>
                                    <span>{t('proj_c_trade')}</span>
                                    <span>{t('proj_c_workers')}</span>
                                    <span>{t('proj_c_phone')}</span>
                                    <span/>
                                </div>
                                {formData.contractors.map((c, i) => (
                                    <div className="contractor-row" key={i}>
                                        <input
                                            className="form-input"
                                            type="text"
                                            aria-label={t('proj_c_name')}
                                            placeholder={t('proj_c_name_ph')}
                                            value={c.name}
                                            onChange={(e) => updateContractor(i, 'name', e.target.value)}
                                        />
                                        <input
                                            className="form-input"
                                            type="text"
                                            aria-label={t('proj_c_trade')}
                                            placeholder={t('proj_c_trade_ph')}
                                            value={c.trade}
                                            onChange={(e) => updateContractor(i, 'trade', e.target.value)}
                                        />
                                        <input
                                            className="form-input"
                                            type="number"
                                            min={0}
                                            aria-label={t('proj_c_workers')}
                                            placeholder="0"
                                            value={c.required_workers}
                                            onChange={(e) => updateContractor(i, 'required_workers', e.target.value)}
                                        />
                                        <input
                                            className="form-input"
                                            type="tel"
                                            aria-label={t('proj_c_phone')}
                                            placeholder="030 ..."
                                            value={c.phone}
                                            onChange={(e) => updateContractor(i, 'phone', e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="contractor-remove"
                                            title={t('proj_c_remove')}
                                            aria-label={t('proj_c_remove')}
                                            onClick={() => removeContractor(i)}
                                        >
                                            <X size={16}/>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <div className="form-actions">
                        <button type="button" className="btn btn-secondary" onClick={closeForm}>
                            {t('btn_cancel')}
                        </button>
                        <button type="submit" className="btn btn-primary">
                            <Plus size={16}/>
                            <span>{t('btn_save')}</span>
                        </button>
                    </div>
                </form>
            )}

            {/* Projects Grid */}
            {!showCreateForm && (
                <div className="projects-grid">
                    {projects.map((proj) => {
                        const isActive = proj.id === activeProjectId;

                        return (
                            <div
                                key={proj.id}
                                className={`project-card interactive-card ${isActive ? 'active-project' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedProjectId(proj.id)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setSelectedProjectId(proj.id);
                                    }
                                }}
                            >
                                <div>
                                    <div className="project-top-row">
                                        <div className="project-badges">
                                            <span className="badge badge-info">{tv(proj.status)}</span>
                                        </div>
                                        {isActive && (
                                            <span className="project-badge-active">
                                                <CheckCircle2 size={12}/>
                                                <span>{t('proj_btn_active')}</span>
                                            </span>
                                        )}
                                    </div>

                                    <h3 className="project-name">{proj.name}</h3>

                                    <div className="project-meta-list">
                                        <div className="project-meta-item">
                                            <Hash size={15} color="var(--color-slate-400)"/>
                                            <span>{proj.number}</span>
                                        </div>
                                        <div className="project-meta-item">
                                            <Briefcase size={15} color="var(--color-slate-400)"/>
                                            <span>{proj.client}</span>
                                        </div>
                                        <div className="project-meta-item">
                                            <MapPin size={15} color="var(--color-slate-400)"/>
                                            <span>{proj.location}</span>
                                        </div>
                                        <div className="project-meta-item">
                                            <Activity size={15} color="var(--color-slate-400)"/>
                                            <span>{t('proj_phase_label')} {tv(proj.phase)}</span>
                                        </div>
                                    </div>

                                    <div className="project-detail-hint">
                                        <span>{t('proj_details')}</span>
                                        <ChevronRight size={14}/>
                                    </div>
                                </div>

                                <div className="project-card-footer" onClick={(e) => e.stopPropagation()}>
                                    {isActive ? (
                                        <span className="select-active-btn current">✓ {t('proj_btn_active')}</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="select-active-btn"
                                            onClick={() => setActiveProjectId(proj.id)}
                                        >
                                            {t('proj_btn_set_active')}
                                        </button>
                                    )}

                                    <div className="project-card-actions">
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            style={{padding: '6px 10px', fontSize: '12px'}}
                                            title={t('proj_btn_edit')}
                                            aria-label={t('proj_btn_edit')}
                                            onClick={() => startEdit(proj)}
                                        >
                                            <Pencil size={14}/>
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-danger"
                                            style={{padding: '6px 10px', fontSize: '12px'}}
                                            title={t('proj_delete')}
                                            onClick={async () => {
                                                if (window.confirm(tf('proj_confirm_delete', {name: proj.name}))) {
                                                    try {
                                                        if (selectedProjectId === proj.id) setSelectedProjectId(null);
                                                        await deleteProject(proj.id);
                                                    } catch (err) {
                                                        console.error(err);
                                                        alert(t('proj_delete_failed_backend'));
                                                    }
                                                }
                                            }}
                                        >
                                            <Trash2 size={14}/>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Project Details Modal */}
            {!showCreateForm && selectedProject && (() => {
                const isActive = selectedProject.id === activeProjectId;
                const contractors = selectedProject.contractors ?? [];
                const requiredWorkers = contractors.reduce((sum, c) => sum + (c.required_workers ?? 0), 0);
                const volume = formatEur(selectedProject.construction_volume_eur);
                const budget = formatEur(selectedProject.budget_eur);
                const area = formatNumber(selectedProject.gross_floor_area_m2);
                const cubic = formatNumber(selectedProject.gross_volume_m3);
                const start = formatDate(selectedProject.start_date, locale);
                const end = formatDate(selectedProject.end_date, locale);

                return (
                    <div className="proj-modal-overlay" onClick={() => setSelectedProjectId(null)}>
                        <div
                            className="proj-modal-content"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="proj-detail-title"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="proj-modal-header">
                                <div style={{minWidth: 0}}>
                                    <div className="project-badges" style={{marginBottom: '8px'}}>
                                        <span className="badge badge-info">{tv(selectedProject.status)}</span>
                                        {selectedProject.construction_type && (
                                            <span
                                                className="badge project-badge-neutral">{tv(selectedProject.construction_type)}</span>
                                        )}
                                        {isActive && (
                                            <span className="project-badge-active">
                                                <CheckCircle2 size={12}/>
                                                <span>{t('proj_btn_active')}</span>
                                            </span>
                                        )}
                                    </div>
                                    <h2 id="proj-detail-title" className="proj-modal-title">{selectedProject.name}</h2>
                                    <div className="proj-modal-sub">
                                        {selectedProject.number} • {selectedProject.client} • {selectedProject.location}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className="proj-modal-close"
                                    onClick={() => setSelectedProjectId(null)}
                                    title={t('btn_close')}
                                    aria-label={t('btn_close')}
                                >
                                    <X size={20}/>
                                </button>
                            </div>

                            <div className="proj-modal-body">
                                {selectedProject.description && (
                                    <div className="proj-detail-section">
                                        <div className="proj-detail-section-title">{t('proj_form_desc')}</div>
                                        <p className="proj-detail-desc">{selectedProject.description}</p>
                                    </div>
                                )}

                                <div className="proj-detail-section">
                                    <div className="proj-detail-section-title">{t('proj_detail_master')}</div>
                                    <div className="project-meta-list" style={{margin: 0}}>
                                        <div className="project-meta-item">
                                            <Hash size={15} color="var(--color-slate-400)"/>
                                            <span>{selectedProject.number}</span>
                                        </div>
                                        <div className="project-meta-item">
                                            <Briefcase size={15} color="var(--color-slate-400)"/>
                                            <span>{selectedProject.client}</span>
                                        </div>
                                        <div className="project-meta-item">
                                            <MapPin size={15} color="var(--color-slate-400)"/>
                                            <span>{selectedProject.location}</span>
                                        </div>
                                        <div className="project-meta-item">
                                            <Activity size={15} color="var(--color-slate-400)"/>
                                            <span>{t('proj_phase_label')} {tv(selectedProject.phase)}</span>
                                        </div>
                                        {(start || end) && (
                                            <div className="project-meta-item">
                                                <CalendarRange size={15} color="var(--color-slate-400)"/>
                                                <span>{t('proj_card_period')}: {start ?? '?'} – {end ?? '?'}</span>
                                            </div>
                                        )}
                                        {selectedProject.contract_type && (
                                            <div className="project-meta-item">
                                                {selectedProject.vob_b_agreed === false
                                                    ? <ShieldOff size={15} color="var(--color-slate-400)"/>
                                                    : <ShieldCheck size={15} color="var(--color-success-dark)"/>}
                                                <span>
                                                    {tv(selectedProject.contract_type)}
                                                    {selectedProject.vob_b_agreed === false ? ` · ${t('proj_card_no_vob')}` : ' · VOB/B'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    {selectedProject.vob_notes && (
                                        <div className="proj-detail-vob-notes">
                                            <strong>{t('proj_form_vob_notes')}:</strong> {selectedProject.vob_notes}
                                        </div>
                                    )}
                                </div>

                                {(volume || budget || area || cubic) && (
                                    <div className="proj-detail-section">
                                        <div className="proj-detail-section-title">{t('proj_sec_figures')}</div>
                                        <div className="project-figures" style={{marginBottom: 0}}>
                                            {volume && (
                                                <div className="project-figure">
                                                    <span className="project-figure-label">{t('proj_form_volume')}</span>
                                                    <span className="project-figure-value">{volume}</span>
                                                </div>
                                            )}
                                            {budget && (
                                                <div className="project-figure">
                                                    <span className="project-figure-label">{t('proj_form_budget')}</span>
                                                    <span className="project-figure-value">{budget}</span>
                                                </div>
                                            )}
                                            {area && (
                                                <div className="project-figure">
                                                    <span className="project-figure-label"><Ruler size={11}/> BGF</span>
                                                    <span className="project-figure-value">{area} m²</span>
                                                </div>
                                            )}
                                            {cubic && (
                                                <div className="project-figure">
                                                    <span className="project-figure-label"><Ruler size={11}/> BRI</span>
                                                    <span className="project-figure-value">{cubic} m³</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {contractors.length > 0 && (
                                    <div className="project-contractors" style={{marginBottom: 0}}>
                                        <div className="project-contractors-head">
                                            <span><HardHat size={13}/> {contractors.length} {t('proj_card_contractors')}</span>
                                            <span><Users size={13}/> {requiredWorkers} {t('proj_card_workers')}</span>
                                        </div>
                                        <ul>
                                            {contractors.map((c, i) => (
                                                <li key={i}>
                                                    <span className="project-contractor-name">
                                                        {c.name}{c.trade && <em> · {c.trade}</em>}
                                                    </span>
                                                    <span className="project-contractor-meta">
                                                        {c.required_workers != null && <span>{c.required_workers} Soll</span>}
                                                        {c.phone && (
                                                            <a href={`tel:${c.phone.replace(/\s/g, '')}`} title={c.phone}>
                                                                <Phone size={12}/>
                                                            </a>
                                                        )}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            <div className="proj-modal-footer">
                                <div>
                                    {isActive ? (
                                        <span className="select-active-btn current">✓ {t('proj_btn_active')}</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="select-active-btn"
                                            onClick={() => setActiveProjectId(selectedProject.id)}
                                        >
                                            {t('proj_btn_set_active')}
                                        </button>
                                    )}
                                </div>

                                <div className="project-card-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setSelectedProjectId(null);
                                            startEdit(selectedProject);
                                        }}
                                    >
                                        <Pencil size={14}/>
                                        <span>{t('proj_btn_edit')}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={() => setSelectedProjectId(null)}
                                    >
                                        <span>{t('btn_close')}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
};

export default Projects;
