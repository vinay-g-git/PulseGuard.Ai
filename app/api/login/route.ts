import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE, MAX_AGE, createSession } from "@/lib/auth";

export const runtime = "nodejs";
const h = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(h(a), h(b));

/** AUTH_USERS="alice:pass1,bob:pass2" (split on the first colon, so passwords may contain colons). */
function users() {
  return (process.env.AUTH_USERS ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(":");
    return i > 0 ? ([p.slice(0, i), p.slice(i + 1)] as const) : null;
  }).filter((x): x is readonly [string, string] => !!x);
}

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  const list = users();
  if (!secret || secret.length < 16 || !list.length) return NextResponse.json({ ok: false, error: "Sign-in is not set up yet. Add AUTH_SECRET and AUTH_USERS to the environment." }, { status: 503 });
  const body = await req.json().catch(() => null);
  const u = String(body?.username ?? "").trim(), p = String(body?.password ?? "");
  const hit = list.find(([name, pass]) => same(name, u) && same(pass, p));
  if (!hit) return NextResponse.json({ ok: false, error: "Wrong username or password." }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await createSession(hit[0], secret), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
  return res;
}
