import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Calendar,
  CloudSun,
  Users,
  AlertTriangle,
  Sparkles,
  Mic,
  Copy,
  Plus,
  CheckCircle2,
  Printer,
  History,
  X,
  BookOpen,
  Mail,
  ListTodo
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import {
  getDiaryEntriesForProject,
  saveProjectDocument,
  getDocumentSummary,
  ProjectDocumentItem
} from '../context/ProjectDocuments';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../services/api';
import '@frontend/src/index.css';
import './DailyReports.css';

export const DailyReports: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { activeProject } = useProjects();
  const userName = localStorage.getItem('userName') || t('role_site_manager');

  // History of diary entries for the current project
  const [diaryHistory, setDiaryHistory] = useState<ProjectDocumentItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPastDoc, setSelectedPastDoc] = useState<ProjectDocumentItem | null>(null);
  const [modalTab, setModalTab] = useState<'summary' | 'raw'>('summary');
  const [referencedDoc, setReferencedDoc] = useState<ProjectDocumentItem | null>(null);

  // New diary entry form state
  const [reportNumber, setReportNumber] = useState('143');
  const [reportDate, setReportDate] = useState('21.11.2026');
  const [weather, setWeather] = useState('9°C, bedeckt, windstill');
  const [workforceCount, setWorkforceCount] = useState<number>(34);
  const [trades, setTrades] = useState<string[]>([
    'Rohbau (Fa. BetonTech)',
    'Tiefbau (Fa. Erd & Grund)',
    'TGA (Fa. Elektro-Klima)',
    'Zimmerer'
  ]);
  const [newTradeInput, setNewTradeInput] = useState('');
  const [progressText, setProgressText] = useState(
    'Bewehrung der Decke über 1. OG Bauteil B fertiggestellt. Abnahme durch Prüfstatiker Dr. Lang für 15:30 Uhr vorbereitet. Betonage für kommenden Werktag gesichert.'
  );
  const [hindranceText, setHindranceText] = useState(
    'Fortführung: Hydraulikdefekt an Kettenbagger 24t behoben, Schacht 3 weiterhin durch fehlende TGA-Pläne blockiert.'
  );
  const [deliveriesText, setDeliveriesText] = useState(
    '2x Sattelzug Betonstahl B500B (24t) angeliefert und auf Baulos B zwischengelagert.'
  );

  // Dictation simulation state
  const [isRecording, setIsRecording] = useState(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState(false);

  // Load project diary entries whenever project changes or custom event fires
  const loadHistory = async () => {
    const localEntries = getDiaryEntriesForProject(activeProject.id);
    let combined = [...localEntries];

    try {
      const backendNotes = await api.listSiteNotes(Number(activeProject.id));
      if (backendNotes && backendNotes.length > 0) {
        const mappedNotes: ProjectDocumentItem[] = backendNotes.map((bn) => ({
          id: `backend-note-${bn.id}`,
          projectId: bn.project_id,
          type: 'diary',
          title: `Tagebuchnotiz #${bn.id} (${bn.category || 'allgemein'})`,
          date: new Date(bn.created_at).toLocaleDateString('de-DE'),
          authorOrSender: bn.author || userName,
          content: bn.content,
          trades: ['Bautagebuch'],
          hindrance: bn.category === 'delay' || bn.category === 'incident' ? bn.content : undefined
        }));

        const existingIds = new Set(combined.map((c) => c.id));
        mappedNotes.forEach((mn) => {
          if (!existingIds.has(mn.id)) {
            combined.push(mn);
          }
        });
      }
    } catch (err) {
      console.warn('Backend listSiteNotes Fallback:', err);
    }

    setDiaryHistory(combined);

    // Auto-calculate next report number based on history
    if (combined.length > 0) {
      const match = combined[0].title.match(/Nr\.\s*(\d+)/i);
      if (match && match[1]) {
        const nextNum = parseInt(match[1], 10) + 1;
        setReportNumber(String(nextNum));
      }
    }
  };

  useEffect(() => {
    loadHistory();

    const handleUpdate = () => {
      loadHistory();
    };
    window.addEventListener('project-documents-updated', handleUpdate);
    return () => window.removeEventListener('project-documents-updated', handleUpdate);
  }, [activeProject.id]);

  // Filter history by search term
  const filteredHistory = diaryHistory.filter((item) => {
    if (!searchTerm.trim()) return true;
    const query = searchTerm.toLowerCase();
    return (
      item.title.toLowerCase().includes(query) ||
      item.content.toLowerCase().includes(query) ||
      item.date.includes(query) ||
      item.authorOrSender.toLowerCase().includes(query)
    );
  });

  // Action: Adopt workforce & trades from previous entry ("Werte von gestern übernehmen")
  const handleAdoptFromPastEntry = (pastDoc: ProjectDocumentItem) => {
    if (pastDoc.weather) setWeather(pastDoc.weather);
    if (pastDoc.workforceCount) setWorkforceCount(pastDoc.workforceCount);
    if (pastDoc.trades && pastDoc.trades.length > 0) {
      setTrades([...pastDoc.trades]);
    }
    setReferencedDoc(pastDoc);
  };

  // Action: Adopt and continue yesterday's hindrance
  const handleContinueHindrance = (pastDoc: ProjectDocumentItem) => {
    const pastHindrance = pastDoc.hindrance || 'Behinderung aus ' + pastDoc.title;
    setHindranceText(`Fortführung aus ${pastDoc.title} (${pastDoc.date}):\n${pastHindrance}\nStatus heute: `);
    setReferencedDoc(pastDoc);
  };

  // Action: Add new trade
  const handleAddTrade = () => {
    if (newTradeInput.trim() && !trades.includes(newTradeInput.trim())) {
      setTrades([...trades, newTradeInput.trim()]);
      setNewTradeInput('');
    }
  };

  const handleRemoveTrade = (tradeToRemove: string) => {
    setTrades(trades.filter((t) => t !== tradeToRemove));
  };

  // Action: Audio dictation toggle
  const handleToggleMic = () => {
    if (!isRecording) {
      setIsRecording(true);
      setTimeout(() => {
        setProgressText(
          (prev) =>
            prev +
            ' [Diktat hinzugefügt 14:15 Uhr]: Betonageabschnitt 2 vorbereitet, Rüttler und Glätter einsatzbereit. Elektriker haben Leerohre im Deckenbereich termingerecht verlegt.'
        );
        setIsRecording(false);
      }, 2000);
    } else {
      setIsRecording(false);
    }
  };

  // Action: Save new entry to project documents & backend site notes
  const handleSaveReport = async () => {
    const title = `Bautagesbericht Nr. ${reportNumber} — ${progressText.slice(0, 35)}...`;
    const fullContent = `Bautagesbericht Nr. ${reportNumber} — Datum: ${reportDate}
Projekt: ${activeProject.name} (${activeProject.number})
Bauleiter: ${userName}
Wetter: ${weather}
Personal: ${workforceCount} Fachkräfte (${trades.join(', ')})

Tagesleistung & Arbeitsfortschritt:
${progressText}

${hindranceText ? `Vorkommnisse & VOB-relevante Behinderungen:\n${hindranceText}\n` : ''}
${deliveriesText ? `Lieferungen, Abnahmen & Prüfungen:\n${deliveriesText}\n` : ''}
${referencedDoc ? `[Bezug auf Vorbericht: ${referencedDoc.title} (${referencedDoc.date})]` : ''}`.trim();

    const newDoc: ProjectDocumentItem = {
      id: `doc-${activeProject.id}-d${Date.now()}`,
      projectId: activeProject.id,
      type: 'diary',
      title,
      date: reportDate,
      authorOrSender: userName,
      weather,
      workforceCount,
      trades,
      hindrance: hindranceText,
      content: fullContent
    };

    saveProjectDocument(newDoc);

    try {
      await api.createSiteNote({
        project_id: Number(activeProject.id),
        content: fullContent,
        category: hindranceText ? 'incident' : 'progress',
        author: userName
      });
    } catch (err) {
      console.warn('Backend createSiteNote Fallback:', err);
    }

    loadHistory();
    setSavedSuccessMsg(true);
    setTimeout(() => setSavedSuccessMsg(false), 4000);
  };

  return (
    <div className="reports-container">
      {/* Top Banner */}
      <section className="reports-header-card">
        <div className="reports-title-area">
          <div className="reports-icon-badge">
            <FileText size={26} />
          </div>
          <div>
            <h1 className="reports-title">{t('rep_title')}</h1>
            <p className="reports-subtitle">
              {t('rep_sub')} <strong>{activeProject.name}</strong> ({activeProject.number}) • {t('rep_author')} {userName}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/summary')}
            title={t('sum_title')}
          >
            <BookOpen size={16} />
            <span>{t('nav_summary')}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveReport}
          >
            <CheckCircle2 size={16} />
            <span>{t('rep_btn_save_report')}</span>
          </button>
        </div>
      </section>

      {/* Success Notification */}
      {savedSuccessMsg && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 'var(--radius-md)',
            color: '#166534',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span>
            ✓ {activeProject.name}: {t('rep_btn_save_report')}
          </span>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '11px', padding: '3px 8px' }}
            onClick={() => setSavedSuccessMsg(false)}
          >
            {t('btn_close')}
          </button>
        </div>
      )}

      {/* Main Grid: Left Side History / Previous Entries, Right Side Editor */}
      <div className="reports-grid">
        {/* Left Column: ALL PREVIOUS ENTRIES FOR THIS PROJECT */}
        <div className="history-panel">
          <div className="history-header">
            <span className="history-title">
              <History size={18} color="var(--color-primary)" />
              <span>{t('rep_history_title')}</span>
            </span>
            <span className="history-badge">
              {diaryHistory.length}
            </span>
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            {t('rep_history_sub')} <strong>{activeProject.name}</strong>:
          </p>

          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="history-search-input"
              placeholder={t('search_placeholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {filteredHistory.length === 0 ? (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                fontSize: '13px',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--color-slate-50)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-light)'
              }}
            >
              {t('rep_history_empty')}
            </div>
          ) : (
            <div className="history-list">
              {filteredHistory.map((item) => {
                const isReferenced = referencedDoc?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`history-item ${isReferenced ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedPastDoc(item);
                      setModalTab('summary');
                    }}
                    title={t('rep_btn_show_summary')}
                  >
                    <div className="history-item-top">
                      <span className="history-item-title">{item.title}</span>
                      <span className="history-item-date">
                        <Calendar size={11} />
                        {item.date}
                      </span>
                    </div>

                    <div className="history-item-meta">
                      {item.workforceCount && (
                        <span>
                          <Users size={11} style={{ display: 'inline', marginRight: '3px' }} />
                          {item.workforceCount}
                        </span>
                      )}
                      {item.weather && (
                        <span>
                          <CloudSun size={11} style={{ display: 'inline', marginRight: '3px' }} />
                          {item.weather.split(',')[0]}
                        </span>
                      )}
                    </div>

                    <div className="history-item-snippet">{item.content}</div>

                    {item.hindrance && (
                      <div className="history-item-hindrance">
                        ⚠️ <strong>{t('cap_cat_hindrance')}:</strong> {item.hindrance}
                      </div>
                    )}

                    {/* Quick Access Action Buttons */}
                    <div className="history-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="history-btn-small"
                        style={{ color: 'var(--color-primary)', fontWeight: 600, backgroundColor: '#eff6ff', borderColor: '#bfdbfe' }}
                        onClick={() => {
                          setSelectedPastDoc(item);
                          setModalTab('summary');
                        }}
                        title={t('rep_btn_show_summary')}
                      >
                        <Sparkles size={11} />
                        <span>{t('rep_btn_show_summary')}</span>
                      </button>

                      <button
                        type="button"
                        className="history-btn-small"
                        onClick={() => handleAdoptFromPastEntry(item)}
                        title={t('rep_btn_adopt_trades')}
                      >
                        <Copy size={11} />
                        <span>{t('rep_btn_adopt_trades')}</span>
                      </button>

                      {item.hindrance && (
                        <button
                          type="button"
                          className="history-btn-small"
                          style={{ color: '#b45309' }}
                          onClick={() => handleContinueHindrance(item)}
                          title={t('rep_btn_continue_hindrance')}
                        >
                          <AlertTriangle size={11} />
                          <span>{t('rep_btn_continue_hindrance')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: NEW DIARY ENTRY FORM */}
        <div className="editor-panel">
          <div className="editor-header">
            <div className="editor-title">
              <FileText size={20} color="var(--color-primary)" />
              <span>{t('rep_editor_title')}</span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className={`history-btn-small ${isRecording ? 'active' : ''}`}
                style={{
                  backgroundColor: isRecording ? '#fee2e2' : 'white',
                  color: isRecording ? '#dc2626' : 'var(--color-slate-700)',
                  borderColor: isRecording ? '#f87171' : 'var(--border-light)'
                }}
                onClick={handleToggleMic}
              >
                <Mic size={13} />
                <span>{isRecording ? t('dash_mic_running') : t('dash_mic_start')}</span>
              </button>

              <button
                type="button"
                className="history-btn-small"
                onClick={() => window.print()}
                title={t('btn_print')}
              >
                <Printer size={13} />
                <span>{t('btn_print')}</span>
              </button>
            </div>
          </div>

          {/* Reference Banner if a past entry was adopted */}
          {referencedDoc && (
            <div className="reference-banner">
              <div className="reference-text">
                ✓ <strong>{referencedDoc.title}</strong> ({referencedDoc.date})
              </div>
              <button
                type="button"
                onClick={() => setReferencedDoc(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1e40af' }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Key Report Metadata */}
          <div className="editor-row">
            <div className="form-group">
              <label className="form-label">{t('rep_form_report_nr')}</label>
              <input
                type="text"
                className="form-input"
                value={reportNumber}
                onChange={(e) => setReportNumber(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('rep_form_date')}</label>
              <input
                type="text"
                className="form-input"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('rep_form_weather')}</label>
              <input
                type="text"
                className="form-input"
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('rep_form_workforce')}</label>
              <input
                type="number"
                className="form-input"
                value={workforceCount}
                onChange={(e) => setWorkforceCount(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Trades & Subcontractors Present */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label className="form-label" style={{ margin: 0 }}>
                {t('rep_form_trades')} ({trades.length})
              </label>
              {diaryHistory.length > 0 && (
                <button
                  type="button"
                  className="history-btn-small"
                  onClick={() => handleAdoptFromPastEntry(diaryHistory[0])}
                  title={t('rep_btn_copy_from_last')}
                >
                  <Copy size={11} />
                  <span>{t('rep_btn_copy_from_last')}</span>
                </button>
              )}
            </div>

            <div className="trades-chips">
              {trades.map((trade) => (
                <span key={trade} className="trade-chip">
                  <span>{trade}</span>
                  <X size={12} className="trade-chip-remove" onClick={() => handleRemoveTrade(trade)} />
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1 }}
                placeholder="Gewerk..."
                value={newTradeInput}
                onChange={(e) => setNewTradeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTrade();
                  }
                }}
              />
              <button type="button" className="btn btn-secondary" onClick={handleAddTrade}>
                <Plus size={14} />
                <span>+</span>
              </button>
            </div>
          </div>

          {/* Progress / Work Done */}
          <div className="form-group">
            <label className="form-label">{t('rep_form_progress')}</label>
            <textarea
              className="form-textarea"
              rows={4}
              value={progressText}
              onChange={(e) => setProgressText(e.target.value)}
              placeholder="Arbeiten..."
            />
          </div>

          {/* Hindrances, Delays & VOB Alerts */}
          <div className="hindrance-card">
            <div className="hindrance-card-header">
              <AlertTriangle size={18} />
              <span>{t('rep_form_hindrance')}</span>
            </div>
            <textarea
              className="form-textarea"
              style={{ backgroundColor: 'white', borderColor: '#fde68a' }}
              rows={3}
              value={hindranceText}
              onChange={(e) => setHindranceText(e.target.value)}
              placeholder="Behinderungen..."
            />
            {hindranceText.trim() && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '12px', padding: '6px 12px', backgroundColor: '#b45309' }}
                  onClick={() => navigate('/drafts')}
                >
                  <Mail size={14} />
                  <span>{t('rep_btn_create_vob_from_hindrance')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Deliveries & Inspections */}
          <div className="form-group">
            <label className="form-label">{t('rep_form_deliveries')}</label>
            <textarea
              className="form-textarea"
              rows={2}
              value={deliveriesText}
              onChange={(e) => setDeliveriesText(e.target.value)}
              placeholder="Lieferungen..."
            />
          </div>

          {/* Save & Action Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-light)' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setProgressText('');
                setHindranceText('');
                setDeliveriesText('');
                setReferencedDoc(null);
              }}
            >
              {t('btn_clear')}
            </button>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/summary')}
              >
                <Sparkles size={16} />
                <span>{t('nav_summary')}</span>
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveReport}
              >
                <CheckCircle2 size={16} />
                <span>{t('rep_btn_save_report')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Full View & Associated Summary of a Previous Diary Entry */}
      {selectedPastDoc && (() => {
        const docSummary = getDocumentSummary(selectedPastDoc);
        return (
          <div className="modal-overlay" onClick={() => setSelectedPastDoc(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '780px' }}>
              <div className="modal-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="badge badge-info" style={{ fontSize: '11px' }}>
                      {modalTab === 'summary' ? 'KI-Zusammenfassung' : 'Originalbericht'}
                    </span>
                    <h3 style={{ margin: 0, fontSize: '17px', color: 'var(--color-slate-900)' }}>
                      {selectedPastDoc.title}
                    </h3>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Erstellt am <strong>{selectedPastDoc.date}</strong> von <strong>{selectedPastDoc.authorOrSender}</strong> • Bauprojekt: {activeProject.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPastDoc(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  title="Schließen"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Tabs */}
              <div className="modal-tabs">
                <button
                  type="button"
                  className={`modal-tab-btn ${modalTab === 'summary' ? 'active' : ''}`}
                  onClick={() => setModalTab('summary')}
                >
                  <Sparkles size={14} />
                  <span>{t('rep_modal_tab_summary')}</span>
                </button>

                <button
                  type="button"
                  className={`modal-tab-btn ${modalTab === 'raw' ? 'active' : ''}`}
                  onClick={() => setModalTab('raw')}
                >
                  <FileText size={14} />
                  <span>{t('rep_modal_tab_raw')}</span>
                </button>
              </div>

              {/* TAB 1: STRUCTURED SUMMARY FOR THIS DAY */}
              {modalTab === 'summary' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Executive Summary */}
                  <div className="summary-block">
                    <span className="summary-block-title">
                      <Sparkles size={16} color="var(--color-primary)" />
                      <span>{t('rep_modal_exec_title')}</span>
                    </span>
                    <ul className="summary-block-list">
                      {docSummary.executiveSummary.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Key Decisions */}
                  {docSummary.keyDecisions && docSummary.keyDecisions.length > 0 && (
                    <div className="summary-block">
                      <span className="summary-block-title">
                        <CheckCircle2 size={16} color="#16a34a" />
                        <span>{t('rep_modal_decisions_title')}</span>
                      </span>
                      <ul className="summary-block-list">
                        {docSummary.keyDecisions.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Action Items */}
                  {docSummary.actionItems && docSummary.actionItems.length > 0 && (
                    <div className="summary-block">
                      <span className="summary-block-title">
                        <ListTodo size={16} color="#2563eb" />
                        <span>{t('rep_modal_actions_title')} ({docSummary.actionItems.length})</span>
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {docSummary.actionItems.map((act) => (
                          <div
                            key={act.id}
                            style={{
                              backgroundColor: 'white',
                              border: '1px solid var(--border-light)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '8px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '12px',
                              gap: '8px'
                            }}
                          >
                            <div>
                              <strong style={{ color: act.done ? 'var(--text-muted)' : 'var(--color-slate-900)' }}>
                                {act.task}
                              </strong>
                              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {act.responsible} • {act.deadline}
                              </div>
                            </div>
                            <span
                              className={`badge ${
                                act.priority === 'Hoch'
                                  ? 'badge-danger'
                                  : act.priority === 'Mittel'
                                  ? 'badge-warning'
                                  : 'badge-info'
                              }`}
                              style={{ fontSize: '10px' }}
                            >
                              {act.priority}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* VOB Risks */}
                  {docSummary.vobRisks && docSummary.vobRisks.length > 0 && (
                    <div
                      style={{
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 'var(--radius-md)',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#92400e', fontWeight: 700, fontSize: '13px' }}>
                        <AlertTriangle size={16} />
                        <span>{t('rep_modal_risks_title')}</span>
                      </div>
                      {docSummary.vobRisks.map((risk, idx) => (
                        <div key={idx} style={{ fontSize: '12px', color: '#78350f', lineHeight: 1.4 }}>
                          <strong>{risk.title}:</strong> {risk.description}
                          <div style={{ marginTop: '4px', fontStyle: 'italic', color: '#92400e' }}>
                            💡 {risk.recommendation}
                          </div>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ fontSize: '11px', padding: '4px 10px', backgroundColor: '#b45309' }}
                          onClick={() => navigate('/drafts')}
                        >
                          <Mail size={12} />
                          <span>{t('drafts_btn_generate')}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    🔍 {docSummary.traceabilityNotes}
                  </div>
                </div>
              )}

              {/* TAB 2: ORIGINAL RAW REPORT TEXT */}
              {modalTab === 'raw' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '13px', backgroundColor: 'var(--color-slate-50)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
                    {selectedPastDoc.weather && (
                      <div>
                        <strong>Wetter:</strong> {selectedPastDoc.weather}
                      </div>
                    )}
                    {selectedPastDoc.workforceCount && (
                      <div>
                        <strong>Fachkräfte:</strong> {selectedPastDoc.workforceCount}
                      </div>
                    )}
                  </div>

                  {selectedPastDoc.trades && selectedPastDoc.trades.length > 0 && (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate-700)', marginBottom: '4px' }}>
                        Anwesende Gewerke:
                      </div>
                      <div className="trades-chips">
                        {selectedPastDoc.trades.map((t) => (
                          <span key={t} className="trade-chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate-700)', marginBottom: '4px' }}>
                      Vollständiger Berichtstext:
                    </div>
                    <pre
                      style={{
                        backgroundColor: 'var(--color-slate-900)',
                        color: 'var(--color-slate-100)',
                        padding: '14px',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '12px',
                        lineHeight: '1.6',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'monospace',
                        maxHeight: '260px',
                        overflowY: 'auto'
                      }}
                    >
                      {selectedPastDoc.content}
                    </pre>
                  </div>

                  {selectedPastDoc.hindrance && (
                    <div className="history-item-hindrance" style={{ padding: '8px 12px' }}>
                      <strong>VOB-Relevante Behinderung:</strong>
                      <div>{selectedPastDoc.hindrance}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Modal Footer Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-light)', flexWrap: 'wrap', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    handleAdoptFromPastEntry(selectedPastDoc);
                    setSelectedPastDoc(null);
                  }}
                >
                  <Copy size={14} />
                  <span>{t('rep_btn_adopt_trades')}</span>
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setSelectedPastDoc(null);
                      navigate('/summary');
                    }}
                  >
                    <BookOpen size={14} />
                    <span>{t('rep_modal_btn_open_summary')}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setSelectedPastDoc(null)}
                  >
                    <span>{t('btn_close')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default DailyReports;
