import React, {useEffect, useState} from 'react';
import {Smartphone, Wifi, WifiOff, Download} from 'lucide-react';
import {useOnlineStatus} from './useOnlineStatus';
import {ComingSoonBadge, ComingSoonNote} from './ComingSoon';

/**
 * Idee #6: Offline-Modus & App-Installation (PWA).
 * Jetzt: Netzstatus + Installations-Button (falls der Browser die App anbietet).
 * Folgt (Frontend): Web-App-Manifest, Service Worker, Warteschlange für Diktate/Berichte, die offline erfasst werden.
 */
export const OfflineAppCard: React.FC = () => {
    const online = useOnlineStatus();
    const [installEvent, setInstallEvent] = useState<any>(null);
    const [installed, setInstalled] = useState(
        typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
    );

    useEffect(() => {
        const onPrompt = (e: Event) => {
            e.preventDefault();
            setInstallEvent(e);
        };
        const onInstalled = () => setInstalled(true);
        window.addEventListener('beforeinstallprompt', onPrompt);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onPrompt);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    return (
        <div className="profile-section-card" style={{marginTop: '16px'}}>
            <h2 style={{fontSize: '16px', fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                <Smartphone size={18}/> Offline & App <ComingSoonBadge label="in Arbeit"/>
            </h2>

            <div style={{display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    {online ? <Wifi size={16} color="#16a34a"/> : <WifiOff size={16} color="#dc2626"/>}
                    <span>
                        Gerät ist <strong>{online ? 'online' : 'offline'}</strong>
                        {!online && ' – Eingaben gehen aktuell verloren, bis der Offline-Modus fertig ist.'}
                    </span>
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={!installEvent || installed}
                        onClick={async () => {
                            installEvent?.prompt();
                            await installEvent?.userChoice;
                            setInstallEvent(null);
                        }}
                        title={installEvent ? 'App auf dem Gerät installieren' : 'Installation noch nicht verfügbar (Manifest/Service Worker folgen)'}
                    >
                        <Download size={14}/>
                        <span>{installed ? 'Als App installiert' : 'Als App installieren'}</span>
                    </button>
                    <span style={{color: 'var(--text-muted)', fontSize: '12px'}}>
                        Offline-Warteschlange: 0 Einträge
                    </span>
                </div>

                <ComingSoonNote>
                    Geplant: Die Web-App wird auf dem Handy installierbar (Startbildschirm, Vollbild). Diktate, Fotos und
                    Tagesberichte werden ohne Netz lokal gespeichert und automatisch gesendet, sobald wieder Empfang da ist.
                    HTTPS-Deployment ist nötig, damit Mikrofon und Installation auf dem Handy funktionieren.
                </ComingSoonNote>
            </div>
        </div>
    );
};

export default OfflineAppCard;
