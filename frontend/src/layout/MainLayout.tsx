import React, {useEffect, useState} from 'react';
import {Outlet, useNavigate, useLocation} from 'react-router-dom';
import {
    HardHat,
    LayoutDashboard,
    Mic,
    FileText,
    Mail,
    FolderKanban,
    LogOut,
    CloudSun,
    BookOpen,
    TrendingUp,
    Calendar,
    Building2,
    MessageSquare,
    WifiOff,
    PanelLeftClose,
    PanelLeftOpen,
    Sun,
    Moon
} from 'lucide-react';
import {useOnlineStatus} from '../components/useOnlineStatus';
import {todayIso} from '../utils/dates';
import {api, HealthStatus} from '../services/api';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import {useTheme} from '../theme/theme';
import '@frontend/src/index.css';
// Dashboard.css still holds styles used by the dashboard page itself
import '@frontend/src/dashboard/Dashboard.css';
import './Layout.css';

type SidebarMode = 'pinned' | 'collapsed';
const SIDEBAR_KEY = 'sidebarMode';

interface NavEntry {
    path: string;
    icon: React.ReactNode;
    labelKey: string;
    fallback?: string;
}

interface NavGroup {
    titleKey: string;
    fallback: string;
    items: NavEntry[];
}

// Grouped navigation (order follows the site manager's day)
const NAV_GROUPS: NavGroup[] = [
    {
        titleKey: 'nav_group_daily',
        fallback: 'Tagesgeschäft',
        items: [
            {path: '/dashboard', icon: <LayoutDashboard size={19}/>, labelKey: 'nav_dashboard'},
            {path: '/capture', icon: <Mic size={19}/>, labelKey: 'nav_capture'},
            {path: '/reports', icon: <FileText size={19}/>, labelKey: 'nav_reports'},
            {path: '/termin', icon: <Calendar size={19}/>, labelKey: 'nav_termin'}
        ]
    },
    {
        titleKey: 'nav_group_letters',
        fallback: 'Schriftverkehr & Fristen',
        items: [
            {path: '/drafts', icon: <Mail size={19}/>, labelKey: 'nav_drafts'},
            {path: '/summary', icon: <BookOpen size={19}/>, labelKey: 'nav_summary'}
            // Fristen-Radar ist jetzt die Ansicht „Fristen“ im Terminplaner (/fristen leitet dorthin um).
        ]
    },
    {
        titleKey: 'nav_group_project',
        fallback: 'Projekt',
        items: [
            // Idee #7: Live-Baufortschritt auf Grundriss mit Zeitregler
            {path: '/fortschritt', icon: <TrendingUp size={19}/>, labelKey: 'nav_progress_map', fallback: 'Baufortschritt'},
            // Idee #5: „Frag dein Projekt“-Chat mit Quellen
            {path: '/assistent', icon: <MessageSquare size={19}/>, labelKey: 'nav_assistant', fallback: 'Projekt-Assistent'},
            {path: '/projects', icon: <FolderKanban size={19}/>, labelKey: 'nav_projects'},
            {path: '/stammdaten', icon: <Building2 size={19}/>, labelKey: 'nav_masterdata', fallback: 'Stammdaten'}
        ]
    }
    // Soll/Ist-Analyse ist ins Dashboard integriert (/analysis leitet dorthin um).
];

export const MainLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {projects, activeProject, activeProjectId, setActiveProjectId} = useProjects();
    const {t} = useLanguage();
    const {theme, toggleTheme} = useTheme();

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

    // Sidebar: pinned (icons + text) or collapsed (icons only). Remembered.
    const [sidebarMode, setSidebarMode] = useState<SidebarMode>(
        () => (localStorage.getItem(SIDEBAR_KEY) === 'collapsed' ? 'collapsed' : 'pinned')
    );
    const toggleSidebar = () => {
        const next: SidebarMode = sidebarMode === 'pinned' ? 'collapsed' : 'pinned';
        setSidebarMode(next);
        localStorage.setItem(SIDEBAR_KEY, next);
    };

    // Idee #6 (Offline/PWA): Netzstatus des Geräts – Details unter Profil → „Offline & App“
    const isOnline = useOnlineStatus();

    // Wetter des Tages aus dem Bautagesbericht (Projektwechsel oder Seitenwechsel → neu laden)
    const [todayWeather, setTodayWeather] = useState<{ temp: number | null; text: string | null } | null>(null);
    useEffect(() => {
        let cancelled = false;
        api.getReport(todayIso(), Number(activeProject.id))
            .then((r) => {
                if (cancelled) return;
                setTodayWeather(r.id != null && (r.weather || r.temperature_c != null)
                    ? {temp: r.temperature_c ?? null, text: r.weather}
                    : null);
            })
            .catch(() => !cancelled && setTodayWeather(null));
        return () => {
            cancelled = true;
        };
    }, [activeProject.id, location.pathname]);

    // Backend-Status (GET /health) – alle 30 s prüfen; zeigt auch, ob PDF-Export verfügbar ist
    const [health, setHealth] = useState<HealthStatus | null>(null);
    const [healthChecked, setHealthChecked] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const check = () =>
            api.health()
                .then((h) => !cancelled && setHealth(h))
                .catch(() => !cancelled && setHealth(null))
                .finally(() => !cancelled && setHealthChecked(true));
        check();
        const timer = window.setInterval(check, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    // One status chip: device offline > backend offline > backend without PDF > all good
    const status = !isOnline
        ? {dot: 'off', text: t('hdr_device_offline', 'Offline'), title: t('hdr_device_offline_hint', 'Gerät ist offline – Offline-Modus folgt (Profil → Offline & App)')}
        : !health
            ? {dot: 'off', text: t('hdr_backend_offline', 'Backend offline'), title: t('hdr_backend_offline_hint', 'Backend nicht erreichbar – Seiten zeigen Beispieldaten')}
            : {
                dot: health.pdf_export ? '' : 'warn',
                text: t('hdr_backend_online', 'Backend online'),
                title: health.pdf_export
                    ? t('hdr_backend_ok_hint', 'Backend verbunden • PDF-Export verfügbar')
                    : t('hdr_backend_nopdf_hint', 'Backend verbunden • PDF-Export nicht verfügbar (Pango fehlt) – Word geht immer')
            };

    return (
        <div className={`app-shell ${sidebarMode === 'collapsed' ? 'collapsed' : ''}`}>
            {/* Space holder so the page sits next to the (fixed) sidebar */}
            <div className="app-sidebar-slot" aria-hidden="true"/>

            <aside className="app-sidebar" aria-label={t('nav_aria', 'Hauptnavigation')}>
                <div className="app-sidebar-brand">
                    <div className="app-logo">
                        <HardHat size={20}/>
                    </div>
                    <div className="app-brand-text">
                        <div className="app-brand-title">Site<span>AI</span> Assistant</div>
                        <div className="app-brand-sub">Bauleitung & Dokumentation</div>
                    </div>
                </div>

                <nav className="app-nav">
                    {NAV_GROUPS.map((group) => (
                        <React.Fragment key={group.titleKey}>
                            <div className="app-nav-group">{t(group.titleKey, group.fallback)}</div>
                            {group.items.map((item) => {
                                const label = t(item.labelKey, item.fallback);
                                return (
                                    <button
                                        key={item.path}
                                        type="button"
                                        className={`app-nav-item ${isActive(item.path) ? 'active' : ''}`}
                                        onClick={() => navigate(item.path)}
                                        title={sidebarMode === 'collapsed' ? label : undefined}
                                        aria-current={isActive(item.path) ? 'page' : undefined}
                                    >
                                        {item.icon}
                                        <span className="app-nav-label">{label}</span>
                                    </button>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </nav>

                <div className="app-sidebar-footer">
                    <button
                        type="button"
                        className={`app-user ${isActive('/profile') ? 'active' : ''}`}
                        onClick={() => navigate('/profile')}
                        title={t('nav_profile')}
                    >
                        <div className="app-avatar">{userName.charAt(0).toUpperCase()}</div>
                        <div className="app-user-info">
                            <span className="app-user-name">{userName}</span>
                            <span className="app-user-role">{currentRole} · {t('nav_profile')}</span>
                        </div>
                    </button>
                </div>
            </aside>

            <div className="app-main">
                {/* Top bar: every element shares the same height and style */}
                <header className="app-header">
                    <div className="app-header-left">
                        <button
                            type="button"
                            className="hdr-icon-btn"
                            onClick={toggleSidebar}
                            title={sidebarMode === 'pinned'
                                ? t('hdr_sidebar_collapse', 'Seitenleiste einklappen')
                                : t('hdr_sidebar_pin', 'Seitenleiste fest anzeigen')}
                            aria-label={sidebarMode === 'pinned'
                                ? t('hdr_sidebar_collapse', 'Seitenleiste einklappen')
                                : t('hdr_sidebar_pin', 'Seitenleiste fest anzeigen')}
                        >
                            {sidebarMode === 'pinned' ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}
                        </button>

                        <label className="hdr-chip hdr-project" htmlFor="globalProjectSelect">
                            <span className="hdr-project-label">{t('hdr_active_project')}</span>
                            <select
                                id="globalProjectSelect"
                                value={activeProjectId}
                                onChange={(e) => setActiveProjectId(Number(e.target.value))}
                            >
                                {projects.map((proj) => (
                                    <option key={proj.id} value={proj.id}>
                                        {proj.name} ({proj.number})
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="app-header-right">
                        {(healthChecked || !isOnline) && (
                            <div
                                className="hdr-chip"
                                title={status.title}
                                onClick={!isOnline ? () => navigate('/profile') : undefined}
                                style={!isOnline ? {cursor: 'pointer'} : undefined}
                            >
                                {!isOnline ? <WifiOff size={14}/> : <span className={`hdr-dot ${status.dot}`}/>}
                                <span className="hdr-status-text">{status.text}</span>
                            </div>
                        )}

                        {/* Wetter aus dem heutigen Bautagesbericht (vorher fest "9°C • Trocken") */}
                        <button
                            type="button"
                            className="hdr-chip hdr-chip-muted hdr-weather"
                            style={{cursor: 'pointer'}}
                            onClick={() => navigate('/reports')}
                            title={t('hdr_weather_hint', 'Wetter aus dem heutigen Bautagesbericht')}
                        >
                            <CloudSun size={16}/>
                            <span>
                                {siteLocation}
                                {todayWeather
                                    ? `: ${todayWeather.temp != null ? `${todayWeather.temp}°C • ` : ''}${todayWeather.text || ''}`
                                    : ` • ${t('hdr_weather_missing', 'Wetter noch nicht erfasst')}`}
                            </span>
                        </button>

                        <LanguageSwitcher/>

                        <button
                            type="button"
                            className="hdr-icon-btn"
                            onClick={toggleTheme}
                            title={theme === 'dark' ? t('hdr_theme_light', 'Helles Design') : t('hdr_theme_dark', 'Dunkles Design')}
                            aria-label={theme === 'dark' ? t('hdr_theme_light', 'Helles Design') : t('hdr_theme_dark', 'Dunkles Design')}
                        >
                            {theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}
                        </button>

                        <button
                            type="button"
                            className="hdr-icon-btn danger"
                            onClick={handleLogout}
                            title={t('nav_logout')}
                            aria-label={t('nav_logout')}
                        >
                            <LogOut size={16}/>
                        </button>
                    </div>
                </header>

                {/* Dynamic Route Outlet */}
                <main className="app-content">
                    <Outlet/>
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
