# NaniCare

NaniCare is a voice-first medication and wellness companion for Indian families. Caregivers can scan and review prescriptions, while older adults can use a simple shared code to view verified medicine schedules, hear instructions, and record doses. Families can also log health readings and share a daily summary.

> NaniCare is a record-keeping and reminder tool. It does not replace a clinician’s advice. Always confirm prescription details and follow the prescribing clinician’s instructions.

## Features

- **Caregiver mode:** Scan a prescription or medicine strip, review extracted details and safety flags, choose whether to **flush & replace** or **add to existing** schedules, flush/reset schedules, and switch or create elder profiles.
- **Grandparents mode:** View caregiver-verified medicines, see dose timing, hear instructions via Indian neural speech (`POST /tts` for English, Hindi, and Marathi, with browser speech fallback), and mark doses taken.
- **Vitals tracker:** Record temperature, blood pressure, weight, and other readings; review or delete entries and create a WhatsApp-ready daily summary.
- **Shared profiles:** Use a share code (the demo code is `DEMO01`) or create a new profile to connect a family member’s schedule and health records.
- **Accessible interface:** High-contrast medicine cards, light and dark themes, and multilingual audio support.

## Project structure

```text
NaniCare/
├── start.sh     One-command launcher for backend + frontend
├── backend/     FastAPI API, database models, schedule/safety logic, and pytest suite
├── frontend/    React application and Express/Vite development server
└── CONTEXT.md   Local architecture and API handoff notes
```

The backend is a FastAPI service backed by PostgreSQL (Neon) or local SQLite. It handles profile, medicine, dose, vitals, summary, and prescription-scanning APIs. The frontend is a React and TypeScript application. When configured with `VITE_API_URL`, it connects to the FastAPI service; otherwise, it uses its built-in preview behavior.

## Requirements

- Node.js and npm
- Python 3.10 or later
- A Gemini API key for live prescription scanning (the backend also supports demo fallback)
- PostgreSQL/Neon is optional for local development; SQLite is used when no database URL is configured

## Run locally

### Quick start (recommended)

From the repository root, run the single launcher script:

```bash
./start.sh
```

This automatically creates missing `.env` files, sets up `backend/.venv`, installs backend and frontend dependencies if needed, and starts both the FastAPI backend (`http://localhost:8000`) and the frontend (`http://localhost:3000`). Press `Ctrl+C` to stop both servers.

Useful flags:

```bash
./start.sh --open       # Start both servers and open http://localhost:3000
./start.sh --setup      # Install dependencies and verify .env files without starting
./start.sh --no-reload  # Run uvicorn without auto-reload
```

### Manual setup (two terminals)

Open two terminals from the repository root.

### 1. Start the backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` and set `GEMINI_API_KEY` for live scanning. You can leave `DATABASE_URL` unset to use the local SQLite database. Then install dependencies and start the API:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn engine:app --reload --port 8000
```

The API will be available at [http://localhost:8000](http://localhost:8000). Interactive API documentation is at [http://localhost:8000/docs](http://localhost:8000/docs). On startup, the backend creates its tables and seeds the `DEMO01` profile.

### 2. Start the frontend

In another terminal, from the repository root:

```bash
cd frontend
npm install
```

To connect the frontend to the FastAPI backend, create `frontend/.env` with:

```env
VITE_API_URL=http://localhost:8000
```

Then start the frontend:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm install` only installs dependencies; `npm run dev` starts the app. If you leave `VITE_API_URL` unset, the frontend uses its built-in preview mode. In that mode, scanning needs `GEMINI_API_KEY` in `frontend/.env`.

## Configuration

Backend settings are read from `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Enables live prescription scanning. |
| `GEMINI_MODEL` | Gemini model name; defaults to `gemini-3.5-flash` (with automatic fallback). |
| `DATABASE_URL` | PostgreSQL/Neon connection string. Unset or placeholder values use SQLite locally. |
| `CORS_ORIGINS` | Allowed frontend origins; configure this for your deployment. |
| `DEFAULT_SHARE_CODE` | Demo profile code; defaults to `DEMO01`. |

Frontend settings are read from `frontend/.env`:

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | FastAPI base URL. Leave unset to use built-in preview behavior. |
| `GEMINI_API_KEY` | Required for prescription scanning in built-in preview mode. |

## Main backend endpoints

FastAPI exposes interactive documentation at `/docs`. Endpoints include:

- `GET /health` and `POST /demo/seed` — service/database status and `DEMO01` seed/reset
- `GET /scan/demo` and `POST /scan` — demo or Gemini Vision prescription/strip extraction
- `GET /profiles`, `POST /profile`, and `GET /profile/{share_code}` — list, create/update, and fetch elder profiles
- `POST /medicines/confirm`, `GET /medicines/{share_code}`, `PATCH /medicines/{medicine_id}`, `DELETE /medicines/{medicine_id}`, and `DELETE /profile/{share_code}/medicines` — confirm (replace or append), list, edit, remove, or flush schedules
- `GET /schedule/{share_code}`, `POST /doses/mark`, `GET /doses/{share_code}`, and `POST /tts` — daily schedule cards, dose tracking, and neural MP3 speech synthesis (`en`/`hi`/`mr`)
- `POST /vitals`, `GET /vitals/{share_code}`, and `DELETE /vitals/{vital_id}` — record, retrieve, and delete vitals
- `GET /profile/{share_code}/summary` — daily adherence and vitals summary with WhatsApp deep link

## Useful commands

From `frontend/`:

```bash
npm run dev      # Start the Express/Vite development server
npm run build    # Build the frontend into dist/
npm run preview  # Preview the Vite build
npm run lint     # Run TypeScript type checking
```

From `backend/` with the virtual environment active:

```bash
./test_api.sh                       # Run all 14 API smoke checks (backend must be running)
pip install -r requirements-dev.txt # Install pytest + httpx for automated tests
pytest tests/test_backend.py -v     # Run unit and API integration tests
```

## Deployment notes

- The backend includes a `Procfile` for platforms such as Render or Railway. Configure the service root as `backend/` and provide the required environment variables.
- For a hosted database, set `DATABASE_URL` to a PostgreSQL connection string. `backend/schema.sql` contains the database DDL; the application also initializes tables on startup.
- Build the frontend with `npm run build` in `frontend/`. Its Express server serves the `dist/` directory when run with `NODE_ENV=production`.

See [CONTEXT.md](CONTEXT.md) for the detailed architecture, data model, API contract, and scheduling and safety rules.
