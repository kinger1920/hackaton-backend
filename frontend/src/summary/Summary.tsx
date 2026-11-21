import React from 'react';
import '@frontend/src/index.css';

export const Summary: React.FC = () => {
    return (
        <div className="panel">
            <h2 className="panel-title">Zusammenfassungen</h2>
            <p style={{color: 'var(--text-muted)', marginTop: '8px'}}>
                Konsolidierte Protokoll- und Baustellenberichte mit offenen Maßnahmen.
            </p>
        </div>
    );
};

export default Summary;
