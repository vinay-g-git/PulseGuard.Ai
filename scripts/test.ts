import { Detector } from "../lib/detector";
import { AlertManager, Incident } from "../lib/alertManager";
import { Reading, Scenario, Simulator } from "../lib/simulator";

function run(scn: Scenario, ticks: number, seed: number): Incident[] {
  const cal = new Simulator(seed + 1000), det = new Detector();
  det.calibrate(Array.from({ length: 120 }, () => cal.next()));
  const sim = new Simulator(seed), mgr = new AlertManager(), recent: Reading[] = [];
  sim.setScenario(scn);
  for (let i = 0; i < ticks; i++) {
    const r = sim.next(i * 1000);
    recent.push(r);
    mgr.ingest(det.analyze(r).findings, r.t, recent.slice(-30));
  }
  return mgr.list();
}

let fails = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) fails++; };
const types = (l: Incident[]) => Array.from(new Set(l.map((i) => i.type)));
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const all = (scn: Scenario, ticks: number, f: (l: Incident[]) => boolean) => SEEDS.every((s) => f(run(scn, ticks, s)));

check("normal: zero false alarms (20 seeds x 300 ticks)", all("normal", 300, (l) => l.length === 0));
check("spike: SPIKE incidents only, severity >= High", all("spike", 60, (l) => types(l).join() === "SPIKE" && l.every((i) => i.peakSeverity >= 2)));
check("drift: exactly ONE deduplicated DRIFT incident reaching Critical", all("drift", 40, (l) => l.filter((i) => i.type === "DRIFT").length === 1 && l.find((i) => i.type === "DRIFT")!.peakSeverity === 3));
check("drift: emits a time-to-critical prediction while drifting", SEEDS.every((seed) => {
  const cal = new Simulator(seed + 1000), det = new Detector(), sim = new Simulator(seed);
  det.calibrate(Array.from({ length: 120 }, () => cal.next()));
  sim.setScenario("drift");
  for (let i = 0; i < 40; i++) {
    const p = det.analyze(sim.next(i * 1000)).findings.find((f) => f.type === "DRIFT")?.prediction;
    if (p && p.samples > 0) return true;
  }
  return false;
}));
check("drift: DRIFT ranks above any other incident", all("drift", 40, (l) => l[0].type === "DRIFT"));
check("dead sensor: SENSOR_FAULT only (never machine failure)", all("dead_sensor", 60, (l) => types(l).join() === "SENSOR_FAULT" && l.length === 1));
check("flicker: sensor faults auto-resolve on recovery", all("flicker", 50, (l) => types(l).join() === "SENSOR_FAULT" && l.some((i) => i.status === "RESOLVED")));
check("multi-sensor: MULTIVARIATE detected", all("multi", 60, (l) => types(l).includes("MULTIVARIATE")));
process.exit(fails ? 1 : 0);
