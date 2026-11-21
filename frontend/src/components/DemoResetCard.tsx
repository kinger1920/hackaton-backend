import React, {useState} from 'react';
import {RotateCcw, AlertTriangle} from 'lucide-react';
import {api, DemoResetResult} from '../services/api';

/**
 * Demo-Reset (POST /api/demo/reset): löscht ALLE Daten im Backend und lädt den Jury-Demo-Stand
 * (Projekt, Firmen/Verträge, Bauzeitenplan, Tagesberichte, Diktate). 403, wenn DEMO_RESET_ENABLED=false.
 */

// Browser-Daten, die zum alten Datenstand gehören (IDs passen nach dem Reset nicht mehr)
const LOCAL_PREFIXES = ['siteAppointments_', 'progressZones_', 'noticeDispatch_'];
const LOCAL_KEYS = ['savedDrafts', 'activeProjectId', 'projectDocuments'];

export const DemoResetCard: React.FC = () => {
    const [refDate, setRefDate] = useState('');
    const [clearLocal, setClearLocal] = useState(true);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<DemoResetResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const run = async () => {
        if (!window.confirm('Demo-Reset löscht ALLE Daten im Backend (Projekte, Berichte, Briefe, Verträge …) und lädt den Demo-Stand neu. Fortfahren?')) return;
        if (window.prompt('Zur Bestätigung bitte RESET eingeben:')?.trim().toUpperCase() !== 'RESET') return;
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
            setError(err?.message || 'Demo-Reset fehlgeschlagen');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="profile-section-card" style={{marginTop: '16px', borderColor: '#fecaca'}}>
            <h2 style={{fontSize: '16px', fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px'}}>
                <RotateCcw size={18}/> Demo zurücksetzen
            </h2>
            <p style={{fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px'}}>
                Setzt die Demo-Daten auf einen festen Stand zurück: Projekt, Firmen und Verträge, Bauzeitenplan, Tagesberichte und Diktate.
                Der letzte Demo-Bericht liegt auf dem letzten Werktag vor dem Bezugsdatum.
            </p>

            <div style={{display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', fontSize: '13px'}}>
                <label style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                    Bezugsdatum (optional, Standard: heute)
                    <input className="form-input" type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)}/>
                </label>
                <label style={{display: 'flex', alignItems: 'center', gap: '6px', paddingBottom: '8px'}}>
                    <input type="checkbox" checked={clearLocal} onChange={(e) => setClearLocal(e.target.checked)}/>
                    Lokale Browserdaten (eigene Termine, Bereiche, Versanddaten) ebenfalls leeren
                </label>
                <button type="button" className="btn btn-danger" onClick={run} disabled={busy}>
                    <RotateCcw size={15}/> <span>{busy ? 'Setze zurück…' : 'Demo zurücksetzen'}</span>
                </button>
            </div>

            <div style={{display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: '#b91c1c', marginTop: '10px'}}>
                <AlertTriangle size={14}/> Löscht alle Daten im Backend – nur für Demo-/Testsysteme.
            </div>

            {error && <div style={{marginTop: '10px', fontSize: '13px', color: '#b91c1c'}}>{error}</div>}

            {result && (
                <div style={{marginTop: '10px', fontSize: '13px', padding: '10px 12px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0'}}>
                    ✓ Demo geladen: {result.reports ?? 0} Tagesberichte, {result.tasks ?? 0} Vorgänge, {result.contracts ?? 0} Verträge,{' '}
                    {result.notes ?? 0} Diktate{result.last_report_date ? ` • letzter Bericht ${new Date(`${result.last_report_date}T00:00:00`).toLocaleDateString('de-DE')}` : ''}.
                    <div style={{marginTop: '6px'}}>
                        <button type="button" className="btn btn-primary" onClick={() => window.location.assign('/dashboard')}>
                            Zum Dashboard (neu laden)
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DemoResetCard;
