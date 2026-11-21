import React, {useEffect, useRef, useState} from 'react';
import {MessageSquare, Mic, RotateCcw, Send, Square} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api} from '../services/api';
import {useAudioRecorder} from '../utils/useAudioRecorder';
import {isNotImplemented} from '../components/ComingSoon';
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
}

const SUGGESTIONS = [
    'Warum sind wir bei Aushub Achse B im Verzug?',
    'Welche Behinderungen gab es letzte Woche?',
    'Wie viele Leute hatte Erdbau Krause laut Vertrag zu stellen?',
    'Welche Briefe sind noch nicht freigegeben?'
];

export const ProjectAssistant: React.FC = () => {
    const {activeProject} = useProjects();
    const greeting = (): Message => ({
        role: 'assistant',
        text: `Fragen zu „${activeProject.name}“ – auf Basis von Tagesberichten, Notizen, Briefen und Verträgen.`
    });
    const [messages, setMessages] = useState<Message[]>(() => [greeting()]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [transcribing, setTranscribing] = useState(false);
    const [audioHint, setAudioHint] = useState<string | null>(null);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement>(null);

    const recorder = useAudioRecorder(async (blob) => {
        setTranscribing(true);
        setAudioHint(null);
        try {
            const res = await api.transcribeAudio(blob, 'de');
            const text = res?.text?.trim();
            if (text) {
                setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
            } else {
                setAudioHint('Spracherkennung aktuell nicht verfügbar – bitte Frage eintippen.');
            }
        } catch (err) {
            setAudioHint(`Audio-Transkription fehlgeschlagen: ${(err as Error)?.message ?? err}`);
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
            setAudioHint('Mikrofon nicht verfügbar (Berechtigung fehlt oder kein HTTPS). Bitte Frage eintippen.');
        }
    };

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
                if (!cancelled) setHistoryError(`Verlauf nicht geladen: ${(err as Error)?.message ?? err}`);
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
            setHistoryError(`Verlauf konnte nicht gelöscht werden: ${(err as Error)?.message ?? err}`);
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
                    text: 'Die Projektabfrage steht auf diesem Server aktuell nicht zur Verfügung. Nutzen Sie bis dahin die Zusammenfassungen (Woche/Monat) oder die Auswertung im Dashboard.'
                };
            } else {
                reply = {role: 'assistant', text: `Fehler: ${(err as Error)?.message ?? err}`};
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
                        <h1>Projekt-Assistent</h1>
                    </div>
                </div>
                <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleNewChat}
                    disabled={busy || messages.length <= 1}
                    title="Verlauf löschen und neuen Chat beginnen"
                >
                    <RotateCcw size={14}/> <span>Neuer Chat</span>
                </button>
            </div>

            {historyError && <div className="chat-audio-hint"><span>{historyError}</span></div>}

            <div className="chat-card">
                <div className="chat-messages">
                    {messages.map((m, idx) => (
                        <div key={idx} className={`chat-bubble ${m.role}`}>
                            {m.text}
                            {m.sources && m.sources.length > 0 && (
                                <div className="chat-sources">Quellen: {m.sources.join(' • ')}</div>
                            )}
                            {m.offline && (
                                <div className="chat-sources">Antwort regelbasiert direkt aus den Projektdaten</div>
                            )}
                        </div>
                    ))}
                    <div ref={endRef}/>
                </div>

                <div className="chat-composer">
                    <div className="chat-suggestions">
                        {SUGGESTIONS.map((s) => (
                            <button key={s} className="idea-tab" onClick={() => ask(s)} disabled={busy}>
                                {s}
                            </button>
                        ))}
                    </div>

                    {audioHint && (
                        <div className="chat-audio-hint">
                            <span>{audioHint}</span>
                            <button type="button" onClick={() => setAudioHint(null)} aria-label="Hinweis schließen">×</button>
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
                            placeholder={recorder.isRecording ? 'Aufnahme läuft – bitte sprechen…' : 'Frage zum Projekt stellen…'}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                        />
                        <button
                            type="button"
                            className={`btn ${recorder.isRecording ? 'chat-mic-recording' : 'btn-secondary'}`}
                            onClick={handleToggleAudio}
                            disabled={busy || transcribing}
                            title={recorder.isRecording ? 'Aufnahme stoppen' : 'Frage per Audio aufnehmen'}
                            aria-label={recorder.isRecording ? 'Aufnahme stoppen' : 'Frage per Audio aufnehmen'}
                        >
                            {recorder.isRecording ? <Square size={14}/> : <Mic size={14}/>}
                            <span>
                                {transcribing ? 'Transkribiere…' : recorder.isRecording ? 'Stopp' : 'Audio'}
                            </span>
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={busy || transcribing || !input.trim()}>
                            <Send size={14}/> <span>Fragen</span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ProjectAssistant;
