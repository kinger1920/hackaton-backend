# AGENTS.md — AI Site Manager Assistant (Backend)

This repository (`hackaton-backend`) is the backend for **Challenge B: AI Site Manager Assistant for Documentation, Daily Reports and Claims**.

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

- **Language:** Python (`>=3.15`, see `pyproject.toml`)
- **Package Manager:** `uv` (`uv.lock` present)
- **Web Framework:** FastAPI + Uvicorn
- **Current Entrypoint:** `main.py`

### Common Commands

```bash
# Install / sync dependencies
uv sync

# Add a new dependency
uv add <package-name>

# Run the development server
uv run uvicorn main:app --reload
```

---

## 7. Guidelines for Coding Agents

- **Hackathon Pragmatism:** Optimize for clean, working, demoable end-to-end flows over over-engineered abstractions.
- **Modular Structure:** As features are added, organize code cleanly (e.g., `app/routers/`, `app/services/`, `app/models/` or `schemas/`, `app/prompts/`, `app/exporters/` for PDF/DOCX generation).
- **API Clarity:** Use Pydantic models for request/response schemas so FastAPI's OpenAPI docs (`/docs`) stay accurate for frontend integration.
- **Keep `AGENTS.md` Updated:** When adding major modules, environment variables, LLM providers, or architectural decisions, update this file so subsequent agents have accurate context.
