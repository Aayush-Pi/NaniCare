# NaniCare

**NaniCare** is a voice-first, WCAG-accessible medication safety, prescription verification, and vitals companion built for Indian families. Caregivers can scan printed or handwritten prescriptions and medicine blister strips, review AI-extracted confidence flags and clinical interaction alerts, and publish verified regimens. Older adults get an **Apple iOS 17 Assistive Access–style** interface accessed via a simple 6-character share code (`DEMO01` out of the box), featuring oversized tiles, non-textual visual cues, green dose-confirmation buttons, camera strip verification, and natural Indian-accented voice instructions in **English, Hindi, and Marathi**.

> **Disclaimer:** NaniCare is a medication organization, visual identification, and reminder tool. It does not replace a licensed clinician's judgment. Always verify extracted details against the original prescription and follow your doctor's advice.

---

## Key Features

### 1. Grandparents Mode (iOS 17 Assistive Access–Inspired UX)
- **Zero-Login Share Code Access:** Connects directly via a 6-character family code (e.g., `DEMO01` for Kamla Sharma) with no passwords or OTPs.
- **Distraction-Free Full-Screen Chrome:** Hides navigation bars and footers when Grandparents Mode is active so elders see only large high-contrast tiles and a single prominent **Back** button (`Escape` supported).
- **One Task Per Screen:**
  - **Medicines Now:** Steps through the current time slot's medicines one focused card at a time with progress dots and Next/Back controls.
  - **Today's List:** Full scrollable checklist grouped by **Morning**, **Afternoon**, and **Night** with strip thumbnails and instant toggle buttons.
  - **Hear Medicines / Stop:** Speaks verified schedules aloud with pre-warmed neural audio caching.
  - **Check My Pill (Camera):** Snaps or uploads a blister strip photo (`POST /scan/verify-strip`) for an immediate green **YES** / red **STOP** safety match with spoken feedback.
  - **Talk (Hands-Free Voice Commands):** Uses browser Speech Recognition (`en-IN`, `hi-IN`, `mr-IN`) so elders can say *"Morning"*, *"Night"*, *"Taken"*, *"Help"*, or regional equivalents (`सुबह`, `रात`, `लिया`, `मदद`, `सकाळ`, `रात्र`, `घेतले`, `मदत`).
  - **Call Family:** One-tap `tel:` phone dialer and pre-filled WhatsApp emergency SOS link.
  - **Settings:** Root `rem` text scaling (`A` / `A` / `A`), **AAA High Contrast** toggle (4px black/white borders), **Grid vs. Rows** home layout switch, language selector (`English` / `हिन्दी` / `मराठी`), and Share Code switcher.
- **Non-Textual Visual Cues:** Sunrise / Sun / Moon icons for time of day, pill-before-plate / plate-before-pill pictograms for meal timing (`Before Food`, `After Food`, `With Food`), tablet-count pill icons, completion dot tracker, and unmistakable **green "I Took It" (`✓`)** buttons with haptic feedback.
- **Safety Invariant:** Grandparents Mode renders and speaks **only** caregiver-verified medicines (`caregiver_verified === true`).

### 2. Caregiver Mode (Dual AI Accuracy & Verification Gate)
- **Quick Family Profile Setup & Switcher:** Create new elder profiles (name, language, caregiver phone, optional custom share code) directly from the workspace home screen or switch across existing profiles (`GET /profiles`, `POST /profile`).
- **Gemini Vision Prescription & Strip Scanner (`POST /scan`):** Uses `gemini-3.5-flash` (with automatic fallback `gemini-3.8-flash` → `gemini-3.5-flash` → `gemini-3.5-flash-lite`) and strict Pydantic structured outputs, plus automatic demo fallback when no API key is configured.
- **Two-Layer Verification Gate:**
  - **Layer 1 (AI Confidence & Clinical Highlighting):** Confidence `< 0.80` or unreadable handwritten fields are flagged **Medium/Low** (`highlight_color: "yellow"`). Allergy or severe drug-interaction conflicts are flagged **critical** (`highlight_color: "red"`).
  - **Layer 2 (Mandatory Caregiver Confirmation):** Items remain locked out of Grandparents Mode until a caregiver clicks **Confirm Manually Verified**.
- **Flexible Schedule Publishing:** Choose **Replace existing** (`replace_existing: true`) or **Add to existing** (`replace_existing: false`), edit confirmed medicines (`PATCH /medicines/{medicine_id}`), remove individual items, clear a schedule (`DELETE /profile/{share_code}/medicines`), or reset `DEMO01`.

### 3. Visual Medicine Catalog & Deterministic SVG Engine (0 AI Tokens)
- **60-Entry Indian Medicines Catalog:** Pre-seeded `medicine_catalog` table (`backend/data/indian_medicines_catalog.json`) covering common Indian prescriptions (e.g., *Thyronorm*, *Glycomet-500*, *Amlong-5*, *Atorva-10*, *Dolo 650*, *Pan-D*, *Augmentin*, *Telma*, *Shelcal*, *Ecosprin*, etc.).
- **Deterministic Vector Strip Thumbnails (`backend/visuals.py`):** Generates lightweight inline SVG pill-strip illustrations (`data:image/svg+xml`) from a compact 6-field `VisualSpec` rendered unclipped in [StripImage.tsx](frontend/src/components/StripImage.tsx).
- **Descriptive Elder Audio:** Spoken EN/HI/MR scripts describe each pill's **size, color, shape, and strip color** (e.g., *"1 small pale yellow round tablet in the sky blue strip"*), using respectful gender-neutral phrasing (`"Please take..."` / `"कृपया ... लीजिए"` / `"कृपया ... घ्या"`).

### 4. Vitals Tracker, Trend Graphs, Refills & Family WhatsApp Loop
- **Clinical Rule Engine (`backend/scheduler.py`):** Flags hypothermia/fever, hypotension/hypertension stages, hypertensive crisis, rapid weight gain (`+2.0 kg / 7d`), rapid weight loss (`-2.5 kg / 14d`), and low weight (`< 35 kg`), plus drug-allergy (`ALLERGY_CONFLICT`), duplicate drug classes, and absorption/bleeding interactions.
- **Responsive Trend Graphs (`frontend/src/components/VitalsCharts.tsx`):** Pure SVG line charts for **Blood Pressure** (systolic circles + diastolic dashed squares), **Temperature** (with green normal-range band), **Weight**, and a **7-day Adherence** bar chart (`GET /profile/{share_code}/trends`), complete with out-of-range red markers and screen-reader `<table>` alternatives.
- **Refill Countdown (`GET /profile/{share_code}/refills`):** Tracks elapsed days vs. course duration and surfaces `refill_soon` / `completed` alerts in the Vitals dashboard and WhatsApp summary.
- **1-Tap Family Report (`GET /profile/{share_code}/summary`):** Compiles adherence, taken/pending/missed doses, latest vitals, active alerts, and a ready-to-send `https://wa.me/?text=...` WhatsApp deep link.

---

## Project Structure

```text
NaniCare/
├── .github/workflows/
│   └── codeql.yml                     # CodeQL workflow (javascript-typescript & python on main)
├── start.sh                           # One-command setup & launcher (backend :8000 + frontend :3000)
├── README.md
├── docs/
│   └── DEMO_SCRIPT.md                 # Hackathon demo runbook
├── backend/
│   ├── data/
│   │   └── indian_medicines_catalog.json # 60 common Indian medicines + VisualSpec metadata
│   ├── engine.py                      # FastAPI app, startup seed, Gemini scan, TTS, all REST endpoints
│   ├── database.py                    # Neon PostgreSQL SQLAlchemy 2.0 engine + local SQLite fallback
│   ├── models.py                      # ORM models (profiles, medicines, dose_logs, vitals_logs, medicine_catalog)
│   ├── schemas.py                     # Strict Pydantic v2 schemas for Gemini & API I/O
│   ├── scheduler.py                   # Deterministic IST slots, clinical rules, interactions, WhatsApp builder
│   ├── visuals.py                     # SVG strip renderer + EN/HI/MR visual pill descriptions
│   ├── prompts.py                     # Gemini Vision system prompt & DEMO01 profile seed
│   ├── schema.sql                     # Idempotent PostgreSQL DDL matching models.py
│   ├── requirements.txt               # Production dependencies (FastAPI, SQLAlchemy, google-genai, edge-tts)
│   ├── requirements-dev.txt           # Test dependencies (pytest, httpx)
│   ├── .env.example
│   ├── Procfile                       # Cloud start command: uvicorn engine:app --host 0.0.0.0 --port $PORT
│   ├── test_api.sh                    # 18-step end-to-end curl smoke-test script
│   └── tests/
│       └── test_backend.py            # 13-test Pytest unit + FastAPI TestClient integration suite
└── frontend/
    ├── server.ts                      # Express + Vite server (:3000) with standalone /api/scan & /api/health
    ├── vite.config.ts
    ├── package.json
    ├── index.html
    ├── .env.example
    └── src/
        ├── App.tsx                    # Root state, skip link, chrome hiding in Assistive Access mode
        ├── index.css                  # Native system font stack, focus-visible rings & reduced-motion rules
        ├── config.ts                  # Fallback DEMO01 seeds, language locales & vitals ranges
        ├── assets/images/             # Sample clinic prescription & blister strip images
        ├── lib/api.ts                 # Dual-mode API adapter (FastAPI, standalone preview, or offline mock)
        ├── mocks/devMockData.json     # Offline JSON fixtures
        ├── pages/
        │   ├── caregiver/index.tsx    # Scanner, Verification Gate, Schedule manager & Emergency contact
        │   ├── nani/index.tsx         # iOS 17 Assistive Access–style Grandparents Mode (6 screens)
        │   └── vitals/index.tsx       # Vitals form/history, SVG charts, refill tracker & WhatsApp report
        ├── components/
        │   ├── ModeSelect.tsx         # Workspace launcher, Quick Family Profile Setup & DEMO01 button
        │   ├── TopBar.tsx             # Desktop header + sticky mobile bottom navigation (< 768px)
        │   ├── PrescriptionScanner.tsx
        │   ├── ReviewMedicineCard.tsx
        │   ├── NaniMedicineCard.tsx   # SlotIcon, MealCue, DoseCount & MedicineFocusCard
        │   ├── StripImage.tsx         # Unclipped SVG data URI + image thumbnail renderer
        │   ├── VitalsCharts.tsx       # Responsive SVG trend charts + screen-reader tables
        │   ├── VitalsLogger.tsx       # Mobile card list + desktop vitals history table
        │   └── WhatsAppSummaryCard.tsx
        ├── types/api.ts
        └── utils/                     # scheduler.ts, storage.ts, tts.ts, whatsapp.ts
```

---

## Requirements

- **Node.js** (v18+ recommended) and **npm**
- **Python 3.10+**
- **Gemini API Key** (optional for local development — both backend and frontend have automatic demo/mock fallbacks)
- **Neon PostgreSQL** (optional for local development — automatically falls back to `backend/nanicare_local.db` SQLite when `DATABASE_URL` is unset or placeholder)

---

## Run Locally

### Quick Start (Recommended)

From the repository root:

```bash
./start.sh
```

`start.sh` automatically creates missing `.env` files, initializes `backend/.venv`, installs Python and Node dependencies when lockfiles/requirements change, waits for `/health`, and starts both servers:

- **Frontend App:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:8000](http://localhost:8000)
- **Swagger / OpenAPI Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

Useful flags:

```bash
./start.sh --open       # Start both servers and open http://localhost:3000
./start.sh --setup      # Install dependencies and verify .env files without launching servers
./start.sh --no-reload  # Run uvicorn without --reload
```

### Manual Setup (Two Terminals)

#### 1. Backend (FastAPI)

```bash
cd backend
cp .env.example .env
# Optional: set GEMINI_API_KEY and DATABASE_URL in backend/.env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn engine:app --reload --port 8000
```

On startup, `init_db()` idempotently creates all 5 tables, seeds the 60-entry `medicine_catalog`, and seeds the `DEMO01` profile (**Kamla Sharma**, 5 medicines, 1 morning dose marked, 2 baseline vitals).

#### 2. Frontend (React + Express/Vite)

```bash
cd frontend
npm install
# Connect to FastAPI:
printf 'VITE_API_URL=http://localhost:8000\n' > .env
npm run dev
```

Frontend operating modes (`frontend/.env`):
- **Connected to FastAPI (`VITE_API_URL=http://localhost:8000`):** Uses all FastAPI routes including database persistence, neural `edge-tts` audio, SVG visual catalog, refill tracker, trend charts, and camera strip verification.
- **Offline Mock Mode (`VITE_USE_MOCK_DATA=true`, `VITE_API_URL` unset):** Serves `frontend/src/mocks/devMockData.json` and stores schedules/vitals in browser `localStorage`.
- **Built-in Express Preview (both unset):** Uses `POST /api/scan` in [frontend/server.ts](frontend/server.ts) (requires `GEMINI_API_KEY` in `frontend/.env`) with `localStorage` persistence.

---

## Configuration Reference

### Backend (`backend/.env`)

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google AI Studio key for live prescription & strip vision extraction. | Unset (demo fallback enabled) |
| `GEMINI_MODEL` | Primary Gemini Vision model (`gemini-3.8-flash` / `gemini-3.5-flash` / `gemini-3.5-flash-lite` fallback chain). | `gemini-3.5-flash` |
| `DATABASE_URL` | Neon PostgreSQL connection string (`?sslmode=require` enforced for `*.neon.tech`). | Unset (`sqlite:///./nanicare_local.db`) |
| `CORS_ORIGINS` | Comma-separated allowed origins (or `*`). | `*` |
| `DEFAULT_SHARE_CODE` | Auto-seeded demo profile code. | `DEMO01` |

### Frontend (`frontend/.env`)

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `VITE_API_URL` | FastAPI backend base URL (e.g. `http://localhost:8000`). | Unset |
| `VITE_USE_MOCK_DATA` | Set to `true` for offline mock scans without FastAPI or Gemini key. | `false` |
| `GEMINI_API_KEY` | Required only in standalone Express preview mode (`/api/scan`). | Unset |

---

## Backend API Endpoints

Full interactive schemas are available at `/docs`.

### System & Demo
- `GET /` — Service metadata & `/docs` link
- `GET /health` — DB backend probe (`postgresql` vs `sqlite`), Gemini status, IST server time
- `POST /demo/seed?reset=false` — Seed or reset `DEMO01`

### Caregiver Mode & Visual Catalog
- `GET /scan/demo` — Sample extraction payload
- `POST /scan` — Multipart image extraction (`file`, `demo`, `allergies_json`) with confidence scores, `yellow`/`red` flags, and SVG/photo thumbnails
- `POST /medicines/confirm` — Save verified medicines (`replace_existing` supported) with IST slots, visual EN/HI/MR TTS instructions & regimen interaction checks
- `GET /medicines/{share_code}` — List profile medicines (`?include_inactive=true`)
- `PATCH /medicines/{medicine_id}` — Update medicine dosage/timing and recompute flags
- `DELETE /medicines/{medicine_id}` — Soft-deactivate one medicine
- `DELETE /profile/{share_code}/medicines` — Flush all active medicines for a profile
- `GET /catalog/search?q=...` & `POST /catalog/lookup` — Search/resolve visual pill specs + SVG previews

### Profiles, Grandparents Mode & Neural TTS
- `GET /profiles`, `POST /profile`, `GET /profile/{share_code}` — List, create/update (auto-generates 6-char share code), and fetch elder profiles
- `GET /schedule/{share_code}` — Verified schedule cards (`?schedule_date=YYYY-MM-DD&lang=hi|mr|en`)
- `POST /doses/mark` & `GET /doses/{share_code}` — Idempotent IST daily dose logging (supports slot aliases)
- `POST /scan/verify-strip` — Camera blister-strip safety match against active verified medicines + spoken EN/HI/MR response
- `POST /tts` — Synthesizes Indian neural MP3 speech (`en-IN-NeerjaNeural`, `hi-IN-SwaraNeural`, `mr-IN-AarohiNeural`) via `edge-tts` with LRU cache & in-flight deduplication

### Vitals, Trends, Refills & Family Loop
- `POST /vitals`, `GET /vitals/{share_code}`, `DELETE /vitals/{vital_id}` — Log, list, and delete vitals with deterministic risk flags
- `GET /profile/{share_code}/summary` — Daily adherence & vitals report with `refill_alerts`, `whatsapp_message`, and `https://wa.me/?text=...` deep link
- `GET /profile/{share_code}/refills` — Per-medicine course countdown & localized refill messages
- `GET /profile/{share_code}/trends?days=7` — Multi-day adherence history & vitals trend direction summary

---

## Testing & Verification

### Backend Tests

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest -q                # Runs the 13-test unit & integration suite in tests/test_backend.py
./test_api.sh            # Runs all 18 curl smoke checks against http://127.0.0.1:8000
```

### Frontend Checks

```bash
cd frontend
npm run lint             # TypeScript type checking (tsc --noEmit)
npm run build            # Production Vite bundle -> dist/
npm run preview          # Preview production build
```

---

## Deployment & CI

- **Single Integrated Branch:** `main` is the single active branch. CodeQL (`javascript-typescript` and `python`) runs automatically via [.github/workflows/codeql.yml](.github/workflows/codeql.yml) on push, PR, and weekly schedule.
- **Database (Neon):** Run [backend/schema.sql](backend/schema.sql) in the Neon SQL Editor (or let `init_db()` create tables at startup) and configure `DATABASE_URL` with `?sslmode=require`.
- **Backend (Render / Railway):** Set root directory to `backend/`, start command from [backend/Procfile](backend/Procfile) (`uvicorn engine:app --host 0.0.0.0 --port $PORT`), and set `GEMINI_API_KEY`, `DATABASE_URL`, `GEMINI_MODEL=gemini-3.5-flash`, and `CORS_ORIGINS`.
- **Frontend (Vercel / Render):** Set root directory to `frontend/`, build command `npm run build`, output directory `dist/`, and set `VITE_API_URL` to your deployed FastAPI URL (or run `NODE_ENV=production npm start` with [frontend/server.ts](frontend/server.ts)).

See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for a step-by-step live demo walkthrough.
