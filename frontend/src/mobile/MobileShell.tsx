import React, {useEffect, useRef, useState} from 'react';
import {Outlet, useLocation, useNavigate} from 'react-router-dom';
import {Calendar, ClipboardList, FileText, HardHat, LogOut, Menu, Mic, Monitor, Moon, Sun, User, WifiOff, X} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {useTheme} from '../theme/theme';
import {setViewMode} from '../utils/useIsMobile';
import './Mobile.css';

/**
 * Handy-Hülle: schlanke Kopfzeile (Projekt + Status), Inhalt, feste Leiste unten.
 * Die Leiste hält die 4 wichtigsten Ziele auf der Baustelle; „Mehr“ öffnet alle übrigen Seiten.
 */

export interface MobileNavEntry {
    path: string;
    icon: React.ReactNode;
    label: string;
}

export interface MobileNavGroup {
    title: string;
    items: MobileNavEntry[];
}

interface Props {
    navGroups: MobileNavGroup[];
    status: { dot: string; text: string; title: string; offline: boolean };
    onLogout: () => void;
}

const TABS: { path: string; label: string; icon: React.ReactNode; match: (p: string) => boolean }[] = [
    {path: '/mobile', label: 'Aufnahme', icon: <Mic size={22}/>, match: (p) => p === '/mobile'},
    {path: '/maengel', label: 'Mängel', icon: <ClipboardList size={22}/>, match: (p) => p === '/maengel'},
    {path: '/reports', label: 'Bericht', icon: <FileText size={22}/>, match: (p) => p === '/reports'},
    {path: '/termin', label: 'Plan', icon: <Calendar size={22}/>, match: (p) => p === '/termin' || p === '/fortschritt'}
];

export const MobileShell: React.FC<Props> = ({navGroups, status, onLogout}) => {
    const navigate = useNavigate();
    const location = useLocation();
    const {projects, activeProjectId, setActiveProjectId} = useProjects();
    const {t} = useLanguage();
    const {theme, toggleTheme} = useTheme();
    const [moreOpen, setMoreOpen] = useState(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const userName = localStorage.getItem('userName') || 'Bauleiter';

    useEffect(() => {
        setMoreOpen(false);
        window.scrollTo({top: 0});
    }, [location.pathname]);

    useEffect(() => {
        if (!moreOpen) return;
        sheetRef.current?.focus();
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [moreOpen]);

    const inTabs = TABS.some((tab) => tab.match(location.pathname));

    return (
        <div className="m-shell">
            <header className="m-header">
                <button type="button" className="m-logo" onClick={() => navigate('/mobile')} aria-label="Zur Aufnahme">
                    <HardHat size={18}/>
                </button>
                <label className="m-project">
                    <span className="m-sr">Aktives Bauprojekt</span>
                    <select value={activeProjectId} onChange={(e) => setActiveProjectId(Number(e.target.value))}>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </label>
                <span className={`m-status ${status.dot}`} title={status.title} aria-label={status.text} role="status">
                    {status.offline ? <WifiOff size={14}/> : <span className="m-status-dot"/>}
                </span>
            </header>

            <main className="app-content m-content">
                <Outlet/>
            </main>

            <nav className="m-tabbar" aria-label="Hauptnavigation">
                {TABS.map((tab) => {
                    const active = tab.match(location.pathname);
                    return (
                        <button key={tab.path} type="button" className={`m-tab${active ? ' active' : ''}${tab.path === '/mobile' ? ' m-tab-record' : ''}`}
                                onClick={() => navigate(tab.path)} aria-current={active ? 'page' : undefined}>
                            <span className="m-tab-icon">{tab.icon}</span>
                            <span className="m-tab-label">{tab.label}</span>
                        </button>
                    );
                })}
                <button type="button" className={`m-tab${moreOpen || !inTabs ? ' active' : ''}`} onClick={() => setMoreOpen(true)}
                        aria-haspopup="dialog" aria-expanded={moreOpen}>
                    <span className="m-tab-icon"><Menu size={22}/></span>
                    <span className="m-tab-label">Mehr</span>
                </button>
            </nav>

            {moreOpen && (
                <div className="m-sheet-backdrop" onClick={() => setMoreOpen(false)}>
                    <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Alle Bereiche" tabIndex={-1} ref={sheetRef}
                         onClick={(e) => e.stopPropagation()}>
                        <div className="m-sheet-handle" aria-hidden="true"/>
                        <div className="m-sheet-head">
                            <strong>Alle Bereiche</strong>
                            <button type="button" className="m-icon-btn" onClick={() => setMoreOpen(false)} aria-label={t('btn_close', 'Schließen')}>
                                <X size={18}/>
                            </button>
                        </div>
                        {navGroups.map((g) => (
                            <div key={g.title} className="m-sheet-group">
                                <div className="m-sheet-group-title">{g.title}</div>
                                <div className="m-sheet-grid">
                                    {g.items.map((item) => (
                                        <button key={item.path} type="button"
                                                className={`m-sheet-item${location.pathname === item.path ? ' active' : ''}`}
                                                onClick={() => navigate(item.path)}>
                                            {item.icon}
                                            <span>{item.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="m-sheet-actions">
                            <button type="button" className="m-sheet-row" onClick={() => navigate('/profile')}>
                                <User size={18}/> <span>{userName} · {t('nav_profile', 'Profil')}</span>
                            </button>
                            <button type="button" className="m-sheet-row" onClick={toggleTheme}>
                                {theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}
                                <span>{theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}</span>
                            </button>
                            <button type="button" className="m-sheet-row" onClick={() => setViewMode('desktop')}>
                                <Monitor size={18}/> <span>Desktop-Ansicht</span>
                            </button>
                            <button type="button" className="m-sheet-row danger" onClick={onLogout}>
                                <LogOut size={18}/> <span>{t('nav_logout', 'Abmelden')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MobileShell;
