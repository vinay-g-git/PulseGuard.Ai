"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";

type M = { id: string; name: string; lastSeen: number | null };

export default function Devices() {
  const [machines, setMachines] = useState<M[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const d = await (await fetch("/api/machines")).json().catch(() => ({}));
    if (d.error === "no_database") setError("Database is not connected yet. Add DATABASE_URL and run npm run db:setup.");
    setMachines(d.machines ?? []);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { setNow(Date.now()); void load(); }, 5000); return () => clearInterval(t); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault(); setError("");
    const d = await (await fetch("/api/machines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })).json().catch(() => ({}));
    if (!d.ok) return setError(d.error ?? "Could not add the machine.");
    setFresh({ name: d.machine.name, key: d.apiKey }); setName(""); void load();
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const curl = fresh ? `curl -X POST ${origin}/api/ingest \\\n  -H "x-api-key: ${fresh.key}" -H "Content-Type: application/json" \\\n  -d '{"vibration":2.5,"temperature":70,"rpm":1480,"pressure":5.0}'` : "";
  const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline focus:outline-2 focus:outline-indigo-400";

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Connected machines</h1>
        <p className="mt-1 text-sm text-slate-600">Add a machine, then send its readings to your website with the API key. Pick it as the Source on the dashboard to watch it live.</p>
      </div>

      <form onSubmit={add} className="flex flex-wrap gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Machine name, e.g. Pump 01" required className={`${field} min-w-[240px] flex-1`} />
        <button className="rounded-lg bg-[#10222B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1B3744]">Add machine</button>
      </form>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {fresh && (
        <section className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold">{fresh.name} added. Copy this API key now. It is shown only once.</p>
          <code className="block break-all rounded bg-white p-2">{fresh.key}</code>
          <p>Test it from a terminal (Mac/Linux; on Windows use curl.exe), or run <code>npm run sensor</code> with this key:</p>
          <pre className="overflow-x-auto rounded bg-white p-2 text-xs">{curl}</pre>
        </section>
      )}

      <ul className="divide-y rounded-xl border">
        {machines.length === 0 && <li className="p-4 text-sm text-slate-500">No machines yet. Add one above.</li>}
        {machines.map((m) => {
          const on = m.lastSeen !== null && now - m.lastSeen < 15000;
          return (
            <li key={m.id} className="flex items-center justify-between p-4 text-sm">
              <span className="font-medium">{m.name}</span>
              <span className={on ? "text-emerald-700" : "text-slate-500"}>{on ? "Receiving data" : m.lastSeen ? `Last data ${Math.round((now - m.lastSeen) / 1000)}s ago` : "No data yet"}</span>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
