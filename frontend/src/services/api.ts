/**
 * AI Site Manager Assistant - Unified API Client
 * Connects frontend to FastAPI backend endpoints.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Notice Types
export type NoticeType = 'delay' | 'cost' | 'defect' | 'concern';
export type FieldSource = 'diktat' | 'ki' | 'regel' | 'nutzer';

export interface SourcedField {
  value: string;
  src: FieldSource;
}

export interface CaptureRequest {
  text: string;
  lang?: string;
  ref_date?: string;
  ref_time?: string;
  force_type?: NoticeType;
  project_id?: number;
}

export interface NoticeDraft {
  type: NoticeType;
  fields: Record<string, SourcedField>;
  questions: string[];
  mode: 'ai' | 'offline';
  site_note_id?: number | null;
  notice_id?: number | null;
}

export interface TranscribeResponse {
  text: string;
  lang: string;
}

export interface ReviewResponse {
  hints: string[];
  mode: 'ai' | 'offline';
}

export interface NoticeOut {
  id: number;
  project_id: number;
  type: NoticeType;
  title: string | null;
  recipient: string | null;
  subject: string | null;
  body: string;
  legal_disclaimer: string;
  source_references: string | null;
  status: 'Entwurf' | 'Freigegeben' | 'Exportiert' | string;
  created_at: string;
  updated_at: string;
  fields: Record<string, SourcedField>;
  missing_fields: string[];
  questions: string[];
  approved_by: string | null;
  approved_at: string | null;
}

export interface NoticePatch {
  fields?: Record<string, string>;
  recipient?: string;
  subject?: string;
  body?: string;
}

export interface SiteNote {
  id: number;
  project_id: number;
  content: string;
  category?: string;
  audio_file_path?: string | null;
  author?: string;
  status: string;
  created_at: string;
}

export interface SiteNoteCreate {
  project_id: number;
  content: string;
  category?: string;
  audio_file_path?: string | null;
  author?: string;
  status?: string;
}

export interface ConstructionPlan {
  id: number;
  project_id: number;
  title: string;
  version?: string;
  file_path?: string | null;
  file_name?: string | null;
  raw_data?: string | null;
  uploaded_at: string;
}

export interface ConstructionPlanCreate {
  project_id: number;
  title: string;
  version?: string;
  file_path?: string | null;
  file_name?: string | null;
  raw_data?: string | null;
}

/** Projekt wie vom Backend geliefert (/projects), inkl. Stammdaten und Nachunternehmer-Liste */
export interface BackendProject {
  id: number;
  name: string;
  number?: string | null;
  client?: string | null;
  location?: string | null;
  phase?: string | null;
  status: string;
  description?: string | null;
  construction_volume_eur?: number | null;
  budget_eur?: number | null;
  gross_floor_area_m2?: number | null;
  gross_volume_m3?: number | null;
  construction_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  contract_type?: string | null;
  vob_b_agreed?: boolean | null;
  vob_notes?: string | null;
  contractors?: { name: string; trade: string; required_workers: number | null; phone: string }[];
  created_at?: string;
  updated_at?: string;
}

/** Schreib-Payload für POST/PATCH /projects (leere Strings erlaubt, Backend macht daraus null) */
export type ProjectPayload = Partial<Record<keyof Omit<BackendProject, 'id' | 'created_at' | 'updated_at'>, unknown>>;

// ---- Analysis Types ----
export interface WorkPackage {
  id: string;
  name: string;
  trade: string;
  subcontractor: string;
  planDate: string;
  actualDate: string;
  planPercent: number;
  actualPercent: number;
  status: 'delayed' | 'warning' | 'ontrack';
  delayDays: number;
}

export interface DeviationItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  sourceReport: string;
  reportDate: string;
  cause: string;
  impact: string;
  vobReference: string;
  suggestedAction: string;
  draftType: 'delay' | 'cost' | 'defect';
}

export interface ManpowerAvg {
  plan: number;
  actual: number;
}

export interface PlanAnalysis {
  overallDelta: number;
  spi: number;
  evaluatedReports: number;
  criticalAlertsCount: number;
  lostHours: number;
  manpowerAvg: ManpowerAvg;
  workPackages: WorkPackage[];
  deviations: DeviationItem[];
  periodFrom: string | null;
  periodTo: string;
  refDate: string;
}

// ---- Dashboard Types (/api/dashboard) ----
export interface DashboardKpis {
  delayDays: number;
  spi: number;
  criticalAlerts: number;
  openDrafts: number;
  workersToday: number | null;
}

export interface DashboardAlert {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  draftType: 'delay' | 'cost' | 'defect';
  source: string;
  /** Bei Briefvorschlägen (Sollstärke-Check): Text für POST /api/capture (+ force_type = draftType) */
  prefillText?: string | null;
}

// ---- Sollstärken-Check (Vertrag vs. Anwesenheit) ----
export interface WorkforceSuggestion {
  draftType: 'delay' | 'cost' | 'defect';
  title: string;
  prefillText: string;
}

export interface WorkforceGap {
  company: string | null;
  trade: string | null;
  contractId: number;
  contractTitle: string;
  planned: number;
  actual: number;
  shortfallPercent: number;
  consecutiveDays: number;
  source: string;
  contractSource: string;
  vobHints: string[];
  suggestion?: WorkforceSuggestion | null;
}

export interface DashboardData {
  kpis: DashboardKpis;
  alerts: DashboardAlert[];
  progress: WorkPackage[];
}

// ---- Day Analysis (/api/reports/{date}/analysis) ----
export interface DayItem {
  text: string;
  source: string;
}

export interface DayAnalysis {
  date: string;
  title: string;
  wentWell: DayItem[];
  wentBadly: DayItem[];
  deviations: DeviationItem[];
  stats: { workers: number | null; plannedWorkers: number | null; hours: number | null; weather: string | null };
  mode: 'ai' | 'offline';
  /** Unterschreitungen der vertraglichen Sollstärke an diesem Tag */
  workforce?: WorkforceGap[];
}

// ---- Vertrag parsen (POST /api/contracts/{id}/parse) ----
export interface ParsedField {
  value: number | string;
  /** wörtliches Zitat aus dem Vertragstext */
  src: string;
}

export interface ContractParseResponse {
  contract_id: number;
  mode: 'ai' | 'offline';
  fields: Record<string, ParsedField>;
  /** Vorschlag für PATCH /contracts/{id} – wird nicht automatisch gespeichert */
  suggested_patch: Record<string, unknown>;
  current_planned_workforce: number | null;
}

// ==========================================
// Geplante Endpunkte (Ideen #1–#7) – Frontend steht, Backend folgt.
// Liefert das Backend 404, zeigt die Oberfläche "Backend folgt".
// ==========================================

/** Idee #1: Foto → Tagebucheintrag (Contract aus dem Hackathon-Plan) */
export interface PhotoDescribeResponse {
  caption: string;
  diary_text: string;
  issues: string[];
}

/** Idee #2: Wetter automatisch */
export interface WeatherResponse {
  date: string;
  temperature_c: number | null;
  condition: string;
  wind_kmh?: number | null;
  precipitation_mm?: number | null;
  source: string;
}

/** Idee #4: Versand & Zugangsnachweis eines Briefs */
export type DispatchMethod = 'email' | 'einschreiben' | 'bote' | 'fax' | 'persoenlich';

export interface NoticeDispatch {
  method: DispatchMethod;
  sent_at: string;            // ISO-Datum/Zeit
  recipient_address?: string | null;
  tracking_number?: string | null;
  received_at?: string | null; // Zugang bestätigt am
  note?: string | null;
}

/** Idee #5: „Frag dein Projekt“ */
export interface AssistantAnswer {
  answer: string;
  sources: string[];
  mode: 'ai' | 'offline';
}

// ---- Summary Types (/api/summarize) ----
export type SummarySourceType = 'diary' | 'minutes' | 'emails';

export interface SummarizeRequest {
  text?: string;
  source_type?: SummarySourceType;
  project_id?: number;
  period?: 'day' | 'week' | 'month';
  ref_date?: string;
}

export interface SummaryActionItem {
  id: string;
  task: string;
  responsible: string;
  deadline: string;
  priority: 'Hoch' | 'Mittel' | 'Normal';
  done: boolean;
  source: string;
}

export interface SummaryVobRisk {
  title: string;
  description: string;
  recommendation: string;
  linkType?: 'delay' | 'cost' | 'defect' | null;
  source?: string;
}

export interface SummaryResponse {
  title: string;
  executiveSummary: string[];
  keyDecisions: string[];
  actionItems: SummaryActionItem[];
  vobRisks: SummaryVobRisk[];
  traceabilityNotes: string;
  keyDecisionSources?: string[];
  sources?: string[];
  periodFrom?: string | null;
  periodTo?: string | null;
  mode: 'ai' | 'offline';
}

// ---- Navigation state for /drafts ("Entwurf erstellen" from anywhere) ----
export interface DraftNavState {
  /** Brieftyp vorauswählen */
  type?: NoticeType;
  /** Stichworte/Sachverhalt vorbefüllen (Nutzer klickt selbst auf "Generieren") */
  keywords?: string;
  /** Vorhandenen Entwurf öffnen */
  noticeId?: number;
}

// ---- Companies (/companies) ----
export type CompanyType = 'own' | 'client' | 'subcontractor';

export interface Company {
  id: number;
  name: string;
  company_type: CompanyType;
  trade?: string | null;
  address?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  vob_rules?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type CompanyCreate = Omit<Company, 'id' | 'created_at' | 'updated_at'>;

// ---- Contracts (/contracts) ----
export interface Contract {
  id: number;
  project_id: number;
  title: string;
  contractor_name?: string | null;
  trade?: string | null;
  planned_workforce?: number | null;
  vob_notes?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  extracted_text?: string | null;
  uploaded_at: string;
}

export interface ContractUpload {
  project_id: number;
  title: string;
  file: File;
  contractor_name?: string;
  trade?: string;
  planned_workforce?: number;
  vob_notes?: string;
}

export type ContractUpdate = Partial<Pick<Contract, 'title' | 'contractor_name' | 'trade' | 'planned_workforce' | 'vob_notes'>>;

export interface ContractText {
  id: number;
  project_id: number;
  title: string;
  contractor_name: string | null;
  trade: string | null;
  planned_workforce: number | null;
  vob_notes: string | null;
  extracted_text: string;
}

// ---- Schedule (/api/schedule) – Zukunft: Aufgaben je Werktag + Termine ----
export type AppointmentCategory = 'deadline' | 'milestone' | 'inspection' | 'meeting' | 'delivery';

export interface DayTask {
  taskId: number;
  code: string;
  title: string;
  trade: string | null;
  company: string | null;
  plannedWorkforce: number | null;
  planPercent: number;
  actualPercent: number;
  status: 'delayed' | 'warning' | 'ontrack';
  isStart: boolean;
  isEnd: boolean;
  isOverdue: boolean;
  source: string;
}

export interface ScheduleDay {
  date: string; // YYYY-MM-DD
  tasks: DayTask[];
}

export interface ScheduleAppointment {
  id: string;
  projectId: number;
  title: string;
  date: string;
  time?: string | null;
  category: AppointmentCategory;
  trade?: string | null;
  description?: string | null;
  vobReference?: string | null;
  isUrgent?: boolean;
}

export interface Schedule {
  projectId: number;
  dateFrom: string;
  dateTo: string;
  refDate: string;
  days: ScheduleDay[];
  appointments: ScheduleAppointment[];
}

// ---- Timeline (/api/timeline) – Vergangenheit: Berichte, Notizen, Briefe, Fortschritt, Warnungen ----
export type TimelineType = 'report' | 'note' | 'notice' | 'progress' | 'alert';

export interface TimelineItem {
  id: string;
  type: TimelineType;
  date: string;
  time?: string | null;
  title: string;
  summary: string;
  source: string;
  refId?: number | null;
  severity?: 'critical' | 'warning' | 'info' | null;
}

export interface Timeline {
  projectId: number;
  dateFrom: string;
  dateTo: string;
  items: TimelineItem[];
}

// ---- Vorgänge eines Bauzeitenplans (/api/plans/{id}/tasks, /import, /tasks/bulk) ----
export type PlanTaskStatus = 'pending' | 'in_progress' | 'delayed' | 'completed';

export interface PlanTask {
  id: number;
  plan_id: number;
  task_code?: string | null;
  title: string;
  trade?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  status: PlanTaskStatus | string;
  notes?: string | null;
}

export interface PlanTaskIn {
  task_code?: string | null;
  title: string;
  trade?: string | null;
  planned_start: string;
  planned_end: string;
  status?: string;
}

export type PlanTaskPatch = Partial<Omit<PlanTask, 'id' | 'plan_id' | 'notes'>>;

/** Gelesener Vorgang aus CSV/PDF (Vorschau). `source` = Fundstelle (Zeile / PDF-Zitat) */
export interface ImportedTask {
  code?: string | null;
  title: string;
  trade?: string | null;
  start: string;
  end: string;
  source?: string | null;
}

export interface ImportResult {
  planId: number;
  mode: 'csv' | 'ai' | 'offline';
  dryRun: boolean;
  tasks: ImportedTask[];
  errors: { row: number; error: string }[];
  warnings: string[];
  created: number;
  updated: number;
}

// ---- Demo-Reset (/api/demo/reset) ----
export interface DemoResetResult {
  ok: boolean;
  project_id?: number;
  reports?: number;
  contracts?: number;
  tasks?: number;
  notes?: number;
  last_report_date?: string;
  shifted_workdays?: number;
  [key: string]: unknown;
}

// ---- Health (/health) ----
export interface HealthStatus {
  status: string;
  pdf_export: boolean;
}

// ---- Daily Report Form Types (/api/reports/{date}) ----
export interface ReportProgressIn {
  task_id: number;
  percent: number;
  note?: string | null;
}

export interface ReportProgressOut {
  task_id: number;
  task_code: string | null;
  title: string;
  percent: number;
  source: 'diktat' | 'ki' | 'regel' | 'nutzer';
  note: string | null;
}

/** Anwesenheit einer Firma / eines Gewerks an einem Tag */
export interface AttendanceItem {
  company?: string | null;
  trade?: string | null;
  workers: number;
  hours?: number | null;
}

export interface DailyReportIn {
  report_number?: number | null;
  weather?: string | null;
  temperature_c?: number | null;
  site_manager?: string | null;
  /** null/undefined = unverändert lassen, Liste = komplett ersetzen */
  attendance?: AttendanceItem[] | null;
  workforce_count?: number | null;
  trades?: string[];
  work_completed?: string | null;
  deviations_incidents?: string | null;
  deliveries?: string | null;
  summary?: string | null;
  status?: 'draft' | 'reviewed' | 'finalized';
  progress?: ReportProgressIn[] | null;
}

export interface DailyReportOut {
  id: number | null;
  project_id: number;
  report_date: string;
  report_number: number | null;
  weather: string | null;
  temperature_c?: number | null;
  site_manager?: string | null;
  attendance?: AttendanceItem[];
  workforce_count: number | null;
  trades: string[];
  work_completed: string | null;
  deviations_incidents: string | null;
  deliveries: string | null;
  summary: string | null;
  status: string;
  progress: ReportProgressOut[];
}

export interface FillRequest {
  text: string;
  lang?: string;
  project_id?: number | null;
}

export interface FillResponse extends DailyReportOut {
  mode: 'ai' | 'offline';
  site_note_id?: number | null;
}

// ==========================================
// API Helpers
// ==========================================

/** Fehlermeldung des Backends lesbar machen: `detail` als Text, FastAPI-Validierungsliste oder Objekt */
async function errorDetail(res: Response): Promise<string> {
  try {
    const errJson = await res.json();
    const detail = errJson?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d: any) => {
          const field = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== 'body').join('.') : '';
          return field ? `${field}: ${d?.msg}` : String(d?.msg ?? JSON.stringify(d));
        })
        .join('; ');
    }
    // 409 bei der Freigabe: {missing_fields, questions} → Rückfragen als lesbaren Text zeigen
    if (Array.isArray(detail?.questions) && detail.questions.length > 0) {
      return `Pflichtangaben fehlen – ${detail.questions.join(' ')}`;
    }
    if (detail) return JSON.stringify(detail);
  } catch {
    // kein JSON
  }
  return `HTTP ${res.status}`;
}

async function expectOk(res: Response, errorPrefix: string): Promise<void> {
  if (!res.ok && res.status !== 404) {
    throw new Error(`${errorPrefix}: ${await errorDetail(res)}`);
  }
}

/** Startet im Browser den Download eines Blobs unter dem angegebenen Dateinamen. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function handleResponse<T>(res: Response, errorPrefix: string): Promise<T> {
  if (!res.ok) throw new Error(`${errorPrefix}: ${await errorDetail(res)}`);
  return res.json() as Promise<T>;
}

export const api = {
  // ---- AI Endpoints ----
  async captureText(req: CaptureRequest): Promise<NoticeDraft> {
    const res = await fetch(`${API_BASE_URL}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return handleResponse<NoticeDraft>(res, 'Fehler bei der KI-Erfassung');
  },

  async transcribeAudio(file: Blob, lang: string = 'de'): Promise<TranscribeResponse> {
    const formData = new FormData();
    // Feldname muss "audio" heißen (Backend: `audio: UploadFile`), sonst 422
    formData.append('audio', file, 'recording.webm');
    formData.append('lang', lang);

    const res = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      body: formData,
    });
    return handleResponse<TranscribeResponse>(res, 'Fehler bei der Audio-Transkription');
  },

  async reviewNotice(noticeId: number): Promise<ReviewResponse> {
    const res = await fetch(`${API_BASE_URL}/api/notices/${noticeId}/review`, {
      method: 'POST',
    });
    return handleResponse<ReviewResponse>(res, 'Fehler beim KI-Review');
  },

  // ---- Notices Endpoints ----
  async listNotices(projectId?: number): Promise<NoticeOut[]> {
    const url = projectId ? `${API_BASE_URL}/api/notices?project_id=${projectId}` : `${API_BASE_URL}/api/notices`;
    const res = await fetch(url);
    return handleResponse<NoticeOut[]>(res, 'Fehler beim Laden der Entwürfe');
  },

  async getNotice(noticeId: number): Promise<NoticeOut> {
    const res = await fetch(`${API_BASE_URL}/api/notices/${noticeId}`);
    return handleResponse<NoticeOut>(res, 'Fehler beim Laden des Schreibens');
  },

  async patchNotice(noticeId: number, patch: NoticePatch): Promise<NoticeOut> {
    const res = await fetch(`${API_BASE_URL}/api/notices/${noticeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return handleResponse<NoticeOut>(res, 'Fehler beim Aktualisieren des Schreibens');
  },

  async approveNotice(noticeId: number): Promise<NoticeOut> {
    const res = await fetch(`${API_BASE_URL}/api/notices/${noticeId}/approve`, {
      method: 'POST',
    });
    return handleResponse<NoticeOut>(res, 'Fehler bei der Freigabe');
  },

  getPdfUrl(noticeId: number): string {
    return `${API_BASE_URL}/api/notices/${noticeId}/pdf`;
  },

  getDocxUrl(noticeId: number): string {
    return `${API_BASE_URL}/api/notices/${noticeId}/docx`;
  },

  async downloadExport(noticeId: number, format: 'pdf' | 'docx'): Promise<Blob> {
    const url = format === 'pdf' ? this.getPdfUrl(noticeId) : this.getDocxUrl(noticeId);
    const res = await fetch(url);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.detail) msg = typeof errJson.detail === 'object' ? JSON.stringify(errJson.detail) : errJson.detail;
      } catch {
        // fallback
      }
      throw new Error(`Export (${format.toUpperCase()}) fehlgeschlagen: ${msg}`);
    }
    return res.blob();
  },

  // ---- Site Notes Endpoints ----
  async createSiteNote(note: SiteNoteCreate): Promise<SiteNote> {
    const res = await fetch(`${API_BASE_URL}/site-notes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    });
    return handleResponse<SiteNote>(res, 'Fehler beim Speichern der Notiz');
  },

  async deleteSiteNote(noteId: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/site-notes/${noteId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Fehler beim Löschen der Notiz: HTTP ${res.status}`);
    }
  },

  // ---- Plans Endpoints ----
  async listPlans(projectId?: number): Promise<ConstructionPlan[]> {
    const url = projectId ? `${API_BASE_URL}/plans?project_id=${projectId}` : `${API_BASE_URL}/plans`;
    const res = await fetch(url);
    return handleResponse<ConstructionPlan[]>(res, 'Fehler beim Laden der Baupläne');
  },

  async createPlan(plan: ConstructionPlanCreate): Promise<ConstructionPlan> {
    const res = await fetch(`${API_BASE_URL}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    });
    return handleResponse<ConstructionPlan>(res, 'Fehler beim Erstellen des Bauplans');
  },

  async updatePlan(planId: number, update: Partial<ConstructionPlanCreate>): Promise<ConstructionPlan> {
    const res = await fetch(`${API_BASE_URL}/plans/${planId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    return handleResponse<ConstructionPlan>(res, 'Fehler beim Aktualisieren des Bauplans');
  },

  async deletePlan(planId: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/plans/${planId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Fehler beim Löschen des Bauplans: HTTP ${res.status}`);
    }
  },

  // ---- Projects Endpoints ----
  async listProjects(): Promise<BackendProject[]> {
    const res = await fetch(`${API_BASE_URL}/projects`);
    return handleResponse<BackendProject[]>(res, 'Fehler beim Laden der Projekte');
  },

  async createProject(project: ProjectPayload): Promise<BackendProject> {
    const res = await fetch(`${API_BASE_URL}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    return handleResponse<BackendProject>(res, 'Projekt konnte nicht angelegt werden');
  },

  async deleteProject(projectId: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
      method: 'DELETE',
    });
    await expectOk(res, 'Projekt konnte nicht gelöscht werden');
  },

  // ---- Analysis Endpoints ----
  async getAnalysis(projectId?: number, period: 'week' | 'all' = 'week', refDate?: string): Promise<PlanAnalysis> {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', String(projectId));
    params.set('period', period);
    if (refDate) params.set('ref_date', refDate);
    const res = await fetch(`${API_BASE_URL}/api/analysis?${params.toString()}`);
    return handleResponse<PlanAnalysis>(res, 'Fehler beim Laden der Soll/Ist-Analyse');
  },

  async getDayAnalysis(reportDate: string, projectId?: number): Promise<DayAnalysis> {
    const params = projectId ? `?project_id=${projectId}` : '';
    const res = await fetch(`${API_BASE_URL}/api/reports/${reportDate}/analysis${params}`);
    return handleResponse<DayAnalysis>(res, 'Fehler beim Laden der Tagesanalyse');
  },

  async getDashboard(projectId?: number, refDate?: string): Promise<DashboardData> {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', String(projectId));
    if (refDate) params.set('ref_date', refDate);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE_URL}/api/dashboard${query}`);
    return handleResponse<DashboardData>(res, 'Fehler beim Laden des Dashboards');
  },

  // ---- Summary Endpoint ----
  /** Genau ein Modus: `text` (+ source_type) ODER `period` + `project_id`. */
  async summarize(req: SummarizeRequest): Promise<SummaryResponse> {
    const res = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return handleResponse<SummaryResponse>(res, 'Fehler bei der Zusammenfassung');
  },

  // ---- Daily Report Form Endpoints (/api/reports/{date}) ----
  async getReport(reportDate: string, projectId?: number): Promise<DailyReportOut> {
    const params = projectId ? `?project_id=${projectId}` : '';
    const res = await fetch(`${API_BASE_URL}/api/reports/${reportDate}${params}`);
    return handleResponse<DailyReportOut>(res, 'Fehler beim Laden des Tagesberichts');
  },

  async putReport(reportDate: string, data: DailyReportIn, projectId?: number): Promise<DailyReportOut> {
    const params = projectId ? `?project_id=${projectId}` : '';
    const res = await fetch(`${API_BASE_URL}/api/reports/${reportDate}${params}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<DailyReportOut>(res, 'Fehler beim Speichern des Tagesberichts');
  },

  async fillReport(reportDate: string, req: FillRequest): Promise<FillResponse> {
    const res = await fetch(`${API_BASE_URL}/api/reports/${reportDate}/fill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return handleResponse<FillResponse>(res, 'Fehler beim Ausfüllen des Tagesberichts per KI');
  },

  /** GET /api/reports/{date}/pdf|docx – 404 wenn der Tag nicht gespeichert ist, 503 wenn Pango fehlt (PDF). */
  async downloadReportExport(reportDate: string, format: 'pdf' | 'docx', projectId?: number): Promise<Blob> {
    const params = projectId ? `?project_id=${projectId}` : '';
    const res = await fetch(`${API_BASE_URL}/api/reports/${reportDate}/${format}${params}`);
    if (!res.ok) {
      throw new Error(`Export (${format.toUpperCase()}) fehlgeschlagen: ${await errorDetail(res)}`);
    }
    return res.blob();
  },

  // ---- Projects (update) ----
  async updateProject(projectId: number, changes: ProjectPayload): Promise<BackendProject> {
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    return handleResponse<BackendProject>(res, 'Projekt konnte nicht gespeichert werden');
  },

  // ---- Companies (/companies) ----
  async listCompanies(filter?: { company_type?: CompanyType; trade?: string }): Promise<Company[]> {
    const params = new URLSearchParams();
    if (filter?.company_type) params.set('company_type', filter.company_type);
    if (filter?.trade) params.set('trade', filter.trade);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE_URL}/companies${query}`);
    return handleResponse<Company[]>(res, 'Fehler beim Laden der Firmen');
  },

  async createCompany(company: CompanyCreate): Promise<Company> {
    const res = await fetch(`${API_BASE_URL}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(company),
    });
    return handleResponse<Company>(res, 'Fehler beim Anlegen der Firma');
  },

  async updateCompany(companyId: number, changes: Partial<CompanyCreate>): Promise<Company> {
    const res = await fetch(`${API_BASE_URL}/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    return handleResponse<Company>(res, 'Fehler beim Aktualisieren der Firma');
  },

  async deleteCompany(companyId: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/companies/${companyId}`, { method: 'DELETE' });
    await expectOk(res, 'Fehler beim Löschen der Firma');
  },

  // ---- Contracts (/contracts) ----
  async listContracts(projectId?: number): Promise<Contract[]> {
    const url = projectId ? `${API_BASE_URL}/contracts?project_id=${projectId}` : `${API_BASE_URL}/contracts`;
    const res = await fetch(url);
    return handleResponse<Contract[]>(res, 'Fehler beim Laden der Verträge');
  },

  /** POST /contracts (multipart): PDF hochladen, Backend extrahiert den Text automatisch. */
  async uploadContract(data: ContractUpload): Promise<Contract> {
    const form = new FormData();
    form.append('project_id', String(data.project_id));
    form.append('title', data.title);
    form.append('file', data.file, data.file.name);
    if (data.contractor_name) form.append('contractor_name', data.contractor_name);
    if (data.trade) form.append('trade', data.trade);
    if (data.planned_workforce != null) form.append('planned_workforce', String(data.planned_workforce));
    if (data.vob_notes) form.append('vob_notes', data.vob_notes);
    const res = await fetch(`${API_BASE_URL}/contracts`, { method: 'POST', body: form });
    return handleResponse<Contract>(res, 'Fehler beim Hochladen des Vertrags');
  },

  async updateContract(contractId: number, changes: ContractUpdate): Promise<Contract> {
    const res = await fetch(`${API_BASE_URL}/contracts/${contractId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    return handleResponse<Contract>(res, 'Fehler beim Aktualisieren des Vertrags');
  },

  async deleteContract(contractId: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/contracts/${contractId}`, { method: 'DELETE' });
    await expectOk(res, 'Fehler beim Löschen des Vertrags');
  },

  async getContractText(contractId: number): Promise<ContractText> {
    const res = await fetch(`${API_BASE_URL}/contracts/${contractId}/text`);
    return handleResponse<ContractText>(res, 'Fehler beim Laden des Vertragstexts');
  },

  async downloadContractFile(contractId: number): Promise<Blob> {
    const res = await fetch(`${API_BASE_URL}/contracts/${contractId}/file`);
    if (!res.ok) throw new Error(`Download fehlgeschlagen: ${await errorDetail(res)}`);
    return res.blob();
  },

  /** POST /api/contracts/{id}/parse – Sollstärke, Firma, Gewerk, Fristen mit Fundstelle (speichert nichts) */
  async parseContract(contractId: number): Promise<ContractParseResponse> {
    const res = await fetch(`${API_BASE_URL}/api/contracts/${contractId}/parse`, { method: 'POST' });
    return handleResponse<ContractParseResponse>(res, 'Vertrag konnte nicht ausgelesen werden');
  },

  /** GET /api/schedule – max. 31 Tage je Abruf (days 1–31) */
  async getSchedule(projectId: number, from: string, days: number, refDate?: string): Promise<Schedule> {
    const params = new URLSearchParams({ project_id: String(projectId), from, days: String(Math.min(31, Math.max(1, days))) });
    if (refDate) params.set('ref_date', refDate);
    const res = await fetch(`${API_BASE_URL}/api/schedule?${params.toString()}`);
    return handleResponse<Schedule>(res, 'Terminplan konnte nicht geladen werden');
  },

  /** GET /api/timeline – max. 92 Tage je Abruf, neueste zuerst */
  async getTimeline(projectId: number, from: string, to: string, types?: TimelineType[]): Promise<Timeline> {
    const params = new URLSearchParams({ project_id: String(projectId), from, to });
    if (types && types.length > 0) params.set('types', types.join(','));
    const res = await fetch(`${API_BASE_URL}/api/timeline?${params.toString()}`);
    return handleResponse<Timeline>(res, 'Timeline konnte nicht geladen werden');
  },

  // ---- Vorgänge (PlanTask) ----
  async listPlanTasks(planId: number): Promise<PlanTask[]> {
    const res = await fetch(`${API_BASE_URL}/api/plans/${planId}/tasks`);
    return handleResponse<PlanTask[]>(res, 'Vorgänge konnten nicht geladen werden');
  },

  async createPlanTask(planId: number, task: PlanTaskIn): Promise<PlanTask> {
    const res = await fetch(`${API_BASE_URL}/api/plans/${planId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    return handleResponse<PlanTask>(res, 'Vorgang konnte nicht angelegt werden');
  },

  async updatePlanTask(planId: number, taskId: number, changes: PlanTaskPatch): Promise<PlanTask> {
    const res = await fetch(`${API_BASE_URL}/api/plans/${planId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    return handleResponse<PlanTask>(res, 'Vorgang konnte nicht gespeichert werden');
  },

  /** 409, wenn schon Fortschritt gemeldet wurde – dann mit force=true erneut (löscht die Historie) */
  async deletePlanTask(planId: number, taskId: number, force = false): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/plans/${planId}/tasks/${taskId}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = new Error(`Vorgang konnte nicht gelöscht werden: ${await errorDetail(res)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
  },

  /** POST /api/plans/{id}/import – CSV (dryRun=true → Vorschau) oder PDF (immer Vorschau) */
  async importPlanFile(planId: number, file: File, dryRun = true): Promise<ImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${API_BASE_URL}/api/plans/${planId}/import?dry_run=${dryRun}`, { method: 'POST', body: form });
    return handleResponse<ImportResult>(res, 'Terminplan konnte nicht gelesen werden');
  },

  /** Bestätigte Vorschau übernehmen (Upsert per Code/Titel, nichts wird gelöscht) */
  async bulkPlanTasks(planId: number, tasks: ImportedTask[]): Promise<ImportResult> {
    const res = await fetch(`${API_BASE_URL}/api/plans/${planId}/tasks/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks }),
    });
    return handleResponse<ImportResult>(res, 'Vorgänge konnten nicht übernommen werden');
  },

  // ---- Demo ----
  /** POST /api/demo/reset – löscht ALLE Daten und lädt den Demo-Stand (403, wenn deaktiviert) */
  async demoReset(refDate?: string): Promise<DemoResetResult> {
    const res = await fetch(`${API_BASE_URL}/api/demo/reset${refDate ? `?ref_date=${refDate}` : ''}`, { method: 'POST' });
    return handleResponse<DemoResetResult>(res, 'Demo-Reset fehlgeschlagen');
  },

  // ---- System ----
  async health(): Promise<HealthStatus> {
    const res = await fetch(`${API_BASE_URL}/health`);
    return handleResponse<HealthStatus>(res, 'Backend nicht erreichbar');
  },

  // ==========================================
  // Geplante Endpunkte (Ideen) – existieren im Backend noch nicht → 404 → "Backend folgt"
  // ==========================================

  /** Idee #1: POST /api/photos/describe (multipart: file, project_id, lang) */
  async describePhoto(file: File, projectId?: number, lang = 'de'): Promise<PhotoDescribeResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('lang', lang);
    if (projectId) form.append('project_id', String(projectId));
    const res = await fetch(`${API_BASE_URL}/api/photos/describe`, { method: 'POST', body: form });
    return handleResponse<PhotoDescribeResponse>(res, 'Fotoanalyse fehlgeschlagen');
  },

  /** Idee #2: GET /api/weather?project_id=&date= */
  async getWeather(date: string, projectId?: number): Promise<WeatherResponse> {
    const params = new URLSearchParams({ date });
    if (projectId) params.set('project_id', String(projectId));
    const res = await fetch(`${API_BASE_URL}/api/weather?${params.toString()}`);
    return handleResponse<WeatherResponse>(res, 'Wetter konnte nicht geladen werden');
  },

  /** Idee #4: GET/PUT /api/notices/{id}/dispatch */
  async getDispatch(noticeId: number): Promise<NoticeDispatch | null> {
    const res = await fetch(`${API_BASE_URL}/api/notices/${noticeId}/dispatch`);
    return handleResponse<NoticeDispatch | null>(res, 'Versanddaten konnten nicht geladen werden');
  },

  async saveDispatch(noticeId: number, data: NoticeDispatch): Promise<NoticeDispatch> {
    const res = await fetch(`${API_BASE_URL}/api/notices/${noticeId}/dispatch`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<NoticeDispatch>(res, 'Versanddaten konnten nicht gespeichert werden');
  },

  /** Idee #5: POST /api/assistant/ask {question, project_id} */
  async askProject(question: string, projectId?: number): Promise<AssistantAnswer> {
    const res = await fetch(`${API_BASE_URL}/api/assistant/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, project_id: projectId }),
    });
    return handleResponse<AssistantAnswer>(res, 'Assistent nicht erreichbar');
  },
};
