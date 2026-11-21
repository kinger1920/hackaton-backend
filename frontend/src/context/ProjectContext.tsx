import React, {createContext, useContext, useState, useEffect} from 'react';

export interface Project {
    id: string;
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
        id: 'proj-1',
        name: 'Neubau Schulzentrum Nord (Haus B & C)',
        number: 'PRJ-2026-084',
        client: 'Städtisches Hochbauamt Berlin-Mitte',
        location: 'Berliner Str. 42, 10115 Berlin',
        phase: 'Rohbau & TGA Vorbereitung',
        status: 'Aktiv',
        description: 'Neubau 4-zügige Realschule mit Zweifeldsporthalle und Außenanlagen.'
    },
    {
        id: 'proj-2',
        name: 'Wohnquartier Spreebogen Baulos 3',
        number: 'PRJ-2026-042',
        client: 'Spreebogen Wohnbau GmbH & Co. KG',
        location: 'Köpenicker Str. 120, 10179 Berlin',
        phase: 'Tiefbau & Gründung',
        status: 'Aktiv',
        description: 'Errichtung von 85 Wohneinheiten mit Tiefgarage in Ufernähe.'
    },
    {
        id: 'proj-3',
        name: 'Sanierung Bürokomplex Am Tiergarten',
        number: 'PRJ-2025-119',
        client: 'Tiergarten Real Estate AG',
        location: 'Tiergartenstr. 15, 10785 Berlin',
        phase: 'Innenausbau & Fassade',
        status: 'In Planung',
        description: 'Energetische Kernsanierung denkmalgeschützter Bürotrakt.'
    }
];

interface ProjectContextType {
    projects: Project[];
    activeProject: Project;
    activeProjectId: string;
    setActiveProjectId: (id: string) => void;
    addProject: (project: Omit<Project, 'id'>) => Project;
    deleteProject: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({children}) => {
    const [projects, setProjects] = useState<Project[]>(() => {
        const saved = localStorage.getItem('constructionProjects');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch {
                // fallback to default
            }
        }
        return DEFAULT_PROJECTS;
    });

    const [activeProjectId, setActiveProjectIdState] = useState<string>(() => {
        const savedActiveId = localStorage.getItem('activeProjectId');
        if (savedActiveId) return savedActiveId;
        return DEFAULT_PROJECTS[0].id;
    });

    // Persist projects whenever they change
    useEffect(() => {
        localStorage.setItem('constructionProjects', JSON.stringify(projects));
    }, [projects]);

    // Persist activeProjectId
    const setActiveProjectId = (id: string) => {
        setActiveProjectIdState(id);
        localStorage.setItem('activeProjectId', id);
    };

    const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0] || DEFAULT_PROJECTS[0];

    const addProject = (projectData: Omit<Project, 'id'>): Project => {
        const newProject: Project = {
            ...projectData,
            id: `proj-${Date.now()}`
        };
        const updated = [newProject, ...projects];
        setProjects(updated);
        setActiveProjectId(newProject.id);
        return newProject;
    };

    const deleteProject = (id: string) => {
        if (projects.length <= 1) {
            alert('Mindestens ein Bauprojekt muss im System verbleiben.');
            return;
        }
        const updated = projects.filter((p) => p.id !== id);
        setProjects(updated);
        if (activeProjectId === id) {
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
                deleteProject
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
