# Vendored: @cloudflare/containers

This directory is a **verbatim copy** of the compiled `dist/` output of the npm package
[`@cloudflare/containers`](https://www.npmjs.com/package/@cloudflare/containers), so the
Worker can be bundled **without `node_modules` being installed**.

| | |
|---|---|
| Package | `@cloudflare/containers` |
| Version | `0.3.7` (see `package.json.orig`) |
| Upstream | https://github.com/cloudflare/workers-sdk (packages/containers) |
| License | MIT OR Apache-2.0 (as declared by the package) |
| Copied | `dist/**` -> this directory, unchanged |

## Why vendor instead of importing from node_modules?

The Worker bundles `cloudflare/src/index.ts`, which imports `@cloudflare/containers`. When
a build environment runs `wrangler deploy` without having installed `node_modules` at the
repository root, the bundler fails with:

```
✘ [ERROR] Could not resolve "@cloudflare/containers"
```

`cloudflare/src/index.ts` therefore imports this copy with a plain relative path, which
needs no npm install and no `alias` entry:

```ts
import { Container, getContainer } from "../vendor/containers/index.js";
```

The package is a good fit for vendoring: **zero dependencies**, ~1,800 lines, and its only
non-local import is the `cloudflare:workers` runtime builtin, which the Workers runtime
provides at runtime and the bundler recognises.

## Maintaining it

The npm dependency is still declared in the root `package.json` (it supplies the
TypeScript types for `npm run cf:typecheck`), so to update:

```bash
npm install @cloudflare/containers@latest
rm -rf cloudflare/vendor/containers
mkdir -p cloudflare/vendor/containers
cp -r node_modules/@cloudflare/containers/dist/. cloudflare/vendor/containers/
cp node_modules/@cloudflare/containers/package.json cloudflare/vendor/containers/package.json.orig
npm run cf:doctor        # verifies the vendored copy resolves
npx wrangler deploy --config wrangler.jsonc --dry-run --containers-rollout=none
```

Keep this file and the upstream version in sync when you update the copy.
