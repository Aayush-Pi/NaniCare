# NaniCare

> **A voice-first, Assistive Access–inspired medication safety companion for older adults — paired with an AI prescription verification gate and vitals dashboard for their families.**

**Live App:** [https://nani-care.vercel.app](https://nani-care.vercel.app/) *(Demo Share Code: `DEMO01`)* · **Backend API Docs:** [https://nanicare.onrender.com/docs](https://nanicare.onrender.com/docs)

**Jump to:**
[Why NaniCare Is Needed](#why-nanicare-is-needed) · [How It Works](#how-it-works) · [Key Features](#key-features) · [Project Structure](#project-structure) · [Quick Start](#run-locally) · [API Reference](#backend-api-endpoints) · [Testing](#testing--verification) · [Deployment](#deployment--ci)

> **Clinical Disclaimer:** NaniCare is a medication organization, visual identification, and adherence tool. It does not replace a licensed clinician's judgment. Always confirm extracted details against the original prescription and follow your doctor's instructions.

---

## Why NaniCare Is Needed

Millions of older adults manage complex daily pill regimens alone — often with declining eyesight, memory lapses, look-alike foil strips, and tiny English labels printed on prescriptions they cannot read.

| The Problem in Numbers | Source |
| :--- | :--- |
| **~50% adherence globally:** Only half of patients with chronic illnesses take medicines as prescribed — and rates drop lower in developing nations. | World Health Organization (WHO), *Adherence to Long-Term Therapies* |
| **75% chronic burden in India:** Around **3 in 4** older Indians live with at least one chronic condition, and **over 33%** in urban cohorts juggle polypharmacy (5+ daily medicines). | *Longitudinal Ageing Study in India (LASI Wave-1)* & PIB / NIH studies |
| **8.5% living alone:** Rapid urbanization and nuclear families leave roughly **1 in 12** older Indians ageing solo without daily bedside help to sort morning vs. night pills. | *LASI* secondary demographic analyses |
| **600,000+ ER visits & ~100,000 hospitalizations/year (65+):** Older adults are **~7× more likely** to be hospitalized after an adverse drug event than younger adults — roughly **two-thirds** caused by unintentional dosing errors. | U.S. Centers for Disease Control and Prevention (CDC, NEISS-CADES) |

**The real gap:** Caregiver apps give charts to young adults, while senior citizens are handed cluttered, tiny-font dashboards — or raw AI chatbots that can hallucinate dosages. **NaniCare bridges both sides:** AI accelerates data entry for the family caregiver, a **human verification gate** blocks unsafe guesses, and the grandparent gets a calm, big-tile visual & voice companion in **Hindi, Marathi, or English**.

---

## How It Works

```text
  [1. Family Caregiver]           [2. Verification Gate]           [3. Older Adult (Assistive Mode)]
  Upload Rx / pill strip  ──▶  AI rates confidence + flags    ──▶  Unlocks ONLY verified pills via 6-char
  via Gemini Vision             Yellow (unclear) / Red (allergy)   Share Code (e.g. DEMO01)
                                          │
                                          ▼
  [4. Daily Family Loop] ◀── Tap green "I Took It" / Speak / Camera Check ◀── Visual strip + Pill size/color TTS
  Vitals SVG Graphs, Refill Alerts & 1-Tap WhatsApp Daily Summary
```

1. **Scan & Flag ([Caregiver Mode](frontend/src/pages/caregiver/index.tsx)):** A family member snaps a prescription or blister strip (`POST /scan`). [backend/engine.py](backend/engine.py) extracts medicines and runs [backend/scheduler.py](backend/scheduler.py) to flag handwritten ambiguities in **amber** and allergy/drug conflicts in **red**.
2. **Verify & Publish ([ReviewMedicineCard.tsx](frontend/src/components/ReviewMedicineCard.tsx)):** Unverified drafts are strictly blocked from the elder's phone. Once the caregiver confirms each medicine, NaniCare generates IST dosage slots, **0-token SVG strip previews** ([backend/visuals.py](backend/visuals.py)), and spoken EN/HI/MR scripts describing **pill size, color, shape, and strip color**.
3. **Guided Elder Routine ([Grandparents Mode](frontend/src/pages/nani/index.tsx)):** Modeled after **Apple iOS 17 Assistive Access**, the elder enters a 6-character code (`DEMO01`) and sees distraction-free big tiles (`Medicines Now`, `Today's List`, `Hear Medicines`, `Check My Pill`, `Talk`, `Call Family`). They can listen in their native language, match pills by camera (`POST /scan/verify-strip`), or tap the big green **"I Took It"** button.
4. **Monitor & Share ([Vitals & Refills](frontend/src/pages/vitals/index.tsx)):** Every dose and vital reading updates live **Blood Pressure, Temperature, Weight, and 7-day Adherence** graphs ([VitalsCharts.tsx](frontend/src/components/VitalsCharts.tsx)), triggers refill countdowns, and builds a 1-tap **WhatsApp Daily Family Report** (`GET /profile/{share_code}/summary`).

---

## Key Features

### 1. Grandparents Mode (iOS 17 Assistive Access–Inspired UX)
- **Zero-Login Share Code Access:** Connects directly via a 6-character family code (default `DEMO01` for Kamla Sharma) — no passwords, emails, or OTPs.
- **Distraction-Free Full-Screen Chrome:** Hides navigation bars and footers inside [App.tsx](frontend/src/App.tsx) when Grandparents Mode is active, leaving only oversized tiles and one prominent **Back** button (`Escape` supported).
- **One Task Per Screen:**
  - **Medicines Now:** Shows one medicine at a time for the active slot with dot progress indicators and Next/Back controls ([NaniMedicineCard.tsx](frontend/src/components/NaniMedicineCard.tsx)).
  - **Today's List:** Scrollable daily checklist grouped by Morning, Afternoon, and Night with strip pictures and instant green toggles.
  - **Hear Medicines / Stop:** Neural Indian MP3 speech (`POST /tts`) with background prefetching ([tts.ts](frontend/src/utils/tts.ts)) and browser `speechSynthesis` fallback.
  - **Check My Pill (Camera):** Snaps a pill strip (`POST /scan/verify-strip`) and gives a clear green **YES** or red **STOP** verdict aloud.
  - **Talk (Hands-Free Voice Commands):** Listens in `en-IN`, `hi-IN`, or `mr-IN` for keywords like *"Morning"*, *"Night"*, *"Taken"*, *"Help"*, or regional equivalents (`सुबह`, `रात`, `लिया`, `मदद`, `सकाळ`, `रात्र`, `घेतले`, `मदत`).
  - **Call Family:** Pre-filled `tel:` emergency dialer and 1-tap WhatsApp SOS alert ([whatsapp.ts](frontend/src/utils/whatsapp.ts)).
  - **Settings:** Root `rem` text scaling (`A` / `A` / `A`), **AAA High Contrast** toggle (4px black/white borders), **Grid vs. Rows** layout switcher, language switcher (`English` / `हिन्दी` / `मराठी`), and Share Code loader.
- **Non-Textual Visual Cues:** Sunrise / Sun / Moon icons for time of day, pill-before-plate / plate-before-pill meal pictograms (`Before Food`, `After Food`, `With Food`), tablet-count icons, completion dots, and haptic vibration on confirm.

### 2. Caregiver Mode (Dual AI Accuracy & Verification Gate)
- **Quick Family Profile Setup ([ModeSelect.tsx](frontend/src/components/ModeSelect.tsx)):** Create an elder profile or load an existing Share Code (or `DEMO01`) right from the start screen.
- **Gemini Vision Extraction ([prompts.py](backend/prompts.py)):** Defaults to `gemini-3.5-flash` with fallback chain (`gemini-3.8-flash` → `gemini-3.5-flash` → `gemini-3.5-flash-lite`), Pydantic structured outputs ([schemas.py](backend/schemas.py)), and automatic demo fallback when no key is set.
- **Clinical Safety Cross-Checks ([scheduler.py](backend/scheduler.py)):** Flags low-confidence OCR (`confidence < 0.80`), missing strengths, `ALLERGY_CONFLICT` against patient allergies, duplicate drug classes, high-alert geriatric drugs (Warfarin, Insulin, Digoxin, Sulfonylureas), and timing interactions (e.g. Levothyroxine vs. Calcium/Iron/PPIs).
- **Schedule Control:** Replace or append schedules, inline edit medicines (`PATCH /medicines/{medicine_id}`), delete items, flush all active prescriptions, or reset `DEMO01`.

### 3. Visual Medicine Catalog & SVG Engine (0 AI Tokens)
- **60-Entry Indian Medicines Catalog ([indian_medicines_catalog.json](backend/data/indian_medicines_catalog.json)):** Auto-seeded into `medicine_catalog` covering common Indian brands (*Thyronorm*, *Glycomet-500*, *Amlong-5*, *Atorva-10*, *Dolo 650*, *Pan-D*, *Augmentin*, *Telma*, *Shelcal*, *Ecosprin*, etc.).
- **Deterministic Vector Strip Illustrations ([backend/visuals.py](backend/visuals.py)):** Renders compact inline `data:image/svg+xml` foil-strip previews displayed cleanly in [StripImage.tsx](frontend/src/components/StripImage.tsx).
- **Elder-Friendly Voice Scripts:** Speaks each tablet/capsule's **size, color, shape, and strip color** in respectful, gender-neutral EN/HI/MR (`"Please take..."` / `"कृपया ... लीजिए"` / `"कृपया ... घ्या"`).

### 4. Vitals Tracker, Trend Graphs, Refills & Family WhatsApp Loop
- **WCAG-Compliant SVG Charts ([VitalsCharts.tsx](frontend/src/components/VitalsCharts.tsx)):** Interactive-width line charts for **Blood Pressure**, **Temperature** (with shaded normal range), **Weight**, and a **7-day Adherence** bar chart (`GET /profile/{share_code}/trends`) — with distinct line patterns/shapes and full screen-reader `<table>` alternatives.
- **Clinical Vital Alerts & Refills:** Flags fever, hypothermia, hypertension stages, rapid weight shifts (`+2.0 kg / 7d` or `-2.5 kg / 14d`), and low weight, alongside course-completion alerts (`GET /profile/{share_code}/refills`).
- **Mobile-First Navigation ([TopBar.tsx](frontend/src/components/TopBar.tsx) & [VitalsLogger.tsx](frontend/src/components/VitalsLogger.tsx)):** Sticky safe-area mobile bottom navigation (`< 768px`) and stacked mobile vitals cards.

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
- **Gemini API Key** (optional for local testing — demo fallbacks work automatically without one)
- **Neon PostgreSQL** (optional for local testing — falls back automatically to `backend/nanicare_local.db` SQLite)

---

## Run Locally

### Quick Start (Recommended)

From the repository root, run [start.sh](start.sh):

```bash
./start.sh
```

`start.sh` automatically creates missing `.env` files, initializes `backend/.venv`, installs dependencies when requirements/lockfiles change, waits for `/health`, and starts both servers:

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

On startup, `init_db()` idempotently creates all 5 tables, seeds the 60-entry `medicine_catalog`, and seeds `DEMO01` (**Kamla Sharma**, 5 medicines, 1 morning dose marked, 2 baseline vitals).

#### 2. Frontend (React + Express/Vite)

```bash
cd frontend
npm install
printf 'VITE_API_URL=http://localhost:8000\n' > .env
npm run dev
```

Frontend operating modes (`frontend/.env`):
- **Connected to FastAPI (`VITE_API_URL=http://localhost:8000`):** Full database persistence, neural `edge-tts` audio, SVG visual catalog, refill tracker, trend charts, and camera strip verification.
- **Offline Mock Mode (`VITE_USE_MOCK_DATA=true`, `VITE_API_URL` unset):** Serves [devMockData.json](frontend/src/mocks/devMockData.json) with browser `localStorage` persistence.
- **Built-in Express Preview (both unset):** Uses `POST /api/scan` in [server.ts](frontend/server.ts) (requires `GEMINI_API_KEY` in `frontend/.env`).

---

## Configuration Reference

### Backend ([backend/.env.example](backend/.env.example))

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google AI Studio key for live prescription & strip vision extraction. | Unset (demo fallback enabled) |
| `GEMINI_MODEL` | Primary Gemini Vision model (`gemini-3.8-flash` / `gemini-3.5-flash` / `gemini-3.5-flash-lite` fallback chain). | `gemini-3.5-flash` |
| `DATABASE_URL` | Neon PostgreSQL connection string (`?sslmode=require` enforced for `*.neon.tech`). | Unset (`sqlite:///./nanicare_local.db`) |
| `CORS_ORIGINS` | Comma-separated allowed origins (or `*`). | `*` |
| `DEFAULT_SHARE_CODE` | Auto-seeded demo profile code. | `DEMO01` |

### Frontend ([frontend/.env.example](frontend/.env.example))

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `VITE_API_URL` | FastAPI backend base URL (e.g. `http://localhost:8000`). | Unset |
| `VITE_USE_MOCK_DATA` | Set to `true` for offline mock scans without FastAPI or Gemini key. | `false` |
| `GEMINI_API_KEY` | Required only in standalone Express preview mode (`/api/scan`). | Unset |

---

## Backend API Endpoints

Full interactive schemas are served by [backend/engine.py](backend/engine.py) at `/docs`.

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
pytest -q                # Runs the 13-test unit & integration suite in backend/tests/test_backend.py
./test_api.sh            # Runs all 18 curl smoke checks against http://127.0.0.1:8000
```

See [test_backend.py](backend/tests/test_backend.py) and [test_api.sh](backend/test_api.sh).

### Frontend Checks

```bash
cd frontend
npm run lint             # TypeScript type checking (tsc --noEmit)
npm run build            # Production Vite bundle -> dist/
npm run preview          # Preview production build
```

---

## Deployment & CI

- **Single Integrated Branch:** `main` is the single active branch. CodeQL (`javascript-typescript` and `python`) runs automatically via [codeql.yml](.github/workflows/codeql.yml) on push, PR, and weekly schedule.
- **Database (Neon):** Run [backend/schema.sql](backend/schema.sql) in the Neon SQL Editor (or let `init_db()` create tables at startup) and configure `DATABASE_URL` with `?sslmode=require`.
- **Backend (Render / Railway):** Set root directory to `backend/`, start command from [backend/Procfile](backend/Procfile) (`uvicorn engine:app --host 0.0.0.0 --port $PORT`), and set `GEMINI_API_KEY`, `DATABASE_URL`, `GEMINI_MODEL=gemini-3.5-flash`, and `CORS_ORIGINS`.
- **Frontend (Vercel / Render):** Set root directory to `frontend/`, build command `npm run build`, output directory `dist/`, and set `VITE_API_URL` to your deployed FastAPI URL (or run `NODE_ENV=production npm start` with [frontend/server.ts](frontend/server.ts)).

See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for a step-by-step live demo walkthrough.
