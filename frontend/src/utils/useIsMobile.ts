import {useEffect, useState} from 'react';

/**
 * Handy-Ansicht: automatisch bis 768 px Breite. Per „Mehr → Desktop-Ansicht“ lässt sich das
 * überschreiben (localStorage "viewMode" = "desktop" | "mobile"; fehlt = automatisch).
 */
export const MOBILE_QUERY = '(max-width: 768px)';
const VIEW_MODE_KEY = 'viewMode';
const EVENT = 'viewmodechange';

type ViewMode = 'auto' | 'desktop' | 'mobile';

export function getViewMode(): ViewMode {
    try {
        const v = localStorage.getItem(VIEW_MODE_KEY);
        return v === 'desktop' || v === 'mobile' ? v : 'auto';
    } catch {
        return 'auto';
    }
}

export function setViewMode(mode: ViewMode): void {
    try {
        if (mode === 'auto') localStorage.removeItem(VIEW_MODE_KEY);
        else localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
        // ignore (privates Fenster)
    }
    window.dispatchEvent(new Event(EVENT));
}

export const isNarrowScreen = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;

/** Ohne Hook (z. B. direkt nach dem Login): soll die Handy-Ansicht gezeigt werden? */
export function isMobileView(): boolean {
    const mode = getViewMode();
    if (mode === 'desktop') return false;
    if (mode === 'mobile') return true;
    return isNarrowScreen();
}

export function useIsMobile(): { isMobile: boolean; narrow: boolean; mode: ViewMode } {
    const [state, setState] = useState(() => ({isMobile: isMobileView(), narrow: isNarrowScreen(), mode: getViewMode()}));
    useEffect(() => {
        const update = () => setState({isMobile: isMobileView(), narrow: isNarrowScreen(), mode: getViewMode()});
        const mq = window.matchMedia(MOBILE_QUERY);
        mq.addEventListener('change', update);
        window.addEventListener(EVENT, update);
        return () => {
            mq.removeEventListener('change', update);
            window.removeEventListener(EVENT, update);
        };
    }, []);
    return state;
}
