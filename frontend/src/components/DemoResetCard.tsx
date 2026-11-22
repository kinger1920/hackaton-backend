import React, {useState} from 'react';
import {RotateCcw, AlertTriangle} from 'lucide-react';
import {api, DemoResetResult} from '../services/api';
import {useLanguage} from '../context/LanguageContext';

/**
 * Demo-Reset (POST /api/demo/reset): löscht ALLE Daten im Backend und lädt den Jury-Demo-Stand
 * (Projekt, Firmen/Verträge, Bauzeitenplan, Tagesberichte, Diktate). 403, wenn DEMO_RESET_ENABLED=false.
 */

// Browser-Daten, die zum alten Datenstand gehören (IDs passen nach dem Reset nicht mehr)
const LOCAL_PREFIXES = ['siteAppointments_', 'progressZones_', 'noticeDispatch_'];
const LOCAL_KEYS = ['savedDrafts', 'activeProjectId', 'projectDocuments'];

export const DemoResetCard: React.FC = () => {
    const {t, tf, locale} = useLanguage();
    const [refDate, setRefDate] = useState('');
    const [clearLocal, setClearLocal] = useState(true);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<DemoResetResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        if (!window.confirm(t('drc_confirm'))) return;
        if (window.prompt(t('drc_prompt'))?.trim().toUpperCase() !== 'RESET') return;
        setBusy(true);
        setError(null);
        setResult(null);
        try {
            const res = await api.demoReset(refDate || undefined);
            if (clearLocal) {
                try {
                    Object.keys(localStorage)
                        .filter((k) => LOCAL_KEYS.includes(k) || LOCAL_PREFIXES.some((p) => k.startsWith(p)))
                        .forEach((k) => localStorage.removeItem(k));
                    if (res.project_id) localStorage.setItem('activeProjectId', String(res.project_id));
                } catch {
                    // ignore
                }
            }
            setResult(res);
        } catch (err: any) {
            setError(err?.message || t('drc_failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="profile-section-card" style={{marginTop: '16px', borderColor: '#fecaca'}}>
            <h2 style={{fontSize: '16px', fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                <RotateCcw size={18}/> {t('drc_title')}
            </h2>
            <p style={{fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px'}}>
                {t('drc_desc')}
            </p>

            <div style={{display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', fontSize: '13px'}}>
                <label style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                    {t('drc_ref_date')}
                    <input className="form-input" type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)}/>
                </label>
                <label style={{display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '8px'}}>
                    <input type="checkbox" checked={clearLocal} onChange={(e) => setClearLocal(e.target.checked)}/>
                    {t('drc_clear_local')}
                </label>
                <button type="button" className="btn btn-danger" onClick={run} disabled={busy}>
                    <RotateCcw size={15}/> <span>{busy ? t('drc_busy') : t('drc_title')}</span>
                </button>
            </div>

            <div style={{display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: '#b91c1c', marginTop: '10px'}}>
                <AlertTriangle size={14}/> {t('drc_warning')}
            </div>

            {error && <div style={{marginTop: '10px', fontSize: '13px', color: '#b91c1c'}}>{error}</div>}

            {result && (
                <div style={{marginTop: '10px', fontSize: '13px', padding: '10px 12px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0'}}>
                    {tf('drc_loaded', {reports: result.reports ?? 0, tasks: result.tasks ?? 0, contracts: result.contracts ?? 0, notes: result.notes ?? 0})}
                    {result.last_report_date ? ` • ${t('drc_last_report')} ${new Date(`${result.last_report_date}T00:00:00`).toLocaleDateString(locale)}` : ''}.
                    <div style={{marginTop: '6px'}}>
                        <button type="button" className="btn btn-primary" onClick={() => window.location.assign('/dashboard')}>
                            {t('drc_to_dashboard')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DemoResetCard;
