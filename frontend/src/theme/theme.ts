/**
 * Light / dark theme.
 * The theme is set as data-theme="light|dark" on <html>; all colours come from
 * CSS variables in theme.css, so switching needs no re-render.
 * Default is dark; the user's choice is remembered in localStorage.
 */
import {useEffect, useState} from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const EVENT = 'themechange';

export const getTheme = (): Theme => (localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark');

export const applyTheme = (theme: Theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme; // native inputs, scrollbars, date pickers
};

export const setTheme = (theme: Theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    window.dispatchEvent(new CustomEvent(EVENT, {detail: theme}));
};

/** React hook: current theme + toggle. */
export const useTheme = () => {
    const [theme, setThemeState] = useState<Theme>(getTheme);

    useEffect(() => {
        const onChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
        window.addEventListener(EVENT, onChange);
        return () => window.removeEventListener(EVENT, onChange);
    }, []);

    const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
    return {theme, setTheme, toggleTheme};
};

// Apply as early as possible (imported from main.tsx) to avoid a flash of the wrong theme.
applyTheme(getTheme());
