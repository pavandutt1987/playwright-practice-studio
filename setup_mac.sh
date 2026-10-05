#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

echo "========================================================"
echo "   🎭 Playwright Practice Studio - Automated Setup"
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

if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] npm was not found. Install Node.js/npm and try again."
    exit 1
fi

echo "[1/3] Installing Python Dependencies (FastAPI, Uvicorn, Playwright)..."
if ! "$PYTHON_CMD" -m pip install -r requirements.txt; then
    echo "[ERROR] Python dependencies installation failed."
    exit 1
fi

echo
echo "[2/3] Installing Node.js & TypeScript Dependencies..."
if ! npm install; then
    echo "[ERROR] npm install failed."
    exit 1
fi

echo
echo "[3/3] Installing Playwright Chromium Browser..."
if ! "$PYTHON_CMD" -m playwright install chromium; then
    echo "[WARNING] Playwright browser install reported an issue, continuing..."
fi

echo
echo "========================================================"
echo "   🎉 Setup Complete! You can now run ./start_mac.sh"
echo "========================================================"
