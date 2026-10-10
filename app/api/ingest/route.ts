import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { CH, db, dbReady } from "@/lib/db";

export const runtime = "nodejs";
const err = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

/** Devices POST here with their machine API key. Accepts one reading, an array, or { readings: [...] }. */
export async function POST(req: Request) {
  if (!dbReady()) return err("Database is not configured.", 503);
  const key = req.headers.get("x-api-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!key) return err("Missing API key. Send it in the x-api-key header.", 401);
  const sql = db();
  const hash = createHash("sha256").update(key).digest("hex");
  const found = (await sql`select machine_id from api_keys where key_hash = ${hash}`) as any[];
  if (!found.length) return err("Invalid API key.", 401);
  const machine = found[0].machine_id as string;

  const body = await req.json().catch(() => null);
  const list: any[] = Array.isArray(body) ? body : Array.isArray(body?.readings) ? body.readings : body ? [body] : [];
  if (!list.length || list.length > 500) return err("Send between 1 and 500 readings per request.", 400);
  const now = Date.now();
  const rows = list.filter((r) => CH.every((c) => typeof r?.[c] === "number" && Number.isFinite(r[c]))).map((r) => ({ ...r, ts: Number(r.ts) > 1e12 ? Number(r.ts) : now }));
  if (!rows.length) return err("Each reading needs numeric vibration, temperature, rpm and pressure.", 400);

  await sql`insert into readings (machine_id, ts, vibration, temperature, rpm, pressure)
    select ${machine}::text, * from unnest(${rows.map((r) => r.ts)}::bigint[], ${rows.map((r) => r.vibration)}::float8[], ${rows.map((r) => r.temperature)}::float8[], ${rows.map((r) => r.rpm)}::float8[], ${rows.map((r) => r.pressure)}::float8[])`;
  if (Math.random() < 0.02) await sql`delete from readings where ts < ${now - 7 * 864e5}`; // keep 7 days
  return NextResponse.json({ ok: true, saved: rows.length });
}
