import React, {useEffect, useState} from 'react';
import {Download, Smartphone, Wifi, WifiOff} from 'lucide-react';
import {useOnlineStatus} from './useOnlineStatus';
import {ComingSoonBadge, ComingSoonNote} from './ComingSoon';
import {useLanguage} from '../context/LanguageContext';

/**
 * Idee #6: Offline-Modus & App-Installation (PWA).
 * Jetzt: Netzstatus + Installations-Button (falls der Browser die App anbietet).
 * Folgt (Frontend): Web-App-Manifest, Service Worker, Warteschlange für Diktate/Berichte, die offline erfasst werden.
 */
export const OfflineAppCard: React.FC = () => {
    const online = useOnlineStatus();
    const {t} = useLanguage();
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
                <Smartphone size={18}/> {t('oac_title')} <ComingSoonBadge label={t('oac_in_progress')}/>
            </h2>

            <div style={{display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    {online ? <Wifi size={16} color="#16a34a"/> : <WifiOff size={16} color="#dc2626"/>}
                    <span>
                        {t('oac_device_is')} <strong>{online ? t('oac_online') : t('oac_offline')}</strong>
                        {!online && t('oac_offline_loss')}
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
                        title={installEvent ? t('oac_install_title') : t('oac_install_unavailable')}
                    >
                        <Download size={14}/>
                        <span>{installed ? t('oac_installed') : t('oac_install')}</span>
                    </button>
                    <span style={{color: 'var(--text-muted)', fontSize: '12px'}}>
                        {t('oac_queue')}
                    </span>
                </div>

                <ComingSoonNote>
                    {t('oac_planned')}
                </ComingSoonNote>
            </div>
        </div>
    );
};

export default OfflineAppCard;
