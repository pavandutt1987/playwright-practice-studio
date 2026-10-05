#!/usr/bin/env bash
#
# Production / PaaS start script for Playwright Practice Studio.
#
# Unlike start_mac.sh (which opens a browser on your own machine and binds to
# 127.0.0.1), this binds to 0.0.0.0 and honours the $PORT variable that hosts
# such as Render, Railway, Fly.io and Cloud Run inject.
#
#   ./start_web.sh              # listens on 8000
#   PORT=3000 ./start_web.sh    # listens on 3000
#
# Set STUDIO_DB_PATH to keep history.db on a mounted volume, e.g.
#   STUDIO_DB_PATH=/data/history.db ./start_web.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Prefer an explicit interpreter, then a local virtualenv, then python3/python.
if [ -n "${PYTHON_CMD:-}" ]; then
    PYTHON="$PYTHON_CMD"
elif [ -x "$SCRIPT_DIR/.venv/bin/python" ]; then
    PYTHON="$SCRIPT_DIR/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON="python"
else
    echo "[ERROR] Python was not found. Install Python 3.10+ and try again."
    exit 1
fi

PORT="${PORT:-8000}"

echo "========================================================"
echo "   🎭 Starting Playwright Practice Studio"
echo "========================================================"
echo "   Python : $PYTHON"
echo "   Bind   : 0.0.0.0:$PORT"
echo "   DB     : ${STUDIO_DB_PATH:-$SCRIPT_DIR/app/history.db}"
echo
echo "   ⚠️  This server executes the code typed into it. Do not expose"
echo "       it to the internet without authentication (see DEPLOYMENT.md)."
echo

exec "$PYTHON" -m uvicorn app.server:app --host 0.0.0.0 --port "$PORT" --workers 1
