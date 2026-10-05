#!/usr/bin/env node
/**
 * Preflight check for the Cloudflare Worker build.
 *
 * Run it before (or instead of) a deploy to get a plain-English reason when the
 * bundle is about to fail:
 *
 *   npm run cf:doctor
 *
 * It exists because Workers Builds reports the resulting problem as
 * `Could not resolve "@cloudflare/containers"`, which does not say *why* - the
 * usual cause being that node_modules was never installed at the repository root.
 *
 * Dependency-free on purpose: it must run and report clearly even when nothing
 * is installed.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

// Resolve the way the bundler does: from the Worker entry point upwards
// (cloudflare/src/node_modules -> cloudflare/node_modules -> root node_modules).
const requireFromWorker = createRequire(join(ROOT, "cloudflare", "src", "index.ts"));

const results = [];
const check = (label, fn) => {
  try {
    results.push({ ok: true, label, detail: fn() });
  } catch (error) {
    results.push({ ok: false, label, detail: error.message });
  }
};

/** Strips // comments so the JSONC Wrangler config can be parsed. */
const parseJsonc = (text) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));

check("Node.js >= 18", () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) throw new Error(`found v${process.versions.node}, need v18 or newer`);
  return `v${process.versions.node}`;
});

check('"@cloudflare/containers" resolves from cloudflare/src/index.ts', () => {
  const entry = requireFromWorker.resolve("@cloudflare/containers");
  return entry.replace(ROOT + "/", "");
});

check("wrangler is installed locally", () => {
  const bin = join(ROOT, "node_modules", ".bin", "wrangler");
  if (!existsSync(bin)) {
    throw new Error(
      "no node_modules/.bin/wrangler - the deploy would fall back to downloading wrangler " +
        'via npx ("npm warn exec ... wrangler@..."). Run: npm ci',
    );
  }
  return "node_modules/.bin/wrangler";
});

check("wrangler.jsonc references existing files", () => {
  const configPath = join(ROOT, "wrangler.jsonc");
  if (!existsSync(configPath)) throw new Error("wrangler.jsonc is missing from the repository root");

  const config = parseJsonc(readFileSync(configPath, "utf8"));
  const problems = [];
  if (config.main && !existsSync(resolve(ROOT, config.main))) problems.push(`main: ${config.main}`);
  for (const container of config.containers ?? []) {
    if (container.image && !existsSync(resolve(ROOT, container.image))) {
      problems.push(`container image: ${container.image}`);
    }
  }
  if (problems.length) throw new Error(`config points at missing file(s): ${problems.join(", ")}`);

  const containers = (config.containers ?? []).length;
  return `${containers} container(s), main=${config.main}`;
});

// --- report -----------------------------------------------------------------
const context = [
  ["WORKERS_CI_COMMIT_SHA", process.env.WORKERS_CI_COMMIT_SHA],
  ["WORKERS_CI_BRANCH", process.env.WORKERS_CI_BRANCH],
  ["GITHUB_SHA", process.env.GITHUB_SHA],
  ["GITHUB_REF_NAME", process.env.GITHUB_REF_NAME],
]
  .filter(([, value]) => value)
  .map(([name, value]) => `${name}=${value}`);

console.log(`\nCloudflare Worker preflight  (repo root: ${ROOT})`);
if (context.length) console.log(`build context: ${context.join("  ")}`);
console.log("-".repeat(64));

for (const { ok, label, detail } of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`        ${detail}`);
}

const failures = results.filter((r) => !r.ok);
console.log("-".repeat(64));

if (failures.length === 0) {
  console.log("Ready to deploy: npm run cf:deploy\n");
  process.exit(0);
}

console.log(`${failures.length} check(s) failed. Most common cause: dependencies were never`);
console.log("installed at the repository root. Fix:\n");
console.log("    npm ci          # installs @cloudflare/containers + wrangler at the root");
console.log("\nOn Cloudflare Workers Builds, set the build command to `npm ci`");
console.log("(not `pip install -r requirements.txt` - the Python deps belong in the image).\n");
process.exit(1);
