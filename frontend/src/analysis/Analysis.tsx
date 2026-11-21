import React from 'react';
import '@frontend/src/index.css';

export const Analysis: React.FC = () => {
  return (
    <div className="panel">
      <h2 className="panel-title">Bautagesberichte & Analyse</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
        Automatische Auswertung von Bautagesberichten und Soll-Ist-Vergleich.
      </p>
    </div>
  );
};

export default Analysis;
