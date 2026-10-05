/**
 * Access gate that runs at the edge, in front of the container.
 *
 * The Studio executes whatever code is typed into it, so a public URL is an
 * open code-execution service. This module is the cheapest way to close that:
 * HTTP Basic auth checked by the Worker before a single byte reaches the
 * container.
 *
 * Behaviour:
 *   * No password configured -> the gate is disabled and every request passes
 *     (fine for `wrangler dev` on your laptop, dangerous in production).
 *   * Password configured   -> every request needs a matching
 *     `Authorization: Basic ...` header, otherwise it gets a 401 with a
 *     `WWW-Authenticate` challenge, which makes the browser prompt for
 *     credentials.
 *
 * Any username is accepted unless one is configured; the password is what
 * matters. Keep the real value in a Wrangler secret:
 *
 *   npx wrangler secret put STUDIO_ACCESS_PASSWORD
 *
 * No dependencies, so this logic can be unit tested with plain Node.
 */

export interface AccessConfig {
  /** Shared password. When empty/undefined the gate is disabled. */
  password?: string;
  /** Optional fixed username. When omitted any username is accepted. */
  username?: string;
  /** Realm shown in the browser's credential prompt. */
  realm?: string;
}

const DEFAULT_REALM = "Playwright Practice Studio";

const UNAUTHORIZED_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>401 - Sign in required</title>
<style>
  body { background:#0f172a; color:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .box { border:1px solid #334155; background:#1e293b; border-radius:12px; padding:28px 32px; max-width:420px; text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; }
  p  { color:#94a3b8; font-size:14px; line-height:1.5; margin:0; }
  code { color:#38bdf8; }
</style></head>
<body><div class="box">
  <h1>🔒 Sign in required</h1>
  <p>This Studio instance is private. Enter the access password when prompted,
     or set the <code>Authorization</code> header when calling it from a test.</p>
</div></body></html>`;

function decodeBase64(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Splits a Basic auth header into username/password, or null if malformed. */
export function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (!scheme || !encoded || scheme.toLowerCase() !== "basic") return null;

  const decoded = decodeBase64(encoded);
  if (decoded === null) return null;

  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

/** Length-independent comparison, so failures do not leak the password length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

export function unauthorizedResponse(realm: string = DEFAULT_REALM): Response {
  return new Response(UNAUTHORIZED_PAGE, {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "www-authenticate": `Basic realm="${realm}", charset="UTF-8"`,
    },
  });
}

/**
 * Returns a 401 Response when the request must be rejected, or null when it may
 * be forwarded to the container.
 */
export function checkAccess(request: Request, config: AccessConfig = {}): Response | null {
  const expectedPassword = config.password ?? "";
  if (!expectedPassword) return null; // gate disabled

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  if (!credentials) return unauthorizedResponse(config.realm);

  if (config.username && !timingSafeEqual(credentials.username, config.username)) {
    return unauthorizedResponse(config.realm);
  }
  if (!timingSafeEqual(credentials.password, expectedPassword)) {
    return unauthorizedResponse(config.realm);
  }
  return null;
}
