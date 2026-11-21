import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@frontend/src/index.css';
// Theme (light/dark, construction colours) – must come after index.css
import './theme/theme';
import './theme/theme.css';
import './theme/theme-overrides.generated.css';
// One shared look for all pages (modelled on Briefentwürfe) – must stay last
import './theme/pages.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
);
