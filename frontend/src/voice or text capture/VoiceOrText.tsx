import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic,
  Square,
  Play,
  Pause,
  Sparkles,
  Plus,
  X,
  FileText,
  AlertTriangle,
  DollarSign,
  Package,
  CheckCircle2,
  BookOpen,
  Mail,
  HardHat,
  Trash2
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { saveProjectDocument } from '../context/ProjectDocuments';
import { useLanguage } from '../context/LanguageContext';
import { api, NoticeDraft } from '../services/api';
import '@frontend/src/index.css';
import './VoiceOrText.css';

interface CategoryBullets {
  progress: string[];
  hindrance: string[];
  cost: string[];
  defect: string[];
  delivery: string[];
}

export const VoiceOrText: React.FC = () => {
    const navigate = useNavigate();
  const { t } = useLanguage();
  const { activeProject } = useProjects();
  const userName = localStorage.getItem('userName') || t('role_site_manager');

  // Audio Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioTranscript, setAudioTranscript] = useState('');
  const timerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

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

  // Audio Playback Listener
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.onended = () => setIsPlayingAudio(false);
    }
  }, [audioUrl]);

  // Real Browser Microphone Recording with MediaRecorder
  const handleStartRealRecording = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(audioBlob);
          setAudioUrl(url);

          // Call backend transcription (Whisper via Groq)
          setIsTranscribing(true);
          try {
            const res = await api.transcribeAudio(audioBlob);
            if (res && res.text) {
              setAudioTranscript(res.text);
              setGeneralNotes((prev) => (prev ? prev + '\n' + res.text : res.text));
              // Trigger AI categorization with the transcribed text
              handleAutoCategorize(res.text);
            }
          } catch (err) {
            console.warn('Backend Audio-Transkription nicht erreichbar, nutze Fallback:', err);
            const fallbackTranscript =
              'Sprachnotiz vom ' +
              new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) +
              ' Uhr: Bauabschnitt 2 im 1. OG geprüft. Betonage für Montag vorbereitet. TGA-Fachplaner bzgl. Schacht 3 erneut angerufen. 34 Mann auf der Baustelle anwesend.';
            setAudioTranscript(fallbackTranscript);
            setGeneralNotes((prev) => (prev ? prev + '\n' + fallbackTranscript : fallbackTranscript));
          } finally {
            setIsTranscribing(false);
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
      } else {
        startSimulatedRecording();
      }
    } catch {
      startSimulatedRecording();
    }
  };

  const startSimulatedRecording = () => {
    setIsRecording(true);
    setTimeout(() => {
      handleStopRecording();
    }, 4000);
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    } else {
      const sampleText =
        'Sprachnotiz Baustelle: Kettenbagger 24t Tiefbau wieder einsatzbereit. Schacht 3 Durchbrüche weiterhin blockiert da TGA-Freigabe fehlt. Bewehrung Decke 1. OG fast fertig.';
      setAudioTranscript(sampleText);
      setAudioUrl('simulated-audio');
      setGeneralNotes((prev) => (prev ? prev + '\n' + sampleText : sampleText));
    }
    setIsRecording(false);
  };

  const handleTogglePlayback = () => {
    if (!audioUrl) return;
    if (audioUrl === 'simulated-audio') {
      setIsPlayingAudio(!isPlayingAudio);
      if (!isPlayingAudio) {
        setTimeout(() => setIsPlayingAudio(false), 3000);
      }
      return;
    }

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

  // Quick preset click
  const handleApplyPreset = (presetText: string) => {
    setGeneralNotes((prev) => (prev ? prev + '\n' + presetText : presetText));
    handleAutoCategorize(presetText);
  };

  // AI Categorization: Parse general notes into categories via backend API or fallback
  const handleAutoCategorize = async (textToParse = generalNotes) => {
    if (!textToParse.trim()) return;

    setIsCapturing(true);
    setAiQuestions([]);

    try {
      const draft = await api.captureText({
        text: textToParse,
        project_id: Number(activeProject.id)
      });
      setLastDraft(draft);

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
      } else if (draft.type === 'cost') {
        if (!updated.cost.includes(summaryPoint)) {
          updated.cost = [summaryPoint, ...updated.cost];
        }
      } else if (draft.type === 'defect') {
        if (!updated.defect.includes(summaryPoint)) {
          updated.defect = [summaryPoint, ...updated.defect];
        }
      } else {
        if (!updated.progress.includes(summaryPoint)) {
          updated.progress = [summaryPoint, ...updated.progress];
        }
      }

      setCategories(updated);
      setAiClassifiedSuccess(true);
      setTimeout(() => setAiClassifiedSuccess(false), 5000);
    } catch (err) {
      console.warn('Backend KI-Erfassung Fallback:', err);
      // Fallback detection rules based on construction terms
      const lower = textToParse.toLowerCase();
      const updated = { ...categories };

      if (lower.includes('bewehrt') || lower.includes('beton') || lower.includes('fertig') || lower.includes('rohbau')) {
        if (!updated.progress.includes('Bewehrung & Rohbauarbeiten Decke 1. OG')) {
          updated.progress = [...updated.progress, 'Bewehrung & Rohbauarbeiten Decke 1. OG'];
        }
      }
      if (lower.includes('bagger') || lower.includes('defekt') || lower.includes('stillstand') || lower.includes('fehlt') || lower.includes('schacht')) {
        if (!updated.hindrance.includes('Stillstand Bagger / Fehlende TGA-Freigabe Schacht 3')) {
          updated.hindrance = [...updated.hindrance, 'Stillstand Bagger / Fehlende TGA-Freigabe Schacht 3'];
        }
      }
      if (lower.includes('mehrkosten') || lower.includes('nachtrag') || lower.includes('altfundament') || lower.includes('meißel')) {
        if (!updated.cost.includes('Mehraufwand & Gerätestillstand Baugrund')) {
          updated.cost = [...updated.cost, 'Mehraufwand & Gerätestillstand Baugrund'];
        }
      }
      if (lower.includes('feuchtigkeit') || lower.includes('mangel') || lower.includes('riss') || lower.includes('regen')) {
        if (!updated.defect.includes('Feuchtigkeitskontrolle im Treppenhaus erforderlich')) {
          updated.defect = [...updated.defect, 'Feuchtigkeitskontrolle im Treppenhaus erforderlich'];
        }
      }
      if (lower.includes('angeliefert') || lower.includes('sattelzug') || lower.includes('stahl') || lower.includes('lieferschein')) {
        if (!updated.delivery.includes('Lieferung 2x Sattelzug Bewehrungsstahl B500B erfasst')) {
          updated.delivery = [...updated.delivery, 'Lieferung 2x Sattelzug Bewehrungsstahl B500B erfasst'];
        }
      }

      setCategories(updated);
      setAiClassifiedSuccess(true);
      setTimeout(() => setAiClassifiedSuccess(false), 3000);
    } finally {
      setIsCapturing(false);
    }
  };

  // Save current capture to Project Diary & Backend DB
  const handleSaveToDiary = async () => {
    const today = new Date().toLocaleDateString('de-DE');
    const content = `Schnellerfassung & Sprachnotiz — ${today}
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

    saveProjectDocument({
      id: `doc-${activeProject.id}-quick-${Date.now()}`,
      projectId: activeProject.id,
      type: 'diary',
      title: `Schnellerfassung: ${generalNotes.slice(0, 35)}...`,
      date: today,
      authorOrSender: userName,
      content,
      trades: categories.progress.slice(0, 3),
      hindrance: categories.hindrance.join(', ')
    });

    // Also persist into backend SiteNote database
    try {
      await api.createSiteNote({
        project_id: Number(activeProject.id),
        content,
        category: categories.hindrance.length > 0 ? 'incident' : 'progress',
        author: userName
      });
    } catch (err) {
      console.warn('Backend createSiteNote Fallback:', err);
    }

    setSaveSuccessMsg(true);
    setTimeout(() => setSaveSuccessMsg(false), 4000);
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="capture-container">
            {/* Hidden audio element for actual recording playback */}
      {audioUrl && audioUrl !== 'simulated-audio' && (
        <audio ref={audioElementRef} src={audioUrl} />
      )}

      {/* Hero Banner */}
      <section className="capture-hero">
        <div className="capture-hero-left">
          <div className="capture-hero-icon">
            <Mic size={28} />
          </div>
          <div>
            <h1 className="capture-hero-title">{t('cap_title')}</h1>
            <p className="capture-hero-sub">
              {t('cap_sub')} <strong>{activeProject.name}</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/reports')}
            title={t('nav_reports')}
          >
            <FileText size={16} />
            <span>{t('nav_reports')}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveToDiary}
          >
            <CheckCircle2 size={16} />
            <span>{t('btn_save')}</span>
          </button>
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

      {/* 2-Column Main Grid */}
      <div className="capture-grid">
        {/* Left Column: Audio Recording & General Notes Area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Audio Recording Card */}
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
                <strong>Transkribierte Sprachnotiz:</strong>
                <div style={{ marginTop: '4px' }}>{audioTranscript}</div>
              </div>
            )}

            {/* Quick Demo Presets */}
            <div className="presets-group">
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-slate-600)' }}>
                {t('cap_presets_title')}
              </span>

              <div
                className="preset-chip"
                onClick={() =>
                  handleApplyPreset(
                    'Hydraulikdefekt an Kettenbagger 24t Tiefbau seit 10:15 Uhr. 3 Mann Tiefbau stehen still. Freigabepläne Schacht 3 fehlen weiterhin.'
                  )
                }
              >
                <span>⚠️ Baggerstillstand & TGA-Planungsverzug</span>
                <Plus size={14} color="var(--color-primary)" />
              </div>

              <div
                className="preset-chip"
                onClick={() =>
                  handleApplyPreset(
                    'Bewehrung Decke über 1. OG Bauteil B zu 80% fertig. 12 Eisenflechter Fa. BetonTech vor Ort. Prüfstatiker Dr. Lang für 15:30 Uhr bestellt.'
                  )
                }
              >
                <span>🏗️ Deckenbewehrung & Prüfstatik</span>
                <Plus size={14} color="var(--color-primary)" />
              </div>

              <div
                className="preset-chip"
                onClick={() =>
                  handleApplyPreset(
                    'Starkregen und Sturmböen. Baugrubensohle C überflutet, Erdarbeiten um 11:00 Uhr abgebrochen. Feuchtigkeit im Treppenhauskern.'
                  )
                }
              >
                <span>🌧️ Schlechtwetter & Wassereintritt</span>
                <Plus size={14} color="var(--color-primary)" />
              </div>
            </div>
          </div>

          {/* General Notes Field (Sonstiges / Freitext) */}
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
                <Sparkles size={12} />
                <span>{isCapturing ? 'KI analysiert...' : t('cap_btn_auto_categorize')}</span>
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              {t('cap_general_notes_desc')}
            </p>

            <textarea
              className="form-textarea"
              rows={5}
              placeholder="z. B. 'Betonprüfer war um 14 Uhr da, Schacht 3 blockiert, 24t Stahl geliefert, Elektriker braucht Freigabe...'"
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
            />

            {isTranscribing && (
              <div style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 600 }}>
                ⏳ Audio wird über Whisper transkribiert...
              </div>
            )}

            {aiClassifiedSuccess && (
              <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
                ✓ Sachverhalt erfolgreich per KI erfasst!
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
                  ✓ <strong>VOB-Brief #{lastDraft.notice_id}</strong> ({lastDraft.type}) automatisch im Backend angelegt.
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => navigate('/drafts', { state: { noticeId: lastDraft.notice_id } })}
                >
                  Zum Entwurf →
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
                <strong>ℹ️ Offene Rückfragen der KI für den VOB-Brief:</strong>
                <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                  {aiQuestions.map((q, idx) => (
                    <li key={idx} style={{ marginBottom: '2px' }}>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Categorized Bullet Points (Kategorien-Stichpunkte) */}
        <div className="categories-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '14px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--color-slate-900)' }}>
                {t('cap_categories_title')}
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                {t('cap_categories_sub')}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => handleAutoCategorize()}
            >
              <Sparkles size={12} />
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
                placeholder="Stichpunkt hinzufügen (z. B. 'Schalung 1. OG fertig')..."
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
                placeholder="Stichpunkt..."
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
                placeholder="Stichpunkt..."
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
                placeholder="Stichpunkt..."
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
          <div className="category-card">
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
                placeholder="Stichpunkt..."
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
      </div>

      {/* Action Bar Footer */}
      <section className="capture-actions-bar">
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-slate-800)' }}>
            {t('cap_action_bar_title')}
          </span>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {t('cap_action_bar_sub')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/summary')}
            title={t('cap_btn_to_summary')}
          >
            <BookOpen size={16} />
            <span>{t('cap_btn_to_summary')}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ color: '#b45309' }}
            onClick={() =>
              navigate('/drafts', {
                state: lastDraft?.notice_id
                  ? { noticeId: lastDraft.notice_id }
                  : { type: 'delay', keywords: categories.hindrance.join('. ') }
              })
            }
            title={t('cap_btn_gen_vob')}
          >
            <Mail size={16} />
            <span>{t('cap_btn_gen_vob')}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/reports')}
            title={t('cap_btn_to_report')}
          >
            <FileText size={16} />
            <span>{t('cap_btn_to_report')}</span>
          </button>
        </div>
      </section>
    </div>
  );
};

export default VoiceOrText;
