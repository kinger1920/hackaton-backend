import React, {useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
    Sparkles,
    AlertTriangle,
    Copy,
    Download,
    Printer,
    UploadCloud,
    FileText,
    X,
    CalendarPlus,
    Mail,
    Check,
    CalendarRange,
    Info,
    BookOpen
} from 'lucide-react';
import {useProjects} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {extractTextFromFile} from '../utils/fileExtractor';
import {api, saveBlob, SummaryResponse, SummaryActionItem, SummaryVobRisk} from '../services/api';
import {todayIso} from '../utils/dates';
import '@frontend/src/index.css';
import './Summary.css';

/**
 * Zusammenfassungen
 * One text box (paste anything: protocol, e-mail, notes) + optional Word/PDF upload underneath.
 * The backend AI (POST /api/summarize) recognises the kind of text by itself.
 * Or: summarise this week / month from the project's reports, notes and letters.
 * Without the server nothing is invented – a clear message is shown instead.
 */

const MAX_CHARS = 12000; // backend evaluates at most 12,000 characters

interface UploadedFileInfo {
    name: string;
    size: number;
    charCount: number;
}

type NoticeLink = 'delay' | 'cost' | 'defect' | 'concern';

const escapeHtml = (s: string) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pad = (n: number) => String(n).padStart(2, '0');

/** "28.11.2026", "28.11." or "2026-11-28" → ISO date; anything else ("Freitag") → '' */
const parseDeadline = (text: string): string => {
    const s = (text || '').trim();
    const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const de = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
    if (de) {
        const year = de[3] ? (de[3].length === 2 ? `20${de[3]}` : de[3]) : String(new Date().getFullYear());
        return `${year}-${pad(Number(de[2]))}-${pad(Number(de[1]))}`;
    }
    return '';
};

const formatBytes = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const noticeName = (link: NoticeLink | null | undefined) =>
    link === 'cost' ? 'Mehrkostenanmeldung' : link === 'defect' ? 'Mängelanzeige' : link === 'concern' ? 'Bedenkenanzeige' : 'Behinderungsanzeige';

export const Summary: React.FC = () => {
    const navigate = useNavigate();
    const {t} = useLanguage();
    const {activeProject} = useProjects();
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- input ---
    const [inputText, setInputText] = useState('');
    const [uploadedFile, setUploadedFile] = useState<UploadedFileInfo | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    // --- result ---
    const [summary, setSummary] = useState<SummaryResponse | null>(null);
    const [busy, setBusy] = useState<null | 'text' | 'day' | 'week' | 'month'>(null);
    const [error, setError] = useState<string | null>(null);
    const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
    const [copyDone, setCopyDone] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // "In Terminplaner": which item is being scheduled + chosen date
    const [scheduling, setScheduling] = useState<{ id: string; date: string } | null>(null);
    const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set());

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2800);
    };

    /* ---------------- input: file ---------------- */

    const handleProcessFile = async (file: File) => {
        setIsExtracting(true);
        setError(null);
        try {
            const extracted = await extractTextFromFile(file);
            setInputText(extracted);
            setUploadedFile({name: file.name, size: file.size, charCount: extracted.length});
        } catch (err) {
            setError(`${t('su_file_failed')} ${String((err as Error)?.message ?? err)}`);
        } finally {
            setIsExtracting(false);
        }
    };

    const handleRemoveFile = () => {
        setUploadedFile(null);
        setInputText('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    /* ---------------- summarise ---------------- */

    const applyResult = (res: SummaryResponse) => {
        setSummary(res);
        setDoneIds(new Set(res.actionItems.filter((a) => a.done).map((a) => a.id)));
        setScheduledIds(new Set());
        setScheduling(null);
    };

    const handleSummarizeText = async () => {
        if (!inputText.trim()) return;
        setBusy('text');
        setError(null);
        try {
            applyResult(await api.summarize({text: inputText.trim(), project_id: Number(activeProject.id)}));
        } catch (err) {
            setError(`${t('su_failed')} ${String((err as Error)?.message ?? '')}`.trim());
        } finally {
            setBusy(null);
        }
    };

    const handleSummarizePeriod = async (period: 'day' | 'week' | 'month') => {
        setBusy(period);
        setError(null);
        try {
            applyResult(await api.summarize({project_id: Number(activeProject.id), period}));
        } catch (err) {
            setError(`${t('su_failed')} ${String((err as Error)?.message ?? '')}`.trim());
        } finally {
            setBusy(null);
        }
    };

    /* ---------------- open items: done / Terminplaner / letter ---------------- */

    const toggleDone = (id: string) =>
        setDoneIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const startScheduling = (item: SummaryActionItem) =>
        setScheduling({id: item.id, date: parseDeadline(item.deadline) || todayIso()});

    /** Adds the item as a deadline to the Terminplaner (same local list the Terminplaner uses). */
    const confirmScheduling = (item: SummaryActionItem) => {
        if (!scheduling?.date) return;
        const key = `siteAppointments_${Number(activeProject.id)}`;
        let list: unknown[] = [];
        try {
            list = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(list)) list = [];
        } catch {
            list = [];
        }
        list.push({
            id: `sum-${Date.now()}`,
            projectId: Number(activeProject.id),
            title: item.task,
            date: scheduling.date,
            category: 'deadline',
            description: [
                item.responsible && `${t('su_responsible')}: ${item.responsible}`,
                item.source && `${t('su_source')}: ${item.source}`,
                t('su_from_summary')
            ].filter(Boolean).join(' · '),
            isUrgent: item.priority === 'Hoch'
        });
        localStorage.setItem(key, JSON.stringify(list));
        setScheduledIds((prev) => new Set(prev).add(item.id));
        setScheduling(null);
        showToast(t('su_toast_scheduled'));
    };

    const openLetter = (type: NoticeLink, keywords: string) =>
        navigate('/drafts', {state: {type, keywords}});

    /* ---------------- export ---------------- */

    const resultAsText = (s: SummaryResponse) =>
        [
            s.title,
            `${t('drafts_label_project')}: ${activeProject.name} (${activeProject.number})`,
            '',
            t('su_sec_summary').toUpperCase(),
            ...s.executiveSummary.map((x) => `• ${x}`),
            '',
            t('su_sec_decisions').toUpperCase(),
            ...(s.keyDecisions.length ? s.keyDecisions.map((d, i) => `• ${d}${s.keyDecisionSources?.[i] ? ` (${s.keyDecisionSources[i]})` : ''}`) : [`– ${t('su_none')}`]),
            '',
            t('su_sec_actions').toUpperCase(),
            ...(s.actionItems.length
                ? s.actionItems.map((a) => `[${doneIds.has(a.id) ? 'x' : ' '}] ${a.task}${a.responsible ? ` | ${a.responsible}` : ''}${a.deadline ? ` | ${a.deadline}` : ''} (${a.source})`)
                : [`– ${t('su_none')}`]),
            '',
            t('su_sec_risks').toUpperCase(),
            ...(s.vobRisks.length ? s.vobRisks.map((r) => `⚠ ${r.title}: ${r.description} – ${r.recommendation} (${r.source ?? ''})`) : [`– ${t('su_none')}`]),
            '',
            s.traceabilityNotes
        ].join('\n');

    const handleCopy = () => {
        if (!summary) return;
        navigator.clipboard.writeText(resultAsText(summary));
        setCopyDone(true);
        setTimeout(() => setCopyDone(false), 2500);
    };

    const handleWord = () => {
        if (!summary) return;
        const s = summary;
        const li = (items: string[]) => items.length ? `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p>– ${escapeHtml(t('su_none'))}</p>`;
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(s.title)}</title>
<style>
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
h1 { font-size: 15pt; margin: 0 0 4pt 0; }
h2 { font-size: 12pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; margin-top: 16pt; }
table { width: 100%; border-collapse: collapse; margin-top: 6pt; }
th, td { border: 1px solid #ddd; padding: 5pt; font-size: 10pt; text-align: left; vertical-align: top; }
th { background-color: #f3efe7; }
.meta, .trace { color: #555; font-size: 9pt; }
</style>
</head>
<body>
<h1>${escapeHtml(s.title)}</h1>
<p class="meta">${escapeHtml(t('drafts_label_project'))}: ${escapeHtml(activeProject.name)} (${escapeHtml(activeProject.number)}) · ${new Date().toLocaleDateString('de-DE')}</p>
<h2>${escapeHtml(t('su_sec_summary'))}</h2>
${li(s.executiveSummary)}
<h2>${escapeHtml(t('su_sec_decisions'))}</h2>
${li(s.keyDecisions.map((d, i) => `${d}${s.keyDecisionSources?.[i] ? ` (${s.keyDecisionSources[i]})` : ''}`))}
<h2>${escapeHtml(t('su_sec_actions'))}</h2>
${s.actionItems.length ? `<table><tr><th>${escapeHtml(t('su_col_status'))}</th><th>${escapeHtml(t('su_col_task'))}</th><th>${escapeHtml(t('su_responsible'))}</th><th>${escapeHtml(t('su_deadline'))}</th><th>${escapeHtml(t('su_source'))}</th></tr>
${s.actionItems.map((a) => `<tr><td>${doneIds.has(a.id) ? escapeHtml(t('su_done')) : escapeHtml(t('su_open'))}</td><td>${escapeHtml(a.task)}</td><td>${escapeHtml(a.responsible || '–')}</td><td>${escapeHtml(a.deadline || '–')}</td><td>${escapeHtml(a.source)}</td></tr>`).join('')}
</table>` : `<p>– ${escapeHtml(t('su_none'))}</p>`}
<h2>${escapeHtml(t('su_sec_risks'))}</h2>
${s.vobRisks.length ? s.vobRisks.map((r) => `<p><strong>${escapeHtml(r.title)}</strong><br/>${escapeHtml(r.description)}<br/><em>${escapeHtml(r.recommendation)}</em>${r.source ? `<br/><span class="trace">${escapeHtml(t('su_source'))}: ${escapeHtml(r.source)}</span>` : ''}</p>`).join('') : `<p>– ${escapeHtml(t('su_none'))}</p>`}
<hr/>
<p class="trace">${escapeHtml(s.traceabilityNotes)}<br/>${escapeHtml(t('su_human_note'))}</p>
</body>
</html>`;
        saveBlob(new Blob([html], {type: 'application/msword;charset=utf-8'}), `Zusammenfassung_${activeProject.number}_${todayIso()}.doc`);
    };

    // Prints only the result card (see @media print in Summary.css)
    const handlePrint = () => {
        document.body.classList.add('print-summary-only');
        const cleanup = () => {
            document.body.classList.remove('print-summary-only');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    };

    /* ---------------- render helpers ---------------- */

    const sourceTag = (source?: string | null) =>
        source ? <span className="su-source" title={t('su_source')}>{source}</span> : null;

    const tooLong = inputText.length > MAX_CHARS;
    const openCount = summary ? summary.actionItems.filter((a) => !doneIds.has(a.id)).length : 0;

    return (
        <div className="summary-container">
            {/* Header */}
            <div className="summary-header">
                <div className="tp-title-group">
                    <div className="tp-title-icon"><BookOpen size={22}/></div>
                    <div>
                        <h1>{t('sum_title')}</h1>
                        <p>{t('su_sub')} <strong>{activeProject.name}</strong></p>
                    </div>
                </div>
                {toast && (
                    <div className="su-toast">
                        <Check size={16}/>
                        <span>{toast}</span>
                    </div>
                )}
            </div>

            <div className="su-layout">
                {/* ---------------- Left: input ---------------- */}
                <div className="su-input-card">
                    <section className="su-step">
                        <h2 className="su-step-title"><span className="su-step-num">1</span>{t('su_step_input')}</h2>
                        <p className="su-hint">{t('su_input_hint')}</p>

                        <textarea
                            className="form-textarea su-textarea"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder={t('su_input_ph')}
                            aria-label={t('su_step_input')}
                        />
                        <div className={`su-counter ${tooLong ? 'warn' : ''}`}>
                            {inputText.length.toLocaleString('de-DE')} / {MAX_CHARS.toLocaleString('de-DE')} {t('su_chars')}
                            {tooLong && <span> – {t('su_too_long')}</span>}
                        </div>

                        {/* Upload underneath the text box */}
                        {uploadedFile ? (
                            <div className="su-file">
                                <FileText size={18}/>
                                <div className="su-file-info">
                                    <span className="su-file-name">{uploadedFile.name}</span>
                                    <span className="su-file-meta">
                                        {formatBytes(uploadedFile.size)} · {uploadedFile.charCount.toLocaleString('de-DE')} {t('su_chars')} {t('su_file_loaded')}
                                    </span>
                                </div>
                                <button type="button" className="su-icon-btn" onClick={handleRemoveFile}
                                        title={t('su_file_remove')} aria-label={t('su_file_remove')}>
                                    <X size={16}/>
                                </button>
                            </div>
                        ) : (
                            <div
                                className={`su-dropzone ${isDragOver ? 'over' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => fileInputRef.current?.click()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        fileInputRef.current?.click();
                                    }
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    setIsDragOver(true);
                                }}
                                onDragLeave={() => setIsDragOver(false)}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setIsDragOver(false);
                                    const file = e.dataTransfer.files?.[0];
                                    if (file) handleProcessFile(file);
                                }}
                            >
                                <UploadCloud size={22}/>
                                <div>
                                    <strong>{isExtracting ? t('su_file_reading') : t('su_drop_title')}</strong>
                                    <span>{t('su_drop_sub')}</span>
                                </div>
                            </div>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.docx,.txt,.md,.eml"
                            style={{display: 'none'}}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleProcessFile(file);
                            }}
                        />

                        <button
                            type="button"
                            className="btn btn-primary su-main-btn"
                            onClick={handleSummarizeText}
                            disabled={!inputText.trim() || busy !== null || isExtracting}
                        >
                            <Sparkles size={18}/>
                            <span>{busy === 'text' ? t('su_busy') : t('su_btn_summarize')}</span>
                        </button>
                    </section>

                    <section className="su-step">
                        <h2 className="su-step-title"><span className="su-step-num">2</span>{t('su_step_project')}</h2>
                        <p className="su-hint">{t('su_project_hint')}</p>
                        <div className="su-period-row">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleSummarizePeriod('day')}
                                disabled={busy !== null}
                            >
                                <Sparkles size={15}/>
                                <span>{busy === 'day' ? t('su_busy') : t('su_btn_today')}</span>
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleSummarizePeriod('week')}
                                disabled={busy !== null}
                            >
                                <Sparkles size={15}/>
                                <span>{busy === 'week' ? t('su_busy') : t('su_btn_week')}</span>
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => handleSummarizePeriod('month')}
                                disabled={busy !== null}
                            >
                                <Sparkles size={15}/>
                                <span>{busy === 'month' ? t('su_busy') : t('su_btn_month')}</span>
                            </button>
                        </div>
                    </section>
                </div>

                {/* ---------------- Right: result ---------------- */}
                <div className="su-result-card">
                    <div className="su-toolbar">
                        <div className="su-toolbar-title">
                            <span>{summary ? summary.title : t('su_result')}</span>
                            {summary && (
                                <span className={`su-mode ${summary.mode}`}
                                      title={summary.mode === 'ai' ? t('su_mode_ai_hint') : t('su_mode_offline_hint')}>
                                    {summary.mode === 'ai' ? t('su_mode_ai') : t('su_mode_offline')}
                                </span>
                            )}
                        </div>
                        <div className="su-toolbar-actions">
                            <button className="doc-btn" onClick={handleCopy} disabled={!summary} title={t('btn_copy')}>
                                <Copy size={14}/>
                                <span>{copyDone ? t('btn_copied') : t('btn_copy')}</span>
                            </button>
                            <button className="doc-btn" onClick={handleWord} disabled={!summary} title={t('btn_word_export')}>
                                <Download size={14}/>
                                <span>Word</span>
                            </button>
                            <button className="doc-btn" onClick={handlePrint} disabled={!summary} title={t('btn_print')}>
                                <Printer size={14}/>
                                <span>{t('btn_print')}</span>
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="su-message error">
                            <AlertTriangle size={15}/>
                            <span>{error}</span>
                            <button type="button" className="su-message-close" aria-label="Schließen" onClick={() => setError(null)}>
                                <X size={14}/>
                            </button>
                        </div>
                    )}

                    {!summary ? (
                        <div className="su-empty">
                            <FileText size={34}/>
                            <p>{t('su_empty')}</p>
                        </div>
                    ) : (
                        <div className="su-result-body su-print-area">
                            {summary.mode === 'offline' && (
                                <div className="su-message info">
                                    <Info size={15}/>
                                    <span>{t('su_offline_note')}</span>
                                </div>
                            )}

                            {(summary.periodFrom || summary.periodTo) && (
                                <div className="su-period">
                                    <CalendarRange size={14}/>
                                    <span>
                                        {summary.periodFrom ? new Date(summary.periodFrom).toLocaleDateString('de-DE') : '?'} – {summary.periodTo ? new Date(summary.periodTo).toLocaleDateString('de-DE') : '?'}
                                    </span>
                                </div>
                            )}

                            {/* 1. Kurzfassung */}
                            <section className="su-section">
                                <h3 className="su-section-title">{t('su_sec_summary')}</h3>
                                {summary.executiveSummary.length ? (
                                    <ul className="su-list">
                                        {summary.executiveSummary.map((s, i) => <li key={i}>{s}</li>)}
                                    </ul>
                                ) : <p className="su-none">{t('su_none')}</p>}
                            </section>

                            {/* 2. Beschlüsse */}
                            <section className="su-section">
                                <h3 className="su-section-title">{t('su_sec_decisions')}</h3>
                                {summary.keyDecisions.length ? (
                                    <ul className="su-list">
                                        {summary.keyDecisions.map((d, i) => (
                                            <li key={i}>{d} {sourceTag(summary.keyDecisionSources?.[i])}</li>
                                        ))}
                                    </ul>
                                ) : <p className="su-none">{t('su_none')}</p>}
                            </section>

                            {/* 3. Offene Punkte */}
                            <section className="su-section">
                                <h3 className="su-section-title">
                                    {t('su_sec_actions')}
                                    {summary.actionItems.length > 0 && <span className="su-count">{openCount}</span>}
                                </h3>
                                {summary.actionItems.length ? (
                                    <div className="su-actions">
                                        {summary.actionItems.map((a) => {
                                            const done = doneIds.has(a.id);
                                            return (
                                                <div key={a.id} className={`su-action ${done ? 'done' : ''}`}>
                                                    <label className="su-action-main">
                                                        <input type="checkbox" checked={done} onChange={() => toggleDone(a.id)}/>
                                                        <span className="su-action-task">{a.task}</span>
                                                    </label>
                                                    <div className="su-action-meta">
                                                        {a.priority === 'Hoch' && <span className="su-chip danger">{t('su_prio_high')}</span>}
                                                        <span className="su-chip">{t('su_responsible')}: {a.responsible || t('su_not_named')}</span>
                                                        <span className="su-chip">{t('su_deadline')}: {a.deadline || t('su_not_named')}</span>
                                                        {sourceTag(a.source)}
                                                    </div>
                                                    <div className="su-action-buttons">
                                                        {scheduledIds.has(a.id) ? (
                                                            <span className="su-scheduled"><Check size={13}/> {t('su_scheduled')}</span>
                                                        ) : scheduling?.id === a.id ? (
                                                            <span className="su-schedule-form">
                                                                <input
                                                                    type="date"
                                                                    className="form-input"
                                                                    value={scheduling.date}
                                                                    onChange={(e) => setScheduling({id: a.id, date: e.target.value})}
                                                                    aria-label={t('su_deadline')}
                                                                />
                                                                <button type="button" className="btn btn-primary su-small-btn"
                                                                        onClick={() => confirmScheduling(a)} disabled={!scheduling.date}>
                                                                    {t('su_add')}
                                                                </button>
                                                                <button type="button" className="su-icon-btn" onClick={() => setScheduling(null)}
                                                                        aria-label={t('btn_cancel')}>
                                                                    <X size={14}/>
                                                                </button>
                                                            </span>
                                                        ) : (
                                                            <button type="button" className="doc-btn" onClick={() => startScheduling(a)}>
                                                                <CalendarPlus size={14}/>
                                                                <span>{t('su_btn_schedule')}</span>
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="doc-btn"
                                                            onClick={() => openLetter('delay', `${a.task}${a.responsible ? `. Verantwortlich: ${a.responsible}` : ''}${a.deadline ? `. Frist: ${a.deadline}` : ''} (Quelle: ${a.source})`)}
                                                        >
                                                            <Mail size={14}/>
                                                            <span>{t('su_btn_letter')}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : <p className="su-none">{t('su_none')}</p>}
                            </section>

                            {/* 4. Risiken */}
                            <section className="su-section">
                                <h3 className="su-section-title">{t('su_sec_risks')}</h3>
                                {summary.vobRisks.length ? (
                                    <div className="su-risks">
                                        {summary.vobRisks.map((r: SummaryVobRisk, i) => (
                                            <div key={i} className="su-risk">
                                                <div className="su-risk-title">
                                                    <AlertTriangle size={15}/>
                                                    <span>{r.title}</span>
                                                </div>
                                                <p className="su-risk-desc">{r.description}</p>
                                                <p className="su-risk-rec">{r.recommendation}</p>
                                                <div className="su-risk-foot">
                                                    {sourceTag(r.source)}
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary su-small-btn"
                                                        onClick={() => openLetter(r.linkType ?? 'delay', `${r.title}. ${r.description}${r.source ? ` (Quelle: ${r.source})` : ''}`)}
                                                    >
                                                        <Mail size={14}/>
                                                        <span>{noticeName(r.linkType)} {t('su_create')}</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : <p className="su-none">{t('su_none')}</p>}
                            </section>

                            <div className="su-trace">
                                <span>{summary.traceabilityNotes}</span>
                                <span>{t('su_human_note')}</span>
                            </div>
                        </div>
                    )}

                    <div className="legal-notice-banner su-legal">
                        <AlertTriangle size={16} style={{flexShrink: 0}}/>
                        <span>{t('su_legal')}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Summary;
