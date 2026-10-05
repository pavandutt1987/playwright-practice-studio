# 🌐 Deploying Playwright Practice Studio

This guide covers putting the Studio (and the login page) on the web.

---

## ⚠️ Read this first — the Studio runs code by design

`app/runner.py` writes whatever snippet you type into a temp file and spawns a real
`python` / `node` / `tsx` child process to execute it. That is the product — but it also
means:

> **Anyone who can open the URL can run arbitrary code on the machine or container
> it is hosted on.**

On your laptop that is exactly what you want. On the public internet it is a problem:
unauthenticated code runners get found by scrapers, used for crypto mining, and will
usually get your account suspended by the hosting provider.

So choose one of these before you deploy publicly:

1. **Keep it private** — private/authenticated URL (see [Securing it](#-securing-a-public-deployment)).
2. **Put a login in front** of it at the proxy/platform level.
3. **Treat it as disposable** — throwaway container, tight CPU/memory limits,
   no credentials, no cloud metadata access.

Also note what **cannot** host the full Studio: serverless function platforms
(Vercel/Netlify Functions, AWS Lambda, Cloudflare Workers). They give you no long-lived
WebSocket (the Run console needs one), kill requests after ~10 seconds, and cannot ship
Python + Node + Chromium in one runtime.

---

## Pick a path

| Path | What you get | Where | Notes |
|---|---|---|---|
| **A. Login page only** | A link to the sign-in UI | GitHub Pages, Netlify, Vercel, Cloudflare Pages | Static only — sign-in needs the API |
| **B. Full Studio in a container** ✅ | IDE + all runners + playground targets + login API | Render, Railway, Fly.io, Cloud Run, HF Spaces, **Cloudflare Containers** | Files in this repo already support it |
| **C. Full Studio on a VPS** | Same, on a box you control | EC2, DigitalOcean, Hetzner, Lightsail | Most control, HTTPS via Caddy/nginx |
| **D. Temporary tunnel** | Share your local instance for an hour | Cloudflare Tunnel, ngrok | Fastest; still public while open |

### Cloudflare specifically

Cloudflare has its own notes because Workers/Pages **cannot** run this app directly (V8
isolates: no Python, no Node child processes, no Chromium, 128 MB memory). Three workable
routes, with full commands in **[cloudflare/README.md](cloudflare/README.md)**:

| Cloudflare product | What it hosts | Verdict |
|---|---|---|
| **Cloudflare Pages** | The login page only | Deploys instantly; sign-in reports a network error without the API |
| **Cloudflare Tunnel** | A tunnel to the Studio on your machine/VPS, with Zero Trust Access in front | ✅ Recommended — free, no container build, runners behave exactly like local |
| **Cloudflare Containers** | The whole Studio on Cloudflare's edge, proxied by a Worker | ✅ Available (needs Workers Paid + Docker locally to build the image) |

The Containers setup is already committed: `wrangler.jsonc` at the repo root, the Worker
in `cloudflare/src/` (with an HTTP Basic auth gate so a public URL is not an open code
runner), and unit tests for that gate.

Three ways to trigger that deploy — a local `wrangler deploy` (needs Docker), the
included GitHub Actions workflow (runner has Docker; also fires on push to `main`), or
Cloudflare's own Workers Builds on git push (no Docker anywhere):

```bash
# local (Docker must be running)
npm run cf:install                # npm ci at the repo root - see note below
npm run cf:test                   # access-gate unit tests
npm run cf:deploy

# GitHub Actions
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh secret set STUDIO_ACCESS_PASSWORD
gh workflow run deploy-cloudflare.yml
```

> The Worker's npm dependencies (`@cloudflare/containers`, `wrangler`) live in the **root**
> `package.json` so that Workers Builds and CI — both of which run at the repository root —
> can bundle `cloudflare/src/`. If you use Cloudflare's Workers Builds, set the build
> command to `npm ci`, **not** `pip install -r requirements.txt`: the Python dependencies
> are installed inside the container image by the `Dockerfile`. Skipping the npm install
> causes `Could not resolve "@cloudflare/containers"`.

Full steps, including the Workers Builds settings, are in
[cloudflare/README.md](cloudflare/README.md#-triggering-a-deploy).


---

## Path A — Deploy just the login page (static)

The page (`app/static/playground/login.html`) is a single self-contained HTML file, so it
hosts anywhere. **Caveat:** sign-in is not static — it calls `/api/auth/login`. On a purely
static host the button will show:

> Network error: could not reach the login API. Is the studio server running?

That is fine for showing the *design*, not for demonstrating sign-in. If you want the real
flow, use Path B and share `https://your-app/login`.

### GitHub Pages (quick version)

```bash
mkdir -p docs && cp app/static/playground/login.html docs/index.html
git add docs && git commit -m "Publish login page demo" && git push
# Repo → Settings → Pages → Source: main / docs  →  https://<user>.github.io/<repo>/
```

Netlify/Vercel/Cloudflare Pages: drag the file in, or set the publish directory to
`app/static/playground`. Any of them works because the page has zero build step.

> Want it to *work* while static? I can add a `demo mode` build that swaps the `fetch`
> calls for an in-browser mock so the form behaves realistically without a server.

---

## Path B — Full Studio in a container (recommended)

This repo ships everything needed:

| File | Purpose |
|---|---|
| `Dockerfile` | Python + Node 20 + Chromium for both runtimes, runs as non-root uid 1000 |
| `.dockerignore` | keeps `.venv`, `node_modules`, the local DB and the zip out of the image |
| `docker-compose.yml` | one-command local container run with a `/data` volume |
| `start_web.sh` | binds `0.0.0.0`, honours `$PORT` for PaaS hosts |

### 1. Test the image locally

```bash
docker build -t playwright-practice-studio .
docker run --rm -p 8000:8000 --shm-size=1g playwright-practice-studio
# → open http://localhost:8000/login   (admin / password123)
```

or simply:

```bash
docker compose up --build
```

The first build downloads ~1 GB of browser binaries — expect 5–15 minutes.

### 2. Deploy to a host

**Render** — New + → *Web Service* → connect this repo → Runtime **Docker** → Health check
path `/api/auth/users` → Deploy.

- Pick **at least 1 GB RAM** if you want to actually run browser scripts; headless
  Chromium will not fit comfortably in the 512 MB free instance.
- Free instances sleep after ~15 min idle; the first request afterwards takes ~1 minute.
  Sleep also clears the in-memory lockout counters — harmless.
- To keep history/snippets: add a **Disk** mounted at `/data` and set
  `STUDIO_DB_PATH=/data/history.db`.
- Set `STUDIO_ALLOWED_ORIGINS=https://<your-app>.onrender.com`.
- WebSockets (the Run console) are supported.

**Railway** — New Project → *Deploy from GitHub repo*; the Dockerfile is detected
automatically and Railway injects `$PORT`. Add a **Volume** mounted at `/data` with
`STUDIO_DB_PATH=/data/history.db` if you want persistence. WebSockets supported.

**Fly.io** — a real VM, so browsers behave best here:

```bash
fly launch --no-deploy                 # detects the Dockerfile
fly volumes create studio_data --size 1

# in fly.toml:
#   [env]
#     PORT = "8000"
#     STUDIO_DB_PATH = "/data/history.db"
#   [mounts]
#     source = "studio_data"
#     destination = "/data"

fly deploy
fly scale memory 2048                  # give Chromium room
fly open /login
```

**Google Cloud Run** — best default security: the container runs inside a gVisor sandbox,
so the code-execution risk is contained, and it scales to zero:

```bash
gcloud run deploy studio \
  --source . --region us-central1 \
  --port 8000 --memory 2Gi --cpu 2 \
  --timeout 3600 --max-instances 1 \
  --allow-unauthenticated
```

- Keep `--max-instances 1`: sessions live in SQLite and the Stop button tracks child
  processes in memory, so scaling out would split that state.
- `--timeout 3600` allows long WebSocket sessions (Cloud Run caps them at 60 min).
- Prefer `--no-allow-unauthenticated` + IAM for a private instance; then reach it with
  `gcloud run services proxy studio --port 8080`.
- The filesystem is ephemeral — add `--add-volume` + `--add-volume-mount` for `/data`
  if you want history to survive redeploys.

**Hugging Face Spaces (Docker)** — the most generous free tier (2 vCPU / 16 GB), and it
runs containers as uid 1000 like our image. Create a Space → SDK **Docker** → blank, then
put this in the Space's `README.md`:

```yaml
---
title: Playwright Practice Studio
sdk: docker
app_port: 8000
---
```

…push this repo to the Space and it will start on port 8000. Spaces are public by default,
so read the security section below before you push.

---

## Path C — Full Studio on a VPS

```bash
git clone <your-repo> && cd playwright-practice-studio
chmod +x start_web.sh setup_mac.sh
./setup_mac.sh          # installs Python + Node deps and Chromium
./start_web.sh          # binds 0.0.0.0:8000, no browser auto-open
```

Keep it alive with systemd (`/etc/systemd/system/studio.service`):

```ini
[Unit]
Description=Playwright Practice Studio
After=network.target

[Service]
WorkingDirectory=/opt/playwright-practice-studio
ExecStart=/opt/playwright-practice-studio/start_web.sh
User=studio
Restart=always
Environment=PORT=8000
Environment=STUDIO_DB_PATH=/var/lib/studio/history.db

[Install]
WantedBy=multi-user.target
```

Front it with Caddy (TLS + basic auth + WebSocket upgrade in three lines):

```caddy
studio.example.com {
    basic_auth {
        admin $2a$14$<bcrypt-hash-from: caddy hash-password>
    }
    reverse_proxy 127.0.0.1:8000
}
```

nginx equivalent — the WebSocket part matters, otherwise the Run console never streams:

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

---

## Path D — Share your local instance temporarily

```bash
cloudflared tunnel --url http://localhost:8000     # or:  ngrok http 8000
```

The URL is public while the tunnel is open — anyone with the link can run code on your
machine. Use it for short demos, then Ctrl+C. Cloudflare Access can put a login in front
of a tunnel if you need more than that.

---

## 🔒 Securing a public deployment

Pick whichever fits; they are ordered by effort.

1. **Proxy-level basic auth (no code change)** — Caddy/nginx snippets above, or Cloudflare
   Access in front of a tunnel.
2. **Platform auth** — Cloud Run `--no-allow-unauthenticated` (IAM), Render private
   services, Fly `flyctl proxy 8000`.
3. **App-level gate (not built yet)** — the current `/api/auth/*` login is a *practice
   target*: its credentials are printed on the page, so it does **not** protect the Studio.
   I can add a real gate that reuses the same session code and requires
   `STUDIO_ACCESS_PASSWORD` before any route, the IDE included — ask if you want it.

### Hardening checklist

- [ ] Authentication in front of the app before sharing the URL
- [ ] CPU/memory limits set (`--cpus 2 --memory 2g`, `--pids-limit 256`, `--shm-size=1g`)
- [ ] `STUDIO_ALLOWED_ORIGINS` set to your exact domain (default is `*` for local dev)
- [ ] `--workers 1` (already the default in `start_web.sh` and the Dockerfile)
- [ ] No secrets, cloud credentials or SSH keys in the container — user code can read them
- [ ] Don't mount the Docker socket or host directories into the container
- [ ] Provider billing alerts on, in case someone abuses the runner
- [ ] Persistent volume only if you want history/snippets to survive restarts

---

## Platform support matrix

| Requirement | Why it matters | Who supports it |
|---|---|---|
| Long-lived WebSocket | the Run console streams logs in real time | Render, Railway, Fly, Cloud Run (≤60 min), HF Spaces, VPS |
| Long-running child processes | each run may take up to 60 s | same as above |
| 1–2 GB RAM | headless Chromium | Render Starter+, Cloud Run 2Gi, HF Spaces free, VPS |
| Persistent disk | `app/history.db` (history + snippets) | Render Disks, Railway Volumes, Fly Volumes, Cloud Run volumes, VPS |
| Non-root container | Chromium sandbox behaves better | the included Dockerfile already uses uid 1000 |

**Headed mode does not work on a server** — there is no display, so the 👁️ toggle still
runs headless. Keep headed mode for your local machine; if you truly need to watch a
remote browser, that needs Xvfb + noVNC, which is not included here.

---

## Verified vs. unverified

**Verified in this repo's environment**

- `start_web.sh` honours `$PORT` and `STUDIO_DB_PATH` — `GET /login` and
  `GET /api/auth/users` both returned `200` on a test port, and the database was created
  at the custom path.
- The frontend uses relative URLs and `window.location.host`, so it needs no changes
  behind any domain or reverse proxy (it also picks `wss://` automatically on HTTPS).
- Dependency pins resolve: `@playwright/test@1.63.0` is the current stable release.

**Not verified here**

- The `docker build` itself — this environment has no Docker daemon. The two commands in
  [step 1](#1-test-the-image-locally) are the exact same steps the image performs, so run
  them once locally before pushing to a host.
- Chromium's launch inside the container. If a run fails with a sandbox error, add
  `chromium_sandbox=False` (Python) / `{ chromiumSandbox: false }` (TypeScript) to the
  practice script, or start the container with `--cap-add=SYS_ADMIN`.
