import React, {useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {FileText, LayoutDashboard, Mail, Mic, PenLine} from 'lucide-react';
import {LanguageCode, useLanguage} from '../context/LanguageContext';
import './MobileBottomNav.css';

interface MobileTabItem {
    path: string;
    icon: React.ReactNode;
    label: string;
    fullLabel: string;
}

const SHORT_LABELS: Record<LanguageCode, {dashboard: string; text: string; voice: string; drafts: string; reports: string}> = {
    de: {dashboard: 'Dashboard', text: 'Schreiben', voice: 'Sprache', drafts: 'Entwürfe', reports: 'Bericht'},
    en: {dashboard: 'Dashboard', text: 'Write', voice: 'Voice', drafts: 'Drafts', reports: 'Report'},
    pl: {dashboard: 'Pulpit', text: 'Notatka', voice: 'Głos', drafts: 'Pisma', reports: 'Raport'}
};

const SVG_W = 148;
const SVG_H = 80;
const BASE_Y = 16;

function buildNotchPaths(morph: number): {fillPath: string; strokePath: string} {
    const crestX = 20 - morph * 3;
    const crestY = BASE_Y - morph * 9;
    const dipY = 49 + morph * 9;
    const c2x = 42 - morph * 2;
    const c3x = SVG_W - c2x;
    const rightCrestX = SVG_W - crestX;

    const topCurve = (offsetY: number) => [
        `M 0 ${BASE_Y + offsetY}`,
        `C ${crestX * 0.5} ${BASE_Y + offsetY}, ${crestX * 0.5} ${crestY + offsetY}, ${crestX} ${crestY + offsetY}`,
        `C ${crestX + 18} ${crestY + offsetY}, ${c2x} ${dipY + offsetY}, 74 ${dipY + offsetY}`,
        `C ${c3x} ${dipY + offsetY}, ${rightCrestX - 18} ${crestY + offsetY}, ${rightCrestX} ${crestY + offsetY}`,
        `C ${SVG_W - crestX * 0.5} ${crestY + offsetY}, ${SVG_W - crestX * 0.5} ${BASE_Y + offsetY}, ${SVG_W} ${BASE_Y + offsetY}`
    ].join(' ');

    return {
        fillPath: `${topCurve(0)} L ${SVG_W} ${SVG_H} L 0 ${SVG_H} Z`,
        strokePath: topCurve(0.5)
    };
}

export const MobileBottomNav: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {language, t} = useLanguage();

    const isVoiceActive = location.pathname === '/capture/voice';
    const [tapBoost, setTapBoost] = useState(false);
    const [morph, setMorph] = useState<number>(() => (isVoiceActive ? 1 : 0));
    const morphRef = useRef<number>(morph);
    const boostTimerRef = useRef<number | null>(null);

    const targetMorph = isVoiceActive ? (tapBoost ? 1.22 : 1) : (tapBoost ? 0.85 : 0);

    useEffect(() => {
        let frameId = 0;
        const animate = () => {
            const current = morphRef.current;
            const diff = targetMorph - current;
            if (Math.abs(diff) < 0.005) {
                morphRef.current = targetMorph;
                setMorph(targetMorph);
                return;
            }
            const next = current + diff * 0.22;
            morphRef.current = next;
            setMorph(next);
            frameId = window.requestAnimationFrame(animate);
        };
        frameId = window.requestAnimationFrame(animate);
        return () => window.cancelAnimationFrame(frameId);
    }, [targetMorph]);

    useEffect(() => {
        return () => {
            if (boostTimerRef.current !== null) {
                window.clearTimeout(boostTimerRef.current);
            }
        };
    }, []);

    const labels = SHORT_LABELS[language] ?? SHORT_LABELS.de;

    const leftTabs: MobileTabItem[] = [
        {
            path: '/dashboard',
            icon: <LayoutDashboard size={20}/>,
            label: labels.dashboard,
            fullLabel: t('nav_dashboard', 'Dashboard')
        },
        {
            path: '/capture/text',
            icon: <PenLine size={20}/>,
            label: labels.text,
            fullLabel: t('nav_capture_text', 'Schreiberfassung')
        }
    ];

    const rightTabs: MobileTabItem[] = [
        {
            path: '/drafts',
            icon: <Mail size={20}/>,
            label: labels.drafts,
            fullLabel: t('nav_drafts', 'Brief- & Mängelentwürfe')
        },
        {
            path: '/reports',
            icon: <FileText size={20}/>,
            label: labels.reports,
            fullLabel: t('nav_reports', 'Bautagesberichte')
        }
    ];

    const handleCenterClick = () => {
        setTapBoost(true);
        if (boostTimerRef.current !== null) {
            window.clearTimeout(boostTimerRef.current);
        }
        boostTimerRef.current = window.setTimeout(() => {
            setTapBoost(false);
        }, 380);
        navigate('/capture/voice');
    };

    const {fillPath, strokePath} = buildNotchPaths(morph);

    const renderTab = (tab: MobileTabItem) => {
        const active = location.pathname === tab.path;
        return (
            <button
                key={tab.path}
                type="button"
                className={`mobile-nav-tab ${active ? 'active' : ''}`}
                onClick={() => navigate(tab.path)}
                aria-label={tab.fullLabel}
                aria-current={active ? 'page' : undefined}
                title={tab.fullLabel}
            >
                <span className="mobile-nav-icon">{tab.icon}</span>
                <span className="mobile-nav-label">{tab.label}</span>
            </button>
        );
    };

    return (
        <nav
            className={`mobile-bottom-nav ${isVoiceActive ? 'voice-active' : ''} ${tapBoost ? 'morphing' : ''}`}
            aria-label={t('nav_aria', 'Hauptnavigation')}
        >
            <div className="mobile-nav-bar">
                <div className="mobile-nav-wing mobile-nav-wing-left">
                    {leftTabs.map(renderTab)}
                </div>

                <div className="mobile-nav-center-slot">
                    <svg
                        className="mobile-nav-notch-svg"
                        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                    >
                        <path className="mobile-nav-notch-fill" d={fillPath}/>
                        <path className="mobile-nav-notch-stroke" d={strokePath}/>
                    </svg>

                    <button
                        type="button"
                        className={`mobile-nav-fab ${isVoiceActive ? 'active' : ''} ${tapBoost ? 'tapped' : ''}`}
                        onClick={handleCenterClick}
                        aria-label={t('nav_capture_voice', 'Spracherfassung')}
                        aria-current={isVoiceActive ? 'page' : undefined}
                        title={t('nav_capture_voice', 'Spracherfassung')}
                    >
                        <Mic size={24}/>
                    </button>
                    <span className={`mobile-nav-center-label ${isVoiceActive ? 'active' : ''}`}>
                        {labels.voice}
                    </span>
                </div>

                <div className="mobile-nav-wing mobile-nav-wing-right">
                    {rightTabs.map(renderTab)}
                </div>
            </div>
        </nav>
    );
};

export default MobileBottomNav;
