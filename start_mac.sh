#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "========================================================"
echo "   🎭 Launching Playwright Practice Studio..."
echo "========================================================"
echo

# Prefer python3 on macOS, but allow python if that is the available command.
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo "[ERROR] Python was not found. Install Python 3 and try again."
    exit 1
fi

URL="http://localhost:8000"

echo "Opening browser to $URL ..."
# Give the server a moment to begin starting before opening the browser.
(
    sleep 1
    open "$URL"
) >/dev/null 2>&1 &

echo "Starting FastAPI Web Server..."
echo "(Press Ctrl + C in this terminal to stop the server)"
echo

exec "$PYTHON_CMD" -m uvicorn app.server:app --host 127.0.0.1 --port 8000
