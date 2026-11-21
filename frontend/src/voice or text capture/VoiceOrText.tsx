import React from 'react';
import '@frontend/src/index.css';

export const VoiceOrText: React.FC = () => {
    return (
        <div className="panel">
            <h2 className="panel-title">Sprach- oder Texterfassung</h2>
            <p style={{color: 'var(--text-muted)', marginTop: '8px'}}>
                Mobile Diktate und schnelle Texteingabe zur Vorbereitung von Dokumenten.
            </p>
        </div>
    );
};

export default VoiceOrText;
