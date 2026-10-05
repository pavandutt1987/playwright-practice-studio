# ☁️ Deploying Playwright Practice Studio on Cloudflare

Three Cloudflare options, from "one static page" to "the whole Studio running on
Cloudflare's network". Pick the one you need.

| Path | What runs on Cloudflare | What you need | Realistic? |
|---|---|---|---|
| **[1. Pages](#path-1--the-login-page-on-cloudflare-pages-static)** | Just the login page | Free account | Works, but sign-in needs the API |
| **[2. Tunnel](#path-2--full-studio-via-cloudflare-tunnel-recommended)** | Nothing (a secure tunnel to your machine) | Domain on Cloudflare, app running locally | ✅ The reliable way |
| **[3. Containers](#path-3--full-studio-in-cloudflare-containers-edge)** | The entire Studio (Python + Node + Chromium) | Workers Paid ($5/mo) + Docker running locally | ✅ Newer; read the caveats |

**Why not Cloudflare Pages/Workers for the whole app?** Workers run on V8 isolates:
no Python, no Node child processes, no Chromium, 128 MB memory. The Studio spawns real
`python`/`node`/`tsx` processes for every run and streams the console over a WebSocket —
only the container path (or a tunnel to a real machine) can do that.

---

## Path 1 — The login page on Cloudflare Pages (static)

The page is a single self-contained HTML file, so it deploys as-is:

```bash
npx wrangler pages deploy app/static/playground --project-name=playwright-studio-login
```

You get `https://playwright-studio-login.pages.dev`. **Caveat:** sign-in calls
`/api/auth/*`, which does not exist on a static host, so the button reports a network
error. Use Path 2 or 3 for the working flow, or ask for a demo mode that mocks the API
in the browser.

---

## Path 2 — Full Studio via Cloudflare Tunnel (recommended)

Publishes the Studio running on your own machine (or VPS) through Cloudflare, with Zero
Trust Access in front so only you can open it. No code changes, no container builds, and
the runners behave exactly like they do locally (headed mode aside).

### 1. Start the Studio

```bash
./start_web.sh          # macOS/Linux: binds 0.0.0.0:8000
# ./start_mac.sh        # or the existing helper (auto-opens a browser)
```

### 2. Install cloudflared and create a named tunnel

```bash
brew install cloudflared                                  # macOS
# or: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

cloudflared tunnel login                                  # pick your zone in the browser
cloudflared tunnel create playwright-studio                # writes <TUNNEL-ID>.json
cloudflared tunnel route dns playwright-studio studio.example.com
```

### 3. Point the tunnel at the Studio

```bash
mkdir -p ~/.cloudflared
cp cloudflare/tunnel-config.yml.example ~/.cloudflared/config.yml
# edit hostname + credentials-file, then:
cloudflared tunnel ingress validate
cloudflared tunnel run playwright-studio
```

Run it as a background service so it survives restarts:
`sudo cloudflared service install`.

### 4. Put Cloudflare Access in front (do not skip this)

A tunnel provides connectivity, not authorisation — the Studio executes code. In the
dashboard: **Zero Trust → Access controls → Applications → Create new application →
Self-hosted and private → Add public hostname** (`studio.example.com`), add an **Allow**
policy (your email, or an email domain), and pick an identity provider. Access policies
are free for up to 50 users.

Then in **Networks → Tunnels → your tunnel**, enable **Protect with Access** so
cloudflared validates the Access token at the origin and unfiltered traffic is rejected.

### 5. Quick alternative (no domain, ~5 minutes)

```bash
cloudflared tunnel --url http://localhost:8000
```

Gives you a random `*.trycloudflare.com` URL — anyone with the link can run code on your
machine, and it dies with the process. Fine for a demo, wrong for anything else.

---

## Path 3 — Full Studio in Cloudflare Containers (edge)

Runs the repo's `Dockerfile` (Python + Node 20 + Chromium) as a container on Cloudflare,
proxied by the Worker in `cloudflare/src/`.

### Prerequisites

- **Workers Paid plan ($5/month)** — Containers are not on the free plan.
- **Docker Desktop installed and running** — `wrangler deploy` builds the image locally
  and pushes it to a Cloudflare-run registry. There is no remote build.
- ~15 minutes and ~1 GB of image to push on the first deploy (Chromium is large).

### Files

```
wrangler.jsonc                  # at the REPO ROOT on purpose: the Docker build context
                                # is the directory containing the config
.dev.vars.example               # also at the root: Wrangler reads .dev.vars beside the config
cloudflare/
├── src/index.ts                # Worker: access gate + proxy to the container
├── src/access.ts               # HTTP Basic auth gate (dependency-free, unit tested)
├── test/access.test.ts         # npm test
└── package.json                # wrangler + @cloudflare/containers
```

### Deploy

```bash
cd cloudflare
npm install
npx wrangler login

# Gate the Studio before it is reachable (any username, this password):
npx wrangler secret put STUDIO_ACCESS_PASSWORD --config ../wrangler.jsonc

npx wrangler deploy --config ../wrangler.jsonc
```

Then open `https://playwright-practice-studio.<your-subdomain>.workers.dev/login` and
sign in to the browser prompt with the password above (username can be anything).

### Deploying the Worker without rebuilding the container

If you only changed Worker code (`src/*.ts`) and not the Dockerfile:

```bash
npx wrangler deploy --config ../wrangler.jsonc --containers-rollout=none
```

### Local development

```bash
# From the repo root (Wrangler looks for .dev.vars beside wrangler.jsonc):
cp .dev.vars.example .dev.vars     # optional local gate

cd cloudflare
npm run dev                        # wrangler dev: Worker + container on localhost (needs Docker)
npm test                           # unit tests for the access gate
npm run typecheck                  # tsc --noEmit
npx wrangler tail --config ../wrangler.jsonc   # live logs from the deployed Worker
```

### Instance size — do not go below `standard-1`

| Instance type | vCPU | Memory | Disk | Verdict for this app |
|---|---|---|---|---|
| `lite` | 1/16 | 256 MiB | 2 GB | No — Chromium will not start |
| `basic` | 1/4 | 1 GiB | 4 GB | No — too tight once Playwright loads |
| `standard-1` (configured) | 1/2 | 4 GiB | 8 GB | ✅ Minimum sensible |
| `standard-2`+ | 1+ | 6 GiB+ | 12 GB+ | Use this if runs feel slow |

Set it in `wrangler.jsonc` → `containers[0].instance_type`.

### Caveats specific to running the Studio here

1. **Disk is ephemeral.** The container gets a fresh filesystem after every sleep, so
   `history.db` (run history + saved snippets) resets when the instance sleeps
   (`sleepAfter = "10m"` in `src/index.ts`). Set it to `"1h"` or longer to keep state
   alive longer, at a higher idle cost.
2. **Cold starts take 2–3 seconds** after the instance has slept.
3. **Billing is usage-based** (10 ms increments) on top of the $5 plan: memory
   $0.0000025/GiB-s, CPU $0.000020/vCPU-s, disk $0.00000007/GB-s, egress $0.025/GB.
   A `standard-1` instance awake for an hour is roughly $0.03–0.05; monthly free
   allowances are 25 GiB-hours, 375 vCPU-minutes and 200 GB-hours.
   Stopping by an idle `sleepAfter` is what keeps this cheap.
4. **Headed mode still does not work** — there is no display in the container.
5. **If a Chromium run crashes**, it is usually the small `/dev/shm` in container
   environments. Add `args=["--disable-dev-shm-usage"]` to the `chromium.launch()`
   call (Python) or `{ args: ["--disable-dev-shm-usage"] }` (TypeScript/JS).
6. **One instance only** (`max_instances: 1`) because the Studio keeps state in SQLite
   and in the process table. Do not scale it out.
7. **The image must be `linux/amd64`.** `wrangler deploy` handles this; if you build
   manually on Apple Silicon, pass `--platform linux/amd64`.

---

## Testing the access gate

```bash
BASE=https://playwright-practice-studio.<subdomain>.workers.dev

curl -i $BASE/login                                   # 401 + WWW-Authenticate
curl -i -u anything:YOUR-PASSWORD $BASE/login         # 200, the login page
curl -s  -u anything:YOUR-PASSWORD $BASE/api/auth/users | head -c 200
```

Playwright scripts need the credentials too:

```python
context = browser.new_context(
    http_credentials={"username": "anything", "password": os.environ["STUDIO_ACCESS_PASSWORD"]},
)
page = context.new_page()
page.goto("https://playwright-practice-studio.<subdomain>.workers.dev/login")
```

---

## What was verified here vs. what you must check

**Verified in this repo's environment**

- `npm install` resolves (`wrangler 4.147.0`, `@cloudflare/containers 0.3.7`,
  `@cloudflare/workers-types 5.20261005.1`, `typescript 5.9.3`).
- `npm test` — 9/9 unit tests pass for the access gate (missing/valid/malformed
  credentials, unicode passwords, custom realms).
- `npm run typecheck` — `tsc --noEmit` passes with no errors.
- `npx wrangler deploy --dry-run --containers-rollout=none` — Wrangler accepts the
  config, bundles the Worker (57 KiB, `@cloudflare/containers` resolved), registers the
  `STUDIO_CONTAINER` Durable Object binding, and resolves the container image to the
  repo-root `Dockerfile`.

**Not verified here** (no Docker daemon and no Cloudflare account in this environment)

- `docker build` of the image and the push to Cloudflare's registry — run the deploy
  once locally; the first build takes several minutes.
- The container actually serving traffic on Cloudflare, and WebSocket streaming through
  the Worker to `/ws/run`.
- Pages deploy (Path 1) and `cloudflared` tunnel setup (Path 2) — both are standard
  commands but were not executed here.
