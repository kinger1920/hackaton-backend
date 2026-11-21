import React, {useState} from 'react';
import {
    Plus,
    Building2,
    MapPin,
    CheckCircle2,
    Trash2,
    Hash,
    Activity,
    Briefcase
} from 'lucide-react';
import {useProjects, Project} from '@/context/ProjectContext';
import '@frontend/src/index.css';
import './Projects.css';

export const Projects: React.FC = () => {
    const {projects, activeProjectId, setActiveProjectId, addProject, deleteProject} = useProjects();

    const [showCreateForm, setShowCreateForm] = useState(false);
    const [formData, setFormData] = useState<Omit<Project, 'id'>>({
        name: '',
        number: '',
        client: '',
        location: '',
        phase: 'Rohbau',
        status: 'Aktiv',
        description: ''
    });

    const handleCreate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        addProject({
            ...formData,
            number: formData.number.trim() || `PRJ-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`
        });

        setFormData({
            name: '',
            number: '',
            client: '',
            location: '',
            phase: 'Rohbau',
            status: 'Aktiv',
            description: ''
        });
        setShowCreateForm(false);
    };

    return (
        <div className="projects-wrapper">
            {/* Header Bar */}
            <div className="projects-header-actions">
                <div className="projects-title-group">
                    <h1>Bauprojekte Übersicht</h1>
                    <p>Verwalten Sie Ihre Bauvorhaben und wählen Sie das aktive Projekt für das Dashboard aus.</p>
                </div>

                <button
                    className="btn btn-primary"
                    onClick={() => setShowCreateForm(!showCreateForm)}
                >
                    <Plus size={18}/>
                    <span>{showCreateForm ? 'Formular schließen' : 'Neues Bauprojekt anlegen'}</span>
                </button>
            </div>

            {/* Create Project Form Card */}
            {showCreateForm && (
                <form onSubmit={handleCreate} className="create-project-card">
                    <div className="create-project-header">
                        <h2 className="create-project-title">
                            <Building2 size={20} color="var(--color-primary)"/>
                            <span>Neues Bauprojekt erfassen</span>
                        </h2>
                    </div>

                    <div className="form-grid-2">
                        <div className="form-group">
                            <label className="form-label" htmlFor="projName">
                                Projektname *
                            </label>
                            <input
                                id="projName"
                                className="form-input"
                                type="text"
                                required
                                placeholder="z. B. Neubau Kindertagesstätte Sonnenblume"
                                value={formData.name}
                                onChange={(e) => setFormData({...formData, name: e.target.value})}
                                autoFocus
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="projNum">
                                Projekt- / Baustellennummer
                            </label>
                            <input
                                id="projNum"
                                className="form-input"
                                type="text"
                                placeholder="z. B. PRJ-2026-105 (optional, wird sonst generiert)"
                                value={formData.number}
                                onChange={(e) => setFormData({...formData, number: e.target.value})}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="projClient">
                                Bauherr / Auftraggeber *
                            </label>
                            <input
                                id="projClient"
                                className="form-input"
                                type="text"
                                required
                                placeholder="z. B. Stadtbauamt oder Wohnungsbaugesellschaft"
                                value={formData.client}
                                onChange={(e) => setFormData({...formData, client: e.target.value})}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="projLoc">
                                Baustellenstandort / Adresse *
                            </label>
                            <input
                                id="projLoc"
                                className="form-input"
                                type="text"
                                required
                                placeholder="Straße, Hausnummer, PLZ Ort"
                                value={formData.location}
                                onChange={(e) => setFormData({...formData, location: e.target.value})}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="projPhase">
                                Aktuelle Bauphase
                            </label>
                            <select
                                id="projPhase"
                                className="form-input"
                                value={formData.phase}
                                onChange={(e) => setFormData({...formData, phase: e.target.value})}
                            >
                                <option value="Tiefbau & Erdarbeiten">Tiefbau & Erdarbeiten</option>
                                <option value="Rohbau">Rohbau</option>
                                <option value="Dach & Fassade">Dach & Fassade</option>
                                <option value="TGA & Haustechnik">TGA & Haustechnik</option>
                                <option value="Innenausbau">Innenausbau</option>
                                <option value="Außenanlagen & Abnahme">Außenanlagen & Abnahme</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="projStatus">
                                Status
                            </label>
                            <select
                                id="projStatus"
                                className="form-input"
                                value={formData.status}
                                onChange={(e) =>
                                    setFormData({...formData, status: e.target.value as Project['status']})
                                }
                            >
                                <option value="Aktiv">Aktiv</option>
                                <option value="In Planung">In Planung</option>
                                <option value="Abgeschlossen">Abgeschlossen</option>
                            </select>
                        </div>

                        <div className="form-group" style={{gridColumn: 'span 2'}}>
                            <label className="form-label" htmlFor="projDesc">
                                Projektbeschreibung / Besonderheiten
                            </label>
                            <textarea
                                id="projDesc"
                                className="form-textarea"
                                rows={2}
                                placeholder="Wichtige Hinweise zum Bauvorhaben (z. B. Sonderauflagen, Lärmschutz, VOB Besonderheiten)"
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                            />
                        </div>
                    </div>

                    <div style={{display: 'flex', justifyContent: 'flex-end', gap: '12px'}}>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setShowCreateForm(false)}
                        >
                            Abbrechen
                        </button>
                        <button type="submit" className="btn btn-primary">
                            <Plus size={16}/>
                            <span>Bauprojekt speichern & aktivieren</span>
                        </button>
                    </div>
                </form>
            )}

            {/* Projects Grid */}
            <div className="projects-grid">
                {projects.map((proj) => {
                    const isActive = proj.id === activeProjectId;
                    return (
                        <div
                            key={proj.id}
                            className={`project-card ${isActive ? 'active-project' : ''}`}
                        >
                            <div>
                                <div className="project-top-row">
                                    <span className="badge badge-info">{proj.status}</span>
                                    {isActive && (
                                        <span className="project-badge-active">
                      <CheckCircle2 size={12}/>
                      <span>Aktives Projekt</span>
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
                                        <span>Phase: {proj.phase}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="project-card-footer">
                                {isActive ? (
                                    <span className="select-active-btn current">
                    ✓ Derzeit ausgewählt
                  </span>
                                ) : (
                                    <button
                                        className="select-active-btn"
                                        onClick={() => setActiveProjectId(proj.id)}
                                    >
                                        Als aktives Projekt festlegen
                                    </button>
                                )}

                                <button
                                    className="btn btn-danger"
                                    style={{padding: '6px 10px', fontSize: '12px'}}
                                    title="Projekt löschen"
                                    onClick={() => {
                                        if (window.confirm(`Möchten Sie das Projekt "${proj.name}" wirklich löschen?`)) {
                                            deleteProject(proj.id);
                                        }
                                    }}
                                >
                                    <Trash2 size={14}/>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Projects;
