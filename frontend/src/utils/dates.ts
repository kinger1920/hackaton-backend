/**
 * Gemeinsame Datums-Helfer (lokale Zeit). Backend-Format: ISO "YYYY-MM-DD", Anzeige: deutsch.
 * Vorher hatte jede Seite eigene Kopien (Dashboard, Terminplaner, Fristen-Radar, Baufortschritt, Stammdaten …).
 */

/** Date → "YYYY-MM-DD" (lokale Zeit, nicht UTC) */
export const toIsoDate = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Heute 00:00 (lokal) */
export const startOfToday = (): Date => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

/** Heute als "YYYY-MM-DD" */
export const todayIso = (): string => toIsoDate(new Date());

/** "YYYY-MM-DD" (auch mit Uhrzeit dahinter) → Date 00:00 lokal */
export const parseIsoDate = (s: string): Date => {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
};

/** Liest "YYYY-MM-DD", "TT.MM.JJJJ" oder "Prognose TT.MM.JJJJ"; null, wenn kein Datum */
export const parseAnyDate = (value?: string | null): Date | null => {
    if (!value) return null;
    const v = value.trim();
    const de = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (de) return new Date(Number(de[3]), Number(de[2]) - 1, Number(de[1]));
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return parseIsoDate(v);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "TT.MM.JJJJ" → "YYYY-MM-DD" (andere Formate unverändert) */
export const deToIso = (s: string): string => {
    const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
};

/** "YYYY-MM-DD" → "TT.MM.JJJJ" */
export const isoToDe = (s: string): string => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};

export const addDays = (d: Date, n: number): Date => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
};

/** Ganze Tage von a bis b (b − a) */
export const daysBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 86400000);

/** Montag = 0 … Sonntag = 6 */
export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7;

export const startOfWeek = (d: Date): Date => addDays(d, -weekdayIndex(d));

/** ISO-Kalenderwoche */
export const isoWeek = (d: Date): number => {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

/** Deutsche Datumsanzeige; akzeptiert Date, "YYYY-MM-DD" oder ISO-Zeitstempel (UTC ohne "Z" vom Backend) */
export const formatDe = (
    value: Date | string | null | undefined,
    opts: Intl.DateTimeFormatOptions = {day: '2-digit', month: '2-digit', year: 'numeric'}
): string => {
    if (!value) return '–';
    let d: Date;
    if (value instanceof Date) d = value;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) d = parseIsoDate(value);
    else d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('de-DE', opts);
};
