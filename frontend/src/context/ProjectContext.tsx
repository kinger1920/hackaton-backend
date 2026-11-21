import React, {createContext, useContext, useState, useEffect} from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface Project {
    id: number;
    name: string;
    number: string;
    client: string;
    location: string;
    phase: string;
    status: 'Aktiv' | 'In Planung' | 'Abgeschlossen';
    description?: string;
}

const DEFAULT_PROJECTS: Project[] = [
    {
        id: 1,
        name: 'Neubau Schulzentrum Nord (Haus B & C)',
        number: 'PRJ-2026-084',
        client: 'Städtisches Hochbauamt Berlin-Mitte',
        location: 'Berliner Str. 42, 10115 Berlin',
        phase: 'Rohbau & TGA Vorbereitung',
        status: 'Aktiv',
        description: 'Neubau 4-zügige Realschule mit Zweifeldsporthalle und Außenanlagen.'
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
        description: raw.description ?? ''
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
