#!/usr/bin/env node
/**
 * Generates src/theme/theme-overrides.generated.css
 *
 * Many page stylesheets use hard-coded colours (#ffffff, #0f172a, #2563eb, …).
 * Instead of editing every page file (and fighting merge conflicts), this script
 * scans all CSS files and writes override rules that map those colours to the
 * theme tokens from theme.css:
 *   - brand blue  → amber (both themes)
 *   - whites, greys, light tints, dark text → theme tokens (dark theme only)
 *
 * Runs automatically via the Vite plugin in vite.config.ts (dev + build, and on
 * every CSS change). Manual run: node scripts/gen-theme-overrides.mjs
 * The output is git-ignored, so it never causes merge conflicts.
 */
import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outFile = join(srcDir, 'theme', 'theme-overrides.generated.css');

// Selectors that must keep their colours (letters are white paper in both themes)
const SKIP_SELECTOR = /paper|letter-sheet|letter-body|letter-subject|ld-draft-stamp|ld-print|legal-notice|print/i;
const SKIP_FILES = new Set(['index.css', 'theme.css', 'theme-overrides.generated.css']);

const norm = (v) => v.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*!important$/, '');

// ---- colour → token maps --------------------------------------------------
const BRAND = {
    '#2563eb': 'var(--color-primary)',
    '#1d4ed8': 'var(--color-primary-hover)',
    '#3b82f6': 'var(--color-primary)',
    '#1e40af': 'var(--color-primary-hover)'
};
const BRAND_FILL = { // brand blue used as a fill → yellow surface
    '#2563eb': 'var(--color-primary-fill)',
    '#1d4ed8': 'var(--color-primary-fill-hover)',
    '#3b82f6': 'var(--color-primary-fill)',
    '#1e40af': 'var(--color-primary-fill-hover)'
};
const BG = {
    '#fff': 'var(--bg-surface)', '#ffffff': 'var(--bg-surface)', 'white': 'var(--bg-surface)',
    '#f8fafc': 'var(--color-slate-50)', '#f9fafb': 'var(--color-slate-50)', '#fafafa': 'var(--color-slate-50)',
    '#fbfcfe': 'var(--color-slate-50)',
    '#f1f5f9': 'var(--color-slate-100)', '#f3f4f6': 'var(--color-slate-100)', '#f4f4f5': 'var(--color-slate-100)',
    '#e2e8f0': 'var(--color-slate-200)', '#e5e7eb': 'var(--color-slate-200)',
    '#eff6ff': 'var(--color-primary-light)', '#dbeafe': 'var(--color-primary-light)',
    '#eef2ff': 'var(--color-ai-light)', '#e0e7ff': 'var(--color-ai-light)',
    '#fffbeb': 'var(--color-warning-light)', '#fef3c7': 'var(--color-warning-light)', '#fff7ed': 'var(--color-warning-light)',
    '#fef2f2': 'var(--color-danger-light)', '#fee2e2': 'var(--color-danger-light)',
    '#f0fdf4': 'var(--color-success-light)', '#dcfce7': 'var(--color-success-light)', '#ecfdf5': 'var(--color-success-light)',
    '#e0f2fe': 'var(--color-info-light)', '#f0f9ff': 'var(--color-info-light)'
};
const TEXT = {
    '#000': 'var(--text-main)', '#000000': 'var(--text-main)', '#111': 'var(--text-main)', '#111111': 'var(--text-main)',
    '#0f172a': 'var(--text-main)', '#111827': 'var(--text-main)', '#1e293b': 'var(--color-slate-800)',
    '#1f2937': 'var(--color-slate-800)',
    '#334155': 'var(--color-slate-700)', '#374151': 'var(--color-slate-700)',
    '#475569': 'var(--color-slate-600)', '#4b5563': 'var(--color-slate-600)',
    '#64748b': 'var(--color-slate-500)', '#6b7280': 'var(--color-slate-500)',
    '#92400e': 'var(--color-warning-dark)', '#b45309': 'var(--color-warning-dark)',
    '#991b1b': 'var(--color-danger-dark)', '#b91c1c': 'var(--color-danger-dark)',
    '#166534': 'var(--color-success-dark)', '#15803d': 'var(--color-success-dark)',
    '#3730a3': 'var(--color-ai)', '#1e3a8a': 'var(--color-slate-800)', '#075985': 'var(--color-info)'
};
const BORDER = {
    '#e2e8f0': 'var(--border-light)', '#e5e7eb': 'var(--border-light)', '#cbd5e1': 'var(--color-slate-300)',
    '#d1d5db': 'var(--color-slate-300)', '#f1f5f9': 'var(--border-light)',
    '#bfdbfe': 'var(--color-primary-border)', '#c7d2fe': 'var(--color-ai-border)',
    '#fecaca': 'var(--color-danger-border)', '#fde68a': 'var(--color-warning-border)',
    '#fef3c7': 'var(--color-warning-border)', '#bbf7d0': 'var(--color-success-border)',
    '#bae6fd': 'var(--color-info-light)'
};

// ---- tiny CSS walker (good enough for our flat stylesheets) ---------------
function* rules(css, inPrint = false) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open === -1) return;
        const head = css.slice(i, open).trim();
        // find matching brace
        let depth = 1, j = open + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        const body = css.slice(open + 1, j - 1);
        if (head.startsWith('@media')) {
            yield* rules(body, inPrint || /print/.test(head));
        } else if (!head.startsWith('@')) {
            yield {selector: head, body, inPrint};
        }
        i = j;
    }
}

const decls = (body) =>
    body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const k = d.indexOf(':');
        return k === -1 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()];
    }).filter(Boolean);

const scope = (selector, prefix) =>
    selector.split(',').map((s) => s.trim()).filter(Boolean).map((s) => `${prefix} ${s}`).join(',\n');

function cssFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...cssFiles(p));
        else if (name.endsWith('.css') && !SKIP_FILES.has(name)) out.push(p);
    }
    return out.sort();
}

// Extra colours that only appear in inline component styles
Object.assign(BG, {
    '#fdf2f8': 'var(--color-slate-100)', '#faf5ff': 'var(--color-ai-light)', '#cbd5e1': 'var(--color-slate-300)'
});
Object.assign(TEXT, {
    '#dc2626': 'var(--color-danger)', '#ef4444': 'var(--color-danger)', '#16a34a': 'var(--color-success)',
    '#d97706': 'var(--color-warning)', '#78350f': 'var(--color-warning-dark)'
});
Object.assign(BORDER, {
    '#fca5a5': 'var(--color-danger-border)', '#f87171': 'var(--color-danger-border)',
    '#e9d5ff': 'var(--color-ai-border)', '#f59e0b': 'var(--color-warning-border)'
});

// Relative luminance (0 = black, 1 = white) of a hex colour, null if not a hex colour
const luminance = (hex) => {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Table first; otherwise a safety net by brightness, so unknown pastel boxes and
// near-black text never glare in dark mode.
const bgToken = (hex) => BG[hex] ?? ((luminance(hex) ?? 0) > 0.82 ? 'var(--color-slate-50)' : undefined);
const textToken = (hex) => {
    const l = luminance(hex);
    return TEXT[hex] ?? (l !== null && l < 0.06 ? 'var(--text-main)' : undefined);
};
const borderToken = (hex) => BORDER[hex] ?? ((luminance(hex) ?? 0) > 0.7 ? 'var(--border-light)' : undefined);

const hexToRgb = (hex) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** Map "prop|#hex" → Set(files) for colours used in style={{…}} and SVG fill/stroke attributes. */
function collectInlineColours(dir) {
    const found = new Map();
    const add = (prop, hex, file) => {
        const key = `${prop}|${hex.toLowerCase()}`;
        if (!found.has(key)) found.set(key, new Set());
        found.get(key).add(file);
    };
    const walk = (d) => {
        for (const name of readdirSync(d)) {
            const p = join(d, name);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!name.endsWith('.tsx')) continue;
            const rel = relative(dir, p).replace(/\\/g, '/');
            const src = readFileSync(p, 'utf8');
            const re = /\b(backgroundColor|background|color|borderColor|border(?:Left|Right|Top|Bottom)?)\s*:\s*['"`]([^'"`]*)['"`]/g;
            for (const m of src.matchAll(re)) {
                // skip var(--x, #fallback) – the variable already follows the theme
                if (/var\(/.test(m[2])) continue;
                const hex = m[2].match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)?.[0];
                if (!hex) continue;
                const prop = m[1].startsWith('background') ? 'bg' : m[1] === 'color' ? 'color' : 'border';
                add(prop, hex, rel);
            }
            for (const m of src.matchAll(/\b(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g)) add(m[1], m[2], rel);
        }
    };
    walk(dir);
    return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// ---- generate ---------------------------------------------------------------
/** Writes the overrides file. Only touches the file when its content changed. Returns true if written. */
export function generateThemeOverrides({quiet = false} = {}) {
const both = [];   // brand colour → amber (light + dark)
const dark = [];   // neutrals → tokens (dark only)

for (const file of cssFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, '/');
    for (const {selector, body, inPrint} of rules(readFileSync(file, 'utf8'))) {
        if (inPrint || SKIP_SELECTOR.test(selector) || selector.startsWith('@') || /^(from|to|\d+%)$/.test(selector)) continue;
        const d = decls(body);
        const hasBrandFill = d.some(([k, v]) => (k === 'background' || k === 'background-color') && BRAND[norm(v)])
            || d.some(([k, v]) => (k === 'background' || k === 'background-color')
                && /var\(--color-primary\)/.test(v) && !/gradient/.test(v));

        const b = [], dk = [];
        for (const [k, raw] of d) {
            const v = norm(raw);
            if (k === 'background' || k === 'background-color') {
                if (/gradient/.test(v)) {
                    // dark navy / brand-blue hero banners → black construction banner (white text stays)
                    if (/#1e3a8a|#2563eb|#1d4ed8|#3b82f6|--color-primary\)/.test(v) && !/90deg/.test(v)) {
                        b.push('background: linear-gradient(135deg, var(--banner-bg-from) 0%, var(--banner-bg-to) 100%)');
                        b.push('border-left: 4px solid var(--color-primary-fill)');
                    } else if (/#2563eb|#1d4ed8|#3b82f6/.test(v)) {
                        // blue progress bars → amber
                        b.push('background: linear-gradient(90deg, var(--color-primary-fill), var(--color-primary-fill-hover))');
                    } else if (/#f[0-9a-f]{5}|#ffffff|#fff\b|white/.test(v)) {
                        // pale card gradients → plain surface in dark mode
                        dk.push('background: var(--bg-surface)');
                    }
                    continue;
                }
                // dark grey surfaces flip to light in dark mode → keep them dark
                if (/var\(--color-slate-(900|800)\)/.test(v)) {
                    dk.push(`background-color: ${/900/.test(v) ? 'var(--chrome-bg)' : 'var(--chrome-bg-raised)'}`);
                    continue;
                }
                if (BRAND_FILL[v]) b.push(`background-color: ${BRAND_FILL[v]}`);
                else if (/var\(--color-primary\)/.test(v) && !/gradient/.test(v)) b.push('background-color: var(--color-primary-fill)');
                else if (bgToken(v)) dk.push(`background-color: ${bgToken(v)}`);
            } else if (k === 'color') {
                if (hasBrandFill && (v === '#fff' || v === '#ffffff' || v === 'white')) b.push('color: var(--color-on-primary)');
                else if (BRAND[v]) b.push(`color: ${BRAND[v]}`);
                else if (textToken(v)) dk.push(`color: ${textToken(v)}`);
            } else if (/^border(-(top|right|bottom|left))?(-color)?$/.test(k)) {
                const hex = v.match(/#[0-9a-f]{3,8}\b|\bwhite\b/)?.[0];
                if (!hex) continue;
                const prop = k.endsWith('-color') ? k : `${k}-color`;
                if (BRAND[hex]) b.push(`${prop}: ${BRAND[hex]}`);
                else if (borderToken(hex)) dk.push(`${prop}: ${borderToken(hex)}`);
            } else if (k === 'fill' || k === 'stroke') {
                if (BRAND[v]) b.push(`${k}: ${BRAND[v]}`);
            }
        }
        if (b.length) both.push(`/* ${rel} */\n${scope(selector, ':root')} {\n    ${b.join(';\n    ')};\n}`);
        if (dk.length) dark.push(`/* ${rel} */\n${scope(selector, '[data-theme="dark"]')} {\n    ${dk.join(';\n    ')};\n}`);
    }
}

// ---- inline styles in components (style={{ backgroundColor: '#fef2f2' }}) ----
// Browsers serialise inline colours as "rgb(r, g, b)", so attribute selectors can
// target them. !important is needed to beat inline styles.
const inline = collectInlineColours(srcDir);
const inlineBoth = [];
const inlineDark = [];
for (const [key, files] of inline) {
    const [prop, hex] = key.split('|');
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const src = `/* inline ${prop}: ${hex} – ${[...files].join(', ')} */`;
    if (prop === 'bg') {
        const sel = (p) => [`[style*="background-color: ${rgb}"]`, `[style*="background: ${rgb}"]`].map((s) => `${p} ${s}`).join(',\n');
        if (BRAND_FILL[hex]) {
            inlineBoth.push(`${src}\n${sel(':root')} {\n    background-color: ${BRAND_FILL[hex]} !important;\n    color: var(--color-on-primary) !important;\n}`);
        } else if (bgToken(hex)) {
            inlineDark.push(`${src}\n${sel('[data-theme="dark"]')} {\n    background-color: ${bgToken(hex)} !important;\n}`);
        }
    } else if (prop === 'color') {
        const sel = (p) => [`[style^="color: ${rgb}"]`, `[style*="; color: ${rgb}"]`].map((s) => `${p} ${s}`).join(',\n');
        if (BRAND[hex]) inlineBoth.push(`${src}\n${sel(':root')} {\n    color: ${BRAND[hex]} !important;\n}`);
        else if (textToken(hex)) inlineDark.push(`${src}\n${sel('[data-theme="dark"]')} {\n    color: ${textToken(hex)} !important;\n}`);
    } else if (prop === 'border') {
        const sel = (p) => [`[style*="solid ${rgb}"]`, `[style*="dashed ${rgb}"]`, `[style*="border-color: ${rgb}"]`]
            .map((s) => `${p} ${s}`).join(',\n');
        if (BRAND[hex]) inlineBoth.push(`${src}\n${sel(':root')} {\n    border-color: ${BRAND[hex]} !important;\n}`);
        else if (borderToken(hex)) inlineDark.push(`${src}\n${sel('[data-theme="dark"]')} {\n    border-color: ${borderToken(hex)} !important;\n}`);
    } else if (prop === 'fill' || prop === 'stroke') {
        // SVG presentation attributes (fill="#0f172a") lose against any CSS rule
        const token = prop === 'fill' && bgToken(hex) ? bgToken(hex) : textToken(hex) ?? borderToken(hex);
        if (BRAND[hex]) inlineBoth.push(`${src}\n:root [${prop}="${hex}"] {\n    ${prop}: ${BRAND[hex]};\n}`);
        else if (token) inlineDark.push(`${src}\n[data-theme="dark"] [${prop}="${hex}"] {\n    ${prop}: ${token};\n}`);
    }
}

const banner = `/* ==========================================================================
   GENERATED FILE – do not edit by hand.
   Source: frontend/scripts/gen-theme-overrides.mjs (regenerated by the Vite plugin)
   Maps hard-coded colours in page stylesheets and inline component styles
   to the theme tokens (theme.css).
   ========================================================================== */
`;

const content =
    `${banner}\n/* ---- brand blue → amber (both themes) ---- */\n\n${both.join('\n\n')}\n\n` +
    `/* ---- neutrals & tints → theme tokens (dark theme) ---- */\n\n${dark.join('\n\n')}\n\n` +
    `/* ---- inline styles: brand blue → amber (both themes) ---- */\n\n${inlineBoth.join('\n\n')}\n\n` +
    `/* ---- inline styles: neutrals & tints → theme tokens (dark theme) ---- */\n\n${inlineDark.join('\n\n')}\n`;

let previous = '';
try {
    previous = readFileSync(outFile, 'utf8');
} catch {
    // first run
}
if (previous === content) return false;
writeFileSync(outFile, content);
if (!quiet) console.log(`theme overrides: ${both.length} brand rules, ${dark.length} dark rules → ${relative(root, outFile)}`);
return true;
}

// Run directly: node scripts/gen-theme-overrides.mjs
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    generateThemeOverrides() || console.log('theme overrides: up to date');
}
