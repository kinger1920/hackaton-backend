import React, {useEffect, useRef, useState} from 'react';
import {MessageSquare, Send, Sparkles} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api} from '../services/api';
import {ComingSoonBadge, ComingSoonNote, isNotImplemented} from '../components/ComingSoon';
import './Ideas.css';

/**
 * Idee #5: „Frag dein Projekt“ – Chat über Tagesberichte, Notizen, Briefe und Verträge, jede Antwort mit Quellen.
 * Frontend fertig; Backend folgt (POST /api/assistant/ask). Die Chat-Tabellen (ChatSession/ChatMessage) gibt es schon.
 */

interface Message {
    role: 'user' | 'assistant';
    text: string;
    sources?: string[];
    pending?: boolean;
}

const SUGGESTIONS = [
    'Warum sind wir bei Aushub Achse B im Verzug?',
    'Welche Behinderungen gab es letzte Woche?',
    'Wie viele Leute hatte Erdbau Krause laut Vertrag zu stellen?',
    'Welche Briefe sind noch nicht freigegeben?'
];

export const ProjectAssistant: React.FC = () => {
    const {activeProject} = useProjects();
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            text: `Hallo! Ich beantworte Fragen zu „${activeProject.name}“ – auf Basis von Tagesberichten, Tagebuch, Briefen und Verträgen. Jede Antwort nennt ihre Quellen.`
        }
    ]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [backendMissing, setBackendMissing] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages]);

    const ask = async (question: string) => {
        const q = question.trim();
        if (!q || busy) return;
        setInput('');
        setBusy(true);
        setMessages((m) => [...m, {role: 'user', text: q}, {role: 'assistant', text: '…', pending: true}]);
        let reply: Message;
        try {
            const res = await api.askProject(q, Number(activeProject.id));
            reply = {role: 'assistant', text: res.answer, sources: res.sources};
        } catch (err) {
            if (isNotImplemented(err)) {
                setBackendMissing(true);
                reply = {
                    role: 'assistant',
                    text: 'Der Projekt-Assistent ist im Frontend vorbereitet, das Backend dafür fehlt noch. Bis dahin: Zusammenfassungen (Woche/Monat) und die Soll/Ist-Analyse im Dashboard nutzen.'
                };
            } else {
                reply = {role: 'assistant', text: `Fehler: ${(err as Error)?.message ?? err}`};
            }
        }
        setMessages((m) => [...m.filter((x) => !x.pending), reply]);
        setBusy(false);
    };

    return (
        <div className="idea-page">
            <div className="idea-header">
                <div className="idea-title-group">
                    <div className="idea-icon"><MessageSquare size={22}/></div>
                    <div>
                        <h1 style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                            Projekt-Assistent <ComingSoonBadge/>
                        </h1>
                        <p>Frag dein Projekt – Antworten mit Quellenangabe, keine Rechtsberatung</p>
                    </div>
                </div>
            </div>

            <div className="chat-card">
                <div className="chat-messages">
                    {messages.map((m, idx) => (
                        <div key={idx} className={`chat-bubble ${m.role}`}>
                            {m.text}
                            {m.sources && m.sources.length > 0 && (
                                <div className="chat-sources">Quellen: {m.sources.join(' • ')}</div>
                            )}
                        </div>
                    ))}
                    <div ref={endRef}/>
                </div>

                <div className="chat-suggestions">
                    {SUGGESTIONS.map((s) => (
                        <button key={s} className="idea-tab" onClick={() => ask(s)} disabled={busy}>
                            <Sparkles size={11} style={{display: 'inline', marginRight: '4px'}}/>
                            {s}
                        </button>
                    ))}
                </div>

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
                        placeholder="Frage zum Projekt stellen…"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
                        <Send size={14}/> <span>Fragen</span>
                    </button>
                </form>
            </div>

            {backendMissing && (
                <ComingSoonNote endpoint="POST /api/assistant/ask {question, project_id} → {answer, sources[], mode}">
                    Backend-Aufgabe: Fragen per LLM über Tagesberichte, SiteNotes, Briefe und Vertragstexte beantworten,
                    nur mit existierenden Quellen (wie bei /api/summarize), Verlauf in ChatSession/ChatMessage speichern.
                </ComingSoonNote>
            )}
        </div>
    );
};

export default ProjectAssistant;
