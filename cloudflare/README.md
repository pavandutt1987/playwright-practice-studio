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
package.json                    # ALSO at the root: the Worker's deps (so Workers Builds,
                                # which runs at the root, can bundle cloudflare/src/)
.dev.vars.example               # reads .dev.vars beside wrangler.jsonc
.github/workflows/deploy-cloudflare.yml   # trigger a deploy from GitHub (Actions tab)
cloudflare/
├── src/index.ts                # Worker: access gate + proxy to the container
├── src/access.ts               # HTTP Basic auth gate (dependency-free, unit tested)
├── test/access.test.ts         # npm run cf:test
└── tsconfig.json               # npm run cf:typecheck
```

Convenience scripts (run from the repo root): `npm run cf:install`, `cf:test`,
`cf:typecheck`, `cf:dev`, `cf:deploy`, `cf:deploy:worker`.

> Why are the Worker dependencies in the **root** package.json and not in
> `cloudflare/package.json`? Because Workers Builds (git-push deploys) and the GitHub
> Actions workflow both run at the repository root — if `@cloudflare/containers` were
> installed in a nested folder, the bundler would fail with
> `Could not resolve "@cloudflare/containers"`.

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

---

## 🚀 Triggering a deploy

Three ways to kick off a deployment. Use the first one while iterating, the second or
third for anything regular.

| Trigger | How | Needs Docker on *your* machine? |
|---|---|---|
| **Manual, from your machine** | `npm run cf:deploy` (or `npx wrangler deploy --config ../wrangler.jsonc` inside `cloudflare/`) | ✅ Yes — Wrangler builds the image locally |
| **GitHub Actions** (workflow included) | Actions → *Deploy to Cloudflare* → **Run workflow**, or `gh workflow run deploy-cloudflare.yml`; also fires on every push to `main` | ❌ No — GitHub's runner has Docker |
| **Cloudflare Workers Builds** | Dashboard → Workers & Pages → *playwright-practice-studio* → Settings → **Builds** → connect the repo | ❌ No — Cloudflare builds the Dockerfile in its own build environment |

Local, while iterating:

```bash
npm run cf:install          # npm ci at the repo root (Worker deps + wrangler)
npm run cf:test             # the access-gate unit tests, as a pre-deploy check
npm run cf:typecheck        # tsc --noEmit for the Worker code
npm run cf:deploy           # full deploy: build image, push, roll out the container
npm run cf:deploy:worker    # Worker-only: skips the image, keeps existing containers
```

### Trigger 2 — GitHub Actions (recommended)

The workflow is at [`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml).

**1. Create an API token.** Cloudflare dashboard → *My Profile* → **API Tokens** →
*Create Token* → use the **"Edit Cloudflare Workers"** template. Copy the token.
If the deploy later fails while *pushing the image* with a permission error, edit the
token and add the permission the error names (the registry is R2-backed), then re-run.

**2. Find your account ID.** `npx wrangler whoami`, or the dashboard URL
(`dash.cloudflare.com/<account-id>/...`).

**3. Add three repository secrets** (Settings → Secrets and variables → Actions →
New repository secret), or with the CLI:

```bash
gh secret set CLOUDFLARE_API_TOKEN        # paste the token
gh secret set CLOUDFLARE_ACCOUNT_ID       # paste the account ID
gh secret set STUDIO_ACCESS_PASSWORD      # the password that gates your Studio
```

**4. Trigger it:**

```bash
gh workflow run deploy-cloudflare.yml                     # full rollout
gh workflow run deploy-cloudflare.yml -f rollout=worker-only
gh run watch                                              # follow the run
```

Or click **Run workflow** in the Actions tab.

> **The workflow must be on the default branch (`main`) before either trigger works.**
> GitHub only surfaces `workflow_dispatch` (the Run workflow button and
> `gh workflow run`) for workflows present on the default branch, and the `push`
> trigger is scoped to `main` anyway. So merge this branch first — until then the
> workflow file is inert.

The workflow:

1. fails fast with a clear message if the credentials are missing,
2. checks Docker is present (the action of last resort for a confusing failure),
3. installs `cloudflare/` dependencies and runs the access-gate unit tests,
4. pushes `STUDIO_ACCESS_PASSWORD` as a Worker secret (and **warns loudly** if that
   secret is unset, because the Studio would then be an open code runner),
5. deploys, then writes a summary with the rollout mode and gate status.

### Trigger 3 — Cloudflare Workers Builds (deploy on git push)

Cloudflare can build and deploy on your behalf whenever you push — no Docker locally,
no GitHub secrets. In the dashboard: **Workers & Pages → your Worker → Settings →
Builds**, connect the GitHub repo, set the production branch to `main`, then:

| Setting | Value | Why |
|---|---|---|
| Root directory | repository root (default) | `wrangler.jsonc` and the `Dockerfile` both live there |
| Build command | `npm ci` (or `npm run cf:install`) | ⚠️ **Not** `pip install -r requirements.txt` — see below. This is what installs `@cloudflare/containers`, without which the bundle fails |
| Deploy command | `npx wrangler deploy` | picks up `wrangler.jsonc` at the root and builds/pushes the image |

**Do not point the build command at `requirements.txt`.** It is a tempting choice because
the repo has one, but the Python dependencies belong *inside the container image* — the
`Dockerfile` installs them itself when the image is built. Installing them in the build
environment is wasted work and, worse, it leaves `node_modules` missing, which produces:

```
✘ [ERROR] Could not resolve "@cloudflare/containers"
      cloudflare/src/index.ts:11:40:
```

If your build log shows a pip install followed by that error, set the build command to
`npm ci`. The log will then show the deploy command using the locally installed
`wrangler` instead of `npm warn exec The following package was not found and will be
installed: wrangler@…`.

Push to `main` and the build runs. Notes from Cloudflare's docs:

- Dockerfile builds **do** run in the Workers Builds environment, and a production
  deploy publishes the image and rolls out the container.
- Builds on **other branches** run `npx wrangler versions upload`: Worker code only —
  no new image, no container rollout — and no Version URL, because this Worker uses
  Durable Objects.
- Set `STUDIO_ACCESS_PASSWORD` as a Worker secret once (`npm run cf:deploy:worker`
  after `npx wrangler secret put ...`, or the dashboard).

### After the first deploy

The Worker goes live immediately, but the container image still has to provision —
**wait a few minutes** and reload if the first requests error. A brand-new deploy can
also take several minutes to build (Node + Chromium is a large image); later runs reuse
the cached layers.

---

### Deploying the Worker without rebuilding the container
If you only changed Worker code (`src/*.ts`) and not the Dockerfile:

```bash
npx wrangler deploy --config ../wrangler.jsonc --containers-rollout=none
```

### Local development

```bash
# From the repo root (Wrangler looks for .dev.vars beside wrangler.jsonc):
cp .dev.vars.example .dev.vars     # optional local gate

npm run cf:dev                     # wrangler dev: Worker + container on localhost (needs Docker)
npm run cf:test                    # unit tests for the access gate
npm run cf:install                 # (re)install the cloudflare/ dependencies

cd cloudflare
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

## Diagnosing a failed deploy

Start with the preflight check — it prints a plain-English reason where the bundler
only says `Could not resolve "@cloudflare/containers"`:

```bash
npm run cf:doctor
```

### "Could not resolve @cloudflare/containers"

This means `node_modules` did not exist at the **repository root** when Wrangler bundled
the Worker. Confirm it from the build log — the failing run contains this tell:

```
npm warn exec The following package was not found and will be installed: wrangler@4.147.0
```

Wrangler is a dependency of this repo, so npm should never have to fetch it. That line
means no root `npm ci` happened (the neighbouring `pip install -r requirements.txt` is a
red herring — the Python dependencies belong *inside* the container image, where the
`Dockerfile` installs them).

**Fix:** set the Workers Builds **build command** to `npm ci`, or run `npm ci` locally
before `npm run cf:deploy`.

### ⚠️ "Retry deployment" rebuilds the OLD commit

If a build failed before a fix was pushed, pressing **Retry** re-runs **the original
commit**, not your latest one — so the same error comes back and it looks like the fix
did nothing. This is easy to misread; the build header shows the commit it is using.

Check the failed build's log for the tell-tale package count:

| What the log says | What it means |
|---|---|
| `added ~90 packages`, no `npm warn exec` | a current revision — good |
| `added 9 packages` **and** `npm warn exec … wrangler@4.147.0` | a pre-fix revision; the retry re-ran old code |

**Fix:** trigger a *fresh* build rather than a retry — push a new commit to the build
branch (or use the dashboard's deploy action on the latest revision), then confirm the
build header shows the newest commit SHA.

### Other failures

| Symptom | Cause and fix |
|---|---|
| `The Docker CLI is needed to build the configured image` | No Docker daemon. Start Docker Desktop, or deploy via GitHub Actions / Workers Builds instead (both have Docker), or use `npm run cf:deploy:worker` to ship Worker-only changes |
| Deploy succeeds but `/login` returns an error | The container image is still provisioning after the first deploy — wait a few minutes |
| Runs fail with a Chromium crash inside the container | Small `/dev/shm`; add `--disable-dev-shm-usage` to the launch args in the practice script |
| Image push is denied with a permission error | Widen the API token, adding the permission named in the error, then re-run |

### How to read a successful build

1. The build header shows the newest commit.
2. `npm ci` reports the full dependency set (~90 packages) and no
   `npm warn exec … wrangler@…`.
3. `npm run cf:doctor` — all four checks pass.
4. `wrangler deploy` uploads the Worker and then builds/pushes the image (slow first
   time: Node + Chromium).
5. The Worker URL responds after the container has provisioned (allow a few minutes).

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
  `@cloudflare/workers-types 5.20261005.1`, `typescript 5.9.3`); `npm ci --prefix cloudflare`
  from the repo root installs cleanly (43 packages, `wrangler` binary present).
- `npm test` — 9/9 unit tests pass for the access gate (missing/valid/malformed
  credentials, unicode passwords, custom realms).
- `npm run typecheck` — `tsc --noEmit` passes with no errors.
- `npx wrangler deploy --dry-run --containers-rollout=none` — Wrangler accepts the
  config, bundles the Worker (57 KiB, `@cloudflare/containers` resolved), registers the
  `STUDIO_CONTAINER` Durable Object binding, and resolves the container image to the
  repo-root `Dockerfile`.
- The workflow in `.github/workflows/deploy-cloudflare.yml` — valid YAML, the two action
  references exist (`actions/checkout@v7`, `actions/setup-node@v7` confirmed via the
  GitHub API), all `${{ }}` expressions balanced, every shell step passes `bash -n`, and
  the three secrets it uses are the ones documented. Its install/test/worker-only
  commands were executed locally (`npm ci --prefix cloudflare`, `npm test --prefix
  cloudflare`, `wrangler deploy --containers-rollout=none`).

**Not verified here** (no Docker daemon and no Cloudflare account in this environment)

- `docker build` of the image and the push to Cloudflare's registry — GitHub Actions or
  Workers Builds both have Docker, so run the deploy there if your machine does not.
- The container actually serving traffic on Cloudflare, and WebSocket streaming through
  the Worker to `/ws/run`.
- Which API-token permissions a container image push needs. Start with the
  "Edit Cloudflare Workers" template and widen it if the push is denied.
- Pages deploy (Path 1) and `cloudflared` tunnel setup (Path 2) — both are standard
  commands but were not executed here.
