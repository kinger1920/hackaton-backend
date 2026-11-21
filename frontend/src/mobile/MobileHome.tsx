import React, {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Camera, Check, ClipboardList, FileText, Keyboard, Loader2, Mail, Mic, NotebookPen, Square, X} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {api} from '../services/api';
import {useAudioRecorder} from '../utils/useAudioRecorder';
import {todayIso} from '../utils/dates';
import './Mobile.css';

/**
 * Handy-Startseite „Aufnahme“: ein großer Knopf – sprechen – Ziel wählen.
 * Ziele: Tagesbericht (POST /api/reports/{heute}/fill), Mangel (POST /api/defects), Brief (Briefentwurf mit
 * dem Text als Stichworten), Notiz (POST /site-notes/create). Foto: POST /api/photos (Beschreibung + Befunde).
 * Ohne Mikrofon im Browser (z. B. kein HTTPS) öffnet der Knopf die Sprachaufnahme des Handys (Datei-Upload).
 */

type Phase = 'idle' | 'recording' | 'transcribing' | 'review' | 'saving';
type Target = 'report' | 'defect' | 'letter' | 'note';

interface Done {
    id: number;
    text: string;
    link?: { label: string; go: () => void };
    error?: boolean;
}

const DEFECT_WORDS = /\b(mangel|mängel|riss|risse|kiesnest|undicht|beschädig|schaden|schäden|fehlerhaft|abplatz|nacharbeit|nicht fachgerecht)/i;
const LETTER_WORDS = /\b(behinder|verzug|verzögert|stillstand|steht|stehen|fehl(t|en|ende)|warten|wartet|mehrkosten|nachtrag|bedenken|zusätzlich)/i;

export function suggestTarget(text: string): Target {
    if (DEFECT_WORDS.test(text)) return 'defect';
    if (LETTER_WORDS.test(text)) return 'letter';
    return 'report';
}

const TARGETS: { key: Target; label: string; hint: string; icon: React.ReactNode }[] = [
    {key: 'report', label: 'Tagesbericht', hint: 'in den heutigen Bericht übernehmen', icon: <FileText size={20}/>},
    {key: 'defect', label: 'Mangel', hint: 'als Mangel mit Frist erfassen', icon: <ClipboardList size={20}/>},
    {key: 'letter', label: 'Brief', hint: 'Behinderung / Mehrkosten / Mängelrüge entwerfen', icon: <Mail size={20}/>},
    {key: 'note', label: 'Notiz', hint: 'nur ins Bautagebuch', icon: <NotebookPen size={20}/>}
];

const firstSentence = (text: string) =>
    text.replace(/^\s*(mangel|notiz)\s*[:,-]\s*/i, '').split(/(?<=[.!?])\s/)[0].trim().slice(0, 120) || 'Mangel';

const greeting = () => {
    const h = new Date().getHours();
    return h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
};

export const MobileHome: React.FC = () => {
    const navigate = useNavigate();
    const {activeProject} = useProjects();
    const projectId = Number(activeProject.id);
    const userName = (localStorage.getItem('userName') || '').split(' ')[0];

    const [phase, setPhase] = useState<Phase>('idle');
    const [text, setText] = useState('');
    const [suggested, setSuggested] = useState<Target>('report');
    const [seconds, setSeconds] = useState(0);
    const [hint, setHint] = useState<string | null>(null);
    const [done, setDone] = useState<Done[]>([]);
    const [weather, setWeather] = useState<string | null>(null);
    const audioInput = useRef<HTMLInputElement>(null);
    const photoInput = useRef<HTMLInputElement>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);

    const today = todayIso();

    useEffect(() => {
        let cancelled = false;
        setWeather(null);
        api.getWeather(today, projectId)
            .then((w) => !cancelled && setWeather(`${w.temperature_c != null ? `${Math.round(w.temperature_c)} °C · ` : ''}${w.condition.replace(/\s*\(.*\)$/, '')}`))
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [projectId, today]);

    const addDone = (entry: Omit<Done, 'id'>) => setDone((prev) => [{...entry, id: Date.now()}, ...prev].slice(0, 3));

    const transcribe = async (blob: Blob) => {
        setPhase('transcribing');
        setHint(null);
        try {
            const res = await api.transcribeAudio(blob, 'de');
            const recognized = res?.text?.trim() ?? '';
            if (!recognized) {
                setHint('Sprache nicht erkannt – bitte kurz eintippen.');
                openText('');
                return;
            }
            openText(recognized);
        } catch (err: any) {
            setHint(`Transkription fehlgeschlagen: ${err?.message ?? err}. Bitte eintippen.`);
            openText('');
        }
    };

    const recorder = useAudioRecorder(transcribe);

    useEffect(() => {
        if (phase !== 'recording') return;
        setSeconds(0);
        const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
        return () => window.clearInterval(timer);
    }, [phase]);

    const openText = (value: string) => {
        setText(value);
        setSuggested(suggestTarget(value));
        setPhase('review');
        window.setTimeout(() => textRef.current?.focus(), 50);
    };

    const onMic = async () => {
        setHint(null);
        if (phase === 'recording') {
            recorder.stop();
            return;
        }
        if (recorder.supported && await recorder.start()) {
            setPhase('recording');
            return;
        }
        // Kein Mikrofon im Browser (z. B. ohne HTTPS) → Sprachaufnahme des Handys
        audioInput.current?.click();
    };

    const reset = () => {
        setText('');
        setPhase('idle');
    };

    const send = async (target: Target) => {
        const value = text.trim();
        if (!value) return;
        if (target === 'letter') {
            navigate('/drafts', {state: {keywords: value}});
            return;
        }
        setPhase('saving');
        try {
            if (target === 'report') {
                await api.fillReport(today, {text: value, lang: 'de', project_id: projectId});
                addDone({text: 'In den Tagesbericht von heute übernommen', link: {label: 'Bericht', go: () => navigate('/reports')}});
            } else if (target === 'defect') {
                const d = await api.createDefect({project_id: projectId, title: firstSentence(value), description: value, source: 'diktat'});
                addDone({
                    text: `Mangel #${d.id} erfasst${d.house ? ` · ${[d.house, d.level].filter(Boolean).join(' · ')}` : ''}`,
                    link: {label: 'Öffnen', go: () => navigate('/maengel', {state: {focusId: d.id}})}
                });
            } else {
                await api.createSiteNote({project_id: projectId, content: value, category: 'general', status: 'raw'});
                addDone({text: 'Notiz im Bautagebuch gespeichert'});
            }
            reset();
        } catch (err: any) {
            addDone({text: `Nicht gespeichert: ${err?.message ?? err}`, error: true});
            setPhase('review');
        }
    };

    const onPhoto = async (file: File | undefined) => {
        if (!file) return;
        setPhase('saving');
        try {
            const photo = await api.uploadPhoto(file, projectId, today);
            const issue = photo.issues?.[0];
            addDone({
                text: `Foto gespeichert${photo.caption ? `: ${photo.caption}` : ''}`,
                link: issue
                    ? {
                        label: 'Als Mangel',
                        go: async () => {
                            try {
                                const d = await api.createDefect({
                                    project_id: projectId, title: issue.slice(0, 120), description: photo.issues.join('; '),
                                    photo_id: photo.id, source: 'foto'
                                });
                                navigate('/maengel', {state: {focusId: d.id}});
                            } catch (err: any) {
                                addDone({text: `Mangel nicht angelegt: ${err?.message ?? err}`, error: true});
                            }
                        }
                    }
                    : {label: 'Bericht', go: () => navigate('/reports')}
            });
        } catch (err: any) {
            addDone({text: `Foto nicht gespeichert: ${err?.message ?? err}`, error: true});
        } finally {
            setPhase('idle');
        }
    };

    const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    return (
        <div className="mh">
            <div className="mh-top">
                <div className="mh-hello">{greeting()}{userName ? `, ${userName}` : ''}</div>
                <div className="mh-sub">
                    {new Date().toLocaleDateString('de-DE', {weekday: 'long', day: 'numeric', month: 'long'})}
                    {weather ? ` · ${weather}` : ''}
                </div>
            </div>

            {phase === 'review' || phase === 'saving' ? (
                <div className="mh-review">
                    <label className="m-sr" htmlFor="mh-text">Erfasster Text</label>
                    <textarea id="mh-text" ref={textRef} className="mh-text" rows={5} value={text}
                              placeholder="Was ist passiert? z. B. „Bagger steht seit 10 Uhr, Pläne fehlen“"
                              onChange={(e) => {
                                  setText(e.target.value);
                                  setSuggested(suggestTarget(e.target.value));
                              }}/>
                    {hint && <div className="mh-hint">{hint}</div>}
                    <div className="mh-targets" role="group" aria-label="Wohin damit?">
                        {TARGETS.map((target) => (
                            <button key={target.key} type="button"
                                    className={`mh-target${target.key === suggested ? ' suggested' : ''}`}
                                    disabled={!text.trim() || phase === 'saving'} onClick={() => send(target.key)}>
                                <span className="mh-target-icon">{target.icon}</span>
                                <span className="mh-target-text">
                                    <strong>{target.label}{target.key === suggested ? <em> · Vorschlag</em> : null}</strong>
                                    <small>{target.hint}</small>
                                </span>
                            </button>
                        ))}
                    </div>
                    <button type="button" className="mh-discard" onClick={reset} disabled={phase === 'saving'}>
                        <X size={16}/> Verwerfen
                    </button>
                </div>
            ) : (
                <div className="mh-center">
                    <button
                        type="button"
                        className={`mh-mic ${phase}`}
                        onClick={onMic}
                        disabled={phase === 'transcribing'}
                        aria-label={phase === 'recording' ? 'Aufnahme beenden' : 'Aufnahme starten'}
                        aria-live="polite"
                    >
                        {phase === 'transcribing' ? <Loader2 size={54} className="mh-spin"/> : phase === 'recording' ? <Square size={48}/> : <Mic size={58}/>}
                    </button>
                    <div className="mh-mic-label" aria-live="polite">
                        {phase === 'recording' ? <><span className="mh-rec-dot"/> {mm} · Tippen zum Beenden</>
                            : phase === 'transcribing' ? 'Wird erkannt…'
                                : 'Tippen und sprechen'}
                    </div>
                    {hint && <div className="mh-hint">{hint}</div>}

                    <div className="mh-quick">
                        <button type="button" className="mh-quick-btn" onClick={() => photoInput.current?.click()} disabled={phase !== 'idle'}>
                            <Camera size={20}/><span>Foto</span>
                        </button>
                        <button type="button" className="mh-quick-btn" onClick={() => openText('')} disabled={phase !== 'idle'}>
                            <Keyboard size={20}/><span>Tippen</span>
                        </button>
                        <button type="button" className="mh-quick-btn" onClick={() => navigate('/maengel', {state: {newDefect: {}}})} disabled={phase !== 'idle'}>
                            <ClipboardList size={20}/><span>Mangel</span>
                        </button>
                    </div>
                </div>
            )}

            {done.length > 0 && (
                <ul className="mh-done" aria-label="Gerade erledigt">
                    {done.map((d) => (
                        <li key={d.id} className={d.error ? 'error' : undefined}>
                            {d.error ? <X size={16}/> : <Check size={16}/>}
                            <span>{d.text}</span>
                            {d.link && <button type="button" onClick={d.link.go}>{d.link.label}</button>}
                        </li>
                    ))}
                </ul>
            )}

            <input ref={audioInput} type="file" accept="audio/*" capture hidden
                   onChange={(e) => {
                       const f = e.target.files?.[0];
                       e.target.value = '';
                       if (f) transcribe(f);
                   }}/>
            <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden
                   onChange={(e) => {
                       const f = e.target.files?.[0];
                       e.target.value = '';
                       onPhoto(f);
                   }}/>
        </div>
    );
};

export default MobileHome;
