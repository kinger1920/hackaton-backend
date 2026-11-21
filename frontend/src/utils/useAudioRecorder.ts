import {useEffect, useRef, useState} from 'react';

/**
 * Gemeinsame Mikrofon-Aufnahme (MediaRecorder) für Erfassung und Bautagesbericht.
 * `start()` liefert false, wenn kein Mikrofon verfügbar ist (kein HTTPS, verweigert, alter Browser) –
 * die Seite entscheidet dann selbst über den Fallback (z. B. Text eintippen).
 * Nach `stop()` wird `onAudio(blob)` mit der Aufnahme aufgerufen.
 */
export function useAudioRecorder(onAudio: (audio: Blob) => void) {
    const [isRecording, setIsRecording] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const onAudioRef = useRef(onAudio);
    onAudioRef.current = onAudio;

    const supported =
        typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

    const start = async (): Promise<boolean> => {
        if (!supported || isRecording) return false;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                setIsRecording(false);
                onAudioRef.current(new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'}));
            };
            recorderRef.current = recorder;
            recorder.start();
            setIsRecording(true);
            return true;
        } catch {
            setIsRecording(false);
            return false;
        }
    };

    const stop = () => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        else setIsRecording(false);
    };

    // Beim Verlassen der Seite Mikrofon freigeben
    useEffect(() => () => {
        if (recorderRef.current?.state === 'recording') {
            recorderRef.current.onstop = null;
            recorderRef.current.stop();
            recorderRef.current.stream.getTracks().forEach((t) => t.stop());
        }
    }, []);

    return {isRecording, supported, start, stop};
}
