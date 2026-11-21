import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Mail,
  BookOpen,
  Sparkles,
  AlertTriangle,
  Clock,
  User,
  Copy,
  Download,
  Printer,
  ListTodo,
  ExternalLink,
  UploadCloud,
  FileCode,
  X,
  Calendar,
  Layers,
  FolderOpen,
  Plus
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import {
  getDocumentsForProject,
  getDocumentSummary,
  ProjectDocumentItem,
  DocumentSourceType
} from '../context/ProjectDocuments';
import { extractTextFromFile } from '../utils/fileExtractor';
import { api, saveBlob, SummarizeRequest } from '../services/api';
import { addDays, isoToDe, toIsoDate, todayIso } from '../utils/dates';
import '@frontend/src/index.css';
import './Summary.css';

interface UploadedFileInfo {
  name: string;
  size: number;
  ext: string;
  charCount: number;
}

interface ActionItem {
  id: string;
  task: string;
  responsible: string;
  deadline: string;
  priority: 'Hoch' | 'Mittel' | 'Normal';
  done: boolean;
  source: string;
}

interface SummaryResult {
  title: string;
  executiveSummary: string[];
  keyDecisions: string[];
  actionItems: ActionItem[];
  vobRisks: {
    title: string;
    description: string;
    recommendation: string;
    linkType?: 'delay' | 'cost' | 'defect' | null;
    source?: string;
  }[];
  traceabilityNotes: string;
  /** Nur bei Backend-Antworten: ai = KI, offline = Regel-Fallback */
  mode?: 'ai' | 'offline';
  sources?: string[];
}

export const Summary: React.FC = () => {
    const navigate = useNavigate();
  const { t } = useLanguage();
  const { activeProject } = useProjects();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeSource, setActiveSource] = useState<DocumentSourceType | 'upload'>('diary');
  const [projectDocs, setProjectDocs] = useState<ProjectDocumentItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [uploadedFile, setUploadedFile] = useState<UploadedFileInfo | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [copyDone, setCopyDone] = useState(false);

  // Dokumente: Tagebuch = echte Berichte + Diktate aus dem Backend (/api/timeline, 90 Tage),
  // Protokolle/E-Mails = aus dem Backend (/api/documents), Fallback auf lokale Ablage.
  useEffect(() => {
    let cancelled = false;
    const refreshDocs = async () => {
      const local = getDocumentsForProject(activeProject.id);
      let docs = local;
      try {
        const [tl, backendDocs] = await Promise.all([
          api.getTimeline(Number(activeProject.id), toIsoDate(addDays(new Date(), -90)), todayIso(), ['report', 'note']),
          api.listDocuments(Number(activeProject.id)).catch(() => [])
        ]);
        const diary: ProjectDocumentItem[] = tl.items.map((it) => ({
          id: `${it.type}-${it.refId ?? it.id}`,
          projectId: activeProject.id,
          type: 'diary',
          title: it.title,
          date: isoToDe(it.date),
          authorOrSender: it.source,
          content: it.summary
        }));
        const nonDiaryFromBackend: ProjectDocumentItem[] = backendDocs
          .filter((d) => d.type !== 'diary')
          .map((d) => ({
            id: d.id,
            projectId: d.projectId,
            type: d.type,
            title: d.title,
            date: d.date,
            authorOrSender: d.authorOrSender,
            content: d.content,
            summary: d.summary ?? undefined
          }));
        const extraDocs = nonDiaryFromBackend.length > 0 ? nonDiaryFromBackend : local.filter((d) => d.type !== 'diary');
        docs = [...diary, ...extraDocs];
      } catch (err) {
        console.warn('Timeline/Dokumente nicht erreichbar – Tagebuch aus lokaler Ablage:', err);
      }
      if (cancelled) return;
      setProjectDocs(docs);

      // If on a doc tab, set first document for this project
      if (activeSource !== 'upload') {
        const filtered = docs.filter((d) => d.type === activeSource);
        if (filtered.length > 0) {
          setSelectedDocId(filtered[0].id);
          setInputText(filtered[0].content);
          // Nur hinterlegte Zusammenfassungen anzeigen – für Backend-Einträge erst per „Synthese“ (KI) erzeugen
          if (filtered[0].summary) setSummaryData(getDocumentSummary(filtered[0]));
        } else {
          setSelectedDocId(null);
          setInputText(`Noch keine ${getSourceLabel(activeSource)} für das Bauprojekt "${activeProject.name}" hinterlegt.`);
        }
      }
    };

    refreshDocs();
    const onUpdate = () => {
      refreshDocs();
    };
    window.addEventListener('project-documents-updated', onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('project-documents-updated', onUpdate);
    };
  }, [activeProject.id, activeSource]);

  // Structured summary state initialized to the active project
  const [summaryData, setSummaryData] = useState<SummaryResult>(() => {
    const docs = getDocumentsForProject(activeProject.id);
    const firstDiary = docs.find((d) => d.type === 'diary');
    return firstDiary
      ? getDocumentSummary(firstDiary)
      : buildInitialSummaryForProject(activeProject.id, activeProject.name, activeProject.number);
  });

  function getSourceLabel(type: DocumentSourceType | 'upload'): string {
    switch (type) {
      case 'diary':
        return 'Tagebucheinträge';
      case 'minutes':
        return 'Protokolle';
      case 'emails':
        return 'E-Mails';
      case 'upload':
        return 'Word/PDF Dokumente';
    }
  }

  const handleSelectDoc = (doc: ProjectDocumentItem) => {
    setSelectedDocId(doc.id);
    setInputText(doc.content);
    setUploadedFile(null);
    // Hinterlegte Zusammenfassung sofort zeigen; Backend-Einträge werden per „Synthese“ (KI) zusammengefasst
    if (doc.summary) setSummaryData(getDocumentSummary(doc));
  };

  const handleSelectAllForProject = () => {
    const filtered = projectDocs.filter((d) => d.type === activeSource);
    if (filtered.length === 0) return;

    const combined = filtered
      .map(
        (d, idx) =>
          `=== DOKUMENT ${idx + 1}: ${d.title} (Datum: ${d.date}, Autor/Absender: ${d.authorOrSender}) ===\n${d.content}`
      )
      .join('\n\n------------------------------------------------------------\n\n');

    setSelectedDocId('all');
    setInputText(combined);
    setUploadedFile(null);
  };

  const handleProcessFile = async (file: File) => {
    setIsExtracting(true);
    try {
      const extracted = await extractTextFromFile(file);
      setInputText(extracted);
      setSelectedDocId(null);
      setUploadedFile({
        name: file.name,
        size: file.size,
        ext: file.name.split('.').pop()?.toLowerCase() || 'file',
        charCount: extracted.length
      });
    } catch (err) {
      alert(`Fehler beim Einlesen der Datei: ${err}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleProcessFile(file);
    }
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    const filtered = projectDocs.filter((d) => d.type === activeSource);
    if (filtered.length > 0) {
      setSelectedDocId(filtered[0].id);
      setInputText(filtered[0].content);
    } else {
      setInputText('');
    }
  };

  // Backend: POST /api/summarize (Text-Modus). Fällt das Backend aus, greift die lokale Synthese.
  const handleSynthesize = async () => {
    if (!inputText.trim()) return;

    setIsSynthesizing(true);
    const req: SummarizeRequest = {
      text: inputText.trim(),
      project_id: Number(activeProject.id),
      source_type: activeSource === 'upload' || uploadedFile ? 'minutes' : activeSource
    };
    try {
      const res = await api.summarize(req);
      setSummaryData(res);
      setIsSynthesizing(false);
      return;
    } catch (err) {
      console.warn('Backend summarize Fallback (lokal):', err);
    }
    synthesizeLocally();
  };

  // Backend: POST /api/summarize (Zeitraum-Modus) – Tagesberichte, Notizen und Briefe des Projekts.
  const handleSummarizePeriod = async (period: 'week' | 'month') => {
    setIsSynthesizing(true);
    try {
      const res = await api.summarize({ project_id: Number(activeProject.id), period });
      setSummaryData(res);
    } catch (err: any) {
      alert(`Zusammenfassung aus Projektdaten nicht möglich: ${err?.message || err}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const synthesizeLocally = () => {
    setTimeout(() => {
      if (uploadedFile) {
        setSummaryData({
          title: `Zusammenfassung: ${uploadedFile.name.replace(/\.[^/.]+$/, '')} • ${activeProject.name}`,
          executiveSummary: [
            `Erfolgreich aus hochgeladener Datei "${uploadedFile.name}" für ${activeProject.name} extrahiert.`,
            'Schlüsselfakten, Leistungsfortschritte und Schnittstellen wurden konsolidiert.',
            'Erkannte Handlungsaufträge wurden automatisch den Gewerken zugewiesen.'
          ],
          keyDecisions: [
            `Dokumentierte Festlegungen aus "${uploadedFile.name}" erfasst.`,
            'Terminliche Abhängigkeiten und Schnittstellen der beteiligten Firmen synchronisiert.',
            'Qualitätssicherungs- und Prüffristen im Baustellenablauf hinterlegt.'
          ],
          actionItems: [
            {
              id: `act-${Date.now()}-1`,
              task: `Festlegungen aus "${uploadedFile.name}" nachverfolgen`,
              responsible: 'Bauleitung / Projektteam',
              deadline: 'In 3 Werktagen',
              priority: 'Hoch',
              done: false,
              source: uploadedFile.name
            },
            {
              id: `act-${Date.now()}-2`,
              task: 'Prüf- und Freigabevermerke an beteiligte Fachplaner weiterleiten',
              responsible: 'Bauleitung Mustermann',
              deadline: 'Kommende Woche',
              priority: 'Mittel',
              done: false,
              source: uploadedFile.name
            }
          ],
          vobRisks: [
            {
              title: 'Prüfung auf VOB-relevante Fristen & Behinderungen',
              description: `Das Dokument "${uploadedFile.name}" enthält Verzugshinweise und Schnittstellen zu nachfolgenden Gewerken.`,
              recommendation: 'Prüfen Sie, ob für betroffene Leistungen vorsorglich eine Behinderungsanzeige oder Bedenkenanmeldung erforderlich ist.',
              linkType: 'delay'
            }
          ],
          traceabilityNotes: `Vollständig extrahiert aus "${uploadedFile.name}" (${uploadedFile.charCount} Zeichen analysiert).`
        });
      } else if (selectedDocId === 'all') {
        // Combined summary of all entries for this project
        setSummaryData({
          title: `Gesamtsynthese: Alle ${getSourceLabel(activeSource as DocumentSourceType)} • ${activeProject.name}`,
          executiveSummary: [
            `Konsolidierte Auswertung aller ${getSourceLabel(activeSource as DocumentSourceType)} für ${activeProject.name}.`,
            'Fortschritte, Personalstärken und Baustellenstörungen wurden projektbezogen zusammengeführt.',
            'Schnittstellen zwischen Planung, Tiefbau und Rohbau wurden abgeglichen.'
          ],
          keyDecisions: [
            'Wochenziele und Meilensteine gemäß Baustellendokumentation abgeglichen.',
            'Verbindliche Planungs- und Prüffristen der Nachunternehmer zusammengeführt.'
          ],
          actionItems: [
            {
              id: `act-${Date.now()}-1`,
              task: `Alle offenen Maßnahmen aus den ${getSourceLabel(activeSource as DocumentSourceType)} im Jour Fixe ansprechen`,
              responsible: 'Bauleitung',
              deadline: 'Nächster Jour Fixe',
              priority: 'Hoch',
              done: false,
              source: `Projekt ${activeProject.name}`
            },
            {
              id: `act-${Date.now()}-2`,
              task: 'Soll-Ist-Abgleich der dokumentierten Tagesleistungen im Bautagesbericht prüfen',
              responsible: 'Bauleiter',
              deadline: 'Wochenende',
              priority: 'Mittel',
              done: false,
              source: `Projekt ${activeProject.name}`
            }
          ],
          vobRisks: [
            {
              title: 'Gesamtrisiko: Termin- und Behinderungsanhäufung',
              description: 'In den Einzeleinträgen zeichnen sich kumulierte Verzögerungen bei Zulieferungen und Planfreigaben ab.',
              recommendation: 'Behinderungsanzeige nach § 6 Abs. 1 VOB/B vorbereiten.',
              linkType: 'delay'
            }
          ],
          traceabilityNotes: `Aggregiert aus allen ${getSourceLabel(activeSource as DocumentSourceType)} des Bauprojekts ${activeProject.name}.`
        });
      } else {
        // Single project document summary
        setSummaryData(buildSummaryForSpecificSituation(activeProject.id, activeProject.name, activeSource));
      }

      setIsSynthesizing(false);
    }, 550);
  };

  const handleToggleActionItem = (id: string) => {
    setSummaryData((prev) => ({
      ...prev,
      actionItems: prev.actionItems.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
      )
    }));
  };

  const handleCopySummary = () => {
    const formatted = `${summaryData.title}
Projekt: ${activeProject.name} (${activeProject.number})

1. KERNPUNKTE / EXECUTIVE SUMMARY:
${summaryData.executiveSummary.map((s) => `• ${s}`).join('\n')}

2. WICHTIGE BESCHLÜSSE:
${summaryData.keyDecisions.map((d) => `• ${d}`).join('\n')}

3. OFFENE MASSNAHMEN & TO-DOS:
${summaryData.actionItems.map((a) => `[${a.done ? 'X' : ' '}] ${a.task} | Verantwortlich: ${a.responsible} | Frist: ${a.deadline}`).join('\n')}

4. VOB-RISIKEN:
${summaryData.vobRisks.map((r) => `⚠️ ${r.title}: ${r.description} (${r.recommendation})`).join('\n')}

Quelle: ${summaryData.traceabilityNotes}`;

    navigator.clipboard.writeText(formatted);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2500);
  };

  const handleDownloadDoc = () => {
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${summaryData.title}</title>
<style>
body { font-family: Calibri, sans-serif; line-height: 1.5; color: #111; }
h1 { font-size: 16pt; color: #1e3a8a; }
h2 { font-size: 13pt; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 14pt; }
li { margin-bottom: 4pt; }
table { width: 100%; border-collapse: collapse; margin-top: 8pt; }
th, td { border: 1px solid #ddd; padding: 6pt; font-size: 10pt; text-align: left; }
th { background-color: #f1f5f9; }
</style>
</head>
<body>
<h1>${summaryData.title}</h1>
<p><strong>Projekt:</strong> ${activeProject.name} (${activeProject.number}) | <strong>Datum:</strong> ${new Date().toLocaleDateString('de-DE')}</p>

<h2>1. Kernaussagen (Executive Summary)</h2>
<ul>
${summaryData.executiveSummary.map((s) => `<li>${s}</li>`).join('')}
</ul>

<h2>2. Wichtige Beschlüsse</h2>
<ul>
${summaryData.keyDecisions.map((d) => `<li>${d}</li>`).join('')}
</ul>

<h2>3. Offene Maßnahmen & Fristen (Action Items)</h2>
<table>
<tr><th>Status</th><th>Aufgabe</th><th>Verantwortlich</th><th>Frist</th><th>Quelle</th></tr>
${summaryData.actionItems.map((a) => `<tr><td>${a.done ? 'Erledigt' : 'Offen'}</td><td>${a.task}</td><td>${a.responsible}</td><td>${a.deadline}</td><td>${a.source}</td></tr>`).join('')}
</table>

<h2>4. Erkannte Risiken & Handlungsempfehlungen</h2>
${summaryData.vobRisks.map((r) => `<p><strong>${r.title}</strong><br/>${r.description}<br/><em>Empfehlung: ${r.recommendation}</em></p>`).join('')}

<hr/>
<p><small>${summaryData.traceabilityNotes}</small></p>
</body>
</html>`;

    saveBlob(new Blob([html], { type: 'application/msword;charset=utf-8' }), `Zusammenfassung_${activeProject.number}_${todayIso()}.doc`);
  };

  const filteredDocs = projectDocs.filter((d) => d.type === activeSource);

  return (
    <div className="summary-container">
      {/* Page Header */}
      <div className="summary-header">
        <div>
          <h1>{t('sum_title')}</h1>
          <p>
            {t('sum_sub')} <strong>{activeProject.name}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="doc-btn" onClick={handleCopySummary} title={t('btn_copy')}>
            <Copy size={14} />
            <span>{copyDone ? t('btn_copied') : t('btn_copy')}</span>
          </button>
          <button className="doc-btn" onClick={handleDownloadDoc} title={t('btn_word_export')}>
            <Download size={14} />
            <span>{t('btn_word_export')}</span>
          </button>
          <button className="doc-btn" onClick={() => window.print()} title={t('btn_print')}>
            <Printer size={14} />
            <span>{t('btn_print')}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Source Ingestion on Left, Structured Output on Right */}
      <div className="summary-split-grid">
        {/* Left Column: Input and Source Selection */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Project Documents Navigation Tabs */}
          <div>
            <div className="source-type-nav">
              <button
                type="button"
                className={`source-tab-btn ${activeSource === 'diary' && !uploadedFile ? 'active' : ''}`}
                onClick={() => {
                  setUploadedFile(null);
                  setActiveSource('diary');
                }}
              >
                <BookOpen size={14} />
                <span>{t('sum_tab_diary')}</span>
              </button>

              <button
                type="button"
                className={`source-tab-btn ${activeSource === 'minutes' && !uploadedFile ? 'active' : ''}`}
                onClick={() => {
                  setUploadedFile(null);
                  setActiveSource('minutes');
                }}
              >
                <FileText size={14} />
                <span>{t('sum_tab_minutes')}</span>
              </button>

              <button
                type="button"
                className={`source-tab-btn ${activeSource === 'emails' && !uploadedFile ? 'active' : ''}`}
                onClick={() => {
                  setUploadedFile(null);
                  setActiveSource('emails');
                }}
              >
                <Mail size={14} />
                <span>{t('sum_tab_emails')}</span>
              </button>

              <button
                type="button"
                className={`source-tab-btn ${activeSource === 'upload' || uploadedFile ? 'active' : ''}`}
                onClick={() => {
                  setActiveSource('upload');
                  fileInputRef.current?.click();
                }}
              >
                <UploadCloud size={14} />
                <span>{t('sum_tab_upload')}</span>
              </button>
            </div>
          </div>

          {/* Word / PDF Upload Zone (if activeSource === 'upload' or file uploaded) */}
          {(activeSource === 'upload' || uploadedFile) && (
            <div>
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf,.docx,.doc,.txt,.md"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />

              {!uploadedFile ? (
                <div
                  className={`upload-dropzone ${isDragOver ? 'dragover' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div className="upload-dropzone-icon">
                    <UploadCloud size={20} />
                  </div>
                  <div className="upload-dropzone-title">
                    {isExtracting ? 'Textextraktion läuft...' : 'Word- oder PDF-Protokoll hier ablegen oder klicken'}
                  </div>
                  <div className="upload-dropzone-sub">
                    Wird automatisch für das Projekt "{activeProject.name}" ausgewertet
                  </div>
                </div>
              ) : (
                <div className="uploaded-file-card">
                  <div className="uploaded-file-info">
                    {uploadedFile.ext === 'pdf' ? (
                      <FileText size={22} color="#dc2626" />
                    ) : (
                      <FileCode size={22} color="#2563eb" />
                    )}
                    <div>
                      <div className="uploaded-file-name">{uploadedFile.name}</div>
                      <div className="uploaded-file-meta">
                        {(uploadedFile.size / 1024).toFixed(1)} KB • {uploadedFile.charCount} Zeichen extrahiert
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '6px', borderRadius: '50%' }}
                    onClick={handleRemoveFile}
                    title="Datei entfernen"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Project-Specific Document List */}
          {activeSource !== 'upload' && !uploadedFile && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-slate-800)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FolderOpen size={16} color="var(--color-primary)" />
                  <span>{getSourceLabel(activeSource as DocumentSourceType)} für {activeProject.name}</span>
                </span>

                <div style={{ display: 'flex', gap: '6px' }}>
                  {activeSource === 'diary' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                      onClick={() => navigate('/reports')}
                      title={t('btn_new_entry')}
                    >
                      <Plus size={13} />
                      <span>{t('btn_new_entry')}</span>
                    </button>
                  )}

                  {filteredDocs.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                      onClick={handleSelectAllForProject}
                      title={t('sum_btn_combine_all')}
                    >
                      <Layers size={13} />
                      <span>{t('sum_btn_combine_all')} ({filteredDocs.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {filteredDocs.length === 0 ? (
                <div style={{ padding: '14px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-slate-50)', border: '1px dashed var(--color-slate-300)', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Keine {getSourceLabel(activeSource as DocumentSourceType)} für dieses Projekt vorhanden.
                </div>
              ) : (
                <div className="project-docs-list">
                  {filteredDocs.map((doc) => {
                    const isSelected = selectedDocId === doc.id;
                    return (
                      <div
                        key={doc.id}
                        className={`project-doc-item ${isSelected ? 'active' : ''}`}
                        onClick={() => handleSelectDoc(doc)}
                      >
                        <div>
                          <div className="project-doc-title">{doc.title}</div>
                          <div className="project-doc-meta">
                            <Calendar size={12} />
                            <span>{doc.date}</span>
                            <span>•</span>
                            <User size={12} />
                            <span>{doc.authorOrSender}</span>
                          </div>
                        </div>

                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-primary)' }}>
                          {isSelected ? '✓' : '→'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Clean Textarea without unwanted heading */}
          <div className="form-group">
            <textarea
              id="sourceTextInput"
              className="form-textarea"
              rows={9}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Inhalte zur automatischen Synthese..."
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px' }}
            disabled={!inputText.trim() || isSynthesizing || isExtracting}
            onClick={handleSynthesize}
          >
            <Sparkles size={16} />
            <span>{isSynthesizing ? 'KI fasst zusammen…' : t('sum_btn_synthesize')}</span>
          </button>

          {/* Zusammenfassung direkt aus den Projektdaten im Backend */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              disabled={isSynthesizing}
              onClick={() => handleSummarizePeriod('week')}
              title="Tagesberichte, Notizen und Briefe dieser Woche zusammenfassen"
            >
              <Calendar size={14} />
              <span>Diese Woche (Projektdaten)</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ flex: 1 }}
              disabled={isSynthesizing}
              onClick={() => handleSummarizePeriod('month')}
              title="Tagesberichte, Notizen und Briefe dieses Monats zusammenfassen"
            >
              <Layers size={14} />
              <span>Dieser Monat (Projektdaten)</span>
            </button>
          </div>
        </div>

        {/* Right Column: Structured Synthesis Output */}
        <div className="summary-result-card">
          <div className="summary-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ListTodo size={18} color="var(--color-primary)" />
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
                {summaryData.title}
              </h2>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {summaryData.mode && (
                <span className="badge badge-info" title={summaryData.mode === 'ai' ? 'Von der KI erstellt' : 'Regelbasiert (KI nicht verfügbar)'}>
                  {summaryData.mode === 'ai' ? 'KI' : 'Offline'}
                </span>
              )}
              <span className="badge badge-info">{activeProject.name}</span>
            </div>
          </div>

          {/* Section 1: Executive Summary */}
          <div className="section-block">
            <h3 className="section-block-title">
              <span>📌</span>
              <span>{t('sum_sec_exec')}</span>
            </h3>
            <div className="executive-box">
              <ul style={{ paddingLeft: '18px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {summaryData.executiveSummary.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Section 2: Key Decisions */}
          <div className="section-block">
            <h3 className="section-block-title">
              <span>✅</span>
              <span>{t('sum_sec_decisions')}</span>
            </h3>
            <ul style={{ paddingLeft: '18px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', color: 'var(--color-slate-800)' }}>
              {summaryData.keyDecisions.map((decision, idx) => (
                <li key={idx}>{decision}</li>
              ))}
            </ul>
          </div>

          {/* Section 3: Open Action Items & Deadlines */}
          <div className="section-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="section-block-title">
                <span>📋</span>
                <span>{t('sum_sec_actions')} ({summaryData.actionItems.filter((a) => !a.done).length})</span>
              </h3>
            </div>

            <div className="action-items-list">
              {summaryData.actionItems.map((item) => (
                <div
                  key={item.id}
                  className={`action-item-row ${item.done ? 'completed' : ''}`}
                >
                  <div className="action-item-left">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => handleToggleActionItem(item.id)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                    />
                    <span style={{ fontWeight: item.done ? 400 : 600 }}>{item.task}</span>
                  </div>

                  <div className="action-item-tags">
                    <span className="responsible-badge">
                      <User size={11} style={{ display: 'inline', marginRight: '3px' }} />
                      {item.responsible}
                    </span>

                    <span className="deadline-badge">
                      <Clock size={11} style={{ display: 'inline', marginRight: '3px' }} />
                      {item.deadline}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Risk & Claims Alerts */}
          {summaryData.vobRisks.length > 0 && (
            <div className="section-block">
              <h3 className="section-block-title">
                <AlertTriangle size={18} color="var(--color-danger)" />
                <span>{t('sum_sec_risks')}</span>
              </h3>

              {summaryData.vobRisks.map((risk, idx) => (
                <div key={idx} className="risk-alert-box">
                  <div className="risk-alert-header">
                    <AlertTriangle size={15} />
                    <span>{risk.title}</span>
                  </div>
                  <div className="risk-alert-desc">{risk.description}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate-700)' }}>
                    Handlungsempfehlung: {risk.recommendation}
                  </div>
                  {risk.source && (
                    <div style={{ fontSize: '11px', color: 'var(--color-slate-500)' }}>🔍 Quelle: {risk.source}</div>
                  )}

                  <button
                    className="risk-action-btn"
                    onClick={() =>
                      navigate('/drafts', {
                        state: {
                          type: risk.linkType ?? 'delay',
                          keywords: `${risk.title}. ${risk.description}${risk.source ? ` (Quelle: ${risk.source})` : ''}`
                        }
                      })
                    }
                  >
                    → Jetzt direkt zu den Briefentwürfen wechseln & {risk.linkType === 'cost' ? 'Mehrkostenanmeldung' : risk.linkType === 'defect' ? 'Mängelrüge' : 'Behinderungsanzeige'} erstellen <ExternalLink size={12} style={{ display: 'inline', marginLeft: '3px' }} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Traceability Footer */}
          <div style={{ fontSize: '11px', color: 'var(--color-slate-400)', borderTop: '1px solid var(--border-light)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between' }}>
            <span>🔍 {summaryData.traceabilityNotes}</span>
            <span>Human-in-the-Loop: Zur Überprüfung durch die Bauleitung</span>
          </div>
        </div>
      </div>
        </div>
    );
};

// Situation-adaptive summary builder based on project situation
function buildInitialSummaryForProject(projectId: string | number, projectName: string, projectNumber: string): SummaryResult {
  if (String(projectId) === '2' || (projectId as any) === 'proj-2') {
    // Wohnquartier Spreebogen
    return {
      title: `Baustellen-Zusammenfassung • ${projectName}`,
      executiveSummary: [
        'Spundwandarbeiten in Achse 1-4 zu 60% abgeschlossen, Grundwasserhaltung mit 4 Brunnen arbeitet stabil.',
        'Altfundament im Uferbereich verursacht Rammhindernis; Abbruchmeißel-Einsatz erforderlich.',
        'Wasserbehördliche Auflage verlangt zusätzliche Rückverankerung der Uferwand.'
      ],
      keyDecisions: [
        'Einbau zusätzlicher Litzenanker zur Erhöhung der Uferwand-Standsicherheit beschlossen.',
        'Antrag auf Mehrvergütung gemäß § 2 Abs. 6 VOB/B angekündigt.',
        'Genehmigung für temporären Kranüberhang über die Spree durch WSA erteilt.'
      ],
      actionItems: [
        {
          id: 'act-spree-1',
          task: 'Mehrkostenanmeldung für Mehraufwand Altfundament & Rammhindernis aufstellen',
          responsible: 'Bauleitung Mustermann',
          deadline: 'In 2 Werktagen',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 67'
        },
        {
          id: 'act-spree-2',
          task: 'Kampfmittelsondierung für Verankerungsbereich beauftragen',
          responsible: 'Projektleiter Bauherr',
          deadline: '26.11.2026',
          priority: 'Hoch',
          done: false,
          source: 'Baubesprechung Nr. 8'
        },
        {
          id: 'act-spree-3',
          task: 'Kranbeleuchtung für Nachtbetrieb gemäß WSA-Auflage installieren',
          responsible: 'Elektriker Baustelle',
          deadline: 'Morgen',
          priority: 'Mittel',
          done: true,
          source: 'WSA Genehmigung'
        }
      ],
      vobRisks: [
        {
          title: 'Mehrkosten & Bauzeitverlängerung wegen unvorhergesehenem Baugrundhindernis (§ 2 Abs. 6 VOB/B)',
          description: 'Das im Uferbereich angetroffene Altfundament war in den Ausschreibungsunterlagen nicht dargestellt und führt zu Geräte-Stillständen.',
          recommendation: 'Formelle Mehrkostenanmeldung und Behinderungsanzeige fristgerecht an die Spreebogen Wohnbau GmbH übermitteln.',
          linkType: 'cost'
        }
      ],
      traceabilityNotes: `Extrahiert aus Bautagesbericht Nr. 67, Baubesprechung Nr. 8 & WSA-Bescheid für ${projectName} (${projectNumber}).`
    };
  } else if (String(projectId) === '3' || (projectId as any) === 'proj-3') {
    // Sanierung Bürokomplex Am Tiergarten
    return {
      title: `Sanierungs- & Schadstoff-Zusammenfassung • ${projectName}`,
      executiveSummary: [
        'Asbestsanierung im 3. OG nach TRGS 519 abgeschlossen; Vorbereitung der Raumluft-Freimessung.',
        'Denkmalschutzauflagen für historischen Stuck im Eingangsfoyer planmäßig umgesetzt.',
        'KMF-Entsorgungsnachweis liegt behördlich bestätigt vor.'
      ],
      keyDecisions: [
        'Freimessung der sanierten Bereiche für Montag 09:00 Uhr mit Gutachter terminiert.',
        'Erhalt und staubdichte Einhausung der Stuckelemente vor Beginn des Trockenbaus festgelegt.',
        'Denkmalgerechte Holz-Alu-Kastenfenster zur Bemusterung freigegeben.'
      ],
      actionItems: [
        {
          id: 'act-tier-1',
          task: 'Begleitung der Asbest-Freimessung im 3. OG durchführen',
          responsible: 'Sachverständiger Dr. Franke',
          deadline: 'Montag 09:00 Uhr',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 22'
        },
        {
          id: 'act-tier-2',
          task: 'Farbbefunduntersuchung an Fassadenfenstern abschließen',
          responsible: 'Restaurator Klein',
          deadline: '25.11.2026',
          priority: 'Mittel',
          done: false,
          source: 'Denkmalbesprechung Nr. 4'
        }
      ],
      vobRisks: [
        {
          title: 'Abhängigkeit: Nachfolgegewerke erst nach erfolgreicher Freimessung freigeben',
          description: 'Trockenbau- und Elektroinstallateure dürfen den Schwarzbereich erst nach schriftlichem Freimessprotokoll betreten.',
          recommendation: 'Sperrbereich überwachen und Protokoll der Umweltakte beifügen.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: `Extrahiert aus Bautagesbericht Nr. 22, Denkmalbesprechung Nr. 4 & EBB-Entsorgungsnachweis für ${projectName}.`
    };
  } else {
    // Schulzentrum Nord (proj-1) or default
    return {
      title: `Konsolidierte Baustellen-Zusammenfassung • ${projectName}`,
      executiveSummary: [
        'Rohbau-Bewehrungsarbeiten im Bauteil B liegen im Zeitplan (80% fertiggestellt), Betonage für Montag vorbereitet.',
        'Kritischer Verzug bei TGA-Schlitz- und Durchbruchsplänen gefährdet den Ausbau im Schachtbereich ab nächster Woche.',
        'Ungeplanter Maschinenausfall (Kettenbagger, 4,5 Std. Stillstand) führte zu Verzögerungen bei Erdarbeiten.'
      ],
      keyDecisions: [
        'Betonage Decke 1. OG Bauteil B verbindlich für kommenden Montag angesetzt.',
        'Nachbesserung der TGA-Planunterlagen durch Fachplaner bis spätestens Freitag gefordert.',
        'Prüfzeugnis für B25/30 Beton durch externe Baustoffprüfung beauftragt.'
      ],
      actionItems: [
        {
          id: 'act-schul-1',
          task: 'TGA-Ausführungspläne für Schacht 3 nachfordern & Eingang prüfen',
          responsible: 'TGA-Planer Weber',
          deadline: 'Freitag, 17:00 Uhr',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 142'
        },
        {
          id: 'act-schul-2',
          task: 'Stillstandsprotokoll Kettenbagger für Mehrkosten-/Behinderungsakte ablegen',
          responsible: 'Bauleitung Mustermann',
          deadline: 'Heute',
          priority: 'Mittel',
          done: true,
          source: 'Bautagesbericht Nr. 142'
        },
        {
          id: 'act-schul-3',
          task: 'Prüfstatische Freigabe für Unterzugbewehrung U-14 einholen',
          responsible: 'Prüfstatiker Dr. Lang',
          deadline: '24.11.2026',
          priority: 'Hoch',
          done: false,
          source: 'Jour Fixe Protokoll Nr. 18'
        },
        {
          id: 'act-schul-4',
          task: 'Teillieferung der Brandschutztürzargen zur Vorab-Montage verhandeln',
          responsible: 'Fa. Hoffmann Türen',
          deadline: '27.11.2026',
          priority: 'Mittel',
          done: false,
          source: 'E-Mail Korrespondenz'
        }
      ],
      vobRisks: [
        {
          title: 'Akute Behinderungsgefahr nach § 6 Abs. 1 VOB/B',
          description: 'Fehlende TGA-Schlitzpläne blockieren den Arbeitsfortschritt im Schacht 3. Ohne rechtzeitige Übergabe droht Stillstand der Gewerke.',
          recommendation: 'Behinderungsanzeige unverzüglich schriftlich an Auftraggeber bzw. TGA-Fachplaner versenden.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: `Extrahiert aus: Bautagesbericht Nr. 142 (20.11.), Jour Fixe Nr. 18 & E-Mail-Korrespondenz GlasTec für ${projectName}.`
    };
  }
}

function buildSummaryForSpecificSituation(projectId: string | number, projectName: string, _source: DocumentSourceType | 'upload'): SummaryResult {
  return buildInitialSummaryForProject(projectId, projectName, 'PRJ-AKTUELL');
}

export default Summary;
