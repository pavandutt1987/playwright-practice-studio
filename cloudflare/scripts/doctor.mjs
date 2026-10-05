#!/usr/bin/env node
/**
 * Preflight check for the Cloudflare Worker build.
 *
 *   npm run cf:doctor
 *
 * It exists because the bundler reports a missing dependency as
 * `Could not resolve "@cloudflare/containers"`, which does not say *why* - the
 * usual cause being that node_modules was never installed at the repository root.
 *
 * Failures (non-zero exit) are things that will break the deploy. Warnings are
 * things that will still work but are worth fixing.
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
/** @param {"fail"|"warn"} severity */
const check = (label, fn, severity = "fail") => {
  try {
    results.push({ ok: true, severity, label, detail: fn() });
  } catch (error) {
    results.push({ ok: false, severity, label, detail: error.message });
  }
};

/** Strips // comments so the JSONC Wrangler config can be parsed. */
const parseJsonc = (text) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));

const readConfig = () => parseJsonc(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8"));

check("Node.js >= 18", () => {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) throw new Error(`found v${process.versions.node}, need v18 or newer`);
  return `v${process.versions.node}`;
});

check("the container helper resolves without node_modules", () => {
  // cloudflare/src/index.ts imports the vendored copy by relative path, so the
  // bundle never resolves a bare npm specifier. Verify the file it points at
  // exists and that no bare "@cloudflare/containers" import has crept back in.
  const workerEntry = join(ROOT, "cloudflare", "src", "index.ts");
  if (!existsSync(workerEntry)) throw new Error("cloudflare/src/index.ts is missing");

  const source = readFileSync(workerEntry, "utf8");
  if (/from\s+["']@cloudflare\/containers["']/.test(source)) {
    throw new Error(
      'cloudflare/src/index.ts imports the bare specifier "@cloudflare/containers" again, ' +
        'which fails unless npm ci ran. Import "../vendor/containers/index.js" instead.',
    );
  }

  const match = source.match(/from\s+["'](\.[^"']*vendor\/containers[^"']*)["']/);
  if (!match) throw new Error("no relative import of the vendored container helper found in index.ts");

  const target = resolve(dirname(workerEntry), match[1]);
  if (!existsSync(target)) throw new Error(`index.ts imports "${match[1]}", but ${target} does not exist`);

  // Report the vendored version so it can be compared with the npm package.
  const vendoredPkg = join(ROOT, "cloudflare", "vendor", "containers", "package.json.orig");
  const version = existsSync(vendoredPkg) ? JSON.parse(readFileSync(vendoredPkg, "utf8")).version : "unknown";
  return `vendored copy v${version} -> ${match[1]} (node_modules not required)`;
});

check(
  "the npm package is still available for TypeScript types",
  () => {
    const entry = requireFromWorker.resolve("@cloudflare/containers");
    return `via node_modules -> ${entry.replace(ROOT + "/", "")}`;
  },
  "warn", // only needed for `npm run cf:typecheck`; the bundle uses the vendored copy
);

check(
  "wrangler is installed locally",
  () => {
    const bin = join(ROOT, "node_modules", ".bin", "wrangler");
    if (!existsSync(bin)) {
      throw new Error(
        "not installed, so the deploy command falls back to downloading it " +
          '("npm warn exec ... wrangler@..."). Harmless, but run: npm ci',
      );
    }
    return "node_modules/.bin/wrangler";
  },
  "warn", // npx can still fetch wrangler, so this does not block a deploy
);

check("wrangler.jsonc references existing files", () => {
  const config = readConfig();
  const problems = [];
  if (config.main && !existsSync(resolve(ROOT, config.main))) problems.push(`main: ${config.main}`);
  for (const container of config.containers ?? []) {
    if (container.image && !existsSync(resolve(ROOT, container.image))) {
      problems.push(`container image: ${container.image}`);
    }
  }
  for (const [specifier, target] of Object.entries(config.alias ?? {})) {
    if (!existsSync(resolve(ROOT, target))) problems.push(`alias ${specifier}: ${target}`);
  }
  if (problems.length) throw new Error(`config points at missing file(s): ${problems.join(", ")}`);

  return `${(config.containers ?? []).length} container(s), main=${config.main}`;
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
console.log("-".repeat(68));

for (const { ok, severity, label, detail } of results) {
  const tag = ok ? "PASS" : severity === "warn" ? "WARN" : "FAIL";
  console.log(`  ${tag}  ${label}`);
  console.log(`        ${detail}`);
}

const failures = results.filter((r) => !r.ok && r.severity === "fail");
const warnings = results.filter((r) => !r.ok && r.severity === "warn");
console.log("-".repeat(68));

if (failures.length === 0) {
  console.log(
    warnings.length
      ? `Ready to deploy (${warnings.length} warning). Run: npm run cf:deploy\n`
      : "Ready to deploy: npm run cf:deploy\n",
  );
  process.exit(0);
}

console.log(`${failures.length} check(s) failed - the deploy would not bundle.`);
console.log("Most common cause: dependencies were never installed at the repository");
console.log("root. Fix:\n");
console.log("    npm ci          # installs @cloudflare/containers + wrangler at the root");
console.log("\nOn Cloudflare Workers Builds, set the build command to `npm ci`");
console.log("(not `pip install -r requirements.txt` - the Python deps belong in the image).");
console.log("See cloudflare/README.md -> Diagnosing a failed deploy.\n");
process.exit(1);
