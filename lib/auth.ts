/** Signed-cookie session using Web Crypto, so it works in both middleware (edge) and route handlers. */
export const COOKIE = "pg_session";
export const MAX_AGE = 8 * 60 * 60; // seconds
const enc = new TextEncoder();
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const key = (s: string) => crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sign = async (data: string, secret: string) => b64(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(data)));

export async function createSession(user: string, secret: string) {
  const body = btoa(JSON.stringify({ u: user, exp: Date.now() + MAX_AGE * 1000 })).replace(/=+$/, "");
  return `${body}.${await sign(body, secret)}`;
}
export async function verifySession(token: string | undefined, secret: string | undefined) {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || (await sign(body, secret)) !== sig) return null;
  try { const p = JSON.parse(atob(body)); return p.exp > Date.now() ? (p.u as string) : null; } catch { return null; }
}
