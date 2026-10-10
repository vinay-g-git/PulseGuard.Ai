"use client";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BASELINE, CHANNELS, Channel, Reading, Scenario, Simulator } from "@/lib/simulator";
import { Baseline, Detector, SEVERITY_LABEL } from "@/lib/detector";
import { AlertManager, Incident } from "@/lib/alertManager";
import { LEVELS, alertText } from "@/lib/voice";
import { VoiceSource, enqueueSpeech, onVoiceSource, stopSpeech } from "@/lib/voiceClient";

const SCENARIOS: { v: Scenario; l: string }[] = [
  { v: "normal", l: "Normal" }, { v: "spike", l: "Sudden Spike" }, { v: "drift", l: "Gradual Drift" },
  { v: "dead_sensor", l: "Dead Sensor" }, { v: "flicker", l: "Flickering Sensor" }, { v: "multi", l: "Multi-Sensor Shift" },
];
const DEMO: { s: Scenario; n: number }[] = [
  { s: "normal", n: 25 }, { s: "spike", n: 35 }, { s: "normal", n: 15 }, { s: "drift", n: 45 }, { s: "normal", n: 20 },
  { s: "dead_sensor", n: 15 }, { s: "flicker", n: 30 }, { s: "normal", n: 15 }, { s: "multi", n: 25 }, { s: "normal", n: 15 },
];
const TYPE_LABEL = { SPIKE: "Sudden spike", DRIFT: "Gradual deterioration", MULTIVARIATE: "Multi-sensor shift", SENSOR_FAULT: "Sensor fault" } as const;
const COLORS: Record<Channel, string> = { vibration: "#6366f1", temperature: "#f97316", rpm: "#0ea5e9", pressure: "#10b981" };
const SEV_CLASS = ["bg-slate-100 text-slate-600", "bg-amber-100 text-amber-800", "bg-orange-100 text-orange-800", "bg-red-100 text-red-800"];
type Point = Reading & { i: number };

function parseCsv(text: string): Reading[] | null {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].toLowerCase().split(",").map((s) => s.trim());
  const idx = CHANNELS.map((c) => head.indexOf(c));
  if (idx.some((i) => i < 0)) return null;
  return lines.slice(1).filter(Boolean).map((l) => {
    const p = l.split(",");
    const row: Reading = { t: 0, scenario: "normal", vibration: null, temperature: null, rpm: null, pressure: null };
    CHANNELS.forEach((c, k) => { const x = parseFloat(p[idx[k]]); row[c] = isNaN(x) ? null : x; });
    return row;
  });
}

function Spark({ vals, color }: { vals: (number | null)[]; color: string }) {
  const v = vals.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const lo = Math.min(...v), rng = Math.max(...v) - lo || 1, W = 220, H = 30;
  let d = "", prev = false;
  vals.forEach((x, i) => {
    if (x === null) { prev = false; return; }
    d += `${prev ? "L" : "M"}${((i / (vals.length - 1)) * W).toFixed(1)},${(H - ((x - lo) / rng) * H).toFixed(1)} `;
    prev = true;
  });
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full"><path d={d} fill="none" stroke={color} strokeWidth={1.8} /></svg>;
}

export default function Dashboard() {
  const sim = useRef(new Simulator());
  const det = useRef(new Detector());
  const mgr = useRef(new AlertManager());
  const recent = useRef<Reading[]>([]);
  const demo = useRef<{ i: number; left: number } | null>(null);
  const replay = useRef<{ rows: Reading[]; idx: number } | null>(null);
  const n = useRef(0);
  const [base, setBase] = useState<Baseline | null>(null);
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demoOn, setDemoOn] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [csvMode, setCsvMode] = useState<"replay" | "baseline">("replay");
  const [md, setMd] = useState<number | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [machines, setMachines] = useState<{ id: string; name: string }[]>([]);
  const [liveId, setLiveId] = useState("");
  const live = useRef<{ queue: any[]; after: number; learn: Reading[] | null } | null>(null);
  // Voice + Telegram alerts. Voice starts OFF: browsers only allow sound after a click, and the click on the toggle unlocks it.
  const [voiceOn, setVoiceOn] = useState(false);
  const [tgOn, setTgOn] = useState(false);
  const [level, setLevel] = useState(2); // minimum peak severity that alerts: 1 all, 2 high+, 3 critical only
  const [tgInfo, setTgInfo] = useState<{ configured: boolean; voice: boolean } | null>(null);
  const [voiceSrc, setVoiceSrc] = useState<VoiceSource>("none");
  const voiceSeen = useRef(new Map<string, number>()); // incidentId -> highest severity already announced aloud
  const tgSeen = useRef(new Map<string, number>());    // same, for Telegram

  function calibrate(samples?: Reading[]) {
    let hist = samples;
    if (!hist) { const s = new Simulator(); hist = Array.from({ length: 120 }, () => s.next()); } // "historical" normal data
    if (!det.current.calibrate(hist)) return false;
    mgr.current.reset();
    recent.current = hist.slice(-30);
    n.current = 0;
    setHistory(hist.slice(-60).map((r) => ({ ...r, i: ++n.current })));
    setIncidents([]);
    setBase(det.current.baseline);
    return true;
  }
  useEffect(() => { calibrate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onVoiceSource(setVoiceSrc);
    fetch("/api/notify").then((r) => r.json()).then(setTgInfo).catch(() => setTgInfo({ configured: false, voice: false }));
    return () => { onVoiceSource(null); stopSpeech(); };
  }, []);

  async function sendTelegram(inc: Incident) {
    try {
      const res = await fetch("/api/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: true, incident: { incidentId: inc.incidentId, type: inc.type, peakSeverity: inc.peakSeverity, channels: inc.channels, message: inc.message, metrics: inc.metrics, prediction: inc.prediction } }),
      });
      const d = await res.json();
      if (!d.ok) setMsg(`Telegram alert failed: ${d.error ?? res.status}`);
    } catch { setMsg("Telegram alert failed: network error."); }
  }

  // Fire a spoken / Telegram alert once per incident, and again only if its severity escalates.
  useEffect(() => {
    for (const inc of incidents) {
      if (inc.status === "RESOLVED") continue;
      const peak = inc.peakSeverity, id = inc.incidentId;
      const heard = voiceSeen.current.get(id) ?? 0;
      if (!voiceOn) voiceSeen.current.set(id, Math.max(heard, peak)); // switching voice on later must not replay old incidents
      else if (peak >= level && peak > heard) { voiceSeen.current.set(id, peak); enqueueSpeech(alertText(inc)); }
      const texted = tgSeen.current.get(id) ?? 0;
      if (!tgOn || !tgInfo?.configured) tgSeen.current.set(id, Math.max(texted, peak));
      else if (peak >= level && peak > texted) { tgSeen.current.set(id, peak); void sendTelegram(inc); }
    }
  }, [incidents, voiceOn, tgOn, level, tgInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleVoice() {
    if (voiceOn) { setVoiceOn(false); stopSpeech(); return; }
    setVoiceOn(true);
    enqueueSpeech("Voice alerts on.", { browserOnly: true }); // this click is the user gesture that unlocks audio; built-in voice so no Groq quota is used
  }

  async function testAlerts() {
    enqueueSpeech("This is a test. Critical alert. Vibration sensor failure. Check the sensor connection.");
    if (!tgInfo?.configured) return setMsg("Voice test played. Telegram is not set up yet (see README).");
    setMsg("Sending Telegram test…");
    try {
      const d = await (await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true, voice: true }) })).json();
      setMsg(d.ok ? `Telegram test sent${d.voice ? ` (with ${d.voice === "voice" ? "voice message" : "audio file"})` : " (text only)"}.` : `Telegram test failed: ${d.error}`);
    } catch { setMsg("Telegram test failed: network error."); }
  }

  useEffect(() => {
    if (!running || !base) return;
    const id = setInterval(() => {
      let r: Reading;
      const rp = replay.current, lv = live.current;
      if (lv) {
        const row = lv.queue.shift();
        if (!row) return;
        r = { ...row, t: Date.now() } as Reading;
        if (lv.learn) {
          lv.learn.push(r);
          if (lv.learn.length < 30) { setMsg(`Learning normal for this machine: ${lv.learn.length}/30 readings. Keep it running normally.`); return; }
          calibrate(lv.learn); lv.learn = null; setMsg("Baseline learned from live readings. Monitoring.");
        }
      } else if (rp) {
        if (rp.idx >= rp.rows.length) { replay.current = null; setReplaying(false); setMsg("CSV replay finished."); return; }
        r = { ...rp.rows[rp.idx++], t: Date.now() };
      } else {
        const d = demo.current;
        if (d) {
          if (d.left <= 0) {
            d.i++;
            if (d.i >= DEMO.length) { demo.current = null; setDemoOn(false); setScenario("normal"); sim.current.setScenario("normal"); }
            else { sim.current.setScenario(DEMO[d.i].s); setScenario(DEMO[d.i].s); d.left = DEMO[d.i].n; }
          }
          if (demo.current) demo.current.left--;
        }
        r = sim.current.next();
      }
      const a = det.current.analyze(r);
      recent.current = [...recent.current.slice(-29), r];
      mgr.current.ingest(a.findings, r.t, recent.current);
      const i = ++n.current;
      setMd(a.mahalanobis);
      setHistory((h) => [...h.slice(-59), { ...r, i }]);
      setIncidents(mgr.current.list());
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [running, base, speed]);

  async function explain(inc: Incident) {
    setNotes((x) => ({ ...x, [inc.incidentId]: "Analyzing…" }));
    try {
      const res = await fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ incident: inc }) });
      const d = await res.json();
      setNotes((x) => ({ ...x, [inc.incidentId]: `${d.explanation} (via ${d.source})` }));
    } catch { setNotes((x) => ({ ...x, [inc.incidentId]: "Explanation unavailable." })); }
  }

  const loadMachines = () => { fetch("/api/machines").then((r) => r.json()).then((d) => setMachines(d.machines ?? [])).catch(() => {}); };
  useEffect(loadMachines, []);
  useEffect(() => {
    if (!liveId) return;
    let stop = false;
    const poll = async () => {
      const lv = live.current;
      if (!lv) return;
      try {
        const d = await (await fetch(`/api/readings?machine=${liveId}&after=${lv.after}`)).json();
        if (stop || live.current !== lv) return;
        for (const r of d.readings ?? []) { lv.queue.push(r); lv.after = Math.max(lv.after, r.ts); }
        lv.queue.splice(0, Math.max(0, lv.queue.length - 120));
      } catch { /* try again on the next poll */ }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [liveId]);

  function pickSource(id: string) {
    demo.current = null; setDemoOn(false); replay.current = null; setReplaying(false);
    live.current = id ? { queue: [], after: 0, learn: [] } : null;
    setLiveId(id);
    setMsg(id ? "Live: waiting for readings. The first 30 readings teach the app what is normal for this machine." : "Back to the simulator.");
  }

  function onCsv(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFileName(f.name);
    f.text().then((t) => {
      const rows = parseCsv(t);
      if (!rows || rows.length < 5) return setMsg("CSV needs a header with vibration,temperature,rpm,pressure and at least 5 rows.");
      if (csvMode === "baseline") setMsg(calibrate(rows) ? `Baseline learned from ${rows.length} CSV rows.` : "Need at least 20 complete rows to learn a baseline.");
      else { live.current = null; setLiveId(""); demo.current = null; setDemoOn(false); replay.current = { rows, idx: 0 }; setReplaying(true); setMsg(`Replaying ${rows.length} CSV rows against the learned baseline.`); }
    });
  }

  function startDemo() {
    live.current = null; setLiveId("");
    if (demoOn) { demo.current = null; setDemoOn(false); return; }
    replay.current = null; setReplaying(false);
    demo.current = { i: -1, left: 0 };
    setDemoOn(true); setRunning(true);
  }

  const active = incidents.filter((i) => i.status !== "RESOLVED");
  const top = active[0];
  const status = !base ? { t: "CALIBRATING", c: SEV_CLASS[0] }
    : !top ? { t: "NORMAL", c: "bg-emerald-100 text-emerald-800" }
    : top.type === "SENSOR_FAULT" ? { t: "SENSOR FAULT", c: SEV_CLASS[1] }
    : { t: top.severity === 3 ? "CRITICAL" : top.severity === 2 ? "DEGRADED" : "WARNING", c: SEV_CLASS[top.severity] };
  const time = (t: number) => new Date(t).toLocaleTimeString();
  const btn = "rounded border bg-white px-3 py-1 text-sm hover:bg-slate-50";

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-6">
      <header className="mb-4 space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-lg font-semibold">Live monitoring</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.c}`}>{status.t}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{active.length} active incident(s)</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs" title="Mahalanobis distance from learned multi-sensor baseline">
            Multivariate score: {md === null ? "n/a" : md.toFixed(1)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>Demo Scenario{" "}
            <select className="rounded border px-2 py-1" value={scenario} disabled={demoOn || replaying}
              onChange={(e) => { const s = e.target.value as Scenario; setScenario(s); sim.current.setScenario(s); }}>
              {SCENARIOS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </label>
          <button className={`${btn} ${demoOn ? "border-indigo-500 text-indigo-700" : ""}`} onClick={startDemo}>{demoOn ? "Stop demo" : "▶ Run full demo"}</button>
          <button className={btn} onClick={() => setRunning((r) => !r)}>{running ? "Pause" : "Resume"}</button>
          <label>Speed{" "}
            <select className="rounded border px-2 py-1" value={speed} onChange={(e) => setSpeed(+e.target.value)}>
              <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
            </select>
          </label>
          <label>Source{" "}
            <select className="rounded border px-2 py-1" value={liveId} onChange={(e) => pickSource(e.target.value)} onFocus={loadMachines}>
              <option value="">Simulator</option>{machines.length === 0 && <option disabled>No machines yet: add one on the Devices page</option>}{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button className={btn} onClick={() => { demo.current = null; setDemoOn(false); replay.current = null; setReplaying(false); calibrate(); setMsg("Re-learned baseline from fresh normal history."); }}>Recalibrate</button>
          <span className="flex items-center gap-1">CSV as
            <select className="rounded border px-2 py-1" value={csvMode} onChange={(e) => setCsvMode(e.target.value as "replay" | "baseline")}>
              <option value="replay">live stream (replay)</option><option value="baseline">baseline (learn)</option>
            </select>
            <label className="cursor-pointer rounded border px-2 py-1 text-xs hover:bg-slate-50 focus-within:outline focus-within:outline-2 focus-within:outline-indigo-400">Choose CSV<input type="file" accept=".csv" onChange={onCsv} className="sr-only" /></label>
            <span className="max-w-[160px] truncate text-xs text-slate-500" title={fileName}>{fileName || "No file loaded"}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className={`${btn} ${voiceOn ? "border-emerald-500 text-emerald-700" : ""}`} onClick={toggleVoice} title="Speak new incidents aloud">
            {voiceOn ? "🔊 Voice alerts: On" : "🔇 Voice alerts: Off"}
          </button>
          <button className={`${btn} ${tgOn ? "border-sky-500 text-sky-700" : ""}`} disabled={!tgInfo?.configured} onClick={() => setTgOn((v) => !v)}
            title={tgInfo?.configured ? "Send new incidents to Telegram" : "Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env.local"}>
            {tgOn ? "✈ Telegram: On" : "✈ Telegram: Off"}
          </button>
          <label>Alert level{" "}
            <select className="rounded border px-2 py-1" value={level} onChange={(e) => setLevel(+e.target.value)}>
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
          </label>
          <button className={btn} onClick={testAlerts}>Test alerts</button>
          <span className="text-xs text-slate-500">
            {tgInfo === null ? "" : tgInfo.configured ? `Telegram ready${tgInfo.voice ? " (text + voice note)" : " (text only: add GROQ_API_KEY for voice notes)"}` : "Telegram not set up"}
            {voiceSrc !== "none" ? ` · last voice: ${voiceSrc === "groq" ? "Groq" : "browser fallback"}` : ""}
          </span>
        </div>
        {(msg || demoOn || replaying) && <p className="text-xs text-slate-500">{msg}{demoOn ? " Demo running: normal → spike → drift → dead sensor → flicker → multi-sensor." : ""}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          {CHANNELS.map((ch) => {
            const b = base ? { mean: base.mean[ch], sd: base.sd[ch], unit: BASELINE[ch].unit, label: BASELINE[ch].label } : BASELINE[ch];
            const last = history[history.length - 1]?.[ch];
            return (
              <div key={ch} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-medium">{b.label} ({b.unit})</span>
                  <span className={last == null || last === 0 ? "font-semibold text-red-600" : ""}>{last == null ? "NO SIGNAL" : last}</span>
                </div>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="i" hide />
                    <YAxis domain={["auto", "auto"]} width={42} tick={{ fontSize: 11 }} />
                    <ReferenceArea y1={b.mean - 3 * b.sd} y2={b.mean + 3 * b.sd} fill="#10b981" fillOpacity={0.12} ifOverflow="extendDomain" />
                    <ReferenceLine y={b.mean + 5 * b.sd} stroke="#ef4444" strokeDasharray="4 4" ifOverflow="extendDomain" />
                    <ReferenceLine y={b.mean - 5 * b.sd} stroke="#ef4444" strokeDasharray="4 4" ifOverflow="extendDomain" />
                    <Tooltip labelFormatter={() => ""} />
                    <Line type="monotone" dataKey={ch} stroke={COLORS[ch]} dot={false} strokeWidth={2} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
          <p className="text-xs text-slate-500 sm:col-span-2">Green band = learned normal (±3σ). Red dashed = alert threshold (±5σ). Baseline was learned from historical data, not hardcoded.</p>
        </section>

        <aside className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-1 font-semibold">Incidents</h2>
          <p className="mb-3 text-xs text-slate-500">Ranked by priority: gradual deterioration first, then multi-sensor shifts, spikes, sensor faults.</p>
          <div className="max-h-[680px] space-y-3 overflow-y-auto">
            {incidents.length === 0 && <p className="text-sm text-slate-500">No incidents. Run the full demo or pick a scenario.</p>}
            {incidents.map((inc) => {
              const rank = active.indexOf(inc);
              return (
                <div key={inc.incidentId} className={`rounded-lg border p-3 text-sm ${inc.status === "RESOLVED" ? "opacity-60" : ""}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-xs">{inc.incidentId}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEV_CLASS[inc.peakSeverity]}`}>{SEVERITY_LABEL[inc.peakSeverity]}</span>
                    {rank >= 0 && <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">PRIORITY {rank + 1}</span>}
                    <span className="ml-auto text-xs text-slate-500">{inc.status}</span>
                  </div>
                  <div className="font-medium">{TYPE_LABEL[inc.type]} · ×{inc.count}</div>
                  <div className="text-slate-600">{inc.message}</div>
                  {inc.prediction && inc.status !== "RESOLVED" && (
                    <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
                      ⚠ Predicted: {inc.prediction.channel} reaches {inc.prediction.limit} in ~{inc.prediction.samples} samples at the current trend
                    </div>
                  )}
                  <div className="mt-1 text-xs text-slate-500">{time(inc.startedAt)} → {time(inc.lastSeenAt)} · now: {SEVERITY_LABEL[inc.severity]}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {inc.channels.map((c) => {
                      const m = inc.metrics[c];
                      return <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{c}: {m.value ?? "null"} · z={m.z.toFixed(1)} · drift={m.drift.toFixed(1)}σ</span>;
                    })}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">Evidence: {inc.evidence.channel}, last 30 samples</div>
                  <Spark vals={inc.evidence.values} color={COLORS[inc.evidence.channel]} />
                  {notes[inc.incidentId] && <p className="mt-2 rounded bg-indigo-50 p-2 text-xs text-indigo-900">{notes[inc.incidentId]}</p>}
                  <div className="mt-2 flex gap-2">
                    {inc.status === "OPEN" && <button className="rounded bg-slate-900 px-2 py-1 text-xs text-white" onClick={() => { mgr.current.acknowledge(inc.incidentId); setIncidents(mgr.current.list()); }}>Acknowledge</button>}
                    <button className="rounded border px-2 py-1 text-xs" onClick={() => explain(inc)}>Explain (AI)</button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
  );
}
