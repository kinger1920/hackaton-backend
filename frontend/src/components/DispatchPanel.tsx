import React, {useEffect, useState} from 'react';
import {Send, CheckCircle2} from 'lucide-react';
import {api, DispatchMethod, NoticeDispatch} from '../services/api';

/**
 * Idee #4: Versand & Zugangsnachweis eines freigegebenen Briefs.
 * Eine Behinderungsanzeige wirkt nur, wenn ihr Zugang nachweisbar ist (§ 6 Abs. 1 VOB/B).
 * Gespeichert über GET/PUT /api/notices/{id}/dispatch im Backend.
 */

const METHODS: Record<DispatchMethod, string> = {
    einschreiben: 'Einschreiben mit Rückschein',
    bote: 'Bote / persönliche Übergabe mit Empfangsquittung',
    email: 'E-Mail (mit Lesebestätigung)',
    fax: 'Fax mit Sendebericht',
    persoenlich: 'Übergabe in Baubesprechung (Protokoll)'
};

const legacyLocalKey = (id: number) => `noticeDispatch_${id}`;

function nowLocal(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

export const DispatchPanel: React.FC<{ noticeId: number | null; approved: boolean }> = ({noticeId, approved}) => {
    const [data, setData] = useState<NoticeDispatch | null>(null);
    const [form, setForm] = useState<NoticeDispatch>({method: 'einschreiben', sent_at: nowLocal()});
    const [editing, setEditing] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        setData(null);
        setEditing(false);
        setMsg(null);
        if (!noticeId) return;
        api.getDispatch(noticeId)
            .then(async (d) => {
                if (d) {
                    setData(d);
                    try {
                        localStorage.removeItem(legacyLocalKey(noticeId));
                    } catch {
                        // ignore
                    }
                    return;
                }
                // Einmalige Migration alter Browser-Versanddaten ins Backend
                try {
                    const raw = localStorage.getItem(legacyLocalKey(noticeId));
                    if (raw) {
                        const legacy: NoticeDispatch = JSON.parse(raw);
                        const saved = await api.saveDispatch(noticeId, legacy);
                        localStorage.removeItem(legacyLocalKey(noticeId));
                        setData(saved);
                    }
                } catch {
                    // ignore
                }
            })
            .catch((err) => {
                setMsg((err as Error)?.message ?? 'Versanddaten konnten nicht geladen werden');
            });
    }, [noticeId]);

    if (!noticeId) return null;

    const save = async () => {
        if (!noticeId) return;
        try {
            const saved = await api.saveDispatch(noticeId, form);
            setData(saved);
            setMsg(null);
            setEditing(false);
        } catch (err) {
            setMsg((err as Error)?.message ?? 'Speichern fehlgeschlagen');
        }
    };

    const box: React.CSSProperties = {
        marginTop: '12px',
        padding: '12px 14px',
        border: '1px solid var(--border-light, #e2e8f0)',
        borderRadius: 'var(--radius-md, 8px)',
        background: 'var(--color-slate-50, #f8fafc)',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    };

    return (
        <div style={box}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                <strong style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                    <Send size={14}/> Versand & Zugangsnachweis
                </strong>
                {approved && !editing && (
                    <button
                        className="doc-btn"
                        onClick={() => {
                            setForm(data ?? {method: 'einschreiben', sent_at: nowLocal()});
                            setEditing(true);
                        }}
                    >
                        {data ? 'Bearbeiten' : 'Versand erfassen'}
                    </button>
                )}
            </div>

            {!approved && (
                <span style={{color: 'var(--text-muted)'}}>Versand erst nach Freigabe des Schreibens möglich.</span>
            )}

            {approved && !editing && data && (
                <div style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                    <span>📮 {METHODS[data.method]} am {new Date(data.sent_at).toLocaleString('de-DE')}</span>
                    {data.tracking_number && <span>Sendungsnr.: {data.tracking_number}</span>}
                    {data.received_at ? (
                        <span style={{color: '#15803d', display: 'flex', alignItems: 'center', gap: '4px'}}>
                            <CheckCircle2 size={13}/> Zugang bestätigt am {new Date(data.received_at).toLocaleDateString('de-DE')}
                        </span>
                    ) : (
                        <span style={{color: '#b45309'}}>⚠️ Zugang noch nicht bestätigt – Nachweis (Rückschein/Quittung) nachreichen.</span>
                    )}
                </div>
            )}

            {approved && !editing && !data && (
                <span style={{color: '#b45309'}}>Noch nicht versendet. Für VOB/B-Fristen zählt der nachweisbare Zugang.</span>
            )}

            {approved && editing && (
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px'}}>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        Versandart
                        <select className="form-input" value={form.method} onChange={(e) => setForm({...form, method: e.target.value as DispatchMethod})}>
                            {Object.entries(METHODS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                    </label>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        Versendet am
                        <input className="form-input" type="datetime-local" value={form.sent_at}
                               onChange={(e) => setForm({...form, sent_at: e.target.value})}/>
                    </label>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        Sendungs-/Belegnummer
                        <input className="form-input" value={form.tracking_number ?? ''}
                               onChange={(e) => setForm({...form, tracking_number: e.target.value || null})}/>
                    </label>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        Zugang bestätigt am
                        <input className="form-input" type="date" value={form.received_at ?? ''}
                               onChange={(e) => setForm({...form, received_at: e.target.value || null})}/>
                    </label>
                    <div style={{gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                        <button className="btn btn-secondary" onClick={() => setEditing(false)}>Abbrechen</button>
                        <button className="btn btn-primary" onClick={save}>Speichern</button>
                    </div>
                </div>
            )}

            {msg && <span style={{fontSize: '11px', color: '#92400e'}}>{msg}</span>}
        </div>
    );
};

export default DispatchPanel;
