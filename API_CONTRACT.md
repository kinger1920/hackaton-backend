# API Contract & Datenmodelle (Backend ↔ Frontend)

Dieses Dokument beschreibt alle Datenbank-Modelle, Feldnamen, Datentypen und API-Payloads des Backends, damit das
Frontend exakt passende Requests und TypeScript-Interfaces verwenden kann.

- **Base URL (lokal):** `http://localhost:8000`
- **Interaktive OpenAPI / Swagger Docs:** `http://localhost:8000/docs`
- **Content-Type:** `application/json` (UTF-8)
- **IDs:** Alle `id`- und `*_id`-Felder sind `number` (`integer`, automatisch hochgezählt).
- **Zeitstempel:** Alle `*_at`-Felder sind ISO-8601 UTC-Strings (z. B. `"2026-11-21T11:35:08.123456Z"`).
- **Datumsfelder:** `YYYY-MM-DD` (z. B. `"2026-11-21"`).

---

## 1. `Project` (Bauprojekt)

Quelle: `backend/src/models/project.py`

| Feld          | Typ (TS)         | Pflicht bei Create | Default    | Beschreibung / Werte                                 |
|---------------|------------------|--------------------|------------|------------------------------------------------------|
| `id`          | `number`         | *(nur Response)*   | auto       | Primärschlüssel                                      |
| `name`        | `string`         | **ja**             | –          | Projektname                                          |
| `number`      | `string \| null` | nein               | `null`     | Projekt- / Baustellennummer (z. B. `"PRJ-2026-084"`) |
| `client`      | `string \| null` | nein               | `null`     | Bauherr / Auftraggeber                               |
| `location`    | `string \| null` | nein               | `null`     | Baustellenadresse / Standort                         |
| `phase`       | `string \| null` | nein               | `"Rohbau"` | Aktuelle Bauphase                                    |
| `status`      | `string`         | nein               | `"Aktiv"`  | `"Aktiv"` \| `"In Planung"` \| `"Abgeschlossen"`     |
| `description` | `string \| null` | nein               | `null`     | Projektbeschreibung / Besonderheiten                 |
| `created_at`  | `string`         | *(nur Response)*   | UTC now    | Erstellungszeitpunkt                                 |
| `updated_at`  | `string`         | *(nur Response)*   | UTC now    | Letzte Änderung                                      |

```ts
export interface Project {
    id: number;
    name: string;
    number?: string | null;
    client?: string | null;
    location?: string | null;
    phase?: string | null;
    status: 'Aktiv' | 'In Planung' | 'Abgeschlossen';
    description?: string | null;
    created_at: string;
    updated_at: string;
}

export type ProjectCreate = Omit<Project, 'id' | 'created_at' | 'updated_at'>;
```

### Bereits implementierte Endpunkte (`Project`)

| Methode | Pfad | Beschreibung | Statuscodes |
| --- | --- | --- | --- |
| `GET` | `/projects` | Alle Projekte abrufen | `200` |
| `GET` | `/projects/{project_id}` | Einzelnes Projekt abrufen | `200`, `404` |
| `POST` | `/projects` | Neues Projekt anlegen (Body: `ProjectCreate`) | `201` |
| `PATCH` | `/projects/{project_id}` | Projekt teilweise aktualisieren (Body: `ProjectUpdate`) | `200`, `404` |
| `DELETE` | `/projects/{project_id}` | Projekt inkl. abhängiger Einträge löschen | `204`, `404` |

---

## 2. `SiteNote` (Baustellen-Notiz / Sprach- & Schnellerfassung)

Quelle: `backend/src/models/note.py`

| Feld              | Typ (TS)         | Pflicht bei Create | Default       | Beschreibung / Werte                                                                  |
|-------------------|------------------|--------------------|---------------|---------------------------------------------------------------------------------------|
| `id`              | `number`         | *(nur Response)*   | auto          | Primärschlüssel                                                                       |
| `project_id`      | `number`         | **ja**             | –             | Foreign Key → `Project.id`                                                            |
| `content`         | `string`         | **ja**             | –             | Text / Transkript der Notiz                                                           |
| `category`        | `string \| null` | nein               | `"general"`   | `"delay"` \| `"incident"` \| `"weather"` \| `"progress"` \| `"defect"` \| `"general"` |
| `audio_file_path` | `string \| null` | nein               | `null`        | Optionaler Pfad zur Audiodatei                                                        |
| `author`          | `string \| null` | nein               | `"Bauleiter"` | Ersteller der Notiz                                                                   |
| `status`          | `string`         | nein               | `"raw"`       | `"raw"` \| `"processed"` \| `"incorporated"`                                          |
| `created_at`      | `string`         | *(nur Response)*   | UTC now       | Erstellungszeitpunkt                                                                  |

```ts
export interface SiteNote {
    id: number;
    project_id: number;
    content: string;
    category?: 'delay' | 'incident' | 'weather' | 'progress' | 'defect' | 'general' | null;
    audio_file_path?: string | null;
    author?: string | null;
    status: 'raw' | 'processed' | 'incorporated';
    created_at: string;
}

export interface SiteNoteCreate {
    project_id: number;
    content: string;
    category?: string | null;
    audio_file_path?: string | null;
    author?: string | null;
    status?: string;
}
```

### Bereits implementierte Endpunkte (`SiteNote`)

| Methode  | Pfad                    | Beschreibung                               | Statuscodes                  |
|----------|-------------------------|--------------------------------------------|------------------------------|
| `GET`    | `/site-notes`           | Alle Notes (optional: `?project_id=1`)     | `200`                        |
| `GET`    | `/site-notes/{note_id}` | Einzelne Note per ID                       | `200`                        |
| `POST`   | `/site-notes/create`    | Neue Note anlegen (Body: `SiteNoteCreate`) | `201`, `404` (Projekt fehlt) |
| `DELETE` | `/site-notes/{note_id}` | Note löschen                               | `204`, `404`                 |

---

## 3. `FormalNotice` (Schriftverkehr / Briefentwürfe)

Quelle: `backend/src/models/notice.py`

| Feld                | Typ (TS)         | Pflicht bei Create | Default                                                             | Beschreibung / Werte                                     |
|---------------------|------------------|--------------------|---------------------------------------------------------------------|----------------------------------------------------------|
| `id`                | `number`         | *(nur Response)*   | auto                                                                | Primärschlüssel                                          |
| `project_id`        | `number`         | **ja**             | –                                                                   | Foreign Key → `Project.id`                               |
| `type`              | `string`         | **ja**             | –                                                                   | `"delay"` \| `"cost"` \| `"defect"` \| `"concern"`       |
| `title`             | `string \| null` | nein               | `null`                                                              | Kurztitel (z. B. für Listenansicht)                      |
| `recipient`         | `string \| null` | nein               | `null`                                                              | Empfänger (Auftraggeber / Nachunternehmer)               |
| `subject`           | `string \| null` | nein               | `null`                                                              | Betreff des Schreibens                                   |
| `body`              | `string`         | **ja**             | –                                                                   | Brieftext (editierbar im Frontend)                       |
| `legal_disclaimer`  | `string`         | nein               | `"Entwurf zur Prüfung durch die Bauleitung - Keine Rechtsberatung"` | Pflicht-Hinweis                                          |
| `source_references` | `string \| null` | nein               | `null`                                                              | JSON-String mit referenzierten IDs (Notes/Reports/Tasks) |
| `status`            | `string`         | nein               | `"Entwurf"`                                                         | `"Entwurf"` \| `"Freigegeben"` \| `"Exportiert"`         |
| `created_at`        | `string`         | *(nur Response)*   | UTC now                                                             | Erstellungszeitpunkt                                     |
| `updated_at`        | `string`         | *(nur Response)*   | UTC now                                                             | Letzte Änderung                                          |

```ts
export type NoticeType = 'delay' | 'cost' | 'defect' | 'concern';

export interface FormalNotice {
    id: number;
    project_id: number;
    type: NoticeType;
    title?: string | null;
    recipient?: string | null;
    subject?: string | null;
    body: string;
    legal_disclaimer: string;
    source_references?: string | null;
    status: 'Entwurf' | 'Freigegeben' | 'Exportiert';
    created_at: string;
    updated_at: string;
}

export interface FormalNoticeCreate {
    project_id: number;
    type: NoticeType;
    title?: string | null;
    recipient?: string | null;
    subject?: string | null;
    body: string;
    legal_disclaimer?: string;
    source_references?: string | null;
    status?: 'Entwurf' | 'Freigegeben' | 'Exportiert';
}
```

---

## 4. `DailyReport` (Bautagesbericht)

Quelle: `backend/src/models/report.py`

| Feld                   | Typ (TS)         | Pflicht bei Create | Default   | Beschreibung / Werte                                                      |
|------------------------|------------------|--------------------|-----------|---------------------------------------------------------------------------|
| `id`                   | `number`         | *(nur Response)*   | auto      | Primärschlüssel                                                           |
| `project_id`           | `number`         | **ja**             | –         | Foreign Key → `Project.id`                                                |
| `report_date`          | `string`         | **ja**             | –         | Datum im Format `YYYY-MM-DD`                                              |
| `summary`              | `string \| null` | nein               | `null`    | Tageszusammenfassung                                                      |
| `weather`              | `string \| null` | nein               | `null`    | JSON-String, z. B. `{"temp_c": 12, "condition": "bewölkt", "rain_mm": 0}` |
| `workforce`            | `string \| null` | nein               | `null`    | JSON-String, z. B. `[{"trade": "Rohbau", "workers": 8, "hours": 64}]`     |
| `equipment`            | `string \| null` | nein               | `null`    | JSON-String, z. B. `[{"machine": "Kran 1", "hours": 7}]`                  |
| `work_completed`       | `string \| null` | nein               | `null`    | Ausgeführte Arbeiten                                                      |
| `deviations_incidents` | `string \| null` | nein               | `null`    | Abweichungen / besondere Vorkommnisse                                     |
| `status`               | `string`         | nein               | `"draft"` | `"draft"` \| `"reviewed"` \| `"finalized"` \| `"exported"`                |
| `created_at`           | `string`         | *(nur Response)*   | UTC now   | Erstellungszeitpunkt                                                      |
| `updated_at`           | `string`         | *(nur Response)*   | UTC now   | Letzte Änderung                                                           |

```ts
export interface DailyReport {
    id: number;
    project_id: number;
    report_date: string; // YYYY-MM-DD
    summary?: string | null;
    weather?: string | null; // JSON string
    workforce?: string | null; // JSON string
    equipment?: string | null; // JSON string
    work_completed?: string | null;
    deviations_incidents?: string | null;
    status: 'draft' | 'reviewed' | 'finalized' | 'exported';
    created_at: string;
    updated_at: string;
}
```

---

## 5. `ConstructionPlan` & `PlanTask` (Bauzeitenplan & Vorgänge)

Quelle: `backend/src/models/plan.py`

### `ConstructionPlan`

| Feld          | Typ (TS)         | Pflicht bei Create | Default | Beschreibung                         |
|---------------|------------------|--------------------|---------|--------------------------------------|
| `id`          | `number`         | *(nur Response)*   | auto    | Primärschlüssel                      |
| `project_id`  | `number`         | **ja**             | –       | Foreign Key → `Project.id`           |
| `title`       | `string`         | **ja**             | –       | Titel des Bauzeitenplans             |
| `version`     | `string \| null` | nein               | `"1.0"` | Versionsnummer                       |
| `file_path`   | `string \| null` | nein               | `null`  | Speicherpfad der hochgeladenen Datei |
| `file_name`   | `string \| null` | nein               | `null`  | Original-Dateiname                   |
| `raw_data`    | `string \| null` | nein               | `null`  | JSON-String (Gantt/WBS-Rohdaten)     |
| `uploaded_at` | `string`         | *(nur Response)*   | UTC now | Upload-Zeitpunkt                     |

### `PlanTask`

| Feld            | Typ (TS)         | Pflicht bei Create | Default     | Beschreibung / Werte                                           |
|-----------------|------------------|--------------------|-------------|----------------------------------------------------------------|
| `id`            | `number`         | *(nur Response)*   | auto        | Primärschlüssel                                                |
| `plan_id`       | `number`         | **ja**             | –           | Foreign Key → `ConstructionPlan.id`                            |
| `task_code`     | `string \| null` | nein               | `null`      | Vorgangsnummer / WBS-Code                                      |
| `title`         | `string`         | **ja**             | –           | Vorgangsbezeichnung                                            |
| `trade`         | `string \| null` | nein               | `null`      | Gewerk (z. B. `"Rohbau"`, `"Erdarbeiten"`, `"Elektro"`)        |
| `planned_start` | `string \| null` | nein               | `null`      | `YYYY-MM-DD`                                                   |
| `planned_end`   | `string \| null` | nein               | `null`      | `YYYY-MM-DD`                                                   |
| `actual_start`  | `string \| null` | nein               | `null`      | `YYYY-MM-DD`                                                   |
| `actual_end`    | `string \| null` | nein               | `null`      | `YYYY-MM-DD`                                                   |
| `status`        | `string`         | nein               | `"pending"` | `"pending"` \| `"in_progress"` \| `"delayed"` \| `"completed"` |
| `notes`         | `string \| null` | nein               | `null`      | Anmerkungen                                                    |

```ts
export interface ConstructionPlan {
    id: number;
    project_id: number;
    title: string;
    version?: string | null;
    file_path?: string | null;
    file_name?: string | null;
    raw_data?: string | null;
    uploaded_at: string;
}

export interface PlanTask {
    id: number;
    plan_id: number;
    task_code?: string | null;
    title: string;
    trade?: string | null;
    planned_start?: string | null; // YYYY-MM-DD
    planned_end?: string | null;   // YYYY-MM-DD
    actual_start?: string | null;  // YYYY-MM-DD
    actual_end?: string | null;    // YYYY-MM-DD
    status: 'pending' | 'in_progress' | 'delayed' | 'completed';
    notes?: string | null;
}
```

### Bereits implementierte Endpunkte (`ConstructionPlan`)

| Methode | Pfad | Beschreibung | Statuscodes |
| --- | --- | --- | --- |
| `GET` | `/plans` | Alle Pläne (optional: `?project_id=1`) | `200` |
| `GET` | `/plans/{plan_id}` | Einzelnen Plan per ID abrufen | `200`, `404` |
| `POST` | `/plans` | Neuen Projektplan anlegen (Body: `ConstructionPlanCreate`) | `201`, `404` (Projekt fehlt) |
| `PATCH` | `/plans/{plan_id}` | Projektplan teilweise aktualisieren (Body: `ConstructionPlanUpdate`) | `200`, `404` |
| `DELETE` | `/plans/{plan_id}` | Projektplan inkl. zugehöriger `PlanTask`s löschen | `204`, `404` |

---

## 6. `ChatSession` & `ChatMessage` (KI-Assistent Chat)

Quelle: `backend/src/models/chat.py`

### `ChatSession`

| Feld         | Typ (TS) | Pflicht bei Create | Default        | Beschreibung               |
|--------------|----------|--------------------|----------------|----------------------------|
| `id`         | `number` | *(nur Response)*   | auto           | Primärschlüssel            |
| `project_id` | `number` | **ja**             | –              | Foreign Key → `Project.id` |
| `title`      | `string` | nein               | `"Neuer Chat"` | Chat-Titel                 |
| `created_at` | `string` | *(nur Response)*   | UTC now        | Erstellungszeitpunkt       |

### `ChatMessage`

| Feld            | Typ (TS)         | Pflicht bei Create | Default | Beschreibung / Werte                                           |
|-----------------|------------------|--------------------|---------|----------------------------------------------------------------|
| `id`            | `number`         | *(nur Response)*   | auto    | Primärschlüssel                                                |
| `session_id`    | `number`         | **ja**             | –       | Foreign Key → `ChatSession.id`                                 |
| `role`          | `string`         | **ja**             | –       | `"user"` \| `"assistant"` \| `"system"`                        |
| `content`       | `string`         | **ja**             | –       | Nachrichteninhalt                                              |
| `metadata_json` | `string \| null` | nein               | `null`  | JSON-String für Quellenangaben / Action-Trigger / Tool-Outputs |
| `created_at`    | `string`         | *(nur Response)*   | UTC now | Erstellungszeitpunkt                                           |

```ts
export interface ChatSession {
    id: number;
    project_id: number;
    title: string;
    created_at: string;
}

export interface ChatMessage {
    id: number;
    session_id: number;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata_json?: string | null;
    created_at: string;
}
```
