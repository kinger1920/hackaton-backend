import React from 'react';
import '@frontend/src/index.css';

export const Correspondence: React.FC = () => {
  return (
    <div className="panel">
      <h2 className="panel-title">Schriftverkehr</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
        Verwaltung und Historie des VOB-konformen Schriftverkehrs.
      </p>
    </div>
  );
};

export default Correspondence;
