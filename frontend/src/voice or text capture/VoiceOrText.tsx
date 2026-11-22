import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  Square,
  Play,
  Pause,
  Tags,
  Plus,
  X,
  FileText,
  AlertTriangle,
  DollarSign,
  Package,
  CheckCircle2,
  Mail,
  HardHat,
  Trash2,
  PenLine
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { saveProjectDocument } from '../context/ProjectDocuments';
import { useLanguage } from '../context/LanguageContext';
import { api, NoticeDraft, NoticeType } from '../services/api';
import { todayIso } from '../utils/dates';
import { useAudioRecorder } from '../utils/useAudioRecorder';
import '@frontend/src/index.css';
import './VoiceOrText.css';

interface CategoryBullets {
  progress: string[];
  hindrance: string[];
  cost: string[];
  defect: string[];
  delivery: string[];
}

interface CustomTextTemplate {
  id: string;
  title: string;
  text: string;
}

const CUSTOM_TEMPLATES_STORAGE_KEY = 'site_assistant_custom_text_templates';

const AUDIO_CATEGORY_OPTIONS: {
  key: keyof CategoryBullets;
  labelKey: string;
  renderIcon: () => React.ReactNode;
}[] = [
  { key: 'progress', labelKey: 'cap_cat_progress', renderIcon: () => <HardHat size={15} color="#2563eb" /> },
  { key: 'hindrance', labelKey: 'cap_cat_hindrance', renderIcon: () => <AlertTriangle size={15} color="#ef4444" /> },
  { key: 'cost', labelKey: 'cap_cat_cost', renderIcon: () => <DollarSign size={15} color="#d97706" /> },
  { key: 'defect', labelKey: 'cap_cat_defect', renderIcon: () => <AlertTriangle size={15} color="#7c3aed" /> },
  { key: 'delivery', labelKey: 'cap_cat_delivery', renderIcon: () => <Package size={15} color="#059669" /> }
];

export interface VoiceOrTextProps {
  mode?: 'voice' | 'text';
}

export const VoiceOrText: React.FC<VoiceOrTextProps> = ({ mode = 'voice' }) => {
    const navigate = useNavigate();
  const { t, tf } = useLanguage();
  const { activeProject } = useProjects();
  const userName = localStorage.getItem('userName') || t('role_site_manager');
  const isVoiceMode = mode === 'voice';

  // Audio Recording States
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioTranscript, setAudioTranscript] = useState('');
  const [selectedAudioCategories, setSelectedAudioCategories] = useState<(keyof CategoryBullets)[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Bottom action toggles: "In Bautagesbericht" is always selected by default; "In Brief umwandeln" can be added
  const [targetDailyReport, setTargetDailyReport] = useState(true);
  const [targetLetterDraft, setTargetLetterDraft] = useState(false);
  const [isExecutingActions, setIsExecutingActions] = useState(false);

  // General notes field (Sonstige Notizen)
  const [generalNotes, setGeneralNotes] = useState(
    'Bewehrung Decke 1. OG zu 80% fertig. Hydraulikdefekt an 24t Kettenbagger Tiefbau seit 10:15 Uhr behoben. TGA-Freigabepläne für Schacht 3 fehlen weiterhin, Durchbrüche können nicht geschalt werden. 2x Sattelzug Betonstahl B500B angeliefert.'
  );

  // Categorized bullet points state
  const [categories, setCategories] = useState<CategoryBullets>({
    progress: ['Decke über 1. OG Bauteil B zu 80% bewehrt', '12 Rohbauer Fa. BetonTech vor Ort'],
    hindrance: ['Hydraulikdefekt an Kettenbagger 24t Tiefbau (4,5h Stillstand)', 'Freigabepläne TGA Schacht 3 fehlen'],
    cost: ['Mehraufwand Stillstandszeiten Rammgerät', 'Zusätzliche Wasserhaltung'],
    defect: ['Feuchtigkeitseintritt im Treppenhauskern 2 nach Starkregen'],
    delivery: ['2x Sattelzug Betonstahl B500B angeliefert', 'Lieferschein 4481 gegengezeichnet']
  });

  // Inputs for adding a bullet to a specific category
  const [newInputs, setNewInputs] = useState<Record<string, string>>({
    progress: '',
    hindrance: '',
    cost: '',
    defect: '',
    delivery: ''
  });

  const [aiClassifiedSuccess, setAiClassifiedSuccess] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastDraft, setLastDraft] = useState<NoticeDraft | null>(null);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  // Jeder POST /api/capture legt im Backend eine Notiz UND einen Brief-Entwurf an,
  // POST /api/reports/{date}/fill ebenfalls eine Notiz → nichts doppelt auslösen.
  const lastCapturedTextRef = useRef<string | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);

  // User-created custom text templates (stored in localStorage, empty by default)
  const [customTemplates, setCustomTemplates] = useState<CustomTextTemplate[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState('');
  const [newTemplateText, setNewTemplateText] = useState('');

  const toggleAudioCategory = (catKey: keyof CategoryBullets) => {
    setSelectedAudioCategories((prev) =>
      prev.includes(catKey) ? prev.filter((k) => k !== catKey) : [...prev, catKey]
    );
  };

  // Audio Playback Listener
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.onended = () => setIsPlayingAudio(false);
    }
  }, [audioUrl]);

  // Mikrofon-Aufnahme (gemeinsamer Hook) → Wiedergabe + Transkription (Whisper) → KI-Kategorisierung.
  // Kein erfundener Ersatztext mehr, wenn Mikrofon oder Transkription fehlen: lieber Hinweis + selbst tippen.
  const recorder = useAudioRecorder(async (audioBlob) => {
    setAudioUrl(URL.createObjectURL(audioBlob));
    setIsTranscribing(true);
    try {
      const res = await api.transcribeAudio(audioBlob);
      if (res?.text?.trim()) {
        setAudioTranscript(res.text);
        setGeneralNotes((prev) => (prev ? prev + '\n' + res.text : res.text));
        handleAutoCategorize(res.text);
      } else {
        setAudioTranscript(t('cap_tr_unavailable'));
      }
    } catch (err) {
      console.warn('Transkription fehlgeschlagen:', err);
      setAudioTranscript(t('cap_tr_failed'));
    } finally {
      setIsTranscribing(false);
    }
  });
  const isRecording = recorder.isRecording;

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);


  const handleStartRealRecording = async () => {
    if (!(await recorder.start())) {
      alert(t('cap_mic_unavailable'));
    }
  };

  const handleStopRecording = () => recorder.stop();

  const handleTogglePlayback = () => {
    if (!audioUrl) return;
    if (audioElementRef.current) {
      if (isPlayingAudio) {
        audioElementRef.current.pause();
        setIsPlayingAudio(false);
      } else {
        audioElementRef.current.play();
        setIsPlayingAudio(true);
      }
    }
  };

  // Add bullet point to category
  const handleAddBullet = (catKey: keyof CategoryBullets) => {
    const val = newInputs[catKey]?.trim();
    if (!val) return;
    setCategories((prev) => ({
      ...prev,
      [catKey]: [...prev[catKey], val]
    }));
    setNewInputs((prev) => ({ ...prev, [catKey]: '' }));
  };

  // Remove bullet point from category
  const handleRemoveBullet = (catKey: keyof CategoryBullets, index: number) => {
    setCategories((prev) => ({
      ...prev,
      [catKey]: prev[catKey].filter((_, i) => i !== index)
    }));
  };

  const persistCustomTemplates = (next: CustomTextTemplate[]) => {
    setCustomTemplates(next);
    try {
      localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('Textvorlagen konnten nicht gespeichert werden:', err);
    }
  };

  const handleInsertCustomTemplate = (templateText: string) => {
    setGeneralNotes((prev) => (prev.trim() ? `${prev}\n${templateText}` : templateText));
  };

  const handleCreateCustomTemplate = () => {
    const cleanText = newTemplateText.trim();
    if (!cleanText) return;
    const cleanTitle = newTemplateTitle.trim() || cleanText.slice(0, 40) + (cleanText.length > 40 ? '…' : '');
    const created: CustomTextTemplate = {
      id: `tpl-${Date.now()}`,
      title: cleanTitle,
      text: cleanText
    };
    persistCustomTemplates([created, ...customTemplates]);
    setNewTemplateTitle('');
    setNewTemplateText('');
    setIsAddingTemplate(false);
  };

  const handleDeleteCustomTemplate = (id: string) => {
    persistCustomTemplates(customTemplates.filter((tpl) => tpl.id !== id));
  };

  // AI Categorization: Parse general notes into categories via backend API or fallback
  const handleAutoCategorize = async (textToParse = generalNotes) => {
    if (!textToParse.trim()) return;
    // gleicher Text wurde schon erfasst → kein zweiter Tagebucheintrag / Brief-Entwurf
    if (lastCapturedTextRef.current === textToParse.trim()) {
      setAiClassifiedSuccess(true);
      setTimeout(() => setAiClassifiedSuccess(false), 3000);
      return;
    }

    setIsCapturing(true);
    setAiQuestions([]);

    try {
      const draft = await api.captureText({
        text: textToParse,
        project_id: Number(activeProject.id)
      });
      setLastDraft(draft);
      if (draft.site_note_id) lastCapturedTextRef.current = textToParse.trim();

      if (draft.questions && draft.questions.length > 0) {
        setAiQuestions(draft.questions);
      }

      // Map fields from backend into UI categories
      const updated = { ...categories };
      const fields = draft.fields || {};
      const cause = fields.cause?.value || fields.reason?.value || '';
      const impact = fields.impact?.value || '';
      const summaryPoint = cause || textToParse.slice(0, 60);

      if (draft.type === 'delay') {
        if (!updated.hindrance.includes(summaryPoint)) {
          updated.hindrance = [summaryPoint, ...updated.hindrance];
        }
        if (impact && !updated.hindrance.includes(impact)) {
          updated.hindrance.push(impact);
        }
        setSelectedAudioCategories((prev) => (prev.includes('hindrance') ? prev : [...prev, 'hindrance']));
      } else if (draft.type === 'cost') {
        if (!updated.cost.includes(summaryPoint)) {
          updated.cost = [summaryPoint, ...updated.cost];
        }
        setSelectedAudioCategories((prev) => (prev.includes('cost') ? prev : [...prev, 'cost']));
      } else if (draft.type === 'defect') {
        if (!updated.defect.includes(summaryPoint)) {
          updated.defect = [summaryPoint, ...updated.defect];
        }
        setSelectedAudioCategories((prev) => (prev.includes('defect') ? prev : [...prev, 'defect']));
      } else {
        if (!updated.progress.includes(summaryPoint)) {
          updated.progress = [summaryPoint, ...updated.progress];
        }
        setSelectedAudioCategories((prev) => (prev.includes('progress') ? prev : [...prev, 'progress']));
      }

      setCategories(updated);
      setAiClassifiedSuccess(true);
      setTimeout(() => setAiClassifiedSuccess(false), 5000);
    } catch (err) {
      console.warn('Backend KI-Erfassung Fallback:', err);
      // Fallback detection rules based on construction terms
      const lower = textToParse.toLowerCase();
      const updated = { ...categories };
      const detectedAudioCats: (keyof CategoryBullets)[] = [];

      if (lower.includes('bewehrt') || lower.includes('beton') || lower.includes('fertig') || lower.includes('rohbau')) {
        if (!updated.progress.includes('Bewehrung & Rohbauarbeiten Decke 1. OG')) {
          updated.progress = [...updated.progress, 'Bewehrung & Rohbauarbeiten Decke 1. OG'];
        }
        detectedAudioCats.push('progress');
      }
      if (lower.includes('bagger') || lower.includes('defekt') || lower.includes('stillstand') || lower.includes('fehlt') || lower.includes('schacht')) {
        if (!updated.hindrance.includes('Stillstand Bagger / Fehlende TGA-Freigabe Schacht 3')) {
          updated.hindrance = [...updated.hindrance, 'Stillstand Bagger / Fehlende TGA-Freigabe Schacht 3'];
        }
        detectedAudioCats.push('hindrance');
      }
      if (lower.includes('mehrkosten') || lower.includes('nachtrag') || lower.includes('altfundament') || lower.includes('meißel')) {
        if (!updated.cost.includes('Mehraufwand & Gerätestillstand Baugrund')) {
          updated.cost = [...updated.cost, 'Mehraufwand & Gerätestillstand Baugrund'];
        }
        detectedAudioCats.push('cost');
      }
      if (lower.includes('feuchtigkeit') || lower.includes('mangel') || lower.includes('riss') || lower.includes('regen')) {
        if (!updated.defect.includes('Feuchtigkeitskontrolle im Treppenhaus erforderlich')) {
          updated.defect = [...updated.defect, 'Feuchtigkeitskontrolle im Treppenhaus erforderlich'];
        }
        detectedAudioCats.push('defect');
      }
      if (lower.includes('angeliefert') || lower.includes('sattelzug') || lower.includes('stahl') || lower.includes('lieferschein')) {
        if (!updated.delivery.includes('Lieferung 2x Sattelzug Bewehrungsstahl B500B erfasst')) {
          updated.delivery = [...updated.delivery, 'Lieferung 2x Sattelzug Bewehrungsstahl B500B erfasst'];
        }
        detectedAudioCats.push('delivery');
      }

      if (detectedAudioCats.length > 0) {
        setSelectedAudioCategories((prev) => Array.from(new Set([...prev, ...detectedAudioCats])));
      }
      setCategories(updated);
      setAiClassifiedSuccess(true);
      setTimeout(() => setAiClassifiedSuccess(false), 3000);
    } finally {
      setIsCapturing(false);
    }
  };

  const buildCapturePayload = () => {
    const selectedLabels = AUDIO_CATEGORY_OPTIONS
      .filter((opt) => selectedAudioCategories.includes(opt.key))
      .map((opt) => t(opt.labelKey));

    if (isVoiceMode) {
      const catSummary = selectedLabels.length > 0 ? selectedLabels.join(', ') : 'Keine Kategorie gewählt';
      const transcriptText = audioTranscript.trim();
      const combinedText = [transcriptText, selectedLabels.length > 0 ? `Kategorien: ${catSummary}` : '']
        .filter(Boolean)
        .join('\n');

      const preferredType: NoticeType = selectedAudioCategories.includes('hindrance')
        ? 'delay'
        : selectedAudioCategories.includes('cost')
          ? 'cost'
          : selectedAudioCategories.includes('defect')
            ? 'defect'
            : 'delay';

      return {
        modeLabel: 'Spracherfassung',
        titleSnippet: (transcriptText || catSummary).slice(0, 35),
        hasIncident: selectedAudioCategories.includes('hindrance') || selectedAudioCategories.includes('defect'),
        combinedText: combinedText || 'Sprachaufnahme erfasst',
        keywords: transcriptText || catSummary,
        preferredType,
        selectedLabels
      };
    }

    const combinedText = [
      generalNotes.trim(),
      categories.progress.length ? `Baufortschritt: ${categories.progress.join('; ')}` : '',
      categories.hindrance.length ? `Behinderungen: ${categories.hindrance.join('; ')}` : '',
      categories.cost.length ? `Mehrkosten: ${categories.cost.join('; ')}` : '',
      categories.defect.length ? `Mängel: ${categories.defect.join('; ')}` : '',
      categories.delivery.length ? `Lieferungen: ${categories.delivery.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    const preferredType: NoticeType =
      categories.hindrance.length > 0
        ? 'delay'
        : categories.cost.length > 0
          ? 'cost'
          : categories.defect.length > 0
            ? 'defect'
            : 'delay';

    const keywords =
      preferredType === 'cost'
        ? categories.cost.join('. ') || generalNotes.trim()
        : preferredType === 'defect'
          ? categories.defect.join('. ') || generalNotes.trim()
          : categories.hindrance.join('. ') || generalNotes.trim();

    return {
      modeLabel: 'Schreiberfassung',
      titleSnippet: generalNotes.slice(0, 35),
      hasIncident: categories.hindrance.length > 0,
      combinedText,
      keywords,
      preferredType,
      selectedLabels
    };
  };

  // Save current capture to Project Diary & Backend DB
  const handleSaveToDiary = async (showToast = true) => {
    const today = new Date().toLocaleDateString('de-DE');
    const payload = buildCapturePayload();
    const content = isVoiceMode
      ? `${payload.modeLabel} — ${today}
Bauprojekt: ${activeProject.name} (${activeProject.number})
Erfasser: ${userName}
Ausgewählte Kategorien: ${payload.selectedLabels.join(', ') || 'Keine Auswahl'}

Transkript / Sprachnotiz:
${audioTranscript || 'Audio-Aufnahme ohne Transkript'}`.trim()
      : `${payload.modeLabel} — ${today}
Bauprojekt: ${activeProject.name} (${activeProject.number})
Erfasser: ${userName}

Allgemeine Notizen:
${generalNotes}

Kategorisierte Stichpunkte:
- Baufortschritt: ${categories.progress.join('; ') || 'Keine Angaben'}
- Behinderungen (§ 6 VOB/B): ${categories.hindrance.join('; ') || 'Keine'}
- Mehrkosten & Nachträge (§ 2 VOB/B): ${categories.cost.join('; ') || 'Keine'}
- Mängel / Qualität: ${categories.defect.join('; ') || 'Keine'}
- Lieferungen & Material: ${categories.delivery.join('; ') || 'Keine'}`.trim();

    // Zweimal „Speichern“ ohne Änderung → kein zweiter identischer Eintrag
    if (lastSavedContentRef.current === content) {
      if (showToast) {
        setSaveSuccessMsg(true);
        setTimeout(() => setSaveSuccessMsg(false), 4000);
      }
      return;
    }

    // Tagebucheintrag im Backend; nur wenn das scheitert, lokal sichern (vorher immer doppelt gespeichert)
    try {
      await api.createSiteNote({
        project_id: Number(activeProject.id),
        content,
        category: payload.hasIncident ? 'incident' : 'progress',
        author: userName
      });
      lastSavedContentRef.current = content;
    } catch (err) {
      console.warn('Backend nicht erreichbar – Notiz lokal gesichert:', err);
      saveProjectDocument({
        id: `doc-${activeProject.id}-quick-${Date.now()}`,
        projectId: activeProject.id,
        type: 'diary',
        title: `${payload.modeLabel}: ${payload.titleSnippet}...`,
        date: today,
        authorOrSender: userName,
        content,
        trades: categories.progress.slice(0, 3),
        hindrance: categories.hindrance.join(', ')
      });
    }

    if (showToast) {
      setSaveSuccessMsg(true);
      setTimeout(() => setSaveSuccessMsg(false), 4000);
    }
  };

  const handleExecuteActions = async () => {
    if (!targetDailyReport && !targetLetterDraft) return;
    setIsExecutingActions(true);
    const payload = buildCapturePayload();
    const reportDate = todayIso();

    try {
      if (targetDailyReport) {
        // /fill trägt in den Bericht ein UND legt selbst den Tagebucheintrag an →
        // eigene Notiz nur, wenn das Backend nicht erreichbar ist (dann ggf. lokal).
        try {
          await api.fillReport(reportDate, {
            text: payload.combinedText,
            project_id: Number(activeProject.id)
          });
        } catch (err) {
          console.warn('Backend fillReport Fallback:', err);
          await handleSaveToDiary(false);
        }
      }

      if (targetLetterDraft) {
        if (lastDraft?.notice_id) {
          navigate('/drafts', { state: { noticeId: lastDraft.notice_id } });
          return;
        }
        try {
          const draft = await api.captureText({
            text: payload.combinedText,
            project_id: Number(activeProject.id),
            force_type: payload.preferredType
          });
          setLastDraft(draft);
          if (draft.notice_id) {
            navigate('/drafts', { state: { noticeId: draft.notice_id } });
            return;
          }
        } catch (err) {
          console.warn('Backend captureText für Briefentwurf Fallback:', err);
        }
        navigate('/drafts', {
          state: { type: payload.preferredType, keywords: payload.keywords }
        });
        return;
      }

      if (targetDailyReport) {
        navigate('/reports', { state: { date: reportDate } });
      }
    } finally {
      setIsExecutingActions(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const renderCustomTemplates = () => (
    <div className="custom-templates-section">
      <div className="custom-templates-header">
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate-700)' }}>
          {tf('cap_tpl_own', { n: customTemplates.length })}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: '11px', padding: '4px 10px' }}
          onClick={() => setIsAddingTemplate((prev) => !prev)}
        >
          {isAddingTemplate ? <X size={12} /> : <Plus size={12} />}
          <span>{isAddingTemplate ? t('btn_cancel') : t('cap_tpl_new')}</span>
        </button>
      </div>

      {isAddingTemplate && (
        <div className="custom-template-form">
          <input
            type="text"
            className="bullet-input"
            placeholder={t('cap_tpl_title_ph')}
            value={newTemplateTitle}
            onChange={(e) => setNewTemplateTitle(e.target.value)}
          />
          <textarea
            className="form-textarea"
            rows={3}
            placeholder={t('cap_tpl_text_ph')}
            value={newTemplateText}
            onChange={(e) => setNewTemplateText(e.target.value)}
          />
          <div className="custom-template-actions">
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => setNewTemplateText(generalNotes)}
              disabled={!generalNotes.trim()}
            >
              {t('cap_tpl_take_current')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '11px', padding: '5px 12px' }}
              onClick={handleCreateCustomTemplate}
              disabled={!newTemplateText.trim()}
            >
              {t('cap_tpl_save')}
            </button>
          </div>
        </div>
      )}

      {customTemplates.length > 0 ? (
        <div className="presets-group">
          {customTemplates.map((tpl) => (
            <div key={tpl.id} className="custom-template-chip">
              <button
                type="button"
                className="custom-template-insert-btn"
                onClick={() => handleInsertCustomTemplate(tpl.text)}
                title={t('cap_tpl_insert')}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <strong>{tpl.title}</strong>
                  {tpl.title !== tpl.text && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                      — {tpl.text.slice(0, 60)}
                      {tpl.text.length > 60 ? '…' : ''}
                    </span>
                  )}
                </span>
                <Plus size={14} color="var(--color-primary)" style={{ flexShrink: 0 }} />
              </button>
              <button
                type="button"
                className="custom-template-delete-btn"
                onClick={() => handleDeleteCustomTemplate(tpl.id)}
                title={t('cap_tpl_delete')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !isAddingTemplate && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            {t('cap_tpl_none')}
          </p>
        )
      )}
    </div>
  );

  const renderAiFeedback = () => (
    <>
      {isTranscribing && (
        <div style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 600 }}>
          {t('cap_transcribing')}
        </div>
      )}

      {aiClassifiedSuccess && (
        <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
          {t('cap_classified')}
        </div>
      )}

      {lastDraft?.notice_id && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px 12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: '#166534'
          }}
        >
          <span>
            ✓ <strong>VOB-Brief #{lastDraft.notice_id}</strong> ({lastDraft.type}) {t('cap_draft_created')}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: '11px', padding: '4px 8px' }}
            onClick={() => navigate('/drafts', { state: { noticeId: lastDraft.notice_id } })}
          >
            {t('cap_to_draft')}
          </button>
        </div>
      )}

      {aiQuestions.length > 0 && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px 12px',
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 'var(--radius-md)',
            fontSize: '12px',
            color: '#92400e'
          }}
        >
          <strong>{t('cap_open_questions')}</strong>
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            {aiQuestions.map((q, idx) => (
              <li key={idx} style={{ marginBottom: '2px' }}>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  const renderGeneralNotesBox = () => (
    <div className="general-notes-box">
      <div className="general-notes-header">
        <span className="general-notes-title">
          <FileText size={16} color="var(--color-slate-700)" />
          <span>{t('cap_general_notes_title')}</span>
        </span>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--color-primary)' }}
          onClick={() => handleAutoCategorize()}
          disabled={isCapturing}
          title={t('cap_btn_auto_categorize')}
        >
          <Tags size={12} />
          <span>{isCapturing ? t('cap_classifying') : t('cap_btn_auto_categorize')}</span>
        </button>
      </div>

      <textarea
        className="form-textarea"
        rows={5}
        placeholder={t('cap_notes_ph')}
        value={generalNotes}
        onChange={(e) => setGeneralNotes(e.target.value)}
      />

      {renderAiFeedback()}

      {renderCustomTemplates()}
    </div>
  );

  return (
    <div className="capture-container">
      {/* Hidden audio element for actual recording playback */}
      {isVoiceMode && audioUrl && (
        <audio ref={audioElementRef} src={audioUrl} />
      )}

      {/* Hero Banner */}
      <section className="capture-hero">
        <div className="capture-hero-left">
          <div className="capture-hero-icon">
            {isVoiceMode ? <Mic size={22} /> : <PenLine size={22} />}
          </div>
          <div>
            <h1 className="capture-hero-title">
              {isVoiceMode ? t('cap_voice_title') : t('cap_text_title')}
            </h1>
          </div>
        </div>
      </section>

      {/* Success Notification */}
      {saveSuccessMsg && (
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
            ✓ {activeProject.name}: {t('btn_save')}
          </span>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '11px', padding: '3px 8px' }}
            onClick={() => setSaveSuccessMsg(false)}
          >
            {t('btn_close')}
          </button>
        </div>
      )}

      {isVoiceMode ? (
        <div className="capture-stack">
          {/* Spracherfassung: Nur Audio-Optionen */}
          <div className="audio-card">
            <div className="audio-header">
              <span className="audio-title">
                <Mic size={18} color="var(--color-primary)" />
                <span>{t('cap_audio_card_title')}</span>
              </span>
              <span className="badge badge-info" style={{ fontSize: '11px' }}>
                {isRecording ? t('cap_mic_active') : t('cap_mic_ready')}
              </span>
            </div>

            {/* Big Mic Button & Waveform Area */}
            <div className={`record-action-area ${isRecording ? 'recording' : ''}`}>
              {!isRecording ? (
                <button
                  type="button"
                  className="big-mic-btn"
                  onClick={handleStartRealRecording}
                  title={t('dash_mic_start')}
                >
                  <Mic size={32} />
                </button>
              ) : (
                <button
                  type="button"
                  className="big-mic-btn recording"
                  onClick={handleStopRecording}
                  title={t('btn_close')}
                >
                  <Square size={28} />
                </button>
              )}

              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: isRecording ? '#dc2626' : 'var(--color-slate-900)' }}>
                  {isRecording ? `${t('cap_mic_active')} (${formatSeconds(recordingSeconds)})` : t('cap_mic_prompt')}
                </div>
                <div style={{fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {isRecording
                    ? t('cap_playback_running')
                    : t('cap_mic_desc')}
                </div>
              </div>

              {/* Animated Waveform during recording */}
              {isRecording && (
                <div className="waveform-bars">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="waveform-bar" />
                  ))}
                </div>
              )}
            </div>

            {/* Playback of recorded audio snippet */}
            {audioUrl && (
              <div className="recorded-player">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '8px', borderRadius: '50%' }}
                    onClick={handleTogglePlayback}
                  >
                    {isPlayingAudio ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-slate-900)' }}>
                      {t('cap_playback_title')}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {isPlayingAudio ? t('cap_playback_running') : t('cap_playback_ready')}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="history-btn-small"
                  onClick={() => {
                    setAudioUrl(null);
                    setAudioTranscript('');
                  }}
                  title={t('btn_delete')}
                >
                  <Trash2 size={12} />
                  <span>{t('btn_delete')}</span>
                </button>
              </div>
            )}

            {/* Realtime Transcribed Text */}
            {audioTranscript && (
              <div
                style={{
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  fontSize: '13px',
                  color: '#1e40af'
                }}
              >
                <strong>{t('cap_transcript')}</strong>
                <div style={{ marginTop: '4px' }}>{audioTranscript}</div>
              </div>
            )}

            {renderAiFeedback()}

            {/* Multi-select Problem / Category Assignment */}
            <div className="audio-category-selector">
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate-700)' }}>
                Kategorie / Problem zuordnen (Mehrfachauswahl möglich):
              </span>
              <div className="audio-category-grid">
                {AUDIO_CATEGORY_OPTIONS.map((opt) => {
                  const isSelected = selectedAudioCategories.includes(opt.key);
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      className={`audio-category-chip ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleAudioCategory(opt.key)}
                      aria-pressed={isSelected}
                    >
                      {opt.renderIcon()}
                      <span>{t(opt.labelKey)}</span>
                      {isSelected && <CheckCircle2 size={14} color="var(--color-primary)" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="capture-stack">
          {/* 1. Kategorisierte Stichpunkte (oben) */}
          <div className="categories-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '14px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                {t('cap_categories_title')}
              </h2>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => handleAutoCategorize()}
            >
              <Tags size={12} />
              <span>{t('cap_btn_reclassify')}</span>
            </button>
          </div>

          {/* Category 1: Baufortschritt & Gewerke */}
          <div className="category-card accent-progress">
            <div className="category-card-header">
              <span className="category-card-title">
                <HardHat size={16} color="#2563eb" />
                <span>{t('cap_cat_progress')} ({categories.progress.length})</span>
              </span>
            </div>

            <div className="bullet-chips">
              {categories.progress.map((bullet, idx) => (
                <span key={idx} className="bullet-chip">
                  <span>{bullet}</span>
                  <X
                    size={12}
                    className="bullet-chip-remove"
                    onClick={() => handleRemoveBullet('progress', idx)}
                  />
                </span>
              ))}
            </div>

            <div className="bullet-input-row">
              <input
                type="text"
                className="bullet-input"
                placeholder={t('cap_bullet_ph')}
                value={newInputs.progress}
                onChange={(e) => setNewInputs({ ...newInputs, progress: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBullet('progress')}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={() => handleAddBullet('progress')}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Category 2: Behinderungen & Störungen (§ 6 VOB/B) */}
          <div className="category-card accent-hindrance">
            <div className="category-card-header">
              <span className="category-card-title">
                <AlertTriangle size={16} color="#ef4444" />
                <span>{t('cap_cat_hindrance')} ({categories.hindrance.length})</span>
              </span>
              {categories.hindrance.length > 0 && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#b91c1c', fontWeight: 600 }}
                  onClick={() => navigate('/drafts', { state: { type: 'delay', keywords: categories.hindrance.join('. ') } })}
                >
                  → {t('btn_generate')}
                </button>
              )}
            </div>

            <div className="bullet-chips">
              {categories.hindrance.map((bullet, idx) => (
                <span key={idx} className="bullet-chip" style={{ backgroundColor: '#fef2f2', borderColor: '#fca5a5' }}>
                  <span>{bullet}</span>
                  <X
                    size={12}
                    className="bullet-chip-remove"
                    onClick={() => handleRemoveBullet('hindrance', idx)}
                  />
                </span>
              ))}
            </div>

            <div className="bullet-input-row">
              <input
                type="text"
                className="bullet-input"
                placeholder={t('cap_bullet_short_ph')}
                value={newInputs.hindrance}
                onChange={(e) => setNewInputs({ ...newInputs, hindrance: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBullet('hindrance')}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={() => handleAddBullet('hindrance')}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Category 3: Mehrkosten & Nachträge (§ 2 VOB/B) */}
          <div className="category-card accent-cost">
            <div className="category-card-header">
              <span className="category-card-title">
                <DollarSign size={16} color="#d97706" />
                <span>{t('cap_cat_cost')} ({categories.cost.length})</span>
              </span>
            </div>

            <div className="bullet-chips">
              {categories.cost.map((bullet, idx) => (
                <span key={idx} className="bullet-chip" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a' }}>
                  <span>{bullet}</span>
                  <X
                    size={12}
                    className="bullet-chip-remove"
                    onClick={() => handleRemoveBullet('cost', idx)}
                  />
                </span>
              ))}
            </div>

            <div className="bullet-input-row">
              <input
                type="text"
                className="bullet-input"
                placeholder={t('cap_bullet_short_ph')}
                value={newInputs.cost}
                onChange={(e) => setNewInputs({ ...newInputs, cost: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBullet('cost')}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={() => handleAddBullet('cost')}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Category 4: Mängel & Qualität (§ 4 / § 13 VOB/B) */}
          <div className="category-card accent-defect">
            <div className="category-card-header">
              <span className="category-card-title">
                <AlertTriangle size={16} color="#7c3aed" />
                <span>{t('cap_cat_defect')} ({categories.defect.length})</span>
              </span>
            </div>

            <div className="bullet-chips">
              {categories.defect.map((bullet, idx) => (
                <span key={idx} className="bullet-chip" style={{ backgroundColor: '#faf5ff', borderColor: '#e9d5ff' }}>
                  <span>{bullet}</span>
                  <X
                    size={12}
                    className="bullet-chip-remove"
                    onClick={() => handleRemoveBullet('defect', idx)}
                  />
                </span>
              ))}
            </div>

            <div className="bullet-input-row">
              <input
                type="text"
                className="bullet-input"
                placeholder={t('cap_bullet_short_ph')}
                value={newInputs.defect}
                onChange={(e) => setNewInputs({ ...newInputs, defect: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBullet('defect')}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={() => handleAddBullet('defect')}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Category 5: Material, Lieferungen & Logistik */}
          <div className="category-card accent-delivery">
            <div className="category-card-header">
              <span className="category-card-title">
                <Package size={16} color="#059669" />
                <span>{t('cap_cat_delivery')} ({categories.delivery.length})</span>
              </span>
            </div>

            <div className="bullet-chips">
              {categories.delivery.map((bullet, idx) => (
                <span key={idx} className="bullet-chip">
                  <span>{bullet}</span>
                  <X
                    size={12}
                    className="bullet-chip-remove"
                    onClick={() => handleRemoveBullet('delivery', idx)}
                  />
                </span>
              ))}
            </div>

            <div className="bullet-input-row">
              <input
                type="text"
                className="bullet-input"
                placeholder={t('cap_bullet_short_ph')}
                value={newInputs.delivery}
                onChange={(e) => setNewInputs({ ...newInputs, delivery: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddBullet('delivery')}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
                onClick={() => handleAddBullet('delivery')}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          </div>

          {/* 2. Allgemeines Notizfeld (unten) */}
          {renderGeneralNotesBox()}
        </div>
      )}

      {/* Action Bar Footer */}
      <section className="capture-actions-bar">
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-slate-800)' }}>
            {t('cap_action_bar_title')}
          </span>
        </div>

        <div className="action-toggle-group">
          <label className={`action-toggle-chip ${targetDailyReport ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={targetDailyReport}
              onChange={(e) => setTargetDailyReport(e.target.checked)}
            />
            <FileText size={15} />
            <span>{t('cap_to_report')}</span>
          </label>

          <label className={`action-toggle-chip ${targetLetterDraft ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={targetLetterDraft}
              onChange={(e) => setTargetLetterDraft(e.target.checked)}
            />
            <Mail size={15} />
            <span>{t('cap_to_letter')}</span>
          </label>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExecuteActions}
            disabled={isExecutingActions || (!targetDailyReport && !targetLetterDraft)}
          >
            <CheckCircle2 size={16} />
            <span>
              {isExecutingActions
                ? t('cap_executing')
                : targetDailyReport && targetLetterDraft
                  ? t('cap_to_both')
                  : targetLetterDraft
                    ? t('cap_to_letter')
                    : t('cap_to_report')}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
};

export default VoiceOrText;
