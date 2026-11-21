import {defineConfig, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'url';
import path from 'path';
// @ts-ignore – plain JS module without type declarations
import {generateThemeOverrides} from './scripts/gen-theme-overrides.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keeps src/theme/theme-overrides.generated.css (git-ignored) in sync with all page CSS files:
// generated when dev/build starts and again whenever a stylesheet is saved.
const themeOverrides = (): Plugin => ({
    name: 'theme-overrides',
    buildStart() {
        generateThemeOverrides({quiet: true});
    },
    handleHotUpdate({file}) {
        if (file.endsWith('.css') && !file.endsWith('theme-overrides.generated.css')) {
            generateThemeOverrides({quiet: true});
        }
    },
});

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [themeOverrides(), react()],
    resolve: {
        alias: {
            '@frontend': path.resolve(__dirname, '.'),
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        open: true,
    },
});
