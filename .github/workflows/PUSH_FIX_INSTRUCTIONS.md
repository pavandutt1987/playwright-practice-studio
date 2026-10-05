# Push the Cloudflare fix to GitHub

The two commits that make the Cloudflare build succeed exist only in this Arena
workspace. They fix `Could not resolve "@cloudflare/containers"` by importing the
container helper through a vendored relative path instead of npm resolution, so the
Worker bundles even when no `node_modules` exists.

Files next to this document:

| File | What it is |
| --- | --- |
| `CLOUDFLARE_NPM_FREE_FIX.patch` | The whole change as a patch (21 files, +2,618/−55), based on commit `5425684` |
| `CLOUDFLARE_NPM_FREE_FIX.bundle` | The same two commits as real git objects (`86de987`, parent `b9237f5`) |

Both apply to the current `arena/01a10b7f-playwright-practice-studio` head (`5425684`)
**and** to `main`, whose tree is identical.

---

## Option 1 — apply and push to the arena branch

```bash
git clone https://github.com/pavandutt1987/playwright-practice-studio.git
cd playwright-practice-studio
git checkout arena/01a10b7f-playwright-practice-studio

git apply /path/to/CLOUDFLARE_NPM_FREE_FIX.patch
git add -A
git commit -m "Bundle the container helper without npm (vendored import)"
git push origin arena/01a10b7f-playwright-practice-studio
```

Note: this branch is **not** the one Workers Builds deploys. A build of a
non-production branch only runs `wrangler versions upload` — no container image is
built or rolled out. Use Option 2 to fix the actual deployment.

## Option 2 — apply and push to `main` (this is what fixes the deploy)

```bash
git clone https://github.com/pavandutt1987/playwright-practice-studio.git
cd playwright-practice-studio
git checkout main

git apply /path/to/CLOUDFLARE_NPM_FREE_FIX.patch
git add -A
git commit -m "Bundle the container helper without npm (vendored import)"
git push origin main
```

## Option 3 — pull the exact commits out of the bundle

```bash
git clone https://github.com/pavandutt1987/playwright-practice-studio.git
cd playwright-practice-studio
git fetch /path/to/CLOUDFLARE_NPM_FREE_FIX.bundle npm-free-fix:fix
git checkout main && git merge fix     # or: git checkout <branch> && git merge fix
git push origin main
```

## Option 4 — new branch + pull request (recommended if `main` is protected)

```bash
git clone https://github.com/pavandutt1987/playwright-practice-studio.git
cd playwright-practice-studio
git checkout main && git pull
git checkout -b fix/cloudflare-npm-free-bundle

git apply /path/to/CLOUDFLARE_NPM_FREE_FIX.patch
git add -A
git commit -m "Bundle the container helper without npm (vendored import)"
git push -u origin fix/cloudflare-npm-free-bundle

gh pr create --base main --fill     # or open the PR from the GitHub web UI
```

With the bundle instead of the patch:

```bash
git fetch /path/to/CLOUDFLARE_NPM_FREE_FIX.bundle npm-free-fix:fix/cloudflare-npm-free-bundle
git push -u origin fix/cloudflare-npm-free-bundle
```

Caveat: a preview build of this branch will not prove the deploy works. Workers
Builds only does the full image build and rollout for the production branch; other
branches run `wrangler versions upload`, and Durable Object Workers have no Version
URL to preview. The branch is for review and for the merge — the proof comes from a
fresh build of `main` after the PR merges.

---

## Verify before you push (optional, no Docker needed)

```bash
npm ci
npm run cf:doctor          # should print PASS for "resolves without node_modules"
npx wrangler deploy --dry-run --containers-rollout=none
```

The dry run should end with `Total Upload: ~57 KiB` and list the
`STUDIO_CONTAINER` Durable Object binding. It bundles the root `Dockerfile` as the
container image.

## If the build now fails at `/accounts/<id>/containers/me`

This is a *different* error from the bundling one, and it appears later in the
pipeline: the Worker uploads, the Docker image builds, and then Wrangler asks
Cloudflare for the account's container configuration before pushing the image to
`registry.cloudflare.com`. It is an account/credential problem, never a code problem.

Two documented causes:

1. **The account is on the Free plan.** Containers are part of the Workers Paid plan
   ($5/month). On a Free account this endpoint returns an opaque `403 Authentication
   error` — Cloudflare has an open bug report about exactly this confusing message
   (developer-platform issue #26). Check **Dashboard → Workers & Pages → Plans**.
   If it says Free, upgrade, then start a new build.
2. **The build's API token has no Containers permission.** Workers Builds creates its
   own token, and its documented permissions are Account Settings (read), Workers
   Scripts (edit), Workers KV Storage (edit), Workers R2 Storage (edit), Workers Routes
   (edit), User Details (read), Memberships (read) — **no Containers**. Fix:
   **Worker → Settings → Build → API token → Create new token** (or select one you
   own) and grant **Containers: Edit** plus **Workers Scripts: Edit**, save, then start
   a **new** build.

Both are visible in the log as the indented lines directly under the `... failed.`
line. `Authentication error` / 403 points at the plan or the token; a 5xx with
`Retrying API call after error` is transient.

To prove the account itself can deploy containers (and rule out the build token),
run locally from the repo root with Docker Desktop running:

```powershell
npm ci
npx wrangler login          # OAuth grants every scope, including Containers
npx wrangler deploy
```

If that succeeds, the account is fine and the fix is the token in Workers Builds.
If it fails at the same endpoint, it is the plan.

---

## In Cloudflare, after the push

1. Workers & Pages → your Worker → Settings → **Builds**.
2. Build command: `npm ci`
3. Deploy command: `npm ci && npm run cf:doctor && npx wrangler deploy`
4. Start a **fresh build** — do **not** press "Retry deployment", which re-runs the
   original commit recorded in that deployment.

A good build log shows ~51 installed packages, no `npm warn exec … wrangler@…` line,
`cf:doctor` PASS lines, and `Total Upload: ~57 KiB`.