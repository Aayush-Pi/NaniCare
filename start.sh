#!/usr/bin/env bash
# =============================================================================
# NaniCare One-Command Launcher
# Sets up .env files, Python venv, Node dependencies, and starts both:
#   - Backend  (FastAPI)  -> http://localhost:8000  (Docs: /docs)
#   - Frontend (Vite/TSX) -> http://localhost:3000
#
# Usage:
#   ./start.sh              # Setup (if needed) + start backend & frontend
#   ./start.sh --open       # Also open http://localhost:3000 in browser
#   ./start.sh --setup      # Install dependencies & check .env files only
#   ./start.sh --no-reload  # Run uvicorn without --reload
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
VENV_DIR="${BACKEND_DIR}/.venv"

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

SETUP_ONLY=false
OPEN_BROWSER=false
RELOAD_FLAG="--reload"

for arg in "$@"; do
  case "$arg" in
    --setup)
      SETUP_ONLY=true
      ;;
    --open)
      OPEN_BROWSER=true
      ;;
    --no-reload)
      RELOAD_FLAG=""
      ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Run ./start.sh --help for usage."
      exit 1
      ;;
  esac
done

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    cksum "$1" | awk '{print $1 "-" $2}'
  fi
}

check_port_free() {
  local port="$1"
  local label="$2"
  if command -v lsof >/dev/null 2>&1; then
    local pid
    pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      echo "Error: Port ${port} (${label}) is already in use by PID ${pid}."
      echo "Stop that process first (e.g. kill ${pid}) and re-run ./start.sh."
      exit 1
    fi
  fi
}

echo "==> Checking prerequisites..."
if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is not installed. Please install Python 3.10+."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Please install Node.js and npm."
  exit 1
fi

# 1. Ensure .env files exist
if [[ ! -f "${BACKEND_DIR}/.env" && -f "${BACKEND_DIR}/.env.example" ]]; then
  echo "==> Creating backend/.env from backend/.env.example..."
  cp "${BACKEND_DIR}/.env.example" "${BACKEND_DIR}/.env"
fi

if [[ ! -f "${FRONTEND_DIR}/.env" ]]; then
  echo "==> Creating frontend/.env (pointing to http://localhost:${BACKEND_PORT})..."
  printf 'VITE_API_URL=http://localhost:%s\n' "${BACKEND_PORT}" > "${FRONTEND_DIR}/.env"
fi

# 2. Setup Python virtual environment & dependencies
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "==> Creating Python virtual environment in backend/.venv..."
  python3 -m venv "${VENV_DIR}"
fi

REQ_HASH="$(hash_file "${BACKEND_DIR}/requirements.txt")"
REQ_STAMP="${VENV_DIR}/.requirements.sha256"
INSTALLED_REQ_HASH=""
if [[ -f "${REQ_STAMP}" ]]; then
  INSTALLED_REQ_HASH="$(cat "${REQ_STAMP}")"
fi

if [[ "${REQ_HASH}" != "${INSTALLED_REQ_HASH}" ]] || ! "${VENV_DIR}/bin/python" -c "import fastapi, uvicorn, sqlalchemy, google.genai" >/dev/null 2>&1; then
  echo "==> Installing backend Python dependencies..."
  "${VENV_DIR}/bin/pip" install -r "${BACKEND_DIR}/requirements.txt"
  printf '%s' "${REQ_HASH}" > "${REQ_STAMP}"
fi

# 3. Setup Frontend Node dependencies
if [[ -f "${FRONTEND_DIR}/package-lock.json" ]]; then
  NODE_HASH="$(hash_file "${FRONTEND_DIR}/package-lock.json")"
else
  NODE_HASH="$(hash_file "${FRONTEND_DIR}/package.json")"
fi
NODE_STAMP="${FRONTEND_DIR}/node_modules/.deps.sha256"
INSTALLED_NODE_HASH=""
if [[ -f "${NODE_STAMP}" ]]; then
  INSTALLED_NODE_HASH="$(cat "${NODE_STAMP}")"
fi

if [[ ! -d "${FRONTEND_DIR}/node_modules" || "${NODE_HASH}" != "${INSTALLED_NODE_HASH}" ]]; then
  echo "==> Installing frontend Node dependencies..."
  (cd "${FRONTEND_DIR}" && npm install)
  mkdir -p "${FRONTEND_DIR}/node_modules"
  printf '%s' "${NODE_HASH}" > "${NODE_STAMP}"
fi

if [[ "${SETUP_ONLY}" == "true" ]]; then
  echo "==> Setup complete! Run ./start.sh to launch NaniCare."
  exit 0
fi

# 4. Check ports before launching
check_port_free "${BACKEND_PORT}" "Backend API"
check_port_free "${FRONTEND_PORT}" "Frontend App"

# Report Gemini key status safely without printing the key
GEMINI_STATUS="Demo fallback mode (no GEMINI_API_KEY in backend/.env)"
if [[ -f "${BACKEND_DIR}/.env" ]]; then
  KEY_VAL="$(grep -E '^GEMINI_API_KEY=' "${BACKEND_DIR}/.env" | tail -n 1 | cut -d '=' -f 2- | tr -d '[:space:]' || true)"
  if [[ -n "${KEY_VAL}" && "${KEY_VAL}" != *"your_gemini_api_key"* && "${KEY_VAL}" != "placeholder" ]]; then
    GEMINI_STATUS="Configured in backend/.env (live scanning enabled)"
  fi
fi

BACKEND_PID=""
FRONTEND_PID=""
CLEANED_UP=false

cleanup() {
  if [[ "${CLEANED_UP}" == "true" ]]; then
    return
  fi
  CLEANED_UP=true
  echo ""
  echo "==> Stopping NaniCare servers..."
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
    wait "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
  echo "==> Stopped."
}

trap cleanup INT TERM EXIT

echo "==> Starting FastAPI backend on http://localhost:${BACKEND_PORT}..."
(
  cd "${BACKEND_DIR}"
  if [[ -n "${RELOAD_FLAG}" ]]; then
    exec "${VENV_DIR}/bin/uvicorn" engine:app --reload --port "${BACKEND_PORT}"
  else
    exec "${VENV_DIR}/bin/uvicorn" engine:app --port "${BACKEND_PORT}"
  fi
) &
BACKEND_PID=$!

# Wait for backend health endpoint before starting frontend
READY=false
for _ in $(seq 1 30); do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "Error: Backend exited unexpectedly during startup."
    exit 1
  fi
  if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 0.5
done

if [[ "${READY}" != "true" ]]; then
  echo "Warning: Backend did not respond to /health within 15s; starting frontend anyway..."
fi

echo "==> Starting Frontend on http://localhost:${FRONTEND_PORT}..."
(
  cd "${FRONTEND_DIR}"
  exec npm run dev
) &
FRONTEND_PID=$!

echo ""
echo "============================================================"
echo " NaniCare is running!"
echo "   Frontend UI : http://localhost:${FRONTEND_PORT}"
echo "   Backend API : http://localhost:${BACKEND_PORT}"
echo "   API Docs    : http://localhost:${BACKEND_PORT}/docs"
echo "   Demo Code   : DEMO01"
echo "   Gemini Key  : ${GEMINI_STATUS}"
echo " Press Ctrl+C to stop both servers."
echo "============================================================"
echo ""

if [[ "${OPEN_BROWSER}" == "true" ]] && command -v open >/dev/null 2>&1; then
  sleep 1.5
  open "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1 || true
fi

# Monitor both child processes (compatible with macOS bash 3.2)
while kill -0 "${BACKEND_PID}" 2>/dev/null && kill -0 "${FRONTEND_PID}" 2>/dev/null; do
  sleep 1
done

echo "Error: One of the NaniCare processes exited unexpectedly."
exit 1
