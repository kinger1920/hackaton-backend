import React, {createContext, useContext, useState, useEffect} from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Firma / Nachunternehmer auf der Baustelle (inkl. vertraglicher Sollstärke)
export interface Contractor {
    name: string;
    trade: string;
    required_workers: number | null;
    phone: string;
}

export interface Project {
    id: number;
    name: string;
    number: string;
    client: string;
    location: string;
    phase: string;
    status: 'Aktiv' | 'In Planung' | 'Abgeschlossen';
    description?: string;

    // Kennzahlen & Kosten
    construction_volume_eur?: number | null;   // Bauvolumen in €
    budget_eur?: number | null;                // Kosten / Budget in €
    gross_floor_area_m2?: number | null;       // Bruttogrundfläche (BGF) in m²
    gross_volume_m3?: number | null;           // Bruttorauminhalt (BRI) in m³
    construction_type?: string;                // Bauform

    // Bauzeit (ISO-Datum YYYY-MM-DD)
    start_date?: string;
    end_date?: string;

    // Vertrag & VOB
    contract_type?: string;
    vob_b_agreed?: boolean;
    vob_notes?: string;                        // unternehmensspezifische VOB-Regelungen

    // Firmen / Nachunternehmer
    contractors?: Contractor[];
}

const toNumberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const DEFAULT_PROJECTS: Project[] = [
    {
        id: 1,
        name: 'Neubau Schulzentrum Nord (Haus B & C)',
        number: 'PRJ-2026-084',
        client: 'Städtisches Hochbauamt Berlin-Mitte',
        location: 'Berliner Str. 42, 10115 Berlin',
        phase: 'Rohbau & TGA Vorbereitung',
        status: 'Aktiv',
        description: 'Neubau 4-zügige Realschule mit Zweifeldsporthalle und Außenanlagen.',
        construction_volume_eur: 18500000,
        budget_eur: 16200000,
        gross_floor_area_m2: 9800,
        gross_volume_m3: 41500,
        construction_type: 'Stahlbetonbau',
        start_date: '2026-03-02',
        end_date: '2027-09-30',
        contract_type: 'Einheitspreisvertrag',
        vob_b_agreed: true,
        vob_notes: 'Behinderungsanzeigen schriftlich innerhalb von 3 Werktagen an die Projektleitung (§ 6 Abs. 1 VOB/B).',
        contractors: [
            {name: 'Müller Rohbau GmbH', trade: 'Rohbau', required_workers: 12, phone: '030 123456-0'},
            {name: 'Elektro Schmidt KG', trade: 'Elektro', required_workers: 4, phone: '030 987654-0'},
            {name: 'Haustechnik Weber', trade: 'Heizung / Sanitär', required_workers: 5, phone: '030 555123-0'}
        ]
    }
];

interface ProjectContextType {
    projects: Project[];
    activeProject: Project;
    activeProjectId: number;
    setActiveProjectId: (id: number) => void;
    addProject: (project: Omit<Project, 'id'>) => Promise<Project>;
    deleteProject: (id: number) => Promise<void>;
    isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

function normalizeProject(raw: any): Project {
    return {
        id: Number(raw.id),
        name: raw.name ?? '',
        number: raw.number ?? '',
        client: raw.client ?? '',
        location: raw.location ?? '',
        phase: raw.phase ?? 'Rohbau',
        status: raw.status ?? 'Aktiv',
        description: raw.description ?? '',
        construction_volume_eur: toNumberOrNull(raw.construction_volume_eur),
        budget_eur: toNumberOrNull(raw.budget_eur),
        gross_floor_area_m2: toNumberOrNull(raw.gross_floor_area_m2),
        gross_volume_m3: toNumberOrNull(raw.gross_volume_m3),
        construction_type: raw.construction_type ?? '',
        start_date: raw.start_date ?? '',
        end_date: raw.end_date ?? '',
        contract_type: raw.contract_type ?? '',
        vob_b_agreed: raw.vob_b_agreed ?? true,
        vob_notes: raw.vob_notes ?? '',
        contractors: Array.isArray(raw.contractors)
            ? raw.contractors.map((c: any) => ({
                name: c?.name ?? '',
                trade: c?.trade ?? '',
                required_workers: toNumberOrNull(c?.required_workers),
                phone: c?.phone ?? ''
            }))
            : []
    };
}

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({children}) => {
    const [projects, setProjects] = useState<Project[]>(DEFAULT_PROJECTS);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [activeProjectId, setActiveProjectIdState] = useState<number>(() => {
        const savedActiveId = Number(localStorage.getItem('activeProjectId'));
        return Number.isFinite(savedActiveId) && savedActiveId > 0 ? savedActiveId : DEFAULT_PROJECTS[0].id;
    });

    // Load projects from backend on mount
    useEffect(() => {
        let cancelled = false;

        const fetchProjects = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/projects`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled && Array.isArray(data) && data.length > 0) {
                    const normalized = data.map(normalizeProject);
                    setProjects(normalized);
                    setActiveProjectIdState((prev) =>
                        normalized.some((p) => p.id === prev) ? prev : normalized[0].id
                    );
                }
            } catch (err) {
                console.warn('Projekte konnten nicht vom Backend geladen werden, nutze Fallback:', err);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        fetchProjects();
        return () => {
            cancelled = true;
        };
    }, []);

    // Persist activeProjectId
    const setActiveProjectId = (id: number) => {
        setActiveProjectIdState(id);
        localStorage.setItem('activeProjectId', String(id));
    };

    const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0] || DEFAULT_PROJECTS[0];

    const addProject = async (projectData: Omit<Project, 'id'>): Promise<Project> => {
        const res = await fetch(`${API_BASE_URL}/projects`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(projectData)
        });
        if (!res.ok) {
            throw new Error(`Projekt konnte nicht angelegt werden (HTTP ${res.status})`);
        }
        const created = normalizeProject(await res.json());
        setProjects((prev) => [created, ...prev]);
        setActiveProjectId(created.id);
        return created;
    };

    const deleteProject = async (id: number): Promise<void> => {
        if (projects.length <= 1) {
            alert('Mindestens ein Bauprojekt muss im System verbleiben.');
            return;
        }
        const res = await fetch(`${API_BASE_URL}/projects/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok && res.status !== 404) {
            throw new Error(`Projekt konnte nicht gelöscht werden (HTTP ${res.status})`);
        }
        const updated = projects.filter((p) => p.id !== id);
        setProjects(updated);
        if (activeProjectId === id && updated.length > 0) {
            setActiveProjectId(updated[0].id);
        }
    };

    return (
        <ProjectContext.Provider
            value={{
                projects,
                activeProject,
                activeProjectId,
                setActiveProjectId,
                addProject,
                deleteProject,
                isLoading
            }}
        >
            {children}
        </ProjectContext.Provider>
    );
};

export const useProjects = (): ProjectContextType => {
    const context = useContext(ProjectContext);
    if (!context) {
        throw new Error('useProjects must be used within a ProjectProvider');
    }
    return context;
};
