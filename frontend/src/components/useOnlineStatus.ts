import {useEffect, useState} from 'react';

/** Netzstatus des Geräts (navigator.onLine) – Basis für den späteren Offline-Modus (Idee #6). */
export function useOnlineStatus(): boolean {
    const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);
    return online;
}
