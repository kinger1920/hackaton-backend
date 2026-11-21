import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  AlertTriangle,
  Mail,
  Sparkles,
  Mic,
  Users,
  CheckCircle2,
  FileDown,
  Clock
} from 'lucide-react';
import './Dashboard.css';
import '@frontend/src/index.css';
import { useProjects } from '../context/ProjectContext';

interface DraftItem {
  id: string;
  title: string;
  category: string;
  date: string;
  status: 'Entwurf' | 'Freigegeben';
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const userName = localStorage.getItem('userName') || 'Bauleiter';
  const { activeProject } = useProjects();

  const [quickNote, setQuickNote] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [drafts, setDrafts] = useState<DraftItem[]>([
    {
      id: '1',
      title: 'Behinderungsanzeige § 6 Abs. 1 VOB/B (Fehlende TGA-Ausführungspläne)',
      category: 'Behinderungsanzeige',
      date: 'Heute, 09:15',
      status: 'Entwurf'
    },
    {
      id: '2',
      title: 'Bautagesbericht KW 47 - Donnerstag (Erdarbeiten & Rohbau Bauteil A)',
      category: 'Bautagesbericht',
      date: 'Heute, 08:00',
      status: 'Entwurf'
    },
    {
      id: '3',
      title: 'Bedenkenanmeldung (Feuchtigkeit in Untergeschoss-Sohle vor Estrich)',
      category: 'Bedenken',
      date: 'Gestern, 16:30',
      status: 'Freigegeben'
    }
  ]);

  const handleMicToggle = () => {
    if (!isRecording) {
      setIsRecording(true);
      setTimeout(() => {
        setQuickNote('Kettenbagger seit 10:15 Uhr stillgelegt, da Freigabe für Schachtarbeiten Trasse Nord fehlt. 3 Mann Tiefbau blockiert.');
        setIsRecording(false);
      }, 1800);
    } else {
      setIsRecording(false);
    }
  };

  const handleGenerateDraft = () => {
    if (!quickNote.trim()) return;

    const newDraft: DraftItem = {
      id: String(Date.now()),
      title: `KI-Entwurf: Behinderungsanzeige (${quickNote.slice(0, 40)}...)`,
      category: 'Behinderungsanzeige',
      date: 'Gerade eben',
      status: 'Entwurf'
    };

    setDrafts([newDraft, ...drafts]);
    setQuickNote('');
  };

  return (
    <>
      {/* Welcome Hero Banner */}
      <section className="welcome-hero">
        <div>
          <h1 className="welcome-title">Hallo, {userName}!</h1>
          <p className="welcome-desc">
            Aktives Bauprojekt: <strong>{activeProject.name}</strong> ({activeProject.number}) • Phase: {activeProject.phase}
          </p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat-card">
            <div className="hero-stat-number">2</div>
            <div className="hero-stat-label">Akute Fristen</div>
          </div>
          <div className="hero-stat-card">
            <div className="hero-stat-number">{drafts.length}</div>
            <div className="hero-stat-label">Offene Entwürfe</div>
          </div>
        </div>
      </section>

      {/* KPI Summary Cards */}
      <section className="kpi-grid">
        <div className="kpi-card">
          <div>
            <div className="kpi-label">Bautagesbericht</div>
            <div className="kpi-value">1 Offen</div>
            <div className="kpi-sub">Fällig bis 18:00 Uhr</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
            <FileText size={24} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">Kritische Abweichungen</div>
            <div className="kpi-value">2 Alerts</div>
            <div className="kpi-sub alert">Handlungsbedarf nach VOB</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
            <AlertTriangle size={24} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">Schriftverkehr-Entwürfe</div>
            <div className="kpi-value">{drafts.length} Bereit</div>
            <div className="kpi-sub">Prüfung & Freigabe nötig</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#f0fdf4', color: '#16a34a' }}>
            <Mail size={24} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">Anwesende Fachkräfte</div>
            <div className="kpi-value">34 Personen</div>
            <div className="kpi-sub">4 Gewerke auf Baustelle</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#f8fafc', color: '#475569' }}>
            <Users size={24} />
          </div>
        </div>
      </section>

      {/* Main Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Quick Capture & Deviations */}
        <div>
          {/* Quick Capture Panel */}
          <div className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <Sparkles size={20} color="#2563eb" />
                <span>KI-Schnellerfassung & Sprachnotiz</span>
              </h2>
            </div>

            <div className="capture-box">
              <textarea
                className="form-textarea capture-textarea"
                placeholder="Schildern Sie kurz die Baustellen-Situation oder klicken Sie auf das Mikrofon (z. B. 'Bagger stillgelegt wegen fehlender Leitungspläne...')"
                value={quickNote}
                onChange={(e) => setQuickNote(e.target.value)}
              />

              <div className="capture-actions">
                <button
                  type="button"
                  className={`mic-btn ${isRecording ? 'active' : ''}`}
                  onClick={handleMicToggle}
                >
                  <Mic size={16} />
                  <span>{isRecording ? 'Sprachaufnahme läuft...' : 'Diktat starten'}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGenerateDraft}
                  disabled={!quickNote.trim()}
                >
                  <Sparkles size={16} />
                  <span>Briefentwurf erzeugen</span>
                </button>
              </div>
            </div>
          </div>

          {/* Deviations & Critical Alerts */}
          <div className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <AlertTriangle size={20} color="#dc2626" />
                <span>Erkannte Abweichungen & Handlungsempfehlungen</span>
              </h2>
            </div>

            <div className="alerts-list">
              <div className="alert-item">
                <span className="badge badge-danger">Dringend</span>
                <div className="alert-content">
                  <div className="alert-title">Verzug bei TGA-Schlitz- und Durchbruchsplanung</div>
                  <div className="alert-desc">
                    Planlieferung seit 4 Tagen überfällig. Trockenbauarbeiten im 1. OG drohen ab Montag zu stocken.
                  </div>
                  <span className="alert-action-link" onClick={() => navigate('/drafts')}>
                    → Jetzt Behinderungsanzeige nach VOB/B entwerfen
                  </span>
                </div>
              </div>

              <div className="alert-item warning">
                <span className="badge badge-warning">Hinweis</span>
                <div className="alert-content">
                  <div className="alert-title">Wetterwarnung: Dauerregen & Starkwind am Freitag</div>
                  <div className="alert-desc">
                    Mögliche Beeinträchtigung der Dachabdichtungsarbeiten. Vorkehrungen zur Baustellensicherung treffen.
                  </div>
                  <span className="alert-action-link" onClick={() => alert('Hinweis in Bautagesbericht übernommen')}>
                    → In heutigen Bautagesbericht aufnehmen
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Drafts & Human-in-the-Loop Review */}
        <div>
          <div className="panel">
            <div className="panel-header">
              <h2 className="panel-title">
                <Clock size={20} color="#2563eb" />
                <span>Schriftverkehr & Entwürfe</span>
              </h2>
            </div>

            <div className="docs-list">
              {drafts.map((draft) => (
                <div key={draft.id} className="doc-item">
                  <div className="doc-info">
                    <FileText size={20} className="doc-icon" />
                    <div>
                      <div className="doc-title">{draft.title}</div>
                      <div className="doc-meta">
                        {draft.category} • {draft.date}
                      </div>
                    </div>
                  </div>

                  <div className="doc-actions">
                    <span className="doc-status-badge">{draft.status}</span>
                    <button
                      className="doc-btn"
                      title="Als PDF / Word exportieren"
                      onClick={() => alert(`Export von: "${draft.title}" als DOCX/PDF gestartet`)}
                    >
                      <FileDown size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Info Box: Human-in-the-Loop */}
          <div
            style={{
              padding: '16px',
              borderRadius: '10px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              fontSize: '13px',
              color: '#1e40af',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start'
            }}
          >
            <CheckCircle2 size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong>Human-in-the-Loop Prinzip:</strong> Alle generierten Schreiben sind Vorschläge
              zur Entlastung. Sie können jeden Entwurf vor Freigabe oder Export prüfen und editieren.
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Dashboard;
