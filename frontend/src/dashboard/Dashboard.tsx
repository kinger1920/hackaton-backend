import React, {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
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
import {useProjects} from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import {api, DashboardAlert, DashboardData, DraftNavState, NoticeOut, NoticeType} from '../services/api';

interface DraftItem {
    id: string;
    noticeId?: number;
    title: string;
    category: string;
    date: string;
    status: 'Entwurf' | 'Freigegeben' | 'Exportiert';
}

const TYPE_LABELS: Record<NoticeType, string> = {
    delay: 'Behinderungsanzeige',
    cost: 'Mehrkostenanmeldung',
    defect: 'Mängelrüge',
    concern: 'Bedenkenanmeldung'
};

// Nur wenn das Backend nicht erreichbar ist (Demo darf nie leer sein).
const FALLBACK_ALERTS: DashboardAlert[] = [
    {
        severity: 'critical',
        title: 'Verzug bei TGA-Schlitz- und Durchbruchsplanung',
        description: 'Planlieferung seit 4 Tagen überfällig. Trockenbauarbeiten im 1. OG drohen ab Montag zu stocken.',
        draftType: 'delay',
        source: 'Beispieldaten (Backend offline)'
    },
    {
        severity: 'warning',
        title: 'Wetterwarnung: Dauerregen & Starkwind am Freitag',
        description: 'Mögliche Beeinträchtigung der Dachabdichtungsarbeiten. Vorkehrungen zur Baustellensicherung treffen.',
        draftType: 'delay',
        source: 'Beispieldaten (Backend offline)'
    }
];

const FALLBACK_DRAFTS: DraftItem[] = [
    {
        id: 'demo-1',
        title: 'Behinderungsanzeige § 6 Abs. 1 VOB/B (Fehlende TGA-Ausführungspläne)',
        category: 'Behinderungsanzeige',
        date: 'Heute, 09:15',
        status: 'Entwurf'
    },
    {
        id: 'demo-2',
        title: 'Bedenkenanmeldung (Feuchtigkeit in Untergeschoss-Sohle vor Estrich)',
        category: 'Bedenkenanmeldung',
        date: 'Gestern, 16:30',
        status: 'Freigegeben'
    }
];

function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
    const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('de-DE', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
}

function noticeToDraft(n: NoticeOut): DraftItem {
    const status = (['Entwurf', 'Freigegeben', 'Exportiert'].includes(n.status) ? n.status : 'Entwurf') as DraftItem['status'];
    return {
        id: `notice-${n.id}`,
        noticeId: n.id,
        title: n.title || n.subject || `${TYPE_LABELS[n.type]} #${n.id}`,
        category: TYPE_LABELS[n.type] ?? n.type,
        date: formatDate(n.updated_at || n.created_at),
        status
    };
}

export const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useLanguage();
  const userName = localStorage.getItem('userName') || t('role_site_manager');
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);

    const [quickNote, setQuickNote] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const [dashboard, setDashboard] = useState<DashboardData | null>(null);
    const [drafts, setDrafts] = useState<DraftItem[]>(FALLBACK_DRAFTS);
    const [reportStatus, setReportStatus] = useState<'open' | 'draft' | 'done' | null>(null);
    const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

    const loadData = async () => {
        const [dash, notices, report] = await Promise.allSettled([
            api.getDashboard(projectId),
            api.listNotices(projectId),
            api.getReport(todayIso(), projectId)
        ]);

        if (dash.status === 'fulfilled') setDashboard(dash.value);
        else {
            console.warn('Dashboard-Fallback:', dash.reason);
            setDashboard(null);
        }

        if (notices.status === 'fulfilled') setDrafts(notices.value.map(noticeToDraft));
        else setDrafts(FALLBACK_DRAFTS);

        if (report.status === 'fulfilled') {
            const r = report.value;
            setReportStatus(r.id == null ? 'open' : r.status === 'draft' ? 'draft' : 'done');
        } else setReportStatus(null);

        setBackendOnline(dash.status === 'fulfilled' || notices.status === 'fulfilled');
    };

    useEffect(() => {
        loadData();
    }, [projectId]);

    const goToDraft = (state: DraftNavState) => navigate('/drafts', {state});

    // ---- Diktat: echte Aufnahme → /api/transcribe ----
    const handleMicToggle = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            alert('Mikrofon wird von diesem Browser nicht unterstützt (HTTPS nötig). Bitte Text eintippen.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                stream.getTracks().forEach((track) => track.stop());
                const blob = new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'});
                setIsTranscribing(true);
                try {
                    const res = await api.transcribeAudio(blob, 'de');
                    if (res.text.trim()) {
                        setQuickNote((prev) => (prev ? `${prev} ${res.text.trim()}` : res.text.trim()));
                    } else {
                        alert('Transkription gerade nicht verfügbar (kein KI-Key / offline). Bitte Text eintippen.');
                    }
                } catch (err) {
                    console.warn('Transkription fehlgeschlagen:', err);
                    alert('Transkription fehlgeschlagen. Bitte Text eintippen.');
                } finally {
                    setIsTranscribing(false);
                }
            };
            mediaRecorderRef.current = recorder;
            recorder.start();
            setIsRecording(true);
        } catch (err) {
            console.warn('Mikrofon-Zugriff verweigert:', err);
            alert('Kein Zugriff auf das Mikrofon. Bitte Text eintippen.');
        }
    };

    // ---- Schnellerfassung → /api/capture → Entwurf öffnen ----
    const handleGenerateDraft = async () => {
        const text = quickNote.trim();
        if (!text) return;

        setIsGenerating(true);
        try {
            const draft = await api.captureText({text, project_id: projectId});
            setQuickNote('');
            if (draft.notice_id) {
                goToDraft({noticeId: draft.notice_id});
            } else {
                goToDraft({type: draft.type, keywords: text});
            }
        } catch (err) {
            console.warn('Capture-Fallback:', err);
            goToDraft({keywords: text});
        } finally {
            setIsGenerating(false);
        }
    };

    const handleExport = async (draft: DraftItem) => {
        if (!draft.noticeId || draft.status === 'Entwurf') {
            // Export nur nach Freigabe – Freigabe passiert bewusst im Brief-Editor.
            goToDraft(draft.noticeId ? {noticeId: draft.noticeId} : {});
            return;
        }
        try {
            const blob = await api.downloadExport(draft.noticeId, 'docx');
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `VOB_${draft.noticeId}_${activeProject.number || projectId}.docx`;
            link.click();
            URL.revokeObjectURL(url);
            loadData();
        } catch (err: any) {
            alert(err?.message || 'Export fehlgeschlagen');
        }
    };

    const alerts = dashboard ? dashboard.alerts : FALLBACK_ALERTS;
    const kpis = dashboard?.kpis;
    const openDrafts = kpis?.openDrafts ?? drafts.filter((d) => d.status === 'Entwurf').length;
    const criticalAlerts = kpis?.criticalAlerts ?? alerts.filter((a) => a.severity === 'critical').length;

    const reportLabel =
        reportStatus === 'done' ? 'Erledigt' : reportStatus === 'draft' ? 'Entwurf' : reportStatus === 'open' ? '1 Offen' : '–';

    return (
        <>
            {/* Welcome Hero Banner */}
            <section className="welcome-hero">
                <div>
                    <h1 className="welcome-title">{t('dash_hello')}, {userName}!</h1>
                    <p className="welcome-desc">
                        {t('hdr_active_project')} <strong>{activeProject.name}</strong> ({activeProject.number}) •
                        {t('dash_phase')}: {activeProject.phase}
                    </p>
                    {backendOnline === false && (
                        <p className="welcome-desc" style={{fontSize: '12px', opacity: 0.85}}>
                            ⚠️ Backend nicht erreichbar – es werden Beispieldaten angezeigt.
                        </p>
                    )}
                </div>
                <div className="hero-stats">
                    <div className="hero-stat-card">
                        <div className="hero-stat-number">{alerts.length}</div>
                        <div className="hero-stat-label">{t('dash_stat_deadlines')}</div>
                    </div>
                    <div className="hero-stat-card">
                        <div className="hero-stat-number">{openDrafts}</div>
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
                        <div className="kpi-value">{reportLabel}</div>
                        <div className="kpi-sub">{t('dash_kpi_diary_sub')}</div>
                    </div>
                    <div className="kpi-icon" style={{backgroundColor: '#eff6ff', color: '#2563eb'}}>
                        <FileText size={24}/>
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
                        <div className="kpi-value">{criticalAlerts} Alerts</div>
                        <div className="kpi-sub alert">
                            {kpis ? `Verzug ${kpis.delayDays.toLocaleString('de-DE')} AT • SPI ${kpis.spi.toLocaleString('de-DE')}` : t('dash_kpi_alerts_sub')}
                        </div>
                    </div>
                    <div className="kpi-icon" style={{backgroundColor: '#fef2f2', color: '#dc2626'}}>
                        <AlertTriangle size={24}/>
                    </div>
                </div>

                <div className="kpi-card" onClick={() => navigate('/drafts')} style={{cursor: 'pointer'}}>
                    <div>
                        <div className="kpi-label">{t('dash_kpi_drafts')}</div>
                        <div className="kpi-value">{openDrafts} Offen</div>
                        <div className="kpi-sub">{t('dash_kpi_drafts_sub')}</div>
                    </div>
                    <div className="kpi-icon" style={{backgroundColor: '#f0fdf4', color: '#16a34a'}}>
                        <Mail size={24}/>
                    </div>
                </div>

                <div className="kpi-card">
                    <div>
                        <div className="kpi-label">{t('dash_kpi_workers')}</div>
                        <div className="kpi-value">
                            {kpis ? (kpis.workersToday != null ? `${kpis.workersToday} Personen` : '–') : '34 Personen'}
                        </div>
                        <div className="kpi-sub">{t('dash_kpi_workers_sub')}</div>
                    </div>
                    <div className="kpi-icon" style={{backgroundColor: '#f8fafc', color: '#475569'}}>
                        <Users size={24}/>
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
                                <Sparkles size={20} color="#2563eb"/>
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
                                    disabled={isTranscribing}
                                >
                                    <Mic size={16}/>
                                    <span>
                                        {isTranscribing ? 'Transkribiere…' : isRecording ? t('dash_mic_running') : t('dash_mic_start')}
                                    </span>
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
                                    disabled={!quickNote.trim() || isGenerating}
                                >
                                    <Sparkles size={16}/>
                                    <span>{isGenerating ? 'KI erstellt Entwurf…' : t('dash_btn_gen_draft')}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Deviations & Critical Alerts */}
                    <div className="panel">
                        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 className="panel-title">
                                <AlertTriangle size={20} color="#dc2626"/>
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
                            {alerts.length === 0 && (
                                <div className="alert-item" style={{borderLeftColor: '#16a34a'}}>
                                    <div className="alert-content">
                                        <div className="alert-title">Keine Abweichungen erkannt</div>
                                        <div className="alert-desc">Alle Vorgänge liegen im Plan.</div>
                                    </div>
                                </div>
                            )}
                            {alerts.map((a, idx) => (
                                <div key={`${a.title}-${idx}`} className={`alert-item ${a.severity === 'critical' ? '' : 'warning'}`}>
                                    <span className={`badge ${a.severity === 'critical' ? 'badge-danger' : 'badge-warning'}`}>
                                        {a.severity === 'critical' ? t('status_urgent') : t('status_warning')}
                                    </span>
                                    <div className="alert-content">
                                        <div className="alert-title">{a.title}</div>
                                        <div className="alert-desc">{a.description}</div>
                                        <div className="alert-desc" style={{fontSize: '11px', opacity: 0.75}}>
                                            🔍 Quelle: {a.source}
                                        </div>
                                        <span
                                            className="alert-action-link"
                                            onClick={() => goToDraft({type: a.draftType, keywords: `${a.title}. ${a.description}`})}
                                        >
                    → {t(`drafts_type_${a.draftType}`)}
                  </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Column: Drafts & Human-in-the-Loop Review */}
                <div>
                    <div className="panel">
                        <div className="panel-header">
                            <h2 className="panel-title">
                                <Clock size={20} color="#2563eb"/>
                                <span>{t('dash_drafts_title')}</span>
                            </h2>
                        </div>

                        <div className="docs-list">
                            {drafts.length === 0 && (
                                <div className="doc-meta" style={{padding: '8px'}}>Noch keine Entwürfe für dieses Projekt.</div>
                            )}
                            {drafts.slice(0, 8).map((draft) => (
                                <div key={draft.id} className="doc-item">
                                    <div
                                        className="doc-info"
                                        style={{cursor: draft.noticeId ? 'pointer' : 'default'}}
                                        onClick={() => draft.noticeId && goToDraft({noticeId: draft.noticeId})}
                                    >
                                        <FileText size={20} className="doc-icon"/>
                                        <div>
                                            <div className="doc-title">{draft.title}</div>
                                            <div className="doc-meta">
                                                {draft.category} • {draft.date}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="doc-actions">
                                        <span className="doc-status-badge">
                      {draft.status === 'Entwurf' ? t('status_draft') : t('status_approved')}
                    </span>
                                        <button
                                            className="doc-btn"
                                            title={draft.status === 'Entwurf' ? 'Prüfen & freigeben' : t('btn_word_export')}
                                            onClick={() => handleExport(draft)}
                                        >
                                            <FileDown size={14}/>
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
                        <CheckCircle2 size={20} style={{flexShrink: 0, marginTop: '2px'}}/>
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
