import React, {useEffect, useState} from 'react';
import {Check, FileText, Pencil, Plus, RefreshCw, Trash2, UploadCloud, X} from 'lucide-react';
import {api, ImportedTask, ImportResult, PlanTask, PlanTaskIn} from '../services/api';
import {formatDe} from '../utils/dates';
import {useLanguage} from '../context/LanguageContext';

/**
 * Vorgänge eines Bauzeitenplans (Backend: /api/plans/{id}/tasks, /import, /tasks/bulk).
 * - Liste mit Inline-Bearbeitung, Anlegen, Löschen (409 bei vorhandenem Fortschritt → Rückfrage, force)
 * - Import aus CSV oder PDF: erst Vorschau (nichts gespeichert), dann ausgewählte Zeilen übernehmen
 */

// Status-Werte des Backends; Anzeigetext über die Übersetzung task_status_<wert>.
const STATUSES = ['pending', 'in_progress', 'delayed', 'completed'];

const fmtDate = (v?: string | null) => formatDe(v);

const EMPTY_TASK: PlanTaskIn = {task_code: '', title: '', trade: '', planned_start: '', planned_end: '', status: 'pending'};

export const PlanTasksPanel: React.FC<{ planId: number; onError: (msg: string) => void }> = ({planId, onError}) => {
    // tx statt t, weil `t` hier unten schon als Schleifenvariable für Vorgänge benutzt wird.
    const {t: tx, tf} = useLanguage();
    const statusLabel = (s: string) => (STATUSES.includes(s) ? tx(`task_status_${s}`) : s);
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
            onError(err?.message || tx('ptp_load_failed'));
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
            onError(err?.message || tx('ptp_create_failed'));
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
            onError(err?.message || tx('ptp_save_failed'));
        }
    };

    const removeTask = async (task: PlanTask) => {
        if (!window.confirm(tf('ptp_confirm_delete', {title: task.title}))) return;
        try {
            await api.deletePlanTask(planId, task.id);
            load();
        } catch (err: any) {
            if (err?.status === 409) {
                if (window.confirm(`${err.message}\n\n${tx('ptp_confirm_force')}`)) {
                    try {
                        await api.deletePlanTask(planId, task.id, true);
                        load();
                    } catch (err2: any) {
                        onError(err2?.message || tx('ptp_delete_failed'));
                    }
                }
            } else {
                onError(err?.message || tx('ptp_delete_failed'));
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
            onError(err?.message || tx('ptp_file_failed'));
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
            setImportMsg(tf('ptp_import_done', {created: res.created, updated: res.updated}));
            setPreview(null);
            load();
        } catch (err: any) {
            onError(err?.message || tx('ptp_apply_failed'));
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
                <strong>{tx('ptp_tasks')} ({tasks.length})</strong>
                <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                    <button className="btn btn-secondary" onClick={load} disabled={loading} title={tx('ptp_reload')}>
                        <RefreshCw size={13}/></button>
                    <label className="btn btn-secondary" style={{cursor: 'pointer'}} title={tx('ptp_import_title')}>
                        <UploadCloud size={14}/> <span>{importing ? tx('ptp_reading') : tx('ptp_import')}</span>
                        <input type="file" accept=".csv,.txt,.pdf,text/csv,application/pdf" style={{display: 'none'}}
                               onChange={(e) => {
                                   handleFile(e.target.files?.[0]);
                                   e.target.value = '';
                               }}/>
                    </label>
                    <button className="btn btn-primary" onClick={() => setNewTask({...EMPTY_TASK})}>
                        <Plus size={14}/> <span>{tx('ptp_task')}</span>
                    </button>
                </div>
            </div>

            <div className="plan-tasks-hint">
                {tx('ptp_csv_cols')}
                <code>Nr</code>, <code>Vorgang</code>, <code>Gewerk</code>, <code>Anfang</code>, <code>Ende</code> –
                {' '}{tx('ptp_csv_hint')}
            </div>

            {importMsg && <div className="plan-tasks-ok">✓ {importMsg}</div>}

            {/* Import-Vorschau */}
            {preview && (
                <div className="plan-preview">
                    <div className="plan-tasks-toolbar">
                        <strong>
                            <FileText size={14}/> {tf('ptp_preview', {
                            n: preview.tasks.length,
                            mode: preview.mode === 'csv' ? 'CSV' : 'PDF'
                        })}
                        </strong>
                        <div style={{display: 'flex', gap: '6px'}}>
                            <button className="btn btn-secondary"
                                    onClick={() => setPreview(null)}>{tx('ptp_discard')}</button>
                            <button className="btn btn-primary" onClick={applyPreview} disabled={importing || selectedRows.size === 0}>
                                {tf('ptp_apply_n', {n: selectedRows.size})}
                            </button>
                        </div>
                    </div>
                    {preview.errors.length > 0 && (
                        <div className="plan-tasks-err">
                            {preview.errors.map((er) => <div key={er.row}>{tx('ptp_row')} {er.row}: {er.error}</div>)}
                        </div>
                    )}
                    {preview.warnings.length > 0 && (
                        <div className="plan-tasks-warn">{preview.warnings.map((w, i) => <div
                            key={i}>{tx('ptp_note')} {w}</div>)}</div>
                    )}
                    <div className="plan-table-wrap">
                        <table className="plan-table">
                            <thead>
                            <tr>
                                <th>
                                    <input type="checkbox" checked={selectedRows.size === preview.tasks.length}
                                           onChange={(e) => setSelectedRows(e.target.checked ? new Set(preview.tasks.map((_, i) => i)) : new Set())}/>
                                </th>
                                <th>{tx('col_no')}</th>
                                <th>{tx('ptp_task')}</th>
                                <th>{tx('col_trade')}</th>
                                <th>{tx('col_start')}</th>
                                <th>{tx('col_end')}</th>
                                <th>{tx('col_source')}</th>
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
                    <input className="form-input" placeholder={tx('col_no')} value={newTask.task_code ?? ''}
                           onChange={(e) => setNewTask({...newTask, task_code: e.target.value})}/>
                    <input className="form-input" placeholder={tx('ptp_task_req')} required value={newTask.title}
                           onChange={(e) => setNewTask({...newTask, title: e.target.value})}/>
                    <input className="form-input" placeholder={tx('col_trade')} value={newTask.trade ?? ''}
                           onChange={(e) => setNewTask({...newTask, trade: e.target.value})}/>
                    <input className="form-input" type="date" required title={tx('ptp_planned_start')}
                           value={newTask.planned_start}
                           onChange={(e) => setNewTask({...newTask, planned_start: e.target.value})}/>
                    <input className="form-input" type="date" required title={tx('ptp_planned_end')}
                           value={newTask.planned_end}
                           onChange={(e) => setNewTask({...newTask, planned_end: e.target.value})}/>
                    <button type="submit" className="btn btn-primary"><Check size={14}/></button>
                    <button type="button" className="btn btn-secondary" onClick={() => setNewTask(null)}><X size={14}/></button>
                </form>
            )}

            {/* Vorgänge */}
            {tasks.length === 0 && !loading ? (
                <div className="masterdata-empty">{tx('ptp_empty')}</div>
            ) : (
                <div className="plan-table-wrap">
                    <table className="plan-table">
                        <thead>
                        <tr>
                            <th>{tx('col_no')}</th>
                            <th>{tx('ptp_task')}</th>
                            <th>{tx('col_trade')}</th>
                            <th>{tx('col_planned')}</th>
                            <th>{tx('col_actual')}</th>
                            <th>{tx('col_status')}</th>
                            <th/>
                        </tr>
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
                                            {STATUSES.map((k) => <option key={k} value={k}>{statusLabel(k)}</option>)}
                                        </select>
                                    </td>
                                    <td className="plan-actions">
                                        <button className="btn btn-primary" onClick={() => saveEdit(t)}
                                                title={tx('btn_save')}><Check size={13}/></button>
                                        <button className="btn btn-secondary" onClick={() => setEditId(null)}
                                                title={tx('btn_cancel')}><X size={13}/></button>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={t.id}>
                                    <td>{t.task_code || '–'}</td>
                                    <td><strong>{t.title}</strong></td>
                                    <td>{t.trade || '–'}</td>
                                    <td>{fmtDate(t.planned_start)} – {fmtDate(t.planned_end)}</td>
                                    <td>{t.actual_start || t.actual_end ? `${fmtDate(t.actual_start)} – ${fmtDate(t.actual_end)}` : '–'}</td>
                                    <td><span className={`plan-status ${t.status}`}>{statusLabel(t.status)}</span></td>
                                    <td className="plan-actions">
                                        <button className="btn btn-secondary" title={tx('btn_edit')} onClick={() => {
                                            setEditId(t.id);
                                            setEdit({...t});
                                        }}><Pencil size={13}/></button>
                                        <button className="btn btn-danger" title={tx('btn_delete')}
                                                onClick={() => removeTask(t)}><Trash2 size={13}/></button>
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
