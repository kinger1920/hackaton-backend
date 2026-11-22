import React, {useEffect, useState} from 'react';
import {CheckCircle2, Send} from 'lucide-react';
import {api, DispatchMethod, NoticeDispatch} from '../services/api';
import {useLanguage} from '../context/LanguageContext';

/**
 * Idee #4: Versand & Zugangsnachweis eines freigegebenen Briefs.
 * Eine Behinderungsanzeige wirkt nur, wenn ihr Zugang nachweisbar ist (§ 6 Abs. 1 VOB/B).
 * Gespeichert über GET/PUT /api/notices/{id}/dispatch im Backend.
 */

// Versandarten; der Anzeigetext kommt aus den Übersetzungen (Key dp_m_<methode>).
const METHODS: DispatchMethod[] = ['einschreiben', 'bote', 'email', 'fax', 'persoenlich'];

const legacyLocalKey = (id: number) => `noticeDispatch_${id}`;

function nowLocal(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

export const DispatchPanel: React.FC<{ noticeId: number | null; approved: boolean }> = ({noticeId, approved}) => {
    const {t, tf, locale} = useLanguage();
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
                setMsg((err as Error)?.message ?? t('dp_load_failed'));
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
            setMsg((err as Error)?.message ?? t('dp_save_failed'));
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
                    <Send size={14}/> {t('dp_title')}
                </strong>
                {approved && !editing && (
                    <button
                        className="doc-btn"
                        onClick={() => {
                            setForm(data ?? {method: 'einschreiben', sent_at: nowLocal()});
                            setEditing(true);
                        }}
                    >
                        {data ? t('dp_edit') : t('dp_record')}
                    </button>
                )}
            </div>

            {!approved && (
                <span style={{color: 'var(--text-muted)'}}>{t('dp_after_approval')}</span>
            )}

            {approved && !editing && data && (
                <div style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                    <span>{tf('dp_sent_line', {
                        method: t(`dp_m_${data.method}`),
                        date: new Date(data.sent_at).toLocaleString(locale)
                    })}</span>
                    {data.tracking_number && <span>{t('dp_tracking')} {data.tracking_number}</span>}
                    {data.received_at ? (
                        <span style={{color: '#15803d', display: 'flex', alignItems: 'center', gap: '4px'}}>
                            <CheckCircle2
                                size={13}/> {t('dp_received_on')} {new Date(data.received_at).toLocaleDateString(locale)}
                        </span>
                    ) : (
                        <span style={{color: '#b45309'}}>{t('dp_not_confirmed')}</span>
                    )}
                </div>
            )}

            {approved && !editing && !data && (
                <span style={{color: '#b45309'}}>{t('dp_not_sent')}</span>
            )}

            {approved && editing && (
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px'}}>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        {t('dp_method')}
                        <select className="form-input" value={form.method} onChange={(e) => setForm({...form, method: e.target.value as DispatchMethod})}>
                            {METHODS.map((k) => (
                                <option key={k} value={k}>{t(`dp_m_${k}`)}</option>
                            ))}
                        </select>
                    </label>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        {t('dp_sent_at')}
                        <input className="form-input" type="datetime-local" value={form.sent_at}
                               onChange={(e) => setForm({...form, sent_at: e.target.value})}/>
                    </label>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        {t('dp_tracking_label')}
                        <input className="form-input" value={form.tracking_number ?? ''}
                               onChange={(e) => setForm({...form, tracking_number: e.target.value || null})}/>
                    </label>
                    <label style={{display: 'flex', flexDirection: 'column', gap: '2px'}}>
                        {t('dp_received_on')}
                        <input className="form-input" type="date" value={form.received_at ?? ''}
                               onChange={(e) => setForm({...form, received_at: e.target.value || null})}/>
                    </label>
                    <div style={{gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '8px'}}>
                        <button className="btn btn-secondary"
                                onClick={() => setEditing(false)}>{t('btn_cancel')}</button>
                        <button className="btn btn-primary" onClick={save}>{t('btn_save')}</button>
                    </div>
                </div>
            )}

            {msg && <span style={{fontSize: '11px', color: '#92400e'}}>{msg}</span>}
        </div>
    );
};

export default DispatchPanel;
