import React, {useEffect, useState} from 'react';
import {Plus, Trash2, Pencil, Check, X, UploadCloud, RefreshCw, FileText} from 'lucide-react';
import {api, ImportedTask, ImportResult, PlanTask, PlanTaskIn} from '../services/api';
import {formatDe} from '../utils/dates';

/**
 * Vorgänge eines Bauzeitenplans (Backend: /api/plans/{id}/tasks, /import, /tasks/bulk).
 * - Liste mit Inline-Bearbeitung, Anlegen, Löschen (409 bei vorhandenem Fortschritt → Rückfrage, force)
 * - Import aus CSV oder PDF: erst Vorschau (nichts gespeichert), dann ausgewählte Zeilen übernehmen
 */

const STATUS_LABELS: Record<string, string> = {
    pending: 'geplant',
    in_progress: 'in Arbeit',
    delayed: 'verzögert',
    completed: 'fertig'
};

const fmtDate = (v?: string | null) => formatDe(v);

const EMPTY_TASK: PlanTaskIn = {task_code: '', title: '', trade: '', planned_start: '', planned_end: '', status: 'pending'};

export const PlanTasksPanel: React.FC<{ planId: number; onError: (msg: string) => void }> = ({planId, onError}) => {
    const [tasks, setTasks] = useState<PlanTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [newTask, setNewTask] = useState<PlanTaskIn | null>(null);
    const [editId, setEditId] = useState<number | null>(null);
    const [edit, setEdit] = useState<Partial<PlanTask>>({});

    // Import
    const [importing, setImporting] = useState(false);
    const [preview, setPreview] = useState<ImportResult | null>(null);
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [importMsg, setImportMsg] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            setTasks(await api.listPlanTasks(planId));
        } catch (err: any) {
            onError(err?.message || 'Vorgänge konnten nicht geladen werden');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [planId]);

    const createTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask) return;
        try {
            await api.createPlanTask(planId, {
                ...newTask,
                task_code: newTask.task_code?.trim() || null,
                trade: newTask.trade?.trim() || null,
                title: newTask.title.trim()
            });
            setNewTask(null);
            load();
        } catch (err: any) {
            onError(err?.message || 'Vorgang konnte nicht angelegt werden');
        }
    };

    const saveEdit = async (task: PlanTask) => {
        try {
            await api.updatePlanTask(planId, task.id, {
                task_code: edit.task_code ?? null,
                title: edit.title ?? task.title,
                trade: edit.trade ?? null,
                planned_start: edit.planned_start || null,
                planned_end: edit.planned_end || null,
                actual_start: edit.actual_start || null,
                actual_end: edit.actual_end || null,
                status: edit.status ?? task.status
            });
            setEditId(null);
            load();
        } catch (err: any) {
            onError(err?.message || 'Vorgang konnte nicht gespeichert werden');
        }
    };

    const removeTask = async (task: PlanTask) => {
        if (!window.confirm(`Vorgang "${task.title}" löschen?`)) return;
        try {
            await api.deletePlanTask(planId, task.id);
            load();
        } catch (err: any) {
            if (err?.status === 409) {
                if (window.confirm(`${err.message}\n\nTrotzdem löschen? Die gemeldeten Fortschritte (Soll/Ist-Historie) gehen dabei verloren.`)) {
                    try {
                        await api.deletePlanTask(planId, task.id, true);
                        load();
                    } catch (err2: any) {
                        onError(err2?.message || 'Löschen fehlgeschlagen');
                    }
                }
            } else {
                onError(err?.message || 'Löschen fehlgeschlagen');
            }
        }
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setImporting(true);
        setImportMsg(null);
        try {
            // Immer erst Vorschau – auch bei CSV (dry_run) –, damit der Nutzer prüfen kann (human in the loop)
            const res = await api.importPlanFile(planId, file, true);
            setPreview(res);
            setSelectedRows(new Set(res.tasks.map((_, i) => i)));
        } catch (err: any) {
            onError(err?.message || 'Datei konnte nicht gelesen werden');
        } finally {
            setImporting(false);
        }
    };

    const applyPreview = async () => {
        if (!preview) return;
        const chosen: ImportedTask[] = preview.tasks.filter((_, i) => selectedRows.has(i));
        if (chosen.length === 0) return;
        setImporting(true);
        try {
            const res = await api.bulkPlanTasks(planId, chosen);
            setImportMsg(`${res.created} neu angelegt, ${res.updated} aktualisiert.`);
            setPreview(null);
            load();
        } catch (err: any) {
            onError(err?.message || 'Übernahme fehlgeschlagen');
        } finally {
            setImporting(false);
        }
    };

    const updatePreviewRow = (idx: number, changes: Partial<ImportedTask>) => {
        if (!preview) return;
        setPreview({...preview, tasks: preview.tasks.map((t, i) => (i === idx ? {...t, ...changes} : t))});
    };

    return (
        <div className="plan-tasks">
            <div className="plan-tasks-toolbar">
                <strong>Vorgänge ({tasks.length})</strong>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title="Neu laden"><RefreshCw size={13}/></button>
                    <label className="btn btn-secondary" style={{cursor: 'pointer'}} title="Terminplan als CSV oder PDF einlesen (Vorschau)">
                        <UploadCloud size={14}/> <span>{importing ? 'Lese…' : 'Import CSV/PDF'}</span>
                        <input type="file" accept=".csv,.txt,.pdf,text/csv,application/pdf" style={{display: 'none'}}
                               onChange={(e) => {
                                   handleFile(e.target.files?.[0]);
                                   e.target.value = '';
                               }}/>
                    </label>
                    <button className="btn btn-primary" onClick={() => setNewTask({...EMPTY_TASK})}>
                        <Plus size={14}/> <span>Vorgang</span>
                    </button>
                </div>
            </div>

            <div className="plan-tasks-hint">
                CSV-Spalten (Deutsch oder Englisch): <code>Nr</code>, <code>Vorgang</code>, <code>Gewerk</code>, <code>Anfang</code>, <code>Ende</code> –
                Datum als TT.MM.JJJJ. Excel bitte als CSV speichern. PDF wird ausgelesen und immer erst als Vorschau gezeigt.
            </div>

            {importMsg && <div className="plan-tasks-ok">✓ {importMsg}</div>}

            {/* Import-Vorschau */}
            {preview && (
                <div className="plan-preview">
                    <div className="plan-tasks-toolbar">
                        <strong>
                            <FileText size={14}/> Vorschau: {preview.tasks.length} Vorgänge
                            ({preview.mode === 'csv' ? 'CSV' : 'PDF'}) – noch nichts gespeichert
                        </strong>
                        <div style={{display: 'flex', gap: '6px'}}>
                            <button className="btn btn-secondary" onClick={() => setPreview(null)}>Verwerfen</button>
                            <button className="btn btn-primary" onClick={applyPreview} disabled={importing || selectedRows.size === 0}>
                                {selectedRows.size} übernehmen
                            </button>
                        </div>
                    </div>
                    {preview.errors.length > 0 && (
                        <div className="plan-tasks-err">
                            {preview.errors.map((er) => <div key={er.row}>Zeile {er.row}: {er.error}</div>)}
                        </div>
                    )}
                    {preview.warnings.length > 0 && (
                        <div className="plan-tasks-warn">{preview.warnings.map((w, i) => <div key={i}>Hinweis: {w}</div>)}</div>
                    )}
                    <div className="plan-table-wrap">
                        <table className="plan-table">
                            <thead>
                            <tr>
                                <th>
                                    <input type="checkbox" checked={selectedRows.size === preview.tasks.length}
                                           onChange={(e) => setSelectedRows(e.target.checked ? new Set(preview.tasks.map((_, i) => i)) : new Set())}/>
                                </th>
                                <th>Nr.</th><th>Vorgang</th><th>Gewerk</th><th>Anfang</th><th>Ende</th><th>Fundstelle</th>
                            </tr>
                            </thead>
                            <tbody>
                            {preview.tasks.map((t, i) => (
                                <tr key={i} className={selectedRows.has(i) ? '' : 'off'}>
                                    <td>
                                        <input type="checkbox" checked={selectedRows.has(i)} onChange={(e) => {
                                            const next = new Set(selectedRows);
                                            if (e.target.checked) next.add(i);
                                            else next.delete(i);
                                            setSelectedRows(next);
                                        }}/>
                                    </td>
                                    <td><input className="plan-cell" value={t.code ?? ''} onChange={(e) => updatePreviewRow(i, {code: e.target.value || null})}/></td>
                                    <td><input className="plan-cell wide" value={t.title} onChange={(e) => updatePreviewRow(i, {title: e.target.value})}/></td>
                                    <td><input className="plan-cell" value={t.trade ?? ''} onChange={(e) => updatePreviewRow(i, {trade: e.target.value || null})}/></td>
                                    <td><input className="plan-cell" type="date" value={t.start} onChange={(e) => updatePreviewRow(i, {start: e.target.value})}/></td>
                                    <td><input className="plan-cell" type="date" value={t.end} onChange={(e) => updatePreviewRow(i, {end: e.target.value})}/></td>
                                    <td className="plan-src" title={t.source ?? ''}>{t.source ?? ''}</td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Neuer Vorgang */}
            {newTask && (
                <form className="plan-new" onSubmit={createTask}>
                    <input className="form-input" placeholder="Nr." value={newTask.task_code ?? ''}
                           onChange={(e) => setNewTask({...newTask, task_code: e.target.value})}/>
                    <input className="form-input" placeholder="Vorgang *" required value={newTask.title}
                           onChange={(e) => setNewTask({...newTask, title: e.target.value})}/>
                    <input className="form-input" placeholder="Gewerk" value={newTask.trade ?? ''}
                           onChange={(e) => setNewTask({...newTask, trade: e.target.value})}/>
                    <input className="form-input" type="date" required title="Soll-Beginn" value={newTask.planned_start}
                           onChange={(e) => setNewTask({...newTask, planned_start: e.target.value})}/>
                    <input className="form-input" type="date" required title="Soll-Ende" value={newTask.planned_end}
                           onChange={(e) => setNewTask({...newTask, planned_end: e.target.value})}/>
                    <button type="submit" className="btn btn-primary"><Check size={14}/></button>
                    <button type="button" className="btn btn-secondary" onClick={() => setNewTask(null)}><X size={14}/></button>
                </form>
            )}

            {/* Vorgänge */}
            {tasks.length === 0 && !loading ? (
                <div className="masterdata-empty">Noch keine Vorgänge – anlegen oder Terminplan importieren.</div>
            ) : (
                <div className="plan-table-wrap">
                    <table className="plan-table">
                        <thead>
                        <tr><th>Nr.</th><th>Vorgang</th><th>Gewerk</th><th>Soll</th><th>Ist</th><th>Status</th><th/></tr>
                        </thead>
                        <tbody>
                        {tasks.map((t) =>
                            editId === t.id ? (
                                <tr key={t.id} className="editing">
                                    <td><input className="plan-cell" value={edit.task_code ?? ''} onChange={(e) => setEdit({...edit, task_code: e.target.value})}/></td>
                                    <td><input className="plan-cell wide" value={edit.title ?? ''} onChange={(e) => setEdit({...edit, title: e.target.value})}/></td>
                                    <td><input className="plan-cell" value={edit.trade ?? ''} onChange={(e) => setEdit({...edit, trade: e.target.value})}/></td>
                                    <td>
                                        <input className="plan-cell" type="date" value={edit.planned_start ?? ''} onChange={(e) => setEdit({...edit, planned_start: e.target.value})}/>
                                        <input className="plan-cell" type="date" value={edit.planned_end ?? ''} onChange={(e) => setEdit({...edit, planned_end: e.target.value})}/>
                                    </td>
                                    <td>
                                        <input className="plan-cell" type="date" value={edit.actual_start ?? ''} onChange={(e) => setEdit({...edit, actual_start: e.target.value})}/>
                                        <input className="plan-cell" type="date" value={edit.actual_end ?? ''} onChange={(e) => setEdit({...edit, actual_end: e.target.value})}/>
                                    </td>
                                    <td>
                                        <select className="plan-cell" value={edit.status ?? 'pending'} onChange={(e) => setEdit({...edit, status: e.target.value})}>
                                            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                        </select>
                                    </td>
                                    <td className="plan-actions">
                                        <button className="btn btn-primary" onClick={() => saveEdit(t)} title="Speichern"><Check size={13}/></button>
                                        <button className="btn btn-secondary" onClick={() => setEditId(null)} title="Abbrechen"><X size={13}/></button>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={t.id}>
                                    <td>{t.task_code || '–'}</td>
                                    <td><strong>{t.title}</strong></td>
                                    <td>{t.trade || '–'}</td>
                                    <td>{fmtDate(t.planned_start)} – {fmtDate(t.planned_end)}</td>
                                    <td>{t.actual_start || t.actual_end ? `${fmtDate(t.actual_start)} – ${fmtDate(t.actual_end)}` : '–'}</td>
                                    <td><span className={`plan-status ${t.status}`}>{STATUS_LABELS[t.status] ?? t.status}</span></td>
                                    <td className="plan-actions">
                                        <button className="btn btn-secondary" title="Bearbeiten" onClick={() => {
                                            setEditId(t.id);
                                            setEdit({...t});
                                        }}><Pencil size={13}/></button>
                                        <button className="btn btn-danger" title="Löschen" onClick={() => removeTask(t)}><Trash2 size={13}/></button>
                                    </td>
                                </tr>
                            )
                        )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default PlanTasksPanel;
