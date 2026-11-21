import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FileText,
  Calendar,
  CloudSun,
  Users,
  Mic,
  Copy,
  Plus,
  CheckCircle2,
  Printer,
  History,
  X,
  Mail,
  FileDown,
  Trash2,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Camera,
  ChevronDown,
  Eye,
  PenLine
} from 'lucide-react';
import { ComingSoonNote, isNotImplemented } from '../components/ComingSoon';
import { addDays, deToIso, isoToDe, toIsoDate as dateToIso, todayIso } from '../utils/dates';
import { useAudioRecorder } from '../utils/useAudioRecorder';
import { useProjects } from '../context/ProjectContext';
import {
  getDiaryEntriesForProject,
  saveProjectDocument,
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

interface CommittedReportSnapshot {
  hasSavedReport: boolean;
  reportDate: string;
  reportNumber: string;
  weather: string;
  temperatureC: string;
  workforceCount: number;
  siteManager: string;
  trades: string[];
  workCompleted: string;
  attendance: AttendanceItem[];
  isFinalized: boolean;
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
  const todayDe = isoToDe(todayIso());

  // History of diary entries for the current project
  const [diaryHistory, setDiaryHistory] = useState<ProjectDocumentItem[]>([]);
  const [referencedDoc, setReferencedDoc] = useState<ProjectDocumentItem | null>(null);

  // 2-Tab View (left: read-only report for selected day, right: edit form) & Header Dropdown
  const [activeReportTab, setActiveReportTab] = useState<'view' | 'edit'>('view');
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);

  // New diary entry form state
  const [reportNumber, setReportNumber] = useState('143');
  const [reportDate, setReportDate] = useState(() => {
    if (navDate && /^\d{4}-\d{2}-\d{2}$/.test(navDate)) {
      const [y, m, d] = navDate.split('-');
      return `${d}.${m}.${y}`;
    }
    return isoToDe(todayIso());
  });
  const isTodaySelected = reportDate === todayDe;
  const [weather, setWeather] = useState('');
  const [workforceCount, setWorkforceCount] = useState<number>(0);
  const [trades, setTrades] = useState<string[]>([]);
  const [newTradeInput, setNewTradeInput] = useState('');
  const [progressText, setProgressText] = useState('');

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

  // Gespeicherte / aktualisierte Ansicht für den linken Tab ("Heutigen Bautagesbericht" / ausgewählter Tag)
  const [committedReport, setCommittedReport] = useState<CommittedReportSnapshot>({
    hasSavedReport: false,
    reportDate,
    reportNumber: '143',
    weather: '',
    temperatureC: '',
    workforceCount: 0,
    siteManager: '',
    trades: [],
    workCompleted: '',
    attendance: [],
    isFinalized: false
  });
  const hasSavedReportNumberRef = useRef(false);

  // Idee #2: Wetter automatisch
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);
  const [weatherHint, setWeatherHint] = useState<string | null>(null);

  // Idee #1: Fotos → Tagebucheintrag
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);

  // Dropdown schließen bei Klick außerhalb oder Escape
  useEffect(() => {
    if (!isHistoryDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target as Node)) {
        setIsHistoryDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsHistoryDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isHistoryDropdownOpen]);

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
    hasSavedReportNumberRef.current = false;

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
          const hasSaved = Boolean(
            report.id != null ||
              report.work_completed ||
              (report.trades && report.trades.length > 0) ||
              (report.attendance && report.attendance.length > 0)
          );
          const nextWeather = report.weather ?? '';
          const nextWorkforce = report.workforce_count ?? 0;
          const nextTrades = report.trades ?? [];
          const nextWorkCompleted = report.work_completed ?? '';
          const nextTemp = report.temperature_c != null ? String(report.temperature_c) : '';
          const nextManager = report.site_manager ?? '';
          const nextAttendance = report.attendance ?? [];
          const nextFinalized = report.status === 'finalized';
          const nextNumber = report.report_number ? String(report.report_number) : reportNumber;

          if (report.report_number) {
            hasSavedReportNumberRef.current = true;
            setReportNumber(String(report.report_number));
          }
          setWeather(nextWeather);
          setWorkforceCount(nextWorkforce);
          setTrades(nextTrades);
          setProgressText(nextWorkCompleted);
          setTemperatureC(nextTemp);
          setSiteManager(nextManager);
          setAttendance(nextAttendance);
          setIsFinalized(nextFinalized);
          setDayAnalysis(null);

          setCommittedReport({
            hasSavedReport: hasSaved,
            reportDate,
            reportNumber: nextNumber,
            weather: nextWeather,
            temperatureC: nextTemp,
            workforceCount: nextWorkforce,
            siteManager: nextManager,
            trades: nextTrades,
            workCompleted: nextWorkCompleted,
            attendance: nextAttendance,
            isFinalized: nextFinalized
          });
        }
      } catch (err) {
        console.warn('Backend getReport Fallback:', err);
        if (cancelled) return;
        const localMatch = getDiaryEntriesForProject(activeProject.id).find((d) => d.date === reportDate);
        if (localMatch) {
          const nextWeather = localMatch.weather ?? '';
          const nextWorkforce = localMatch.workforceCount ?? 0;
          const nextTrades = localMatch.trades ?? [];
          const nextWorkCompleted = localMatch.content ?? '';
          setWeather(nextWeather);
          setWorkforceCount(nextWorkforce);
          setTrades(nextTrades);
          setProgressText(nextWorkCompleted);
          setTemperatureC('');
          setSiteManager(localMatch.authorOrSender ?? '');
          setAttendance([]);
          setIsFinalized(false);
          setCommittedReport({
            hasSavedReport: true,
            reportDate,
            reportNumber,
            weather: nextWeather,
            temperatureC: '',
            workforceCount: nextWorkforce,
            siteManager: localMatch.authorOrSender ?? '',
            trades: nextTrades,
            workCompleted: nextWorkCompleted,
            attendance: [],
            isFinalized: false
          });
        } else {
          setWeather('');
          setWorkforceCount(0);
          setTrades([]);
          setProgressText('');
          setTemperatureC('');
          setSiteManager('');
          setAttendance([]);
          setIsFinalized(false);
          setCommittedReport({
            hasSavedReport: false,
            reportDate,
            reportNumber,
            weather: '',
            temperatureC: '',
            workforceCount: 0,
            siteManager: '',
            trades: [],
            workCompleted: '',
            attendance: [],
            isFinalized: false
          });
        }
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

    // Nächste Berichtsnummer aus dem neuesten Bericht ableiten (nur falls Tag noch keine Nummer hat)
    if (!hasSavedReportNumberRef.current) {
      const latest = combined.find((c) => /Nr\.\s*\d+/i.test(c.title));
      const match = latest?.title.match(/Nr\.\s*(\d+)/i);
      if (match) setReportNumber(String(parseInt(match[1], 10) + 1));
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

  // Nur Bautagesberichte von heute und der Vergangenheit für das Dropdown "Letzte Einträge" (keine Schreiberfassung/Spracherfassung)
  const todayIsoStr = todayIso();
  const dropdownReports = diaryHistory.filter((item) => {
    const isReport = item.id.startsWith('report-') || /\bbautagesbericht\b/i.test(item.title);
    const isCaptureNote = /schreiberfassung|spracherfassung/i.test(item.title);
    const itemIso = toIsoDate(item.date);
    const isTodayOrPast = /^\d{4}-\d{2}-\d{2}$/.test(itemIso) ? itemIso <= todayIsoStr : true;
    return isReport && !isCaptureNote && isTodayOrPast && item.date !== todayDe;
  });

  // Auswahl eines Eintrags/Tags aus dem Dropdown "Letzte Einträge"
  const handleSelectDateFromDropdown = (targetDate: string) => {
    setReportDate(targetDate);
    setReferencedDoc(null);
    setActiveReportTab('view');
    setIsHistoryDropdownOpen(false);
  };

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
    setActiveReportTab('edit');
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
        const nextProgress = res.work_completed ?? progressText;
        const nextTrades = res.trades && res.trades.length > 0 ? res.trades : trades;
        const nextWeather = res.weather ?? weather;
        const nextWorkforce = res.workforce_count ?? workforceCount;

        if (res.work_completed) setProgressText(res.work_completed);
        if (res.trades && res.trades.length > 0) setTrades(res.trades);
        if (res.weather) setWeather(res.weather);
        if (res.workforce_count) setWorkforceCount(res.workforce_count);
        setDayAnalysis(null);

        setCommittedReport((prev) => ({
          ...prev,
          hasSavedReport: true,
          reportDate,
          workCompleted: nextProgress,
          trades: nextTrades,
          weather: nextWeather,
          workforceCount: nextWorkforce
        }));
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

  // Speichern / Aktualisieren: PUT /api/reports/{date}. Nur wenn das Backend nicht erreichbar ist, lokal sichern.
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
        content: [
          `Bautagesbericht Nr. ${reportNumber} — Datum: ${reportDate}`,
          `Wetter: ${weather}`,
          `Personal: ${workforceCount} (${trades.join(', ')})`,
          `Tagesleistung: ${progressText}`,
          referencedDoc ? `[Bezug auf: ${referencedDoc.title} (${referencedDoc.date})]` : ''
        ].filter(Boolean).join('\n')
      });
    }

    hasSavedReportNumberRef.current = true;
    setCommittedReport({
      hasSavedReport: true,
      reportDate,
      reportNumber,
      weather,
      temperatureC,
      workforceCount,
      siteManager: siteManager.trim() || userName,
      trades: [...trades],
      workCompleted: progressText,
      attendance: attendance
        .filter((a) => (a.company && a.company.trim()) || (a.trade && a.trade.trim()) || a.workers > 0)
        .map((a) => ({ ...a })),
      isFinalized
    });
    setActiveReportTab('view');

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
            <FileText size={22} />
          </div>
          <div>
            <h1 className="reports-title">{t('rep_title')}</h1>
            <p className="reports-subtitle">
              {t('rep_sub')} <strong>{activeProject.name}</strong> ({activeProject.number}) • {t('rep_author')} {userName}
            </p>
          </div>
        </div>

        <div className="reports-header-actions">
          <div className="reports-history-dropdown" ref={historyDropdownRef}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsHistoryDropdownOpen((prev) => !prev)}
              aria-expanded={isHistoryDropdownOpen}
              title={t('rep_history_title')}
            >
              <History size={16} />
              <span>{t('rep_history_title')}</span>
              <ChevronDown size={15} />
            </button>

            {isHistoryDropdownOpen && (
              <div className="reports-history-dropdown-menu" role="menu">
                <div className="reports-history-dropdown-header">
                  <span>Bautagesbericht auswählen</span>
                  <span className="history-badge">{1 + dropdownReports.length}</span>
                </div>

                <div className="reports-history-dropdown-list">
                  <button
                    type="button"
                    className={`reports-history-dropdown-item ${isTodaySelected ? 'active' : ''}`}
                    onClick={() => handleSelectDateFromDropdown(todayDe)}
                  >
                    <div className="reports-history-dropdown-item-top">
                      <span>Heutiger Bautagesbericht</span>
                      <span className="reports-history-dropdown-item-date">Heute, {todayDe}</span>
                    </div>
                    <div className="reports-history-dropdown-item-sub">
                      Aktuellen Tagesbericht anzeigen &amp; verfassen
                    </div>
                  </button>

                  {dropdownReports.length === 0 ? (
                    <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
                      Keine weiteren vergangenen Bautagesberichte vorhanden.
                    </div>
                  ) : (
                    dropdownReports.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`reports-history-dropdown-item ${item.date === reportDate ? 'active' : ''}`}
                        onClick={() => handleSelectDateFromDropdown(item.date)}
                      >
                        <div className="reports-history-dropdown-item-top">
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                          </span>
                          <span className="reports-history-dropdown-item-date">{item.date}</span>
                        </div>
                        <div className="reports-history-dropdown-item-sub">
                          {item.authorOrSender}
                          {item.content ? ` • ${item.content}` : ''}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
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
            ✓ {activeProject.name}: Änderungen gespeichert
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

      {/* Main Grid: 2-Tab Report View & Editor */}
      <div className="reports-grid">
        <div className="reports-folder-shell">
          <div className="reports-folder-tabs" role="tablist" aria-label="Bautagesbericht-Ansicht">
            <button
              type="button"
              role="tab"
              aria-selected={activeReportTab === 'view'}
              className={`reports-folder-tab ${activeReportTab === 'view' ? 'active' : ''}`}
              onClick={() => setActiveReportTab('view')}
            >
              <Eye size={15} />
              <span>{isTodaySelected ? 'Heutiger Bautagesbericht' : `Bautagesbericht (${reportDate})`}</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeReportTab === 'edit'}
              className={`reports-folder-tab ${activeReportTab === 'edit' ? 'active' : ''}`}
              onClick={() => setActiveReportTab('edit')}
            >
              <PenLine size={15} />
              <span>{isTodaySelected ? t('rep_editor_title') : `Bearbeitung (${reportDate})`}</span>
            </button>
          </div>

          {/* 2-TAB REPORT VIEW & EDITOR */}
          <div className="editor-panel reports-folder-panel">
            <div className="editor-header">
              <div className="editor-title">
                {activeReportTab === 'view' ? <Eye size={18} /> : <PenLine size={18} />}
                <span>
                  {activeReportTab === 'view'
                    ? isTodaySelected
                      ? 'Aktuelle Tagesübersicht'
                      : `Tagesübersicht vom ${reportDate}`
                    : isTodaySelected
                    ? 'Tagesbericht bearbeiten'
                    : `Bearbeitung (${reportDate})`}
                </span>
              </div>

              <div className="editor-toolbar">
                <button
                  type="button"
                  className={`history-btn-small ${isRecording ? 'recording-active' : ''}`}
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

          {!isTodaySelected && (
            <div className="reports-day-indicator">
              <Calendar size={14} color="var(--color-primary)" />
              <span>
                Ausgewählter Tag: <strong>{reportDate}</strong>
              </span>
              <button
                type="button"
                className="reports-day-reset-btn"
                onClick={() => handleSelectDateFromDropdown(todayDe)}
              >
                Zurück zu heute ({todayDe})
              </button>
            </div>
          )}

          {/* TAB 1 (LEFT): AKTUELLER / AUSGEWÄHLTER BAUTAGESBERICHT */}
          {activeReportTab === 'view' && (
            <div className="report-view-body">
              {!committedReport.hasSavedReport ? (
                <div className="report-view-empty">
                  <FileText size={28} color="var(--color-primary)" />
                  <div>
                    Für den <strong>{reportDate}</strong> liegt noch kein gespeicherter Bautagesbericht vor.
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setActiveReportTab('edit')}
                  >
                    <PenLine size={15} />
                    <span>{isTodaySelected ? t('rep_editor_title') : `Bericht für ${reportDate} verfassen`}</span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="report-view-top">
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                        Bautagesbericht Nr. {committedReport.reportNumber || '—'} • {committedReport.reportDate}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Projekt: {activeProject.name} ({activeProject.number})
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span className={`badge ${committedReport.isFinalized ? 'badge-success' : 'badge-info'}`}>
                        {committedReport.isFinalized ? 'Abgeschlossen' : 'Entwurf'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => setActiveReportTab('edit')}
                      >
                        <PenLine size={14} />
                        <span>Bearbeiten</span>
                      </button>
                    </div>
                  </div>

                  <div className="report-view-meta-grid">
                    <div className="report-view-meta-card">
                      <span className="report-view-meta-label">{t('rep_form_date')}</span>
                      <span className="report-view-meta-value">{committedReport.reportDate}</span>
                    </div>

                    <div className="report-view-meta-card">
                      <span className="report-view-meta-label">{t('rep_form_weather')}</span>
                      <span className="report-view-meta-value">
                        {[
                          committedReport.weather || null,
                          committedReport.temperatureC ? `${committedReport.temperatureC} °C` : null
                        ]
                          .filter(Boolean)
                          .join(' • ') || '—'}
                      </span>
                    </div>

                    <div className="report-view-meta-card">
                      <span className="report-view-meta-label">{t('rep_form_workforce')}</span>
                      <span className="report-view-meta-value">
                        {committedReport.workforceCount} Personen
                      </span>
                    </div>

                    <div className="report-view-meta-card">
                      <span className="report-view-meta-label">Bauleitung</span>
                      <span className="report-view-meta-value">
                        {committedReport.siteManager || userName}
                      </span>
                    </div>
                  </div>

                  {committedReport.attendance.length > 0 && (
                    <div className="report-view-section">
                      <div className="report-view-section-title">
                        Anwesenheit je Firma ({committedReport.attendance.reduce((s, a) => s + (a.workers || 0), 0)} Personen)
                      </div>
                      <table className="report-view-table">
                        <thead>
                          <tr>
                            <th>Firma</th>
                            <th>Gewerk</th>
                            <th>Arbeitskräfte</th>
                            <th>Std.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {committedReport.attendance.map((a, idx) => (
                            <tr key={idx}>
                              <td>{a.company || '—'}</td>
                              <td>{a.trade || '—'}</td>
                              <td>{a.workers}</td>
                              <td>{a.hours != null ? `${a.hours} h` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {committedReport.trades.length > 0 && (
                    <div className="report-view-section">
                      <div className="report-view-section-title">
                        {t('rep_form_trades')} ({committedReport.trades.length})
                      </div>
                      <div className="trades-chips" style={{ marginTop: 0 }}>
                        {committedReport.trades.map((trade) => (
                          <span key={trade} className="trade-chip">
                            {trade}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="report-view-section">
                    <div className="report-view-section-title">{t('rep_form_progress')}</div>
                    <div className="report-view-text">
                      {committedReport.workCompleted.trim() || 'Keine Angaben zur Tagesleistung erfasst.'}
                    </div>
                  </div>

                  {photos.length > 0 && (
                    <div className="report-view-section">
                      <div className="report-view-section-title">Baustellenfotos ({photos.length})</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {photos.map((p) => (
                          <img
                            key={p.photoId ?? p.url}
                            src={p.url}
                            alt={p.fileName}
                            style={{ width: '130px', height: '85px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="editor-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleAnalyzeDay}
                      disabled={isAnalyzing}
                    >
                      <TrendingUp size={16} />
                      <span>{isAnalyzing ? 'Analysiere…' : 'Tag analysieren'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveReport}
                    >
                      <CheckCircle2 size={16} />
                      <span>Änderungen speichern</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 2 (RIGHT): BEARBEITUNG */}
          {activeReportTab === 'edit' && (
            <>
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
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span>{t('rep_form_weather')}</span>
                    {/* Idee #2: Wetter automatisch (Backend folgt: GET /api/weather) */}
                    <button
                      type="button"
                      className="history-btn-small"
                      style={{ padding: '2px 7px', fontSize: '10px' }}
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
                <div className="section-header-row">
                  <label className="form-label" style={{ margin: 0 }}>
                    Anwesenheit je Firma ({attendance.reduce((s, a) => s + (a.workers || 0), 0)} Personen)
                  </label>
                  <div className="section-header-actions">
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
                  <div className="attendance-list">
                    {attendance.map((a, idx) => {
                      const planned = plannedFor(a.company);
                      const below = planned != null && a.workers < planned;
                      return (
                        <div key={idx} className="attendance-row">
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
                            className="history-btn-small danger-tint"
                            onClick={() => setAttendance(attendance.filter((_, i) => i !== idx))}
                            title="Zeile entfernen"
                          >
                            <Trash2 size={12} />
                          </button>
                          {below && (
                            <div style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#b91c1c' }}>
                              Hinweis: Unter Sollstärke laut Vertrag ({a.workers} von {planned})
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
                <div className="section-header-row">
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

                <div className="trade-add-row">
                  <input
                    type="text"
                    className="form-input"
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
                  <button type="button" className="btn btn-secondary" onClick={handleAddTrade} title="Gewerk hinzufügen">
                    <Plus size={15} />
                    <span>Hinzufügen</span>
                  </button>
                </div>
              </div>

              {/* Idee #1: Foto → Tagebucheintrag (POST /api/photos) */}
              <div className="form-group">
                <div className="section-header-row">
                  <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    Baustellenfotos ({photos.length})
                  </label>
                  <label className="history-btn-small" style={{ cursor: 'pointer' }}>
                    <Camera size={12} />
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
                        style={{ width: '150px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', overflow: 'hidden', fontSize: '11px', backgroundColor: 'var(--bg-surface)' }}
                      >
                        <img src={p.url} alt={p.fileName} style={{ width: '100%', height: '90px', objectFit: 'cover', display: 'block' }} />
                        <div style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {p.status === 'analyzing' && <span>KI analysiert…</span>}
                          {p.status === 'done' && p.result && (
                            <>
                              <span><strong>{p.result.caption}</strong></span>
                              {p.result.issues.length > 0 && <span style={{ color: '#b91c1c' }}>Mängel: {p.result.issues.join(', ')}</span>}
                            </>
                          )}
                          {p.status === 'unavailable' && <span style={{ color: '#92400e' }}>Fotoanalyse folgt (Backend)</span>}
                          {p.status === 'error' && <span style={{ color: '#b91c1c' }}>{p.error}</span>}
                          <button
                            type="button"
                            className="history-btn-small danger-tint"
                            style={{ alignSelf: 'flex-start' }}
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

              {/* Save & Action Footer */}
              <div className="editor-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setProgressText('');
                    setReferencedDoc(null);
                  }}
                >
                  {t('btn_clear')}
                </button>

                <div className="editor-footer-actions">
                  <label
                    className={`finalize-checkbox-chip ${isFinalized ? 'active' : ''}`}
                    title="Abgeschlossene Berichte werden ohne ENTWURF-Wasserzeichen exportiert"
                  >
                    <input
                      type="checkbox"
                      checked={isFinalized}
                      onChange={(e) => setIsFinalized(e.target.checked)}
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
                    className="btn btn-primary"
                    onClick={handleSaveReport}
                  >
                    <CheckCircle2 size={16} />
                    <span>Änderungen speichern</span>
                  </button>
                </div>
              </div>
            </>
          )}

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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <Users size={12} />
                    {dayAnalysis.stats.workers} Personen
                    {dayAnalysis.stats.plannedWorkers != null ? ` (Soll ${dayAnalysis.stats.plannedWorkers})` : ''}
                  </span>
                )}
                {dayAnalysis.stats.hours != null && <span>{dayAnalysis.stats.hours} Std.</span>}
                {dayAnalysis.stats.weather && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <CloudSun size={12} />
                    {dayAnalysis.stats.weather}
                  </span>
                )}
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
                    {gap.company || gap.trade || gap.contractTitle}: {gap.actual} statt {gap.planned} Personen (−{gap.shortfallPercent} %)
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px', gap: '8px' }}>
                    <span style={{ color: '#92400e', flex: '1 1 220px' }}>Empfehlung: {dev.suggestedAction}</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '11px', padding: '5px 10px', backgroundColor: '#b45309', whiteSpace: 'nowrap' }}
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
      </div>
    </div>
  );
};

export default DailyReports;
