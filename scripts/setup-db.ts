import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const steps = [
  `create table if not exists machines (id text primary key, name text not null, created_at timestamptz not null default now())`,
  `create table if not exists api_keys (key_hash text primary key, machine_id text not null references machines(id) on delete cascade, created_at timestamptz not null default now())`,
  `create table if not exists readings (machine_id text not null, ts bigint not null, vibration double precision not null, temperature double precision not null, rpm double precision not null, pressure double precision not null)`,
  `create index if not exists readings_machine_ts on readings (machine_id, ts desc)`,
];
(async () => { for (const s of steps) await sql.query(s); console.log("Database ready."); })().catch((e) => { console.error(e.message); process.exit(1); });
