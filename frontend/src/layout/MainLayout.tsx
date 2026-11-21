import React from 'react';
import {Outlet, useNavigate, useLocation} from 'react-router-dom';
import {
    HardHat,
    LayoutDashboard,
    Mic,
    FileText,
    Mail,
  FolderKanban,
  User,
  LogOut,
  CloudSun,
  BookOpen,
  TrendingUp
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import '@frontend/src/index.css';
import '@frontend/src/dashboard/Dashboard.css';

export const MainLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {projects, activeProject, activeProjectId, setActiveProjectId} = useProjects();
  const { t } = useLanguage();

    const userName = localStorage.getItem('userName') || 'Bauleiter';
    const userProfile = (() => {
        try {
            const data = localStorage.getItem('userProfile');
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    })();

    const currentRole = userProfile?.role || 'Bauleiter';
    const siteLocation = activeProject?.location
        ? activeProject.location.split(',').pop()?.trim()
        : 'Berlin';

    const handleLogout = () => {
        localStorage.removeItem('userName');
        navigate('/login');
    };

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="dashboard-layout">
            {/* Persistent Left Sidebar */}
            <aside className="dashboard-sidebar">
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <HardHat size={22}/>
                    </div>
                    <div>
                        <div className="sidebar-title">SiteAI Assistant</div>
                        <div className="sidebar-subtitle">Bauleitung & Dokumentation</div>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    <button
                        className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}
                        onClick={() => navigate('/dashboard')}
                    >
                        <LayoutDashboard size={18}/>
                        <span>{t('nav_dashboard')}</span>
                    </button>

                    <button
                        className={`nav-item ${isActive('/capture') ? 'active' : ''}`}
                        onClick={() => navigate('/capture')}
                    >
                        <Mic size={18}/>
                        <span>{t('nav_capture')}</span>
                    </button>

                    <button
                        className={`nav-item ${isActive('/reports') ? 'active' : ''}`}
                        onClick={() => navigate('/reports')}
                    >
                        <FileText size={18}/>
                        <span>{t('nav_reports')}</span>
                    </button>

                    <button
                        className={`nav-item ${isActive('/analysis') || isActive('/alerts') ? 'active' : ''}`}
                        onClick={() => navigate('/analysis')}
                    >
                        <TrendingUp size={18}/>
                        <span>{t('nav_analysis')}</span>
                        <span className="nav-badge">2</span>
                    </button>

                    <button
                        className={`nav-item ${isActive('/drafts') ? 'active' : ''}`}
                        onClick={() => navigate('/drafts')}
                    >
                        <Mail size={18}/>
                        <span>{t('nav_drafts')}</span>
          </button>

          <button
            className={`nav-item ${isActive('/summary') ? 'active' : ''}`}
            onClick={() => navigate('/summary')}
          >
            <BookOpen size={18} />
            <span>{t('nav_summary')}</span>
                    </button>

                    <button
                        className={`nav-item ${isActive('/projects') ? 'active' : ''}`}
                        onClick={() => navigate('/projects')}
                    >
                        <FolderKanban size={18}/>
                        <span>{t('nav_projects')}</span>
                    </button>

                    <button
                        className={`nav-item ${isActive('/profile') ? 'active' : ''}`}
                        onClick={() => navigate('/profile')}
                    >
                        <User size={18}/>
                        <span>{t('nav_profile')}</span>
                    </button>
                </nav>

                <div className="sidebar-footer">
                    <div
                        className="user-badge"
                        onClick={() => navigate('/profile')}
                        style={{cursor: 'pointer'}}
                        title="Mein Profil bearbeiten"
                    >
                        <div className="user-avatar">{userName.charAt(0).toUpperCase()}</div>
                        <div className="user-info">
                            <span className="user-name">{userName}</span>
                            <span className="user-role">{currentRole}</span>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <div className="dashboard-main">
                {/* Persistent Top Header */}
                <header className="dashboard-header">
                    {/* Dropdown for selecting current construction project */}
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                        <span className="status-dot"></span>
                        <label
                            htmlFor="globalProjectSelect"
                            style={{fontSize: '13px', fontWeight: 600, color: 'var(--color-slate-600)'}}
                        >
                            {t('hdr_active_project')}
                        </label>
                        <select
                            id="globalProjectSelect"
                            className="form-input"
                            value={activeProjectId}
                            onChange={(e) => setActiveProjectId(e.target.value)}
                            style={{
                                width: 'auto',
                                maxWidth: '380px',
                                padding: '6px 12px',
                                fontSize: '13px',
                                fontWeight: 600,
                                backgroundColor: 'var(--color-slate-100)',
                                borderColor: 'var(--border-light)',
                                cursor: 'pointer'
                            }}
                        >
                            {projects.map((proj) => (
                                <option key={proj.id} value={proj.id}>
                                    {proj.name} ({proj.number})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="header-actions">
                        <div className="header-info-tag">
                            <CloudSun size={16}/>
                            <span>{siteLocation}: 9°C • {t('hdr_weather_dry')}</span>
                        </div>

                        {/* Language Switcher Button in top right header */}
            <LanguageSwitcher />

            <button className="btn btn-danger" onClick={handleLogout} title={t('nav_logout')}>
                            <LogOut size={16}/>
                            <span>{t('nav_logout')}</span>
                        </button>
                    </div>
                </header>

                {/* Dynamic Route Outlet */}
                <main className="dashboard-content">
                    <Outlet/>
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
