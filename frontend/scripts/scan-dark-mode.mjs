#!/usr/bin/env node
/**
 * Dark-mode audit: lists light backgrounds that are NOT covered by a dark-mode rule.
 *   node scripts/scan-dark-mode.mjs
 * Checks every CSS file (rules) and every component (inline style={{…}}) against
 * theme-overrides.generated.css, theme.css and pages.css.
 * Exit code 1 if something is uncovered – handy before a push.
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const themeFiles = ['theme/theme-overrides.generated.css', 'theme/theme.css', 'theme/pages.css'].map((f) => join(src, f));
const themeCss = themeFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// selectors that are meant to stay white (letters = paper)
const ALLOWED = /paper|letter-sheet|letter-body|letter-subject|ld-print|print|pf-paper|su-print/i;

const lum = (hex) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(h.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Is this background value light (would glare in dark mode)? var(--x, #fff) is fine – the variable follows the theme. */
const isLight = (value) => {
    const v = value.replace(/var\(--[a-z0-9-]+\s*,\s*[^)]*\)/gi, 'var(--x)').toLowerCase();
    if (/\bwhite\b/.test(v)) return true;
    for (const m of v.matchAll(/#[0-9a-f]{3,6}\b/g)) if ((lum(m[0]) ?? 0) > 0.6) return true;
    for (const m of v.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g)) {
        const a = m[4] === undefined ? 1 : Number(m[4]);
        if (a > 0.5 && Number(m[1]) > 200 && Number(m[2]) > 200 && Number(m[3]) > 200) return true;
    }
    return false;
};

const files = (dir, ext) => {
    const out = [];
    for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) out.push(...files(p, ext));
        else if (n.endsWith(ext)) out.push(p);
    }
    return out;
};

const problems = [];

// ---- CSS rules -------------------------------------------------------------
for (const file of files(src, '.css')) {
    if (themeFiles.includes(file) || file.endsWith('index.css')) continue;
    const rel = relative(src, file).replace(/\\/g, '/');
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // flatten @media blocks except print
    const flat = css.replace(/@media[^{]*print[^{]*\{([\s\S]*?\})\s*\}/g, '');
    for (const m of flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const selector = m[1].trim().replace(/\s+/g, ' ');
        if (ALLOWED.test(selector) || /^(from|to|\d+%)$/.test(selector)) continue;
        for (const d of m[2].split(';')) {
            const [k, ...rest] = d.split(':');
            const prop = k?.trim().toLowerCase();
            if (prop !== 'background' && prop !== 'background-color') continue;
            const value = rest.join(':').trim();
            if (!isLight(value)) continue;
            // covered if every part of the selector list has a [data-theme="dark"] rule
            const parts = selector.split(',').map((s) => s.trim());
            const uncovered = parts.filter((s) => !themeCss.includes(`[data-theme="dark"] ${s}`) && !themeCss.includes(`:root ${s} {`) && !themeCss.includes(`:root ${s},`));
            if (uncovered.length) problems.push(`${rel}: ${uncovered.join(', ')} { ${prop}: ${value} }`);
        }
    }
}

// ---- inline styles in components -------------------------------------------
for (const file of files(src, '.tsx')) {
    const rel = relative(src, file).replace(/\\/g, '/');
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/\b(backgroundColor|background)\s*:\s*['"`]([^'"`]+)['"`]/g)) {
        if (!isLight(m[2])) continue;
        const v = m[2].trim().toLowerCase();
        const hex = v === 'white' ? '#ffffff' : v.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/)?.[0];
        let covered = false;
        if (hex) {
            let h = hex.replace('#', '');
            if (h.length === 3) h = h.split('').map((c) => c + c).join('');
            const n = parseInt(h, 16);
            covered = themeCss.includes(`rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})"]`);
        }
        if (!covered) {
            const line = code.slice(0, m.index).split('\n').length;
            problems.push(`${rel}:${line}: inline ${m[1]}: '${m[2]}'`);
        }
    }
}

if (problems.length) {
    console.log(`${problems.length} light background(s) not covered in dark mode:\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
} else {
    console.log('dark mode: no uncovered light backgrounds');
}
