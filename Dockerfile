# Playwright Practice Studio - container image
#
# Bundles everything the three language runners need:
#   * Python + playwright     -> the Python runner (async_playwright)
#   * Node.js 20 + tsx        -> the TypeScript and JavaScript runners
#   * Chromium for BOTH the Python and the Node playwright packages
#
# Build:  docker build -t playwright-practice-studio .
# Run:    docker run --rm -p 8000:8000 --shm-size=1g playwright-practice-studio
#
# NOTE: this image executes the code typed into the Studio. Keep it private or
# put it behind authentication - see DEPLOYMENT.md ("Read this first").

FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=8000

# --- Node.js 20 (needed by the TypeScript / JavaScript runners) --------------
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Python dependencies (FastAPI, Uvicorn, Playwright) ---------------------
COPY requirements.txt ./
RUN pip install -r requirements.txt

# --- Node dependencies (tsx for TypeScript, @playwright/test for JS/TS) -----
# Dev dependencies are required here (tsx lives in devDependencies), so do not
# set NODE_ENV=production in this image.
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

# --- Browsers for both runtimes, into the shared $PLAYWRIGHT_BROWSERS_PATH ---
# a+rX so the non-root runtime user below can actually read/execute them.
RUN playwright install --with-deps chromium \
 && npx playwright install chromium \
 && chmod -R a+rX /ms-playwright

# --- Application code -------------------------------------------------------
COPY . .

# Run as a non-root user: Chromium's sandbox misbehaves as root and several
# platforms (Hugging Face Spaces, Cloud Run policies) expect a non-root user.
# /data is where a mounted volume can keep history.db across restarts.
RUN useradd --create-home --uid 1000 studio \
 && mkdir -p /data \
 && chown -R studio:studio /app /data

ENV HOME=/home/studio
USER studio

EXPOSE 8000

# $PORT is honoured so the same image works on Render, Railway, Fly.io,
# Google Cloud Run and Hugging Face Spaces. --workers 1 is deliberate: the
# Stop button and the streaming console rely on in-process state.
CMD ["sh", "-c", "python -m uvicorn app.server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
