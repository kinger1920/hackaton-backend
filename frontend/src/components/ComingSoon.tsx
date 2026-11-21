import React from 'react';
import {Hammer} from 'lucide-react';

/**
 * Einheitlicher Hinweis für Funktionen, deren Oberfläche schon steht, deren Backend aber noch fehlt.
 * `endpoint` nennt den geplanten API-Pfad (siehe WETTBEWERB_UND_IDEEN.md / API-Vorschläge).
 */
export const ComingSoonBadge: React.FC<{ label?: string }> = ({label = 'Backend folgt'}) => (
    <span
        style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            padding: '2px 7px',
            borderRadius: '999px',
            backgroundColor: '#fef3c7',
            color: '#92400e',
            border: '1px solid #fde68a',
            whiteSpace: 'nowrap'
        }}
    >
        <Hammer size={10}/>
        {label}
    </span>
);

export const ComingSoonNote: React.FC<{ children: React.ReactNode; endpoint?: string }> = ({children, endpoint}) => (
    <div
        style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
            fontSize: '12px',
            lineHeight: 1.45,
            padding: '10px 12px',
            borderRadius: 'var(--radius-md, 8px)',
            backgroundColor: '#fffbeb',
            border: '1px dashed #f59e0b',
            color: '#78350f'
        }}
    >
        <Hammer size={14} style={{flexShrink: 0, marginTop: '2px'}}/>
        <div>
            {children}
            {endpoint && (
                <div style={{marginTop: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#92400e'}}>
                    geplanter Endpunkt: {endpoint}
                </div>
            )}
        </div>
    </div>
);

/** true, wenn ein Fehler bedeutet „Endpunkt gibt es (noch) nicht“ (404/405/501). */
export function isNotImplemented(err: unknown): boolean {
    const msg = String((err as any)?.message ?? err);
    return /HTTP (404|405|501)\b|Not Found|Method Not Allowed|Not Implemented/i.test(msg);
}
