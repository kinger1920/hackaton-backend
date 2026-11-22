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
import { api, CategorizedBulletsPayload, NoticeDraft, NoticeType } from '../services/api';
import { isoToDe, todayIso } from '../utils/dates';

/**
 * Datum + Uhrzeit des Geräts für /api/capture (Contract: ref_date, ref_time).
 * Ohne diese Angaben kann die KI "vor 2 Stunden" nicht auflösen, und der Server
 * (UTC beim Deploy) nimmt nachts sein eigenes, evtl. falsches "heute".
 */
const captureRefNow = () => {
  const now = new Date();
  return {
    ref_date: todayIso(),
    ref_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  };
};
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

const EMPTY_CATEGORIES: CategoryBullets = {
  progress: [],
  hindrance: [],
  cost: [],
  defect: [],
  delivery: []
};

const EMPTY_INPUTS: Record<keyof CategoryBullets, string> = {
  progress: '',
  hindrance: '',
  cost: '',
  defect: '',
  delivery: ''
};

const CATEGORY_KEYS: (keyof CategoryBullets)[] = ['progress', 'hindrance', 'cost', 'defect', 'delivery'];

const ABBREVIATION_END_RE = /\b(?:fa|nr|z\.?b|z|ca|bzw|inkl|ggf|abs|st|std|tel|dr|ing|dipl|v|u|d|min|max|ggü|lt|gem)\.$/i;
const ORDINAL_BEFORE_LEVEL_RE = /\b\d+\.$/;
const LEVEL_START_RE = /^(?:og|ug|eg|dg|ba|bt|abschnitt|bauabschnitt|bauteil)\b/i;

function splitTextIntoItems(text: string): string[] {
  const items: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const semiParts = line.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
    for (const part of semiParts) {
      const tokens = part.split(/\s+/);
      let current = '';
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const next = tokens[i + 1] || '';
        current = current ? `${current} ${tok}` : tok;
        const endsSentence = /[.!?]$/.test(tok);
        const isAbbrev =
          ABBREVIATION_END_RE.test(tok) ||
          (ORDINAL_BEFORE_LEVEL_RE.test(tok) && LEVEL_START_RE.test(next));
        if (endsSentence && !isAbbrev && next) {
          items.push(current.trim());
          current = '';
        }
      }
      if (current.trim()) items.push(current.trim());
    }
  }
  return items;
}

function classifySingleItem(rawItem: string): { category: keyof CategoryBullets; text: string } {
  const trimmed = rawItem.replace(/^[-•*]\s*/, '').trim();
  const prefixMatch = trimmed.match(
    /^(baufortschritt|fortschritt|behinderung(?:en)?|störung(?:en)?|mehrkosten|nachtrag|nachträge|mangel|mängel|lieferung(?:en)?|material)\s*:\s*(.+)$/i
  );
  if (prefixMatch) {
    const head = prefixMatch[1].toLowerCase();
    const body = prefixMatch[2].trim();
    if (head.startsWith('baufortschritt') || head.startsWith('fortschritt')) return { category: 'progress', text: body };
    if (head.startsWith('mehrkosten') || head.startsWith('nachtrag') || head.startsWith('nachträge')) return { category: 'cost', text: body };
    if (head.startsWith('mangel') || head.startsWith('mängel')) return { category: 'defect', text: body };
    if (head.startsWith('liefer') || head.startsWith('material')) return { category: 'delivery', text: body };
    return { category: 'hindrance', text: body };
  }

  const lower = trimmed.toLowerCase();
  const hasAny = (words: string[]) => words.some((w) => lower.includes(w));

  if (
    hasAny([
      'mehrkosten',
      'nachtrag',
      'zusatzleistung',
      'mehraufwand',
      'zusätzliche',
      'teurer',
      'regie',
      'stundenlohn',
      'wasserhaltung',
      'dodatkow',
      'koszt'
    ])
  ) {
    return { category: 'cost', text: trimmed };
  }
  if (
    hasAny([
      'mangel',
      'mängel',
      'riss',
      'feuchtigkeit',
      'undicht',
      'schaden',
      'fehlerhaft',
      'nachbesser',
      'usterk',
      'pęknię',
      'wad'
    ])
  ) {
    return { category: 'defect', text: trimmed };
  }
  if (
    hasAny([
      'behinder',
      'stillstand',
      'steht',
      'ausfall',
      'hydraulikdefekt',
      'defekt',
      'fehlt',
      'fehlen',
      'blockiert',
      'wartet',
      'warten',
      'verzög',
      'freigabe',
      'störung',
      'unterbrochen',
      'stoi',
      'brak',
      'czeka',
      'opóźni'
    ])
  ) {
    return { category: 'hindrance', text: trimmed };
  }
  if (
    hasAny([
      'angeliefert',
      'lieferung',
      'geliefert',
      'lieferschein',
      'sattelzug',
      'lkw',
      'abgeladen',
      'abnahme',
      'prüfstatiker',
      'betonprüfer',
      'begehung',
      'dostaw'
    ])
  ) {
    return { category: 'delivery', text: trimmed };
  }
  return { category: 'progress', text: trimmed };
}

function categorizeTextIntoBullets(text: string): {
  bullets: CategoryBullets;
  count: number;
  detectedKeys: (keyof CategoryBullets)[];
} {
  const buckets: CategoryBullets = {
    progress: [],
    hindrance: [],
    cost: [],
    defect: [],
    delivery: []
  };
  const items = splitTextIntoItems(text);
  let count = 0;
  for (const item of items) {
    const { category, text: clean } = classifySingleItem(item);
    if (clean && !buckets[category].includes(clean)) {
      buckets[category].push(clean);
      count++;
    }
  }
  const detectedKeys = CATEGORY_KEYS.filter((k) => buckets[k].length > 0);
  return { bullets: buckets, count, detectedKeys };
}

function mergeCategoryBullets(base: CategoryBullets, extra: CategoryBullets): CategoryBullets {
  const next: CategoryBullets = {
    progress: [...base.progress],
    hindrance: [...base.hindrance],
    cost: [...base.cost],
    defect: [...base.defect],
    delivery: [...base.delivery]
  };
  for (const key of CATEGORY_KEYS) {
    for (const item of extra[key]) {
      const clean = item.trim();
      if (clean && !next[key].includes(clean)) {
        next[key].push(clean);
      }
    }
  }
  return next;
}

function hasAnyCategoryBullets(cats: CategoryBullets): boolean {
  return CATEGORY_KEYS.some((k) => cats[k].length > 0);
}

function normalizeCategories(raw?: CategorizedBulletsPayload | null): CategoryBullets {
  return {
    progress: Array.isArray(raw?.progress) ? raw.progress.map((s) => String(s).trim()).filter(Boolean) : [],
    hindrance: Array.isArray(raw?.hindrance) ? raw.hindrance.map((s) => String(s).trim()).filter(Boolean) : [],
    cost: Array.isArray(raw?.cost) ? raw.cost.map((s) => String(s).trim()).filter(Boolean) : [],
    defect: Array.isArray(raw?.defect) ? raw.defect.map((s) => String(s).trim()).filter(Boolean) : [],
    delivery: Array.isArray(raw?.delivery) ? raw.delivery.map((s) => String(s).trim()).filter(Boolean) : []
  };
}

const bulletsStorageKey = (projectId: string | number, isoDate: string) =>
  `site_assistant_capture_bullets_${projectId}_${isoDate}`;

function readLocalBullets(projectId: string | number, isoDate: string): CategoryBullets {
  try {
    const raw = localStorage.getItem(bulletsStorageKey(projectId, isoDate));
    if (!raw) return EMPTY_CATEGORIES;
    return normalizeCategories(JSON.parse(raw));
  } catch {
    return EMPTY_CATEGORIES;
  }
}

function writeLocalBullets(projectId: string | number, isoDate: string, cats: CategoryBullets): void {
  try {
    const key = bulletsStorageKey(projectId, isoDate);
    if (hasAnyCategoryBullets(cats)) {
      localStorage.setItem(key, JSON.stringify(cats));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
}

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
  const { t } = useLanguage();
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

  // General notes field (Sonstige Notizen) — leer starten, keine Vorauswahl
  const [generalNotes, setGeneralNotes] = useState('');

  // Categorized bullet points state — leer starten, keine Vorauswahl
  const [categories, setCategories] = useState<CategoryBullets>(EMPTY_CATEGORIES);

  // Inputs for adding a bullet to a specific category
  const [newInputs, setNewInputs] = useState<Record<keyof CategoryBullets, string>>(EMPTY_INPUTS);

  const [classificationFeedback, setClassificationFeedback] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [lastDraft, setLastDraft] = useState<NoticeDraft | null>(null);
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  // Merkt sich, ob generalNotes bereits in Kategorien zerlegt wurde (verhindert Duplikate bei Übergabe).
  const categorizedNotesRef = useRef<string | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  // Stichpunkte, die bereits in den heutigen Bautagesbericht übernommen wurden (für synchrones Löschen).
  const syncedCategoriesRef = useRef<CategoryBullets>(EMPTY_CATEGORIES);

  // Bereits heute übernommene Stichpunkte des aktiven Projekts aus dem Bautagesbericht laden
  useEffect(() => {
    if (isVoiceMode) return;
    let cancelled = false;
    const today = todayIso();

    const loadTodayBullets = async () => {
      try {
        const report = await api.getReport(today, Number(activeProject.id));
        if (cancelled) return;
        const loaded = normalizeCategories(report.categories);
        setCategories(loaded);
        syncedCategoriesRef.current = loaded;
        writeLocalBullets(activeProject.id, today, loaded);
      } catch {
        if (cancelled) return;
        const local = readLocalBullets(activeProject.id, today);
        setCategories(local);
        syncedCategoriesRef.current = local;
      }
      setNewInputs(EMPTY_INPUTS);
      setGeneralNotes('');
      categorizedNotesRef.current = null;
      setLastDraft(null);
      setActionErrorMsg(null);
    };

    loadTodayBullets();
    return () => {
      cancelled = true;
    };
  }, [activeProject.id, isVoiceMode]);

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

  const showClassificationFeedback = (msg: string) => {
    setClassificationFeedback(msg);
    window.setTimeout(() => {
      setClassificationFeedback((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const toggleAudioCategory = (catKey: keyof CategoryBullets) => {
    setSelectedAudioCategories((prev) =>
      prev.includes(catKey) ? prev.filter((k) => k !== catKey) : [...prev, catKey]
    );
    setActionErrorMsg(null);
  };

  // Audio Playback Listener
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.onended = () => setIsPlayingAudio(false);
    }
  }, [audioUrl]);

  // Mikrofon-Aufnahme (gemeinsamer Hook) → Wiedergabe + Transkription (Whisper) → Kategorie-Erkennung.
  // Kein erfundener Ersatztext mehr, wenn Mikrofon oder Transkription fehlen: lieber Hinweis + selbst tippen.
  const recorder = useAudioRecorder(async (audioBlob) => {
    setAudioUrl(URL.createObjectURL(audioBlob));
    setIsTranscribing(true);
    try {
      const res = await api.transcribeAudio(audioBlob);
      if (res?.text?.trim()) {
        setAudioTranscript(res.text);
        setGeneralNotes((prev) => (prev ? prev + '\n' + res.text : res.text));
        const { detectedKeys } = categorizeTextIntoBullets(res.text);
        if (detectedKeys.length > 0) {
          setSelectedAudioCategories((prev) => Array.from(new Set([...prev, ...detectedKeys])));
        }
        setActionErrorMsg(null);
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

  // Alle Kategorien inkl. noch nicht mit "+" bestätigter Eingaben zusammenführen
  const getEffectiveCategories = (): CategoryBullets => {
    const next: CategoryBullets = {
      progress: [...categories.progress],
      hindrance: [...categories.hindrance],
      cost: [...categories.cost],
      defect: [...categories.defect],
      delivery: [...categories.delivery]
    };
    for (const key of CATEGORY_KEYS) {
      const pending = newInputs[key]?.trim();
      if (pending && !next[key].includes(pending)) {
        next[key].push(pending);
      }
    }
    return next;
  };

  // Add bullet point to category
  const handleAddBullet = (catKey: keyof CategoryBullets) => {
    const val = newInputs[catKey]?.trim();
    if (!val) return;
    setCategories((prev) => ({
      ...prev,
      [catKey]: prev[catKey].includes(val) ? prev[catKey] : [...prev[catKey], val]
    }));
    setNewInputs((prev) => ({ ...prev, [catKey]: '' }));
    setActionErrorMsg(null);
    setLastDraft(null);
  };

  // Remove bullet point from category (und falls bereits übernommen, auch aus dem heutigen Bautagesbericht)
  const handleRemoveBullet = async (catKey: keyof CategoryBullets, index: number) => {
    const removedText = categories[catKey][index];
    if (!removedText) return;

    const nextCategories: CategoryBullets = {
      ...categories,
      [catKey]: categories[catKey].filter((_, i) => i !== index)
    };
    setCategories(nextCategories);
    setLastDraft(null);

    const syncedKey = syncedCategoriesRef.current[catKey].includes(removedText)
      ? catKey
      : CATEGORY_KEYS.find((k) => syncedCategoriesRef.current[k].includes(removedText));

    if (!syncedKey) return;

    const today = todayIso();
    const nextSynced: CategoryBullets = {
      ...syncedCategoriesRef.current,
      [syncedKey]: syncedCategoriesRef.current[syncedKey].filter((item) => item !== removedText)
    };
    syncedCategoriesRef.current = nextSynced;
    writeLocalBullets(activeProject.id, today, nextSynced);

    try {
      const updated = await api.removeReportBullet(today, {
        category: syncedKey,
        text: removedText,
        project_id: Number(activeProject.id)
      });
      const serverCats = normalizeCategories(updated.categories);
      syncedCategoriesRef.current = serverCats;
      writeLocalBullets(activeProject.id, today, serverCats);
      showClassificationFeedback('✓ Stichpunkt auch aus dem heutigen Bautagesbericht entfernt');
    } catch (err) {
      console.warn('Stichpunkt konnte im Backend-Bericht nicht entfernt werden:', err);
    }
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
    setActionErrorMsg(null);
    setLastDraft(null);
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

  // Freitext satzweise in die 5 Kategorien einordnen – ohne unerwünschten Brief-Entwurf als Nebeneffekt.
  const handleAutoCategorize = (textToParse = generalNotes) => {
    const clean = textToParse.trim();
    if (!clean) {
      showClassificationFeedback('Bitte zuerst Text im Notizfeld eingeben.');
      return;
    }

    const { bullets, count, detectedKeys } = categorizeTextIntoBullets(clean);
    if (isVoiceMode) {
      if (detectedKeys.length > 0) {
        setSelectedAudioCategories((prev) => Array.from(new Set([...prev, ...detectedKeys])));
      }
      showClassificationFeedback(`✓ ${detectedKeys.length} Kategorie(n) erkannt`);
      return;
    }

    const base = getEffectiveCategories();
    setCategories(mergeCategoryBullets(base, bullets));
    setNewInputs(EMPTY_INPUTS);
    if (textToParse === generalNotes) {
      categorizedNotesRef.current = clean;
    }
    setActionErrorMsg(null);
    setLastDraft(null);
    showClassificationFeedback(`✓ ${count} Stichpunkt${count === 1 ? '' : 'e'} zugeordnet`);
  };

  // Alle vorhandenen Stichpunkte (+ offene Eingaben + ggf. neues Notizfeld) neu sortieren.
  const handleReclassify = () => {
    const effective = getEffectiveCategories();
    const existingAll = CATEGORY_KEYS.flatMap((k) => effective[k]);
    const notesTrimmed = generalNotes.trim();
    const includeNotes = notesTrimmed && categorizedNotesRef.current !== notesTrimmed;
    const combinedInput = [...existingAll, ...(includeNotes ? [notesTrimmed] : [])].join('\n');

    if (!combinedInput.trim()) {
      showClassificationFeedback('Noch keine Stichpunkte oder Notizen zum Zuordnen vorhanden.');
      return;
    }

    const { bullets, count } = categorizeTextIntoBullets(combinedInput);
    setCategories(bullets);
    setNewInputs(EMPTY_INPUTS);
    if (notesTrimmed) {
      categorizedNotesRef.current = notesTrimmed;
    }
    setActionErrorMsg(null);
    setLastDraft(null);
    showClassificationFeedback(`✓ ${count} Stichpunkt${count === 1 ? '' : 'e'} neu zugeordnet`);
  };

  const buildCapturePayload = (effectiveCats: CategoryBullets) => {
    const selectedLabels = AUDIO_CATEGORY_OPTIONS
      .filter((opt) => selectedAudioCategories.includes(opt.key))
      .map((opt) => t(opt.labelKey));

    if (isVoiceMode) {
      const catSummary = selectedLabels.length > 0 ? selectedLabels.join(', ') : '';
      const transcriptText = audioTranscript.trim();
      const combinedText = [transcriptText, catSummary ? `Kategorien: ${catSummary}` : '']
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
        titleSnippet: (transcriptText || catSummary || 'Sprachaufnahme').slice(0, 35),
        hasIncident:
          selectedAudioCategories.includes('hindrance') ||
          selectedAudioCategories.includes('cost') ||
          selectedAudioCategories.includes('defect'),
        hasContent: Boolean(transcriptText || selectedLabels.length > 0),
        reportFreeText: combinedText,
        reportCategories: undefined as CategoryBullets | undefined,
        combinedText,
        keywords: transcriptText || catSummary,
        preferredType,
        selectedLabels
      };
    }

    const notesTrimmed = generalNotes.trim();
    const hasBullets = hasAnyCategoryBullets(effectiveCats);
    const notesAlreadyCategorized = Boolean(
      notesTrimmed && hasBullets && categorizedNotesRef.current === notesTrimmed
    );
    const reportFreeText = notesAlreadyCategorized ? '' : notesTrimmed;

    const combinedText = [
      reportFreeText,
      effectiveCats.progress.length ? `Baufortschritt: ${effectiveCats.progress.join('; ')}` : '',
      effectiveCats.hindrance.length ? `Behinderungen: ${effectiveCats.hindrance.join('; ')}` : '',
      effectiveCats.cost.length ? `Mehrkosten: ${effectiveCats.cost.join('; ')}` : '',
      effectiveCats.defect.length ? `Mängel: ${effectiveCats.defect.join('; ')}` : '',
      effectiveCats.delivery.length ? `Lieferungen: ${effectiveCats.delivery.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    const preferredType: NoticeType =
      effectiveCats.hindrance.length > 0
        ? 'delay'
        : effectiveCats.cost.length > 0
          ? 'cost'
          : effectiveCats.defect.length > 0
            ? 'defect'
            : 'delay';

    const keywords =
      preferredType === 'cost'
        ? effectiveCats.cost.join('. ') || notesTrimmed
        : preferredType === 'defect'
          ? effectiveCats.defect.join('. ') || notesTrimmed
          : effectiveCats.hindrance.join('. ') || notesTrimmed || combinedText;

    const firstSnippet =
      notesTrimmed ||
      effectiveCats.progress[0] ||
      effectiveCats.hindrance[0] ||
      effectiveCats.cost[0] ||
      effectiveCats.defect[0] ||
      effectiveCats.delivery[0] ||
      'Schreiberfassung';

    return {
      modeLabel: 'Schreiberfassung',
      titleSnippet: firstSnippet.slice(0, 35),
      hasIncident:
        effectiveCats.hindrance.length > 0 ||
        effectiveCats.cost.length > 0 ||
        effectiveCats.defect.length > 0,
      hasContent: Boolean(notesTrimmed || hasBullets),
      reportFreeText,
      reportCategories: hasBullets ? effectiveCats : undefined,
      combinedText,
      keywords,
      preferredType,
      selectedLabels
    };
  };

  // Save current capture to Project Diary & Backend DB (Fallback wenn /fill nicht erreichbar)
  const handleSaveToDiary = async (showToast = true, effectiveCats: CategoryBullets = getEffectiveCategories()) => {
    const today = isoToDe(todayIso());
    const payload = buildCapturePayload(effectiveCats);
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
${generalNotes.trim() ? `\nAllgemeine Notizen:\n${generalNotes.trim()}\n` : ''}
Kategorisierte Stichpunkte:
- Baufortschritt: ${effectiveCats.progress.join('; ') || 'Keine Angaben'}
- Behinderungen (§ 6 VOB/B): ${effectiveCats.hindrance.join('; ') || 'Keine'}
- Mehrkosten & Nachträge (§ 2 VOB/B): ${effectiveCats.cost.join('; ') || 'Keine'}
- Mängel / Qualität: ${effectiveCats.defect.join('; ') || 'Keine'}
- Lieferungen & Material: ${effectiveCats.delivery.join('; ') || 'Keine'}`.trim();

    if (lastSavedContentRef.current === content) {
      if (showToast) {
        setSaveSuccessMsg(true);
        setTimeout(() => setSaveSuccessMsg(false), 4000);
      }
      return;
    }

    const hindranceLines = [
      ...effectiveCats.hindrance.map((s) => `Behinderung: ${s}`),
      ...effectiveCats.cost.map((s) => `Mehrkosten: ${s}`),
      ...effectiveCats.defect.map((s) => `Mangel: ${s}`)
    ].join('\n');

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
        content: payload.combinedText || content,
        trades: effectiveCats.progress.slice(0, 3),
        hindrance: hindranceLines || undefined
      });
    }

    if (showToast) {
      setSaveSuccessMsg(true);
      setTimeout(() => setSaveSuccessMsg(false), 4000);
    }
  };

  const handleExecuteActions = async () => {
    if (!targetDailyReport && !targetLetterDraft) return;
    setActionErrorMsg(null);

    // Offene Texteingaben in den Kategorien automatisch übernehmen, damit nichts verloren geht
    const effectiveCats = isVoiceMode ? categories : getEffectiveCategories();
    if (!isVoiceMode && CATEGORY_KEYS.some((k) => newInputs[k]?.trim())) {
      setCategories(effectiveCats);
      setNewInputs(EMPTY_INPUTS);
    }

    const payload = buildCapturePayload(effectiveCats);
    if (!payload.hasContent) {
      setActionErrorMsg(
        isVoiceMode
          ? 'Bitte zuerst eine Sprachnotiz aufnehmen oder mindestens eine Kategorie auswählen.'
          : 'Bitte mindestens einen Stichpunkt oder eine Notiz eingeben.'
      );
      return;
    }

    setIsExecutingActions(true);
    const reportDate = todayIso();

    try {
      if (targetDailyReport) {
        // /fill trägt Freitext + kategorisierte Stichpunkte direkt in die passenden Berichtsfelder ein
        // und legt selbst den Tagebucheintrag an → lokale Sicherung nur bei Backend-Ausfall.
        try {
          const filled = await api.fillReport(reportDate, {
            text: payload.reportFreeText,
            project_id: Number(activeProject.id),
            categories: payload.reportCategories
          });
          if (!isVoiceMode) {
            const serverCats = normalizeCategories(filled.categories);
            syncedCategoriesRef.current = serverCats;
            setCategories(serverCats);
            writeLocalBullets(activeProject.id, reportDate, serverCats);
          }
        } catch (err) {
          console.warn('Backend fillReport Fallback:', err);
          if (!isVoiceMode) {
            syncedCategoriesRef.current = effectiveCats;
            writeLocalBullets(activeProject.id, reportDate, effectiveCats);
          }
          await handleSaveToDiary(false, effectiveCats);
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
            force_type: payload.preferredType,
            ...captureRefNow()
          });
          setLastDraft(draft);
          if (draft.questions && draft.questions.length > 0) {
            setAiQuestions(draft.questions);
          }
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
          Eigene Standardtexte ({customTemplates.length})
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

      {classificationFeedback && (
        <div
          style={{
            fontSize: '12px',
            color: classificationFeedback.startsWith('✓') ? '#16a34a' : '#b45309',
            fontWeight: 600
          }}
        >
          {classificationFeedback}
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
          disabled={!generalNotes.trim()}
          title={t('cap_btn_auto_categorize')}
        >
          <Tags size={12} />
          <span>{t('cap_btn_auto_categorize')}</span>
        </button>
      </div>

      <textarea
        className="form-textarea"
        rows={5}
        placeholder={t('cap_notes_ph')}
        value={generalNotes}
        onChange={(e) => {
          setGeneralNotes(e.target.value);
          setActionErrorMsg(null);
          setLastDraft(null);
        }}
      />

      {renderAiFeedback()}

      {renderCustomTemplates()}
    </div>
  );

  const renderBulletChip = (
    catKey: keyof CategoryBullets,
    bullet: string,
    idx: number,
    chipStyle?: React.CSSProperties
  ) => (
    <span key={`${catKey}-${idx}`} className="bullet-chip" style={chipStyle}>
      <span>{bullet}</span>
      <button
        type="button"
        className="bullet-chip-remove"
        onClick={() => handleRemoveBullet(catKey, idx)}
        aria-label="Stichpunkt entfernen"
        title="Stichpunkt entfernen"
      >
        <X size={12} />
      </button>
    </span>
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
            type="button"
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
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {isRecording ? t('cap_playback_running') : t('cap_mic_desc')}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '14px', gap: '10px', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                  {t('cap_categories_title')}
                </h2>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 8px' }}
                onClick={handleReclassify}
              >
                <Tags size={12} />
                <span>{t('cap_btn_reclassify')}</span>
              </button>
            </div>

            {classificationFeedback && (
              <div
                style={{
                  fontSize: '12px',
                  color: classificationFeedback.startsWith('✓') ? '#16a34a' : '#b45309',
                  fontWeight: 600
                }}
              >
                {classificationFeedback}
              </div>
            )}

            {/* Category 1: Baufortschritt & Gewerke */}
            <div className="category-card accent-progress">
              <div className="category-card-header">
                <span className="category-card-title">
                  <HardHat size={16} color="#2563eb" />
                  <span>{t('cap_cat_progress')} ({categories.progress.length})</span>
                </span>
              </div>

              {categories.progress.length > 0 && (
                <div className="bullet-chips">
                  {categories.progress.map((bullet, idx) => renderBulletChip('progress', bullet, idx))}
                </div>
              )}

              <div className="bullet-input-row">
                <input
                  type="text"
                  className="bullet-input"
                  placeholder={t('cap_bullet_ph')}
                  value={newInputs.progress}
                  onChange={(e) => {
                    setNewInputs((prev) => ({ ...prev, progress: e.target.value }));
                    setActionErrorMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddBullet('progress');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={() => handleAddBullet('progress')}
                  title="Stichpunkt hinzufügen"
                  aria-label="Stichpunkt zu Baufortschritt hinzufügen"
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

              {categories.hindrance.length > 0 && (
                <div className="bullet-chips">
                  {categories.hindrance.map((bullet, idx) =>
                    renderBulletChip('hindrance', bullet, idx, { backgroundColor: '#fef2f2', borderColor: '#fca5a5' })
                  )}
                </div>
              )}

              <div className="bullet-input-row">
                <input
                  type="text"
                  className="bullet-input"
                  placeholder={t('cap_bullet_short_ph')}
                  value={newInputs.hindrance}
                  onChange={(e) => {
                    setNewInputs((prev) => ({ ...prev, hindrance: e.target.value }));
                    setActionErrorMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddBullet('hindrance');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={() => handleAddBullet('hindrance')}
                  title="Stichpunkt hinzufügen"
                  aria-label="Stichpunkt zu Behinderungen hinzufügen"
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

              {categories.cost.length > 0 && (
                <div className="bullet-chips">
                  {categories.cost.map((bullet, idx) =>
                    renderBulletChip('cost', bullet, idx, { backgroundColor: '#fffbeb', borderColor: '#fde68a' })
                  )}
                </div>
              )}

              <div className="bullet-input-row">
                <input
                  type="text"
                  className="bullet-input"
                  placeholder={t('cap_bullet_short_ph')}
                  value={newInputs.cost}
                  onChange={(e) => {
                    setNewInputs((prev) => ({ ...prev, cost: e.target.value }));
                    setActionErrorMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddBullet('cost');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={() => handleAddBullet('cost')}
                  title="Stichpunkt hinzufügen"
                  aria-label="Stichpunkt zu Mehrkosten hinzufügen"
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

              {categories.defect.length > 0 && (
                <div className="bullet-chips">
                  {categories.defect.map((bullet, idx) =>
                    renderBulletChip('defect', bullet, idx, { backgroundColor: '#faf5ff', borderColor: '#e9d5ff' })
                  )}
                </div>
              )}

              <div className="bullet-input-row">
                <input
                  type="text"
                  className="bullet-input"
                  placeholder={t('cap_bullet_short_ph')}
                  value={newInputs.defect}
                  onChange={(e) => {
                    setNewInputs((prev) => ({ ...prev, defect: e.target.value }));
                    setActionErrorMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddBullet('defect');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={() => handleAddBullet('defect')}
                  title="Stichpunkt hinzufügen"
                  aria-label="Stichpunkt zu Mängeln hinzufügen"
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

              {categories.delivery.length > 0 && (
                <div className="bullet-chips">
                  {categories.delivery.map((bullet, idx) => renderBulletChip('delivery', bullet, idx))}
                </div>
              )}

              <div className="bullet-input-row">
                <input
                  type="text"
                  className="bullet-input"
                  placeholder={t('cap_bullet_short_ph')}
                  value={newInputs.delivery}
                  onChange={(e) => {
                    setNewInputs((prev) => ({ ...prev, delivery: e.target.value }));
                    setActionErrorMsg(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddBullet('delivery');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                  onClick={() => handleAddBullet('delivery')}
                  title="Stichpunkt hinzufügen"
                  aria-label="Stichpunkt zu Lieferungen hinzufügen"
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
          {actionErrorMsg && (
            <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '4px', fontWeight: 500 }}>
              {actionErrorMsg}
            </div>
          )}
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
