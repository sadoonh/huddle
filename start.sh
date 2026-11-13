#!/usr/bin/env bash
#
# One-command local launcher for the standup app.
#
#   ./start.sh
#
# Installs missing dependencies, prepares the demo database, starts FastAPI and
# Vite, waits for both to be healthy, opens the browser, and shuts everything
# down on Ctrl+C. Safe to run repeatedly: existing data and dependencies are
# reused.
#
# Optional environment variables:
#   API_PORT=8000   WEB_PORT=5173   NO_OPEN=1   RESET=1
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
NO_OPEN="${NO_OPEN:-0}"
RESET="${RESET:-0}"

DEV_DIR="$ROOT/.dev"
mkdir -p "$DEV_DIR"

if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

say()  { printf "${GREEN}▸${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

API_PID=""
WEB_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [ -n "${WEB_PID:-}" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [ -n "${API_PID:-}" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [ -n "${WEB_PID:-}" ]; then
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [ -n "${API_PID:-}" ]; then
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3.13 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ] && command -v uv >/dev/null 2>&1; then
  say "No compatible system Python found; asking uv for Python 3.12…"
  uv python install 3.12 >/dev/null
  PYTHON="$(uv python find 3.12)"
fi

if [ -z "$PYTHON" ]; then
  die "Python 3.10–3.13 is required. Install one, or install uv (https://docs.astral.sh/uv/)."
fi

command -v node >/dev/null 2>&1 || die "Node.js 18+ is required. Install it from https://nodejs.org/."
command -v npm >/dev/null 2>&1 || die "npm is required (it ships with Node.js)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js 18+ is required (found $(node -v))."
fi

if [ "$API_PORT" = "$WEB_PORT" ]; then
  die "API_PORT and WEB_PORT must differ."
fi

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
VENV_PY="$ROOT/backend/.venv/bin/python"
REQ_STAMP="$ROOT/backend/.venv/.requirements.sha256"

# A pre-existing venv created with an unsupported Python (e.g. 3.14 before
# psycopg wheels exist) would fail halfway through installation. Rebuild it.
if [ -x "$VENV_PY" ]; then
  if ! "$VENV_PY" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null; then
    warn "Existing backend virtualenv uses an unsupported Python; recreating it."
    rm -rf "$ROOT/backend/.venv"
  fi
fi

req_hash() {
  "$VENV_PY" -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' \
    "$ROOT/backend/requirements.txt"
}

if [ ! -x "$VENV_PY" ]; then
  say "Creating backend virtualenv…"
  if command -v uv >/dev/null 2>&1; then
    uv venv "$ROOT/backend/.venv" --python "$PYTHON" >/dev/null
  else
    "$PYTHON" -m venv "$ROOT/backend/.venv"
  fi
fi

NEED_BACKEND_INSTALL=0
if [ ! -f "$REQ_STAMP" ]; then
  NEED_BACKEND_INSTALL=1
elif [ "$(cat "$REQ_STAMP")" != "$(req_hash)" ]; then
  NEED_BACKEND_INSTALL=1
elif ! "$VENV_PY" -c 'import fastapi, sqlalchemy, uvicorn' >/dev/null 2>&1; then
  NEED_BACKEND_INSTALL=1
fi

if [ "$NEED_BACKEND_INSTALL" = "1" ]; then
  say "Installing backend dependencies…"
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "$VENV_PY" -q -r "$ROOT/backend/requirements.txt"
  else
    "$VENV_PY" -m pip install -q --upgrade pip
    "$VENV_PY" -m pip install -q -r "$ROOT/backend/requirements.txt"
  fi
  req_hash > "$REQ_STAMP"
fi

FRONTEND_STAMP="$ROOT/frontend/node_modules/.deps.sha256"

lock_hash() {
  "$VENV_PY" -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' \
    "$ROOT/frontend/package-lock.json"
}

NEED_FRONTEND_INSTALL=0
if [ ! -d "$ROOT/frontend/node_modules" ] || [ ! -x "$ROOT/frontend/node_modules/.bin/vite" ]; then
  NEED_FRONTEND_INSTALL=1
elif [ ! -f "$FRONTEND_STAMP" ]; then
  NEED_FRONTEND_INSTALL=1
elif [ "$(cat "$FRONTEND_STAMP")" != "$(lock_hash)" ]; then
  NEED_FRONTEND_INSTALL=1
fi

if [ "$NEED_FRONTEND_INSTALL" = "1" ]; then
  say "Installing frontend dependencies…"
  (cd "$ROOT/frontend" && npm ci --no-audit --no-fund)
  lock_hash > "$FRONTEND_STAMP"
fi

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
say "Preparing database…"
if [ "$RESET" = "1" ]; then
  warn "RESET=1: rebuilding the demo workspace (local data will be replaced)."
  (cd "$ROOT/backend" && "$VENV_PY" -m app.seed --reset >/dev/null) \
    || die "Could not seed the database."
else
  (cd "$ROOT/backend" && "$VENV_PY" -m app.seed >/dev/null) \
    || die "Could not prepare the database."
fi

# ---------------------------------------------------------------------------
# Port checks
# ---------------------------------------------------------------------------
port_in_use() {
  "$VENV_PY" - "$1" <<'PY'
import socket, sys
sock = socket.socket()
try:
    in_use = sock.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0
finally:
    sock.close()
raise SystemExit(0 if in_use else 1)
PY
}

if port_in_use "$API_PORT"; then
  die "Port $API_PORT is already in use. Try: API_PORT=8001 WEB_PORT=5174 ./start.sh"
fi
if port_in_use "$WEB_PORT"; then
  die "Port $WEB_PORT is already in use. Try: API_PORT=8001 WEB_PORT=5174 ./start.sh"
fi

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------
wait_for_http() {
  url="$1"
  pid="$2"
  log="$3"
  attempt=0
  while [ "$attempt" -lt 120 ]; do
    if "$VENV_PY" - "$url" <<'PY' >/dev/null 2>&1
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=1) as response:
        raise SystemExit(0 if response.status < 500 else 1)
except Exception:
    raise SystemExit(1)
PY
    then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      echo
      printf "Process exited while starting. Last lines from %s:\n" "$log" >&2
      tail -n 40 "$log" >&2 || true
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done
  printf "Timed out waiting for %s. See %s\n" "$url" "$log" >&2
  tail -n 40 "$log" >&2 || true
  return 1
}

say "Starting API on port $API_PORT…"
(
  cd "$ROOT/backend"
  export CORS_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT"
  exec "$VENV_PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT"
) > "$DEV_DIR/api.log" 2>&1 &
API_PID=$!

wait_for_http "http://127.0.0.1:$API_PORT/health" "$API_PID" "$DEV_DIR/api.log" \
  || die "The API did not start."

say "Starting web app on port $WEB_PORT…"
(
  cd "$ROOT/frontend"
  export API_PROXY_TARGET="http://127.0.0.1:$API_PORT"
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort
) > "$DEV_DIR/web.log" 2>&1 &
WEB_PID=$!

wait_for_http "http://127.0.0.1:$WEB_PORT/" "$WEB_PID" "$DEV_DIR/web.log" \
  || die "The web app did not start."

APP_URL="http://localhost:$WEB_PORT"
if [ "$NO_OPEN" != "1" ]; then
  if command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$APP_URL" >/dev/null 2>&1 || true
  fi
fi

echo
printf "${BOLD}Standup is running${NC}\n"
printf "  App   %s\n" "$APP_URL"
printf "  API   http://localhost:%s/api/docs\n" "$API_PORT"
printf "  Logs  .dev/api.log, .dev/web.log\n"
printf "  Stop  Ctrl+C\n"
echo

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$API_PID" 2>/dev/null; then
  printf "${RED}API stopped unexpectedly.${NC} Last lines:\n" >&2
  tail -n 40 "$DEV_DIR/api.log" >&2 || true
elif ! kill -0 "$WEB_PID" 2>/dev/null; then
  printf "${RED}Web app stopped unexpectedly.${NC} Last lines:\n" >&2
  tail -n 40 "$DEV_DIR/web.log" >&2 || true
fi
exit 1
