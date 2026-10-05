/**
 * Cloudflare Worker entry point for Playwright Practice Studio.
 *
 * The Worker does two things:
 *   1. Optionally gates every request behind HTTP Basic auth (see ./access.ts),
 *      which keeps an internet-facing Studio from being an open code runner.
 *   2. Proxies everything else to a single Cloudflare Container running the
 *      FastAPI app + Chromium (see ../Dockerfile).
 */

// Imported with a plain relative path to the vendored copy rather than the bare
// specifier "@cloudflare/containers". A relative path needs no npm install and no
// `alias` entry, so the Worker bundles in any build environment - including one
// where `npm ci` never ran. See ../vendor/containers/README.md.
import { Container, getContainer } from "../vendor/containers/index.js";
import { checkAccess } from "./access";

export class StudioContainer extends Container {
  /** The port uvicorn listens on inside the container (see ../start_web.sh). */
  defaultPort = 8000;

  /** Stay warm between edits, then scale to zero (billing stops while asleep). */
  sleepAfter = "10m";

  /** Passed to the container process as environment variables. */
  envVars = {
    PORT: "8000",
    PYTHONUNBUFFERED: "1",
    // Cloudflare container disks are ephemeral, so the SQLite history file lives
    // in /tmp and resets whenever the instance sleeps. Move this to a mounted
    // volume on a host with persistent disk if you need history to survive.
    STUDIO_DB_PATH: "/tmp/history.db",
    STUDIO_ALLOWED_ORIGINS: "*",
  };
}

interface Env {
  STUDIO_CONTAINER: DurableObjectNamespace<StudioContainer>;
  STUDIO_ACCESS_PASSWORD?: string;
  STUDIO_ACCESS_USER?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const denied = checkAccess(request, {
      password: env.STUDIO_ACCESS_PASSWORD,
      username: env.STUDIO_ACCESS_USER,
    });
    if (denied) return denied;

    // Use fetch() rather than containerFetch(): only fetch() proxies WebSocket
    // upgrades, and the Studio needs /ws/run for streaming console output.
    return getContainer(env.STUDIO_CONTAINER).fetch(request);
  },
};
