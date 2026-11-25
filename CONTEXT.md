# NaniCare — Project Context & Engineering Handoff

**NaniCare** is a voice-first eldercare prescription and vitals companion designed for Indian families.

- **Caregiver Mode (Adult Child / Caregiver):** Scans a handwritten doctor prescription or medicine blister strip via Gemini Vision, reviews AI-extracted fields (with low-confidence `< 0.80` or incomplete fields highlighted in yellow), and saves the verified regimen to Neon PostgreSQL.
- **Nani Mode (Elder Patient):** Zero-login, zero-auth experience accessed via a simple 6-character `share_code` (default `"DEMO01"`). Renders high-contrast medication cards with medicine strip thumbnails, plays warm Hindi (`hi`), Marathi (`mr`), or English (`en`) spoken audio instructions, and logs taken doses.
- **Vitals & Family Loop:** Logs body temperature (°F), blood pressure (mmHg), and weight (kg) (plus optional pulse, SpO2, blood sugar), flags abnormal values using a deterministic clinical rule engine, and generates a daily summary + ready-to-use `https://wa.me/?text=...` WhatsApp deep link.

---

## 1. Repository & File Structure

```text
NaniCare/
├── CONTEXT.md              # Project context, architecture & API/frontend handoff guide
├── README.md
├── backend/
│   ├── engine.py           # Main FastAPI app, CORS, startup DB init & DEMO01 seed, all API routes
│   ├── database.py         # Neon PostgreSQL SQLAlchemy 2.0 engine, get_db(), init_db(), SQLite fallback
│   ├── models.py           # SQLAlchemy ORM models (Profile, Medicine, DoseLog, VitalLog)
│   ├── schemas.py          # Strict Pydantic v2 schemas for Gemini Structured Output & API I/O
│   ├── scheduler.py        # Pure deterministic Python logic (Indian dosage times, safety flags, vitals math, WhatsApp)
│   ├── prompts.py          # Gemini Vision system prompt, SVG demo thumbnails, DEMO_PRESCRIPTION_PAYLOAD, DEMO01 seed
│   ├── schema.sql          # Idempotent PostgreSQL DDL matching models.py (for Neon SQL Editor / MCP)
│   ├── requirements.txt    # Exact Python dependencies
│   ├── .env.example        # Template for GEMINI_API_KEY, DATABASE_URL, GEMINI_MODEL, CORS_ORIGINS
│   ├── .gitignore          # Ignores .env, venv/, __pycache__/, *.pyc, *.db
│   ├── Procfile            # Render/Railway start command: uvicorn engine:app --host 0.0.0.0 --port $PORT
│   └── test_api.sh         # Executable curl smoke-test script covering all endpoints
└── frontend/
    ├── server.ts           # Express + Vite dev/prod server (port 3000) with /api/health & /api/scan
    ├── vite.config.ts      # Vite + React + Tailwind v4 config (copies src/assets into dist/)
    ├── package.json        # React 19, Vite, Express, @google/genai, Tailwind, lucide-react, motion
    ├── index.html
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── App.tsx         # Root app state, routing (select | caregiver | nani | vitals), theme & language
        ├── config.ts       # DEMO01 seed data, language locales, vitals ranges, strip preset assets
        ├── assets/images/  # Sample prescription & medicine strip images
        ├── lib/api.ts      # Dual-mode API client (VITE_API_URL FastAPI mode or built-in preview + localStorage)
        ├── pages/
        │   ├── caregiver/index.tsx
        │   ├── nani/index.tsx
        │   └── vitals/index.tsx
        ├── components/     # ModeSelect, TopBar, PrescriptionScanner, ReviewMedicineCard, NaniMedicineCard, StripImage, VitalsLogger, WhatsAppSummaryCard
        ├── types/api.ts    # Frontend TypeScript API & domain types
        └── utils/          # scheduler.ts, storage.ts, tts.ts, whatsapp.ts
```

---

## 2. Tech Stack & Runtime Behavior

- **Backend Framework:** FastAPI + Uvicorn (`backend/engine.py`)
- **Frontend Framework:** React 19 + Vite + Tailwind CSS v4 + Express preview server (`frontend/server.ts`, port `3000`)
- **AI Extraction:**
  - **FastAPI (`backend/engine.py`):** Google Gemini Vision (`google-genai` SDK, default `gemini-2.5-flash`) with `response_mime_type="application/json"` and `response_schema=PrescriptionExtractionOutput` (`schemas.py`).
    - **Automatic Demo Fallback:** If `GEMINI_API_KEY` is unset/placeholder, `demo=true` is passed, no file is uploaded, or the live Gemini call errors, `POST /scan` gracefully returns `DEMO_PRESCRIPTION_PAYLOAD` (`source: "demo_fallback"`) so hackathon demos never crash.
  - **Frontend Built-in Preview (`frontend/server.ts`):** Exposes `POST /api/scan` using `@google/genai` (`gemini-4-hydrogen`) when `VITE_API_URL` is not configured.
- **Database:** Neon Serverless PostgreSQL (`postgresql+psycopg2://...` with `sslmode=require` auto-enforced for `*.neon.tech`, `pool_pre_ping=True`, `pool_recycle=300`).
  - **Automatic Local Fallback:** If `DATABASE_URL` is unset or still uses the `.env.example` placeholder, `database.py` automatically falls back to `sqlite:///./nanicare_local.db`.
- **Timezone:** All daily schedules, adherence calculations, and dose dates use **IST (`Asia/Kolkata`)**.
- **Startup Auto-Seed:** On startup (`lifespan` in `engine.py`), `init_db()` creates tables idempotently and seeds `"DEMO01"` (**Kamla Nani**, 72 yrs, Hindi, 5 realistic Indian medicines + 1 taken morning dose + 2 baseline vitals logs).

---

## 3. Database Schema (`models.py` & `schema.sql`)

| Table | Purpose | Key Columns |
| :--- | :--- | :--- |
| `profiles` | Elder profiles (zero-auth lookup) | `id`, `share_code` (unique uppercase, e.g. `DEMO01`), `elder_name`, `age`, `preferred_language` (`hi` \| `mr` \| `en`), `caregiver_name`, `caregiver_phone`, `known_allergies` (`JSONB`) |
| `medicines` | Verified medicines & schedules | `id`, `profile_id` (FK), `brand_name`, `generic_name`, `strength`, `dosage_form`, `dosage_pattern`, `meal_relation`, `schedule_slots` (`JSONB`), `duration_days`, `as_needed`, `instructions_en/hi/mr`, `strip_thumbnail`, `pill_color_tag`, `confidence`, `needs_review`, `safety_flags` (`JSONB`), `is_active`, `prescribed_by` |
| `dose_logs` | Daily adherence tracking | `id`, `profile_id` (FK), `medicine_id` (FK), `dose_date`, `scheduled_slot`, `scheduled_time`, `status` (`taken` \| `skipped` \| `snoozed`), `taken_at`, `marked_by`, `notes`. Unique constraint on `(medicine_id, dose_date, scheduled_slot)` for idempotent marking. |
| `vitals_logs` | Health vitals & deterministic flags | `id`, `profile_id` (FK), `recorded_at`, `temperature_f`, `systolic_mmhg`, `diastolic_mmhg`, `weight_kg`, `pulse_bpm`, `spo2_percent`, `blood_sugar_mgdl`, `overall_status` (`normal` \| `caution` \| `critical`), `flags` (`JSONB`), `notes`, `recorded_by` |

---

## 4. API Contract Reference (`engine.py`)

### System & Demo
| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Basic service metadata & `/docs` pointer |
| `GET` | `/health` | DB connectivity probe (`postgresql` vs `sqlite`), Gemini config status, IST server time |
| `POST` | `/demo/seed?reset=false` | Idempotently seeds (or resets if `reset=true`) the `"DEMO01"` profile |

### Caregiver Mode (Scan & Confirm)
| Method | Path | Input | Output |
| :--- | :--- | :--- | :--- |
| `GET` | `/scan/demo` | None | `ScanResponse` using `DEMO_PRESCRIPTION_PAYLOAD` |
| `POST` | `/scan` | Multipart form: optional `file` (JPEG/PNG/WEBP <= 12 MB) + optional `demo=bool` | `ScanResponse` with `medicines[]` (`confidence`, `needs_review`, `highlight_color` = `"none"` \| `"yellow"` \| `"red"`, `schedule_slots`, `instructions_en/hi/mr`, `safety_flags`), `regimen_safety_flags[]`, and compressed `strip_thumbnail` data URI |
| `POST` | `/medicines/confirm` | JSON `MedicinesConfirmRequest` (`share_code`, optional profile fields, `replace_existing`, `medicines[]`) | `201` `MedicinesConfirmResponse` — persists verified medicines, generates deterministic slots & EN/HI/MR scripts, and runs regimen-wide interaction checks |
| `GET` | `/medicines/{share_code}` | Query `include_inactive=bool` | `list[MedicineResponse]` |
| `DELETE` | `/medicines/{medicine_id}` | Path `medicine_id` | Soft-deactivates (`is_active=false`) |

### Profiles & Nani Mode
| Method | Path | Input | Output |
| :--- | :--- | :--- | :--- |
| `POST` | `/profile` | JSON `ProfileCreateRequest` (auto-generates 6-char `share_code` if omitted) | `201` `ProfileResponse` |
| `GET` | `/profile/{share_code}` | Path `share_code` | `ProfileResponse` |
| `GET` | `/schedule/{share_code}` | Query optional `schedule_date=YYYY-MM-DD`, optional `lang=hi\|mr\|en` | `NaniScheduleResponse` (`adherence_percent`, `next_due_card`, `cards[]`, `as_needed_cards[]`, each card containing `strip_thumbnail`, `pill_color_tag`, `status`, and localized `spoken_text`) |
| `POST` | `/doses/mark` | JSON `DoseMarkRequest` (`share_code`, `medicine_id`, `scheduled_slot`, `status`: `taken` \| `skipped` \| `snoozed`, `marked_by`: `nani` \| `caregiver`) | `DoseLogResponse` (idempotent upsert per medicine/date/slot) |
| `GET` | `/doses/{share_code}` | Query optional `dose_date=YYYY-MM-DD` | `list[DoseLogResponse]` |

### Vitals & Family Loop
| Method | Path | Input | Output |
| :--- | :--- | :--- | :--- |
| `POST` | `/vitals` | JSON `VitalCreateRequest` (at least one vital: `temperature_f`, `systolic_mmhg` + `diastolic_mmhg`, `weight_kg`, optional `pulse_bpm`, `spo2_percent`, `blood_sugar_mgdl`) | `201` `VitalResponse` with `overall_status` (`normal` \| `caution` \| `critical`), `flags[]`, and `alert_summary_en/hi/mr` |
| `GET` | `/vitals/{share_code}` | Query `limit=20` | `VitalsHistoryResponse` |
| `GET` | `/profile/{share_code}/summary` | Query optional `report_date=YYYY-MM-DD`, optional `phone=+91...` | `DailySummaryResponse` with adherence counts, taken/pending/missed lists, latest vital, active safety flags, `whatsapp_message`, and URL-encoded `whatsapp_url` (`https://wa.me/?text=...`) |

---

## 5. Deterministic Rules (`scheduler.py`)

### Indian Dosage Shorthand & Meal Alignment
- **Numeric Patterns:** `1-0-1`, `1-1-1`, `1-0-0`, `0-0-1`, `0.5-0-0.5`, `½-0-½`, `1-1-1-1`
- **Latin Shorthand:** `OD`/`QD`, `BD`/`BID`, `TDS`/`TID`, `QID`, `HS`/`QHS`/`BT`, `SOS`/`PRN`, `BBF`, `AC`, `PC`
- **IST Default Slot Times & High-Contrast Colors:**
  - `empty_stomach`: `07:00` (`#0284C7`) — also auto-inferred for Levothyroxine (`Thyronorm`/`Eltroxin`) & PPIs (`Pan-D`/`Omez`)
  - `morning`: `07:30` before food / `08:30` after food (`#2563EB`)
  - `afternoon`: `13:00` before food / `14:00` after food (`#D97706`)
  - `evening`: `17:30` (`#7C3AED`)
  - `night`: `20:00` before food / `21:00` after food (`#0F766E`) — auto-preferred for Statins (`Atorva`/`Rosuvas`)
  - `sos`: `00:00` (`#DC2626`)

### Medication Safety Flags
- **`LOW_CONFIDENCE_OCR`** (`warning` -> `highlight_color: "yellow"`): Triggered when `confidence < 0.80` or `low_confidence_fields` is non-empty.
- **`MISSING_STRENGTH`** (`warning`): Triggered when strength (`mg`/`mcg`/`ml`) is missing.
- **High-Alert Geriatric Classes:** Anticoagulants (`Warfarin`, `Acitrom`), `Insulin`, Sulfonylureas (`Glimepiride`, `Amaryl` — also flagged `critical` if `empty_stomach`), `Digoxin`, and `Levothyroxine` empty-stomach timing.
- **Duplicate Active Ingredients / Classes:** Detects duplicate Paracetamol (`Dolo 650` + `Crocin`), NSAIDs, PPIs, Statins, Sulfonylureas, or ARBs/ACEi.
- **Drug-Drug / Timing Interactions:**
  - `INTERACTION_BLEEDING_RISK` (`critical`): Blood thinner + NSAID painkiller
  - `INTERACTION_THYROID_ABSORPTION` (`warning`): Levothyroxine + Calcium/Iron (`Shelcal`) or PPI (4-hour gap required)
  - `INTERACTION_BP_NSAID` (`warning`): ARB/ACEi + NSAID

### Vitals Rule Engine Thresholds
- **Temperature (°F):** `< 95.0` (`critical` hypothermia), `< 97.0` (`caution`), `97.0–99.5` (`normal`), `99.6–100.3` (`caution` low-grade), `100.4–102.9` (`caution` fever), `>= 103.0` (`critical` high fever).
- **Blood Pressure (mmHg):** `< 80/50` (`critical` severe hypotension), `< 90/60` (`caution` low BP), `90–129 / 60–79` (`normal`), `130–139 / 80–89` (`caution` elevated), `140–179 / 90–119` (`caution` stage 2), `>= 180` or `>= 120` (`critical` hypertensive crisis).
- **Weight (kg):** Flags `RAPID_WEIGHT_GAIN` (`+2.0 kg` within 7 days vs prior reading), `RAPID_WEIGHT_LOSS` (`-2.5 kg` within 14 days), and `LOW_WEIGHT` (`< 35.0 kg`).

---

## 6. Frontend Integration & Dual-Mode Client (`frontend/src/lib/api.ts`)

1. **Dual-Mode Operation (`VITE_API_URL`):**
   - **FastAPI Mode (`VITE_API_URL` set, e.g. `http://localhost:8000`):** `frontend/src/lib/api.ts` calls the FastAPI endpoints (`/scan`, `/medicines/confirm`, `/schedule/{share_code}`, `/doses/mark`, `/medicines/{id}`, `/vitals`, `/profile/{share_code}/summary`).
   - **Built-in Preview Mode (`VITE_API_URL` unset):** `scanPrescription()` calls the Express endpoint `POST /api/scan` in `frontend/server.ts`, while schedules, dose logs, vitals, and summaries persist in browser `localStorage` (`frontend/src/utils/storage.ts`) seeded with `DEMO01` defaults from `frontend/src/config.ts`.
   - **DTO Adapter Layer:** `frontend/src/lib/api.ts` translates between the frontend UI types (`frontend/src/types/api.ts`) and FastAPI's Pydantic schemas (`backend/schemas.py`), so both FastAPI mode and Built-in Preview mode share the same React components without modifying the backend.
2. **Nani Mode Audio:** Uses browser `window.speechSynthesis` (`frontend/src/utils/tts.ts`) with `hi-IN`, `mr-IN`, or `en-IN` (matching `active_language`).
3. **Caregiver Yellow Highlighting:** Renders warning borders/badges whenever `needs_review === true` or accuracy is `Medium`/`Low` (`highlight_color === "yellow"` / `"red"` in FastAPI).
4. **Strip Thumbnails:** Uses local asset images in `frontend/src/assets/images/` (or `data:image/...;base64,...` URIs returned by FastAPI `strip_thumbnail`)—no external media server or S3 bucket is needed.
5. **Zero-Auth Demo Flow:** On first load, `share_code` defaults to `"DEMO01"` so users can immediately inspect the schedule, play spoken instructions, mark a dose taken, and open the WhatsApp report.

---

## 7. Setup, Environment & Deployment

### Environment Variables (`backend/.env`)
```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
DATABASE_URL=postgresql://user:password@ep-your-project.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
CORS_ORIGINS=*
DEFAULT_SHARE_CODE=DEMO01
```

### Local Run & Smoke Test

#### Backend (FastAPI)
```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
uvicorn engine:app --reload --port 8000
./test_api.sh
```

#### Frontend (Express + Vite + React)
```bash
cd frontend
npm install
# Optional frontend/.env:
# GEMINI_API_KEY=your_gemini_api_key_here   # Required for /api/scan in built-in preview mode
# VITE_API_URL=http://localhost:8000        # Set to route API calls to FastAPI instead of preview mode
npm run dev
```
The frontend runs on `http://localhost:3000`.

### Cloud Deployment (Neon + Render / Railway)
1. **Neon:** Create a Neon Postgres database, run `backend/schema.sql` in the Neon SQL Editor (optional—`init_db()` also creates tables on startup), and copy the pooled connection string into `DATABASE_URL`.
2. **Render / Railway:** Set root directory to `backend/`, start command from `Procfile` (`uvicorn engine:app --host 0.0.0.0 --port $PORT`), and configure `GEMINI_API_KEY`, `DATABASE_URL`, and `GEMINI_MODEL`.
