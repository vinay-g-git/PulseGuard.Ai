// Pretends to be a machine. Usage: SENSOR_URL=http://localhost:3000 SENSOR_KEY=pg_xxx npm run sensor
// Normal for ~60s, then a vibration spike, then drift. Send one reading per second.
const url = (process.env.SENSOR_URL ?? "http://localhost:3000") + "/api/ingest", key = process.env.SENSOR_KEY ?? "";
if (!key) { console.error("Set SENSOR_KEY to the API key shown when you added the machine."); process.exit(1); }
const n = (m: number, s: number) => m + (Math.random() + Math.random() + Math.random() - 1.5) * s;
let t = 0;
setInterval(async () => {
  t++;
  const spike = t > 60 && t < 66, drift = t > 100 ? (t - 100) * 0.05 : 0;
  const body = { ts: Date.now(), vibration: n(2.5, 0.3) + (spike ? 6 : 0) + drift, temperature: n(70, 1.5) + drift * 4, rpm: n(1480, 15), pressure: n(5, 0.1) };
  try { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key }, body: JSON.stringify(body) }); console.log(t, r.status, spike ? "SPIKE" : drift ? "drift" : ""); }
  catch (e) { console.log("send failed:", (e as Error).message); }
}, 1000);
