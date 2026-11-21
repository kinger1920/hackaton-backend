import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  ListTodo,
  FileDown,
  Trash2,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Camera
} from 'lucide-react';
import { ComingSoonNote, isNotImplemented } from '../components/ComingSoon';
import { addDays, deToIso, isoToDe, toIsoDate as dateToIso, todayIso } from '../utils/dates';
import { useAudioRecorder } from '../utils/useAudioRecorder';
import { useProjects } from '../context/ProjectContext';
import {
  getDiaryEntriesForProject,
  saveProjectDocument,
  getDocumentSummary,
  ProjectDocumentItem
} from '../context/ProjectDocuments';
import { useLanguage } from '../context/LanguageContext';
import { api, AttendanceItem, Contract, DayAnalysis, PhotoDescribeResponse, saveBlob } from '../services/api';

interface ReportPhoto {
  photoId?: number;
  file?: File;
  fileName: string;
  url: string;
  status: 'analyzing' | 'done' | 'unavailable' | 'error';
  result?: PhotoDescribeResponse;
  error?: string;
}
import '@frontend/src/index.css';
import './DailyReports.css';

export const DailyReports: React.FC = () => {
  const navigate = useNavigate();
  // Aus dem Terminplaner: navigate('/reports', {state: {date: 'YYYY-MM-DD'}}) öffnet diesen Tag
  const navDate = (useLocation().state as { date?: string } | null)?.date;
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
  const [reportDate, setReportDate] = useState(() => {
    if (navDate && /^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
      const [y, m, d] = navDate.split('-');
      return `${d}.${m}.${y}`;
    }
    return '21.11.2026';
  });
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

  // Dictation state (echte Aufnahme → /api/transcribe → /api/reports/{date}/fill)
  const [isProcessingDictation, setIsProcessingDictation] = useState(false);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState(false);

  // Abschluss-Status (finalized = kein "ENTWURF"-Wasserzeichen im Export)
  const [isFinalized, setIsFinalized] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);

  // Tagesanalyse (GET /api/reports/{date}/analysis)
  const [dayAnalysis, setDayAnalysis] = useState<DayAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Neue Berichtsfelder im Backend: Temperatur, Bauleitung, Anwesenheit je Firma
  const [temperatureC, setTemperatureC] = useState<string>('');
  const [siteManager, setSiteManager] = useState<string>('');
  const [attendance, setAttendance] = useState<AttendanceItem[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);

  // Idee #2: Wetter automatisch
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);
  const [weatherHint, setWeatherHint] = useState<string | null>(null);

  // Idee #1: Fotos → Tagebucheintrag
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);

  // Verträge des Projekts (Sollstärke je Firma)
  useEffect(() => {
    api.listContracts(Number(activeProject.id))
      .then(setContracts)
      .catch(() => setContracts([]));
  }, [activeProject.id]);

  const plannedFor = (company?: string | null): number | null => {
    if (!company) return null;
    const c = contracts.find((k) => k.contractor_name && k.contractor_name.toLowerCase() === company.trim().toLowerCase());
    return c?.planned_workforce ?? null;
  };

  const updateAttendance = (idx: number, changes: Partial<AttendanceItem>) => {
    setAttendance((prev) => {
      const next = prev.map((a, i) => (i === idx ? { ...a, ...changes } : a));
      const total = next.reduce((s, a) => s + (a.workers || 0), 0);
      if (total > 0) setWorkforceCount(total);
      return next;
    });
  };

  const handleAttendanceFromContracts = () => {
    const existing = new Set(attendance.map((a) => (a.company || '').toLowerCase()));
    const added = contracts
      .filter((c) => c.contractor_name && !existing.has(c.contractor_name.toLowerCase()))
      .map((c) => ({ company: c.contractor_name!, trade: c.trade ?? '', workers: 0, hours: null }));
    setAttendance([...attendance, ...added]);
  };

  const handleAutoWeather = async () => {
    setIsLoadingWeather(true);
    setWeatherHint(null);
    try {
      const w = await api.getWeather(toIsoDate(reportDate), Number(activeProject.id));
      setWeather([w.condition, w.wind_kmh != null ? `Wind ${w.wind_kmh} km/h` : null, w.precipitation_mm != null ? `${w.precipitation_mm} mm Niederschlag` : null].filter(Boolean).join(', '));
      if (w.temperature_c != null) setTemperatureC(String(w.temperature_c));
    } catch (err) {
      setWeatherHint(
        isNotImplemented(err)
          ? 'Automatisches Wetter (Standort + Datum, beweisrelevant für Behinderungen) ist vorbereitet – das Backend liefert es noch nicht. Bitte vorerst von Hand eintragen.'
          : `Wetter konnte nicht geladen werden: ${(err as Error)?.message ?? err}`
      );
    } finally {
      setIsLoadingWeather(false);
    }
  };

  const handlePhotosSelected = (files: FileList | null) => {
    if (!files) return;
    const iso = toIsoDate(reportDate);
    Array.from(files).forEach((file) => {
      const localUrl = URL.createObjectURL(file);
      setPhotos((prev) => [...prev, { file, fileName: file.name, url: localUrl, status: 'analyzing' }]);
      api.uploadPhoto(file, Number(activeProject.id), iso)
        .then((saved) => {
          const remoteUrl = api.getPhotoFileUrl(saved);
          URL.revokeObjectURL(localUrl);
          setPhotos((prev) =>
            prev.map((p) =>
              p.url === localUrl
                ? {
                    photoId: saved.id,
                    fileName: saved.file_name,
                    url: remoteUrl,
                    status: 'done',
                    result: {
                      caption: saved.caption,
                      diary_text: saved.diary_text,
                      issues: saved.issues,
                      mode: saved.mode,
                      id: saved.id,
                      url: saved.url
                    }
                  }
                : p
            )
          );
          // Vorschlag in den Bericht übernehmen (Nutzer kann bearbeiten – human in the loop)
          if (saved.diary_text) {
            setProgressText((prev) => (prev ? `${prev}\n[Foto] ${saved.diary_text}` : `[Foto] ${saved.diary_text}`));
          }
        })
        .catch((err) => {
          setPhotos((prev) =>
            prev.map((p) =>
              p.url === localUrl
                ? { ...p, status: isNotImplemented(err) ? 'unavailable' : 'error', error: (err as Error)?.message }
                : p
            )
          );
        });
    });
  };

  const removePhoto = async (idx: number) => {
    const target = photos[idx];
    if (!target) return;
    if (target.photoId != null) {
      try {
        await api.deletePhoto(target.photoId);
      } catch (err) {
        console.warn('Foto konnte nicht im Backend gelöscht werden:', err);
      }
    }
    if (target.url.startsWith('blob:')) {
      URL.revokeObjectURL(target.url);
    }
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Formular-Datum (TT.MM.JJJJ) → ISO für das Backend
  const toIsoDate = deToIso;

  // Load backend daily report for current date and project
  useEffect(() => {
    let cancelled = false;
    const fetchBackendReport = async () => {
      try {
        const iso = toIsoDate(reportDate);
        const [report, dayPhotos] = await Promise.all([
          api.getReport(iso, Number(activeProject.id)),
          api.listPhotos(Number(activeProject.id), undefined, undefined, iso).catch(() => [])
        ]);
        if (!cancelled) {
          setPhotos(
            dayPhotos.map((p) => ({
              photoId: p.id,
              fileName: p.file_name,
              url: api.getPhotoFileUrl(p),
              status: 'done',
              result: {
                caption: p.caption,
                diary_text: p.diary_text,
                issues: p.issues,
                mode: p.mode,
                id: p.id,
                url: p.url
              }
            }))
          );
        }
        if (!cancelled && report) {
          if (report.weather) setWeather(report.weather);
          if (report.workforce_count !== null && report.workforce_count !== undefined && report.workforce_count > 0) {
            setWorkforceCount(report.workforce_count);
          }
          if (report.trades && report.trades.length > 0) {
            setTrades(report.trades);
          }
          if (report.work_completed) setProgressText(report.work_completed);
          if (report.deviations_incidents) setHindranceText(report.deviations_incidents);
          if (report.deliveries) setDeliveriesText(report.deliveries);
          if (report.report_number) setReportNumber(String(report.report_number));
          setTemperatureC(report.temperature_c != null ? String(report.temperature_c) : '');
          setSiteManager(report.site_manager ?? '');
          setAttendance(report.attendance ?? []);
          setIsFinalized(report.status === 'finalized');
          setDayAnalysis(null);
        }
      } catch (err) {
        console.warn('Backend getReport Fallback:', err);
      }
    };

    fetchBackendReport();
    return () => {
      cancelled = true;
    };
  }, [reportDate, activeProject.id]);

  // Verlauf: Bautagesberichte + Diktate der letzten 90 Tage aus dem Backend (/api/timeline).
  // Lokale Beispiel-Dokumente nur, wenn das Backend nicht erreichbar ist.
  const loadHistory = async () => {
    let combined: ProjectDocumentItem[];
    try {
      const tl = await api.getTimeline(Number(activeProject.id), dateToIso(addDays(new Date(), -90)), todayIso(), ['report', 'note']);
      combined = tl.items.map((it) => ({
        id: `${it.type}-${it.refId ?? it.id}`,
        projectId: activeProject.id,
        type: 'diary',
        title: it.title,
        date: isoToDe(it.date),
        authorOrSender: it.source,
        content: it.summary,
        hindrance: it.severity === 'warning' || it.severity === 'critical' ? it.summary : undefined
      }));
    } catch (err) {
      console.warn('Timeline nicht erreichbar, zeige lokale Einträge:', err);
      combined = getDiaryEntriesForProject(activeProject.id);
    }

    setDiaryHistory(combined);

    // Nächste Berichtsnummer aus dem neuesten Bericht ableiten
    const latest = combined.find((c) => /Nr\.\s*\d+/i.test(c.title));
    const match = latest?.title.match(/Nr\.\s*(\d+)/i);
    if (match) setReportNumber(String(parseInt(match[1], 10) + 1));
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
  const handleAdoptFromPastEntry = async (pastDoc: ProjectDocumentItem) => {
    if (pastDoc.id.startsWith('report-')) {
      try {
        const r = await api.getReport(toIsoDate(pastDoc.date), Number(activeProject.id));
        if (r.weather) setWeather(r.weather);
        if (r.temperature_c != null) setTemperatureC(String(r.temperature_c));
        if (r.workforce_count) setWorkforceCount(r.workforce_count);
        if (r.trades.length > 0) setTrades([...r.trades]);
        if (r.attendance && r.attendance.length > 0) setAttendance(r.attendance.map((a) => ({ ...a })));
      } catch (err) {
        console.warn('Vorbericht konnte nicht geladen werden:', err);
      }
    } else {
      if (pastDoc.weather) setWeather(pastDoc.weather);
      if (pastDoc.workforceCount) setWorkforceCount(pastDoc.workforceCount);
      if (pastDoc.trades && pastDoc.trades.length > 0) setTrades([...pastDoc.trades]);
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

  // Diktat-Text → /api/reports/{date}/fill (KI ordnet Felder + Fortschritt je Vorgang zu)
  const applyDictation = async (dictatedText: string) => {
    setIsProcessingDictation(true);
    try {
      const iso = toIsoDate(reportDate);
      const res = await api.fillReport(iso, {
        text: dictatedText,
        project_id: Number(activeProject.id)
      });
      if (res) {
        if (res.work_completed) setProgressText(res.work_completed);
        if (res.deviations_incidents) setHindranceText(res.deviations_incidents);
        if (res.deliveries) setDeliveriesText(res.deliveries);
        if (res.trades && res.trades.length > 0) setTrades(res.trades);
        if (res.weather) setWeather(res.weather);
        if (res.workforce_count) setWorkforceCount(res.workforce_count);
        setDayAnalysis(null);
      }
    } catch (err) {
      console.warn('Backend fillReport Fallback:', err);
      setProgressText((prev) => (prev ? `${prev}\n[Diktat]: ${dictatedText}` : dictatedText));
    } finally {
      setIsProcessingDictation(false);
    }
  };

  const askForTypedDictation = () => {
    const typed = window.prompt('Diktat als Text eingeben (wird per KI in den Bericht übernommen):');
    if (typed && typed.trim()) applyDictation(typed.trim());
  };

  // Aufnahme → /api/transcribe → fill (gemeinsamer Hook utils/useAudioRecorder)
  const recorder = useAudioRecorder(async (blob) => {
    setIsProcessingDictation(true);
    let text = '';
    try {
      text = (await api.transcribeAudio(blob, 'de')).text.trim();
    } catch (err) {
      console.warn('Transkription fehlgeschlagen:', err);
    }
    setIsProcessingDictation(false);
    if (text) applyDictation(text);
    else askForTypedDictation();
  });
  const isRecording = recorder.isRecording;

  const handleToggleMic = async () => {
    if (isRecording) {
      recorder.stop();
      return;
    }
    if (!(await recorder.start())) askForTypedDictation();
  };

  // Export: GET /api/reports/{date}/pdf|docx (Bericht wird vorher gespeichert, sonst 404)
  const handleExport = async (format: 'pdf' | 'docx') => {
    setExporting(format);
    try {
      await saveReportToBackend();
      const iso = toIsoDate(reportDate);
      const blob = await api.downloadReportExport(iso, format, Number(activeProject.id));
      saveBlob(blob, `Bautagesbericht_${reportNumber}_${iso}.${format}`);
    } catch (err: any) {
      const msg = err?.message || 'Unbekannter Fehler';
      if (format === 'pdf' && window.confirm(`${msg}\n\nStattdessen über den Browser drucken?`)) {
        window.print();
      } else if (format !== 'pdf') {
        alert(msg);
      }
    } finally {
      setExporting(null);
    }
  };

  // Tagesanalyse: was lief gut / schlecht, inkl. Abweichungen mit Quelle
  const handleAnalyzeDay = async () => {
    setIsAnalyzing(true);
    try {
      await saveReportToBackend();
      const res = await api.getDayAnalysis(toIsoDate(reportDate), Number(activeProject.id));
      setDayAnalysis(res);
    } catch (err: any) {
      alert(`Tagesanalyse nicht möglich: ${err?.message || err}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Tagebucheintrag aus dem Backend löschen (DELETE /site-notes/{id})
  const handleDeleteBackendNote = async (itemId: string) => {
    const noteId = Number(itemId.replace('note-', ''));
    if (!noteId || !window.confirm('Diesen Tagebucheintrag wirklich löschen?')) return;
    try {
      await api.deleteSiteNote(noteId);
      setDiaryHistory((prev) => prev.filter((d) => d.id !== itemId));
    } catch (err: any) {
      alert(err?.message || 'Löschen fehlgeschlagen');
    }
  };

  // PUT /api/reports/{date} – gemeinsam genutzt von Speichern, Export und Analyse
  const saveReportToBackend = async () => {
    const iso = toIsoDate(reportDate);
    await api.putReport(
      iso,
      {
        report_number: parseInt(reportNumber, 10) || undefined,
        weather,
        workforce_count: workforceCount,
        trades,
        work_completed: progressText,
        deviations_incidents: hindranceText,
        deliveries: deliveriesText,
        summary: `Bautagesbericht Nr. ${reportNumber} vom ${reportDate}`,
        status: isFinalized ? 'finalized' : 'draft',
        temperature_c: temperatureC.trim() === '' ? null : Number(temperatureC),
        site_manager: siteManager.trim() || userName,
        // Leere Firmenzeilen nicht senden; leere Liste = Anwesenheit löschen
        attendance: attendance
          .filter((a) => (a.company && a.company.trim()) || (a.trade && a.trade.trim()) || a.workers > 0)
          .map((a) => ({ ...a, company: a.company?.trim() || null, trade: a.trade?.trim() || null }))
      },
      Number(activeProject.id)
    );
  };

  // Speichern: PUT /api/reports/{date}. Nur wenn das Backend nicht erreichbar ist, lokal sichern.
  // (Früher zusätzlich als lokale Kopie UND als Tagebuchnotiz gespeichert → doppelt in Timeline/Verlauf.)
  const handleSaveReport = async () => {
    try {
      await saveReportToBackend();
    } catch (err) {
      console.warn('Backend nicht erreichbar – Bericht lokal gesichert:', err);
      saveProjectDocument({
        id: `doc-${activeProject.id}-d${Date.now()}`,
        projectId: activeProject.id,
        type: 'diary',
        title: `Bautagesbericht Nr. ${reportNumber} — ${progressText.slice(0, 35)}...`,
        date: reportDate,
        authorOrSender: userName,
        weather,
        workforceCount,
        trades,
        hindrance: hindranceText,
        content: [
          `Bautagesbericht Nr. ${reportNumber} — Datum: ${reportDate}`,
          `Wetter: ${weather}`,
          `Personal: ${workforceCount} (${trades.join(', ')})`,
          `Tagesleistung: ${progressText}`,
          hindranceText ? `Vorkommnisse: ${hindranceText}` : '',
          deliveriesText ? `Lieferungen/Abnahmen: ${deliveriesText}` : '',
          referencedDoc ? `[Bezug auf: ${referencedDoc.title} (${referencedDoc.date})]` : ''
        ].filter(Boolean).join('\n')
      });
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

                      {item.id.startsWith('note-') && (
                        <button
                          type="button"
                          className="history-btn-small"
                          style={{ color: '#dc2626' }}
                          onClick={() => handleDeleteBackendNote(item.id)}
                          title="Eintrag löschen"
                        >
                          <Trash2 size={11} />
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
                disabled={isProcessingDictation}
              >
                <Mic size={13} />
                <span>
                  {isProcessingDictation ? 'KI übernimmt Diktat…' : isRecording ? t('dash_mic_running') : t('dash_mic_start')}
                </span>
              </button>

              <button
                type="button"
                className="history-btn-small"
                onClick={() => handleExport('docx')}
                disabled={exporting !== null}
                title="Als Word-Datei exportieren (speichert vorher)"
              >
                <FileDown size={13} />
                <span>{exporting === 'docx' ? 'Export…' : 'Word'}</span>
              </button>

              <button
                type="button"
                className="history-btn-small"
                onClick={() => handleExport('pdf')}
                disabled={exporting !== null}
                title="Als PDF exportieren (speichert vorher)"
              >
                <FileDown size={13} />
                <span>{exporting === 'pdf' ? 'Export…' : 'PDF'}</span>
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
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <span>{t('rep_form_weather')}</span>
                {/* Idee #2: Wetter automatisch (Backend folgt: GET /api/weather) */}
                <button
                  type="button"
                  className="history-btn-small"
                  style={{ padding: '1px 6px', fontSize: '10px' }}
                  onClick={handleAutoWeather}
                  disabled={isLoadingWeather}
                  title="Wetter für Datum und Baustelle automatisch übernehmen"
                >
                  <CloudSun size={11} />
                  <span>{isLoadingWeather ? '…' : 'Automatisch'}</span>
                </button>
              </label>
              <input
                type="text"
                className="form-input"
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Temperatur (°C)</label>
              <input
                type="number"
                className="form-input"
                step="0.5"
                value={temperatureC}
                placeholder="z. B. 7"
                onChange={(e) => setTemperatureC(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">{t('rep_form_workforce')}</label>
              <input
                type="number"
                className="form-input"
                value={workforceCount}
                onChange={(e) => setWorkforceCount(Number(e.target.value))}
                title={attendance.length > 0 ? 'Summe aus der Anwesenheit je Firma' : undefined}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Bauleitung</label>
              <input
                type="text"
                className="form-input"
                value={siteManager}
                placeholder={userName}
                onChange={(e) => setSiteManager(e.target.value)}
              />
            </div>
          </div>

          {weatherHint && <ComingSoonNote endpoint="GET /api/weather?project_id=&date=">{weatherHint}</ComingSoonNote>}

          {/* Anwesenheit je Firma (Backend: attendance) – Basis für den Sollstärken-Check gegen die Verträge */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
              <label className="form-label" style={{ margin: 0 }}>
                Anwesenheit je Firma ({attendance.reduce((s, a) => s + (a.workers || 0), 0)} Personen)
              </label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {contracts.length > 0 && (
                  <button
                    type="button"
                    className="history-btn-small"
                    onClick={handleAttendanceFromContracts}
                    title="Firmen aus den hinterlegten Verträgen übernehmen"
                  >
                    <Copy size={11} />
                    <span>Firmen aus Verträgen</span>
                  </button>
                )}
                <button
                  type="button"
                  className="history-btn-small"
                  onClick={() => setAttendance([...attendance, { company: '', trade: '', workers: 0, hours: null }])}
                >
                  <Plus size={11} />
                  <span>Firma</span>
                </button>
              </div>
            </div>
            {attendance.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Noch keine Anwesenheit erfasst. Pro Firma eintragen, damit die Sollstärke laut Vertrag geprüft werden kann.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {attendance.map((a, idx) => {
                  const planned = plannedFor(a.company);
                  const below = planned != null && a.workers < planned;
                  return (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1.3fr 0.8fr 0.8fr auto', gap: '6px', alignItems: 'center' }}>
                      <input
                        className="form-input"
                        placeholder="Firma"
                        value={a.company ?? ''}
                        onChange={(e) => updateAttendance(idx, { company: e.target.value })}
                      />
                      <input
                        className="form-input"
                        placeholder="Gewerk"
                        value={a.trade ?? ''}
                        onChange={(e) => updateAttendance(idx, { trade: e.target.value })}
                      />
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        title={planned != null ? `Sollstärke laut Vertrag: ${planned}` : 'Arbeitskräfte'}
                        style={below ? { borderColor: '#f87171', backgroundColor: '#fef2f2' } : undefined}
                        value={a.workers}
                        onChange={(e) => updateAttendance(idx, { workers: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        step="0.5"
                        placeholder="Std."
                        value={a.hours ?? ''}
                        onChange={(e) => updateAttendance(idx, { hours: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                      <button
                        type="button"
                        className="history-btn-small"
                        style={{ color: '#dc2626' }}
                        onClick={() => setAttendance(attendance.filter((_, i) => i !== idx))}
                        title="Zeile entfernen"
                      >
                        <Trash2 size={11} />
                      </button>
                      {below && (
                        <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#b91c1c' }}>
                          ⚠️ Unter Sollstärke laut Vertrag ({a.workers} von {planned})
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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

          {/* Idee #1: Foto → Tagebucheintrag (POST /api/photos) */}
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                Baustellenfotos ({photos.length})
              </label>
              <label className="history-btn-small" style={{ cursor: 'pointer' }}>
                <Camera size={11} />
                <span>Foto aufnehmen / hochladen</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handlePhotosSelected(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {photos.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                {photos.map((p, idx) => (
                  <div
                    key={p.photoId ?? p.url}
                    style={{ width: '150px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', fontSize: '11px', backgroundColor: 'white' }}
                  >
                    <img src={p.url} alt={p.fileName} style={{ width: '100%', height: '90px', objectFit: 'cover', display: 'block' }} />
                    <div style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {p.status === 'analyzing' && <span>KI analysiert…</span>}
                      {p.status === 'done' && p.result && (
                        <>
                          <span><strong>{p.result.caption}</strong></span>
                          {p.result.issues.length > 0 && <span style={{ color: '#b91c1c' }}>⚠️ {p.result.issues.join(', ')}</span>}
                        </>
                      )}
                      {p.status === 'unavailable' && <span style={{ color: '#92400e' }}>Fotoanalyse folgt (Backend)</span>}
                      {p.status === 'error' && <span style={{ color: '#b91c1c' }}>{p.error}</span>}
                      <button
                        type="button"
                        className="history-btn-small"
                        style={{ alignSelf: 'flex-start', color: '#dc2626' }}
                        onClick={() => removePhoto(idx)}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  onClick={() => navigate('/drafts', { state: { type: 'delay', keywords: hindranceText.trim() } })}
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

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-slate-700)', cursor: 'pointer' }}
                title="Abgeschlossene Berichte werden ohne ENTWURF-Wasserzeichen exportiert"
              >
                <input
                  type="checkbox"
                  checked={isFinalized}
                  onChange={(e) => setIsFinalized(e.target.checked)}
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                <span>Bericht abschließen</span>
              </label>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAnalyzeDay}
                disabled={isAnalyzing}
                title="Was lief heute gut, was lief schlecht? (speichert vorher)"
              >
                <TrendingUp size={16} />
                <span>{isAnalyzing ? 'Analysiere…' : 'Tag analysieren'}</span>
              </button>

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

          {/* Tagesanalyse (GET /api/reports/{date}/analysis) */}
          {dayAnalysis && (
            <div
              style={{
                marginTop: '12px',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                backgroundColor: 'var(--color-slate-50)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '14px' }}>{dayAnalysis.title}</strong>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span className="badge badge-info">{dayAnalysis.mode === 'ai' ? 'KI' : 'Regeln'}</span>
                  <button
                    type="button"
                    onClick={() => setDayAnalysis(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    title="Schließen"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--color-slate-600)', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                {dayAnalysis.stats.workers != null && (
                  <span>
                    👷 {dayAnalysis.stats.workers} Personen
                    {dayAnalysis.stats.plannedWorkers != null ? ` (Soll ${dayAnalysis.stats.plannedWorkers})` : ''}
                  </span>
                )}
                {dayAnalysis.stats.hours != null && <span>⏱ {dayAnalysis.stats.hours} Std.</span>}
                {dayAnalysis.stats.weather && <span>🌤 {dayAnalysis.stats.weather}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px', color: '#15803d' }}>
                    <ThumbsUp size={14} /> Lief gut
                  </div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px' }}>
                    {dayAnalysis.wentWell.length === 0 && <li style={{ color: 'var(--color-slate-500)' }}>Keine Einträge</li>}
                    {dayAnalysis.wentWell.map((item, idx) => (
                      <li key={idx}>
                        {item.text} <span style={{ color: 'var(--color-slate-400)' }}>({item.source})</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '13px', color: '#b91c1c' }}>
                    <ThumbsDown size={14} /> Lief schlecht
                  </div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px' }}>
                    {dayAnalysis.wentBadly.length === 0 && <li style={{ color: 'var(--color-slate-500)' }}>Keine Einträge</li>}
                    {dayAnalysis.wentBadly.map((item, idx) => (
                      <li key={idx}>
                        {item.text} <span style={{ color: 'var(--color-slate-400)' }}>({item.source})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Sollstärken-Check: Vertrag vs. Anwesenheit (Backend: DayAnalysis.workforce) */}
              {(dayAnalysis.workforce ?? []).map((gap) => (
                <div
                  key={`wf-${gap.contractId}`}
                  style={{ fontSize: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}
                >
                  <strong>
                    👷 {gap.company || gap.trade || gap.contractTitle}: {gap.actual} statt {gap.planned} Personen (−{gap.shortfallPercent} %)
                  </strong>
                  {gap.consecutiveDays > 1 && <span> • seit {gap.consecutiveDays} Tagen</span>}
                  <div style={{ color: 'var(--color-slate-500)', marginTop: '2px' }}>
                    Quelle: {gap.source} • Vertrag: {gap.contractSource}
                  </div>
                  {gap.vobHints.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                      {gap.vobHints.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  )}
                  {gap.suggestion && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: '11px', padding: '4px 10px', backgroundColor: '#b91c1c', whiteSpace: 'nowrap' }}
                        onClick={() =>
                          navigate('/drafts', { state: { type: gap.suggestion!.draftType, keywords: gap.suggestion!.prefillText } })
                        }
                      >
                        <Mail size={12} />
                        <span>{gap.suggestion.title}</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {dayAnalysis.deviations.map((dev) => (
                <div
                  key={dev.id}
                  style={{ fontSize: '12px', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 'var(--radius-md)', padding: '8px 10px' }}
                >
                  <strong>{dev.title}</strong> — {dev.cause} <em>({dev.vobReference})</em>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', gap: '8px' }}>
                    <span style={{ color: '#92400e' }}>💡 {dev.suggestedAction}</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '11px', padding: '4px 10px', backgroundColor: '#b45309', whiteSpace: 'nowrap' }}
                      onClick={() =>
                        navigate('/drafts', {
                          state: { type: dev.draftType, keywords: `${dev.title}. Ursache: ${dev.cause}. Auswirkung: ${dev.impact} (Quelle: ${dev.sourceReport})` }
                        })
                      }
                    >
                      <Mail size={12} />
                      <span>{t('drafts_btn_generate')}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                          onClick={() => navigate('/drafts', { state: { type: docSummary.vobRisks[0].linkType ?? 'delay', keywords: `${docSummary.vobRisks[0].title}. ${docSummary.vobRisks[0].description}` } })}
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
