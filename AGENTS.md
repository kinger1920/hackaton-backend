# AGENTS.md — AI Site Manager Assistant

This repository is a monorepo for **Challenge B: AI Site Manager Assistant for Documentation, Daily Reports and Claims**, structured into `backend/` and `frontend/`.

---

## 1. Project Context & Problem Statement

**Working Title:** *"AI Site Manager Assistant for Documentation, Daily Reports and Claims"*

Construction site managers (*Bauleiter*) spend a large share of their time on documentation, correspondence, and formal notices—such as delay notices (*Behinderungsanzeigen*), additional cost notices (*Mehrkostenanmeldungen*), notices of concern (*Bedenkenanmeldungen*), and defect notices (*Mängelrügen*).

Currently, analyzing daily site reports (*Bautagesberichte*), evaluating performance data against the schedule, detecting deviations, and drafting formal letters is mostly done manually. These tasks follow recurring patterns but require high accuracy and the consolidation of scattered information (meeting minutes, site diary entries, emails, voice notes, photos).

---

## 2. Challenge Objectives

Build an AI assistant that reduces operational documentation workload for site managers:

1. **Voice & Text Capture:** Capture site situations via mobile dictation (audio/speech-to-text) or quick text input.
2. **Daily Report Analysis:** Automatically evaluate performance data, compare actual progress against plan, and detect deviations/delays.
3. **Smart Correspondence Drafts:** Generate structured drafts for formal letters (delay, additional cost, concern, defect notices) from a few keywords or a short voice note.
4. **Structured Summaries:** Synthesize scattered inputs (site diary entries, meeting minutes, emails, photos) into clear summaries with open items and deadlines.
5. **Proactive Deviation Alerts:** Detect critical deviations in reports/data and proactively suggest corresponding formal notices.
6. **Human-in-the-Loop:** The site manager always retains full control—the AI produces editable drafts and suggestions, never sends or finalizes documents autonomously.

---

## 3. Core Use Cases

- **Form / Letter Assistant:** Site manager enters keywords or dictates a note (e.g., *"excavator idle since 10 am due to missing utility plans"*), and the assistant generates a properly formatted formal notice ready for review and export.
- **Daily Report Analysis:** Ingest daily reports, extract performance metrics, compare against planned targets, and flag delays or bottlenecks.
- **Documentation Drafts:** Generate a structured daily site report (*Bautagesbericht*) draft from photos, voice/text notes, and calendar/appointment entries.
- **Meeting Minute Summaries:** Extract key decisions, responsibilities, open action items, and deadlines from meeting minutes and emails.
- **Deviation Alerts:** Continuously or on-demand flag critical schedule/performance deviations and propose pre-filled draft correspondence.

---

## 4. Deliverables & Demo Story

- **Prototype:** Interactive chat/voice interface backed by this API, supporting **PDF** and **Word (`.docx`)** export of generated reports and notices.
- **Demo Narrative:** *"A day in the life of a site manager with an AI assistant"* — design endpoints and sample data so they cleanly support an end-to-end walkthrough of a typical day on site (morning capture → daily report / meeting summary → deviation detection → formal notice draft → review & PDF/Word export).

---

## 5. Non-Negotiable Domain Constraints

- **No Legal Advice:** The system provides *drafting support only*, not legal advice. Final review and responsibility always lie with the site manager / construction company. Generated notices should be clearly marked as drafts for review.
- **Human-in-the-Loop:** Every generated letter, report, or alert must be reviewable and editable by the user before export or dispatch.
- **Traceability:** When flagging deviations or drafting claims, reference the underlying source inputs (e.g., report date, note, photo, meeting minute) so the site manager can verify facts quickly.

---

## 6. Tech Stack & Repository Setup

### Repository Layout

```text
.
├── backend/          # FastAPI backend (Python + uv)
│   ├── pyproject.toml
│   ├── uv.lock
│   └── src/
│       └── main.py
├── frontend/         # Frontend application
└── AGENTS.md
```

### Backend

- **Language:** Python (`>=3.15`, see `backend/pyproject.toml`)
- **Package Manager:** `uv` (`backend/uv.lock` present)
- **Web Framework:** FastAPI + Uvicorn
- **Current Entrypoint:** `backend/src/main.py`

### Common Commands (Backend)

```bash
# Install / sync dependencies
cd backend && uv sync

# Add a new dependency
cd backend && uv add <package-name>

# Run the development server
cd backend && ./scripts/dev.sh   # or: uv run uvicorn src.main:app --reload (no Pango path, no .env vars)
```

### Quickstart for Teammates (own API key, all features)

1. `cp backend/.env.example backend/.env` and put **your own** Groq key into `GROQ_API_KEY` (free: https://console.groq.com/keys). Never commit `.env` or paste keys anywhere. Without a key everything still runs offline (`"mode": "offline"`).
2. macOS, once: `brew install pango` (needed for PDF export).
3. `cd backend && uv sync && ./scripts/dev.sh` – sets the Pango path on macOS and loads all values from `backend/.env` (incl. optional `DATABASE_URL`). Use this instead of plain `uvicorn`, also in PyCharm/VS Code terminals.
4. Optional demo data in a copy (keeps the tracked DB clean): `cp data/site_assistant.db ~/bauassist-demo.db`, set `DATABASE_URL=sqlite:////Users/<you>/bauassist-demo.db` in `.env`, run `DATABASE_URL=sqlite:////Users/<you>/bauassist-demo.db uv run python scripts/seed_reports.py`, restart `./scripts/dev.sh`.
5. Open http://localhost:8000/docs. `GET /health` must show `"pdf_export": true`; otherwise `/pdf` returns 503 with a hint (Word export always works).
6. Frontend: `cd frontend && npm install && npm run dev`. Only if the backend is not on `localhost:8000`: `cp .env.example .env.local` and adjust `VITE_API_URL`.

### Environment & PDF Export

- Copy `backend/.env.example` to `backend/.env` and set `GROQ_API_KEY` (LLM + Whisper via Groq). Without a key, all AI endpoints fall back to offline rules.
- PDF export (`GET /api/notices/{id}/pdf`) uses WeasyPrint, which needs Pango as a system library:

```bash
# macOS (once): install Pango and make it findable for Python (add the export to ~/.zshrc)
brew install pango
export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib
```

Attendance per company (`attendance[]` in `/api/reports/{date}`, stored in `DailyReport.workforce` JSON) is compared with `Contract.planned_workforce` in `services/workforce.py`: below 80 % → warning; 2 report days in a row → dashboard alert with `prefillText` for `POST /api/capture` (`force_type: "delay"`). Seed firms/contracts: `scripts/seed_reports.py` (`seed_companies`). Schedule & timeline: `GET /api/schedule?project_id&from&days&ref_date` gives tasks per workday from the construction plan (firm + contracted workforce if unambiguous; unfinished overdue tasks stay as `isOverdue`) plus merged `appointments` (manual DB appointments with `source="manual", editable=true` and auto-computed milestones/deadlines from plan & workforce check with `editable=false`); `GET /api/schedule/ics?project_id=` exports a live `.ics` calendar feed; `GET/POST /api/appointments` and `PATCH/DELETE /api/appointments/{id}` manage manual calendar appointments (`Appointment` table); `GET /api/timeline?project_id&from&to&types=report,note,notice,progress,alert` lists past events newest first, each with a source. Site photos: `GET/POST /api/photos`, `POST /api/photos/describe`, `GET /api/photos/{id}/file`, `DELETE /api/photos/{id}` store site photos (`SitePhoto` table + `data/uploads/photos/`) per project and date (`report_date`) with AI/offline caption, diary text and issue detection, displayed both in the calendar (`Termin.tsx`) and daily reports (`DailyReports.tsx`). Additional backend endpoints replacing former `localStorage` state: `GET/PUT /api/notices/{id}/dispatch` (`NoticeDraftData.dispatch_json`), `PlanTask.location` (exposed on `WorkPackage` in `/api/analysis` and editable via `PATCH /api/plans/{id}/tasks/{task_id}`), `GET/POST/DELETE /api/documents` (`ProjectDocument`), and `GET/PUT /api/profile` (`UserProfile`). Project master data: `/projects` accepts the frontend form fields (`construction_volume_eur`, `budget_eur`, `gross_floor_area_m2`, `gross_volume_m3`, `construction_type`, `start_date`, `end_date`, `contract_type`, `vob_b_agreed`, `vob_notes`); `contractors[]` is stored as Company + Contract (`required_workers` → `planned_workforce`) and returned on read. Plan import: `POST /api/plans/{id}/import` (CSV is applied, `dry_run=true` previews; PDF is always a preview → confirm via `POST /api/plans/{id}/tasks/bulk`), task CRUD under `/api/plans/{id}/tasks` (delete with progress → 409 unless `force=true`). Demo reset: `POST /api/demo/reset[?ref_date=]` wipes the WHOLE database and loads the jury demo (project 1 with master data, 2 firms/contracts, plan with 23 tasks – 6 seed tasks + 17 follow-up shell tasks for Haus B/C up to the roof, all starting after the last report day so the 1.8-day delay story is unchanged – locations as `Haus B · UG (Achse A)`, 15 reports, 2 dictations DE/PL, 2 manual appointments), shifted by workdays so the last report is the last workday before today. Disabled with `DEMO_RESET_ENABLED=false`. Weather: `GET /api/weather?project_id=&date=` (Open-Meteo, free, no key) also returns `wind_gusts_kmh`, `precipitation_probability`, `t_min/t_max`, `place` and rule-based `crane_status`/`is_wind_warning` (gusts ≥ 45 km/h) and `concrete_status` (min temp ≤ +5 °C); today uses the current reading. The dashboard weather tile and header chip use it (fallback: daily report, then sample values). Daily reports export the same way: `GET /api/reports/{date}/pdf|docx` (404 if the day has no saved report; reports not `finalized` carry an "ENTWURF" watermark; contents incl. plan vs. actual table, rule-based day analysis and signature lines, no LLM call). Without Pango the PDF endpoints return `503` and the PDF test is skipped; Word export (`/docx`) works without system libraries. Linux/Docker: install `libpango-1.0-0 libpangoft2-1.0-0`.

Project assistant: `POST /api/assistant/ask {question, project_id, ref_date?}` → `{answer, sources[], mode, session_id}` answers only from project data (reports, notes, letters, contracts, plan vs. actual, appointments) with verified source labels and a rule-based offline fallback (`services/assistant.py`); history per project in `ChatSession`/`ChatMessage` via `GET/DELETE /api/assistant/history?project_id=`. Weather: `GET /api/weather?date&project_id` uses Open-Meteo (no key, stdlib only) for `Project.location`, falls back to the weather stored in that day's report, 503 otherwise (`services/weather.py`). `PUT /contracts/{id}/file` attaches/replaces a contract PDF later and re-extracts its text. Building progress: `GET /api/progress/building?project_id=` returns houses, levels (Gründung → UG → EG → n.OG → Dach), every task with plan dates, duration and reported progress history, plus events (defects, hindrances, report incidents, photo issues) placed by house/level (`services/progress_map.py`, location parsed from `PlanTask.location`/title, axis → house learned from other tasks); the frontend (`ideas/ProgressMap.tsx`) computes the state per day with the same formulas as `services/analysis.py` and shows a 2.5D building + Gantt.

Defect management: `Defect` table (`models/defect.py`; photo/notice/task are plain ids without FK) with status flow offen -> in_bearbeitung -> behoben -> abgenommen (`resolved_date`/`accepted_date` set and cleared automatically), company, deadline, priority and house/level parsed from `location`/title like the building view. `GET /api/defects?project_id&status(open|offen|in_bearbeitung|behoben|abgenommen)&company&house&overdue` (overdue first), `GET /api/defects/summary`, `POST`, `PATCH /{id}`, `DELETE /{id}`, `GET /api/defects/export/{docx|pdf}` (defect list, PDF 503 without Pango). Overdue defects are appended to `/api/dashboard` alerts (draftType defect), defects feed the building view (red until resolved; linked notice/photo not shown twice) and the assistant (context + offline rule). `GET /api/assistant/suggestions?project_id` builds suggestion questions from project data. Demo reset adds 4 defects (one per status, one overdue, one linked to the Mängelrüge + photo).

Mobile view (frontend): up to 768 px width `MainLayout` renders `mobile/MobileShell.tsx` instead of sidebar + header (slim project bar, bottom tab bar Aufnahme/Mängel/Bericht/Plan/Mehr, "Mehr" sheet with all pages, theme, "Desktop-Ansicht"). Override via localStorage `viewMode` (`utils/useIsMobile.ts`). `/mobile` (`mobile/MobileHome.tsx`) is the phone start page: one big record button → transcription → choose target (daily report `/fill`, defect, letter draft, site note; suggestion by keywords) + quick actions photo/type/defect. Without browser microphone (no HTTPS) the button opens the phone's own recorder (file input). Test on a phone in the same Wi-Fi: `uvicorn src.main:app --host 0.0.0.0 --reload --env-file .env` and `npm run dev -- --host`, open `http://<PC-IP>:3000`; the frontend then calls `http://<PC-IP>:8000` automatically (API_BASE_URL defaults to the page's host) and CORS allows private-network origins (`allow_origin_regex` in `main.py`).

### Demo Data for Summaries & Analysis

`POST /api/summarize` summarizes a week/month of daily reports, site notes and notices (or a free text such as an email). Daily reports: `GET/PUT /api/reports/{date}`, `POST /api/reports/{date}/fill` (dictation → report fields + progress per plan task, stored in `ReportProgress`). New nullable columns are added to existing SQLite DBs on startup (`add_missing_columns` in `database.py`), no reset needed. Plan vs. actual: `GET /api/analysis?period=week|all&ref_date=` (format of `frontend/src/analysis/Analysis.tsx`), `GET /api/reports/{date}/analysis` (what went well/badly that day), `GET /api/dashboard`. All numbers are computed in `services/analysis.py` (plan % linear over workdays, delay = (plan % − actual %) × duration); only the day analysis uses the LLM for free text. To get demo data (plan "Bauzeitenplan Rohbau" with 6 tasks, daily reports for workdays 02.11.–20.11.2026, progress per task) run `cd backend && DATABASE_URL=sqlite:///path/to/copy.db uv run python scripts/seed_reports.py`. Without `DATABASE_URL` it writes into the tracked `data/site_assistant.db` – do not commit that.

---

## 7. Guidelines for Coding Agents

- **Hackathon Pragmatism:** Optimize for clean, working, demoable end-to-end flows over over-engineered abstractions.
- **Modular Structure:** As features are added in `backend/src/`, organize code cleanly (e.g., `routers/`, `services/`, `models/` or `schemas/`, `prompts/`, `exporters/` for PDF/DOCX generation).
- **API Clarity:** Use Pydantic models for request/response schemas so FastAPI's OpenAPI docs (`/docs`) stay accurate for frontend integration.
- **Keep `AGENTS.md` Updated:** When adding major modules, environment variables, LLM providers, or architectural decisions, update this file so subsequent agents have accurate context.
