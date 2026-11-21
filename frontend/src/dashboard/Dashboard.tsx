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
import { useLanguage } from '../context/LanguageContext';

interface DraftItem {
  id: string;
  title: string;
  category: string;
  date: string;
  status: 'Entwurf' | 'Freigegeben';
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const userName = localStorage.getItem('userName') || t('role_site_manager');
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
          <h1 className="welcome-title">{t('dash_hello')}, {userName}!</h1>
          <p className="welcome-desc">
            {t('hdr_active_project')} <strong>{activeProject.name}</strong> ({activeProject.number}) • {t('dash_phase')}: {activeProject.phase}
          </p>
        </div>
        <div className="hero-stats">
          <div className="hero-stat-card">
            <div className="hero-stat-number">2</div>
            <div className="hero-stat-label">{t('dash_stat_deadlines')}</div>
          </div>
          <div className="hero-stat-card">
            <div className="hero-stat-number">{drafts.length}</div>
            <div className="hero-stat-label">{t('dash_stat_open_drafts')}</div>
          </div>
        </div>
      </section>

      {/* KPI Summary Cards */}
      <section className="kpi-grid">
        <div
          className="kpi-card"
          onClick={() => navigate('/reports')}
          style={{ cursor: 'pointer' }}
          title={t('dash_kpi_diary')}
        >
          <div>
            <div className="kpi-label">{t('dash_kpi_diary')}</div>
            <div className="kpi-value">1 Offen</div>
            <div className="kpi-sub">{t('dash_kpi_diary_sub')}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
            <FileText size={24} />
          </div>
        </div>

        <div
          className="kpi-card"
          onClick={() => navigate('/analysis')}
          style={{ cursor: 'pointer' }}
          title={t('dash_btn_full_analysis')}
        >
          <div>
            <div className="kpi-label">{t('dash_kpi_alerts')}</div>
            <div className="kpi-value">2 Alerts</div>
            <div className="kpi-sub alert">{t('dash_kpi_alerts_sub')}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
            <AlertTriangle size={24} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">{t('dash_kpi_drafts')}</div>
            <div className="kpi-value">{drafts.length} Bereit</div>
            <div className="kpi-sub">{t('dash_kpi_drafts_sub')}</div>
          </div>
          <div className="kpi-icon" style={{ backgroundColor: '#f0fdf4', color: '#16a34a' }}>
            <Mail size={24} />
          </div>
        </div>

        <div className="kpi-card">
          <div>
            <div className="kpi-label">{t('dash_kpi_workers')}</div>
            <div className="kpi-value">34 Personen</div>
            <div className="kpi-sub">{t('dash_kpi_workers_sub')}</div>
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
                <span>{t('dash_capture_title')}</span>
              </h2>
            </div>

            <div className="capture-box">
              <textarea
                className="form-textarea capture-textarea"
                placeholder={t('dash_capture_placeholder')}
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
                  <span>{isRecording ? t('dash_mic_running') : t('dash_mic_start')}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate('/capture')}
                  title={t('dash_btn_open_capture')}
                >
                  <Mic size={16} />
                  <span>{t('dash_btn_open_capture')}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate('/reports')}
                  title={t('dash_btn_to_diary')}
                >
                  <FileText size={16} />
                  <span>{t('dash_btn_to_diary')}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleGenerateDraft}
                  disabled={!quickNote.trim()}
                >
                  <Sparkles size={16} />
                  <span>{t('dash_btn_gen_draft')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Deviations & Critical Alerts */}
          <div className="panel">
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="panel-title">
                <AlertTriangle size={20} color="#dc2626" />
                <span>{t('dash_deviations_title')}</span>
              </h2>
              <button
                type="button"
                className="history-btn-small"
                onClick={() => navigate('/analysis')}
                style={{ color: '#dc2626', fontWeight: 600 }}
              >
                <span>{t('dash_btn_full_analysis')}</span>
              </button>
            </div>

            <div className="alerts-list">
              <div className="alert-item">
                <span className="badge badge-danger">{t('status_urgent')}</span>
                <div className="alert-content">
                  <div className="alert-title">Verzug bei TGA-Schlitz- und Durchbruchsplanung</div>
                  <div className="alert-desc">
                    Planlieferung seit 4 Tagen überfällig. Trockenbauarbeiten im 1. OG drohen ab Montag zu stocken.
                  </div>
                  <span className="alert-action-link" onClick={() => navigate('/drafts')}>
                    → {t('drafts_type_delay')}
                  </span>
                </div>
              </div>

              <div className="alert-item warning">
                <span className="badge badge-warning">{t('status_warning')}</span>
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
                <span>{t('dash_drafts_title')}</span>
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
                    <span className="doc-status-badge">
                      {draft.status === 'Freigegeben' ? t('status_approved') : t('status_draft')}
                    </span>
                    <button
                      className="doc-btn"
                      title={t('btn_word_export')}
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
