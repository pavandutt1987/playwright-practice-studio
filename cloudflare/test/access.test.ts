/**
 * Unit tests for the edge access gate.
 *
 * Runs on plain Node (no Workers runtime, no Docker, no network):
 *   npm test
 *
 * Node's --experimental-strip-types removes the TypeScript types at load time;
 * this file deliberately imports ./access.ts, which has no dependencies.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkAccess, parseBasicAuth, timingSafeEqual, unauthorizedResponse } from "../src/access.ts";

const PASSWORD = "s3cret-studio-password";
const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
const request = (authorization?: string) =>
  new Request("https://studio.example.com/login", {
    headers: authorization ? { authorization } : {},
  });

test("gate is disabled when no password is configured", () => {
  assert.equal(checkAccess(request(), {}), null);
  assert.equal(checkAccess(request(), { password: "" }), null);
});

test("rejects requests without credentials", () => {
  const response = checkAccess(request(), { password: PASSWORD });
  assert.ok(response instanceof Response);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /^Basic realm="Playwright Practice Studio"/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects a wrong password", () => {
  const response = checkAccess(request(`Basic ${b64(`studio:not-the-password`)}`), { password: PASSWORD });
  assert.equal(response?.status, 401);
});

test("accepts the right password with any username", () => {
  assert.equal(checkAccess(request(`Basic ${b64(`anything:${PASSWORD}`)}`), { password: PASSWORD }), null);
});

test("the username is only enforced when configured", () => {
  const header = `Basic ${b64(`nobody:${PASSWORD}`)}`;
  assert.equal(checkAccess(request(header), { password: PASSWORD }), null);
  assert.equal(checkAccess(request(header), { password: PASSWORD, username: "studio" })?.status, 401);
  assert.equal(checkAccess(request(`Basic ${b64(`studio:${PASSWORD}`)}`), { password: PASSWORD, username: "studio" }), null);
});

test("passwords with non-ASCII characters survive the round trip", () => {
  const unicode = "wachtwoord-ÄÖÜ-Ω-🎭";
  assert.equal(checkAccess(request(`Basic ${b64(`u:${unicode}`)}`), { password: unicode }), null);
});

test("malformed headers are rejected instead of throwing", () => {
  const malformed = [
    "Basic not-base64!!",
    "Basic " + b64("no-colon-here"),
    b64(`studio:${PASSWORD}`),           // missing scheme
    "Bearer " + b64(`studio:${PASSWORD}`), // wrong scheme
    "Basic",
    "",
  ];
  for (const header of malformed) {
    const response = checkAccess(request(header), { password: PASSWORD });
    assert.equal(response?.status, 401, `expected 401 for header: ${JSON.stringify(header)}`);
  }
});

test("parseBasicAuth and timingSafeEqual behave at the edges", () => {
  assert.equal(parseBasicAuth(null), null);
  assert.deepEqual(parseBasicAuth(`Basic ${b64("user:pa:ss:word")}`), { username: "user", password: "pa:ss:word" });
  assert.ok(timingSafeEqual("abc", "abc"));
  assert.ok(!timingSafeEqual("abc", "abd"));
  assert.ok(!timingSafeEqual("abc", "abcd"));
  assert.ok(timingSafeEqual("", ""));
});

test("custom realm is echoed back in the challenge", () => {
  const response = unauthorizedResponse("My Studio");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), 'Basic realm="My Studio", charset="UTF-8"');
});
