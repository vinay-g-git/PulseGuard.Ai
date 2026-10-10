import { NextResponse } from "next/server";
import { db, dbReady } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const u = new URL(req.url), machine = u.searchParams.get("machine") ?? "", after = Number(u.searchParams.get("after") ?? 0) || 0;
  if (!dbReady() || !machine) return NextResponse.json({ ok: false, readings: [] });
  const sql = db();
  const rows = (after > 0
    ? await sql`select ts, vibration, temperature, rpm, pressure from readings where machine_id = ${machine} and ts > ${after} order by ts asc limit 300`
    : await sql`select * from (select ts, vibration, temperature, rpm, pressure from readings where machine_id = ${machine} order by ts desc limit 60) x order by ts asc`) as any[];
  return NextResponse.json({ ok: true, readings: rows.map((r) => ({ ts: Number(r.ts), vibration: r.vibration, temperature: r.temperature, rpm: r.rpm, pressure: r.pressure })) });
}
