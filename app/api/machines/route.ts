import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { db, dbReady } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  if (!dbReady()) return NextResponse.json({ ok: false, error: "no_database", machines: [] });
  const rows = (await db()`select m.id, m.name, (select max(ts) from readings r where r.machine_id = m.id) as last_seen from machines m order by m.created_at desc`) as any[];
  return NextResponse.json({ ok: true, machines: rows.map((r) => ({ id: r.id, name: r.name, lastSeen: r.last_seen ? Number(r.last_seen) : null })) });
}

export async function POST(req: Request) {
  if (!dbReady()) return NextResponse.json({ ok: false, error: "Database is not configured. Add DATABASE_URL." }, { status: 503 });
  const name = String((await req.json().catch(() => null))?.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ ok: false, error: "Give the machine a name." }, { status: 400 });
  const id = "m_" + randomBytes(4).toString("hex"), apiKey = "pg_" + randomBytes(24).toString("hex");
  const sql = db();
  await sql`insert into machines (id, name) values (${id}, ${name})`;
  await sql`insert into api_keys (key_hash, machine_id) values (${createHash("sha256").update(apiKey).digest("hex")}, ${id})`;
  return NextResponse.json({ ok: true, machine: { id, name }, apiKey }); // the key is shown once and never stored in plain text
}
