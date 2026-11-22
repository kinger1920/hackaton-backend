import React, {useEffect, useRef, useState} from 'react';
import {MessageSquare, Mic, RotateCcw, Send, Square} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api} from '../services/api';
import {useAudioRecorder} from '../utils/useAudioRecorder';
import {isNotImplemented} from '../components/ComingSoon';
import {useLanguage} from '../context/LanguageContext';
import './Ideas.css';

/**
 * Projekt-Assistent: POST /api/assistant/ask (Antwort + Quellen), Verlauf je Projekt über
 * GET/DELETE /api/assistant/history (gespeichert in ChatSession/ChatMessage).
 */

interface Message {
    role: 'user' | 'assistant';
    text: string;
    sources?: string[];
    pending?: boolean;
    offline?: boolean;
    /** Begrüßung: Text wird beim Rendern in der aktuellen Sprache erzeugt. */
    greeting?: boolean;
}

// Feste Beispielfragen (Übersetzungs-Keys) als Rückfall, falls das Backend keine Vorschläge liefert.
const SUGGESTION_KEYS = ['pa_sugg_1', 'pa_sugg_2', 'pa_sugg_3', 'pa_sugg_4'];

export const ProjectAssistant: React.FC = () => {
    const {activeProject} = useProjects();
    const {t, tf, language} = useLanguage();
    const greeting = (): Message => ({role: 'assistant', text: '', greeting: true});
    const fallbackSuggestions = () => SUGGESTION_KEYS.map((k) => t(k));
    const [messages, setMessages] = useState<Message[]>(() => [greeting()]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [audioHint, setAudioHint] = useState<string | null>(null);
    const [historyError, setHistoryError] = useState<string | null>(null);
    // null = noch keine Vorschläge vom Backend → übersetzte Beispielfragen anzeigen
    const [suggestions, setSuggestions] = useState<string[] | null>(null);
    const endRef = useRef<HTMLDivElement>(null);

    const recorder = useAudioRecorder(async (blob) => {
        setTranscribing(true);
        setAudioHint(null);
        try {
            const res = await api.transcribeAudio(blob, language);
            const text = res?.text?.trim();
            if (text) {
                setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
            } else {
                setAudioHint(t('pa_stt_unavailable'));
            }
        } catch (err) {
            setAudioHint(`${t('pa_stt_failed')} ${(err as Error)?.message ?? err}`);
        } finally {
            setTranscribing(false);
        }
    });

    const handleToggleAudio = async () => {
        setAudioHint(null);
        if (recorder.isRecording) {
            recorder.stop();
            return;
        }
        if (!(await recorder.start())) {
            setAudioHint(t('pa_mic_unavailable'));
        }
    };

    // Vorschlagsfragen aus den echten Projektdaten (Verzug, Mängel, Verträge …); feste Beispiele als Rückfall
    useEffect(() => {
        let cancelled = false;
        api.getAssistantSuggestions(Number(activeProject.id))
            .then((qs) => {
                if (!cancelled && qs.length > 0) setSuggestions(qs);
            })
            .catch(() => {
                if (!cancelled) setSuggestions(null);
            });
        return () => {
            cancelled = true;
        };
    }, [activeProject.id]);

    // Verlauf des aktiven Projekts laden (bei Projektwechsel neu)
    useEffect(() => {
        let cancelled = false;
        setMessages([greeting()]);
        setHistoryError(null);
        api.getAssistantHistory(Number(activeProject.id))
            .then((hist) => {
                if (cancelled || hist.length === 0) return;
                setMessages([greeting(), ...hist.map((h) => ({
                    role: h.role,
                    text: h.text,
                    sources: h.sources,
                    offline: h.mode === 'offline'
                }))]);
            })
            .catch((err) => {
                if (!cancelled) setHistoryError(`${t('pa_history_failed')} ${(err as Error)?.message ?? err}`);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProject.id]);

    const handleNewChat = async () => {
        if (busy) return;
        try {
            await api.clearAssistantHistory(Number(activeProject.id));
            setHistoryError(null);
        } catch (err) {
            setHistoryError(`${t('pa_clear_failed')} ${(err as Error)?.message ?? err}`);
            return;
        }
        setMessages([greeting()]);
    };

    useEffect(() => {
        endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
    }, [messages]);

    const ask = async (question: string) => {
        const q = question.trim();
        if (!q || busy) return;
        setInput('');
        setAudioHint(null);
        setBusy(true);
        setMessages((m) => [...m, {role: 'user', text: q}, {role: 'assistant', text: '…', pending: true}]);
        let reply: Message;
        try {
            const res = await api.askProject(q, Number(activeProject.id));
            reply = {role: 'assistant', text: res.answer, sources: res.sources, offline: res.mode === 'offline'};
        } catch (err) {
            if (isNotImplemented(err)) {
                reply = {
                    role: 'assistant',
                    text: t('pa_not_available')
                };
            } else {
                reply = {role: 'assistant', text: `${t('pa_error')} ${(err as Error)?.message ?? err}`};
            }
        }
        setMessages((m) => [...m.filter((x) => !x.pending), reply]);
        setBusy(false);
    };

    return (
        <div className="idea-page chat-page">
            <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><MessageSquare size={22}/></div>
                    <div>
                        <h1>{t('pa_title')}</h1>
                    </div>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleNewChat}
                    disabled={busy || messages.length <= 1}
                    title={t('pa_new_chat_title')}
                >
                    <RotateCcw size={14}/> <span>{t('pa_new_chat')}</span>
                </button>
            </div>

            {historyError && <div className="chat-audio-hint"><span>{historyError}</span></div>}

            <div className="chat-card">
                <div className="chat-messages">
                    {messages.map((m, idx) => (
                        <div key={idx} className={`chat-bubble ${m.role}`}>
                            {m.greeting ? tf('pa_greeting', {name: activeProject.name}) : m.text}
                            {m.sources && m.sources.length > 0 && (
                                <div className="chat-sources">{t('pa_sources')} {m.sources.join(' • ')}</div>
                            )}
                            {m.offline && (
                                <div className="chat-sources">{t('pa_offline_answer')}</div>
                            )}
                        </div>
                    ))}
                    <div ref={endRef}/>
                </div>

                <div className="chat-composer">
                    <div className="chat-suggestions">
                        {(suggestions ?? fallbackSuggestions()).map((s) => (
                            <button key={s} className="idea-tab" onClick={() => ask(s)} disabled={busy}>
                                {s}
                            </button>
                        ))}
                    </div>

                    {audioHint && (
                        <div className="chat-audio-hint">
                            <span>{audioHint}</span>
                            <button type="button" onClick={() => setAudioHint(null)} aria-label={t('pa_close_hint')}>×
                            </button>
                        </div>
                    )}

                    <form
                        className="chat-input-row"
                        onSubmit={(e) => {
                            e.preventDefault();
                            ask(input);
                        }}
                    >
                        <input
                            className="form-input"
                            style={{flex: 1}}
                            placeholder={recorder.isRecording ? t('pa_recording_ph') : t('pa_input_ph')}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                        />
                        <button
                            type="button"
                            className={`btn ${recorder.isRecording ? 'chat-mic-recording' : 'btn-secondary'}`}
                            onClick={handleToggleAudio}
                            disabled={busy || transcribing}
                            title={recorder.isRecording ? t('pa_stop_rec') : t('pa_record')}
                            aria-label={recorder.isRecording ? t('pa_stop_rec') : t('pa_record')}
                        >
                            {recorder.isRecording ? <Square size={14}/> : <Mic size={14}/>}
                            <span>
                                {transcribing ? t('pa_transcribing') : recorder.isRecording ? t('pa_stop') : t('pa_audio')}
                            </span>
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={busy || transcribing || !input.trim()}>
                            <Send size={14}/> <span>{t('pa_ask')}</span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ProjectAssistant;
