export const CHANNELS = ["vibration", "temperature", "rpm", "pressure"] as const;
export type Channel = (typeof CHANNELS)[number];
export type Scenario = "normal" | "spike" | "drift" | "dead_sensor" | "flicker" | "multi";

/** True process parameters used by the generator (the detector never reads these; it learns its own baseline). */
export const BASELINE: Record<Channel, { mean: number; sd: number; unit: string; label: string }> = {
  vibration: { mean: 2.5, sd: 0.15, unit: "mm/s", label: "Vibration" },
  temperature: { mean: 65, sd: 0.6, unit: "°C", label: "Temperature" },
  rpm: { mean: 1800, sd: 12, unit: "RPM", label: "RPM" },
  pressure: { mean: 100, sd: 1.2, unit: "PSI", label: "Pressure" },
};

/** Engineering failure limits, used for time-to-critical prediction. */
export const FAILURE_LIMIT: Partial<Record<Channel, { limit: number; dir: 1 | -1 }>> = {
  vibration: { limit: 5, dir: 1 },
  temperature: { limit: 85, dir: 1 },
};

export interface Reading {
  t: number;
  scenario: Scenario;
  vibration: number | null;
  temperature: number | null;
  rpm: number | null;
  pressure: number | null;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic sensor stream + demo scenario controller. Call next() once per tick. RPM and pressure are strongly coupled (load). */
export class Simulator {
  scenario: Scenario = "normal";
  private step = 0;
  private tick = 0;
  private rng: () => number;
  constructor(seed: number = (Math.random() * 2 ** 32) >>> 0) { this.rng = mulberry32(seed); }

  private gauss() {
    const u = 1 - this.rng(), v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  setScenario(s: Scenario) { this.scenario = s; this.step = 0; }

  next(now = Date.now()): Reading {
    const s = this.step++, k = this.tick++;
    const load = this.gauss();
    const v: Record<Channel, number | null> = { vibration: 0, temperature: 0, rpm: 0, pressure: 0 };
    for (const ch of CHANNELS) {
      const b = BASELINE[ch];
      const coupled = ch === "rpm" || ch === "pressure"; // shared load factor, correlation ≈ 0.95
      const noise = coupled ? Math.sqrt(0.05) * this.gauss() + Math.sqrt(0.95) * load : this.gauss();
      v[ch] = b.mean + noise * b.sd + 0.2 * b.sd * Math.sin(k / 8);
    }
    switch (this.scenario) {
      case "spike": // 1-tick impulse every 15 samples
        if (s % 15 === 5) v.vibration! += 8;
        break;
      case "drift": { // ramp over 25 samples, then hold at the degraded level
        const d = Math.min(s, 25);
        v.temperature! += 0.5 * d;
        v.vibration! += 0.08 * d;
        break;
      }
      case "dead_sensor": // vibration sensor dies; the others stay steady
        v.vibration = null;
        break;
      case "flicker": // vibration sensor drops out for 6 ticks every 15, then recovers
        if (s % 15 >= 5 && s % 15 <= 10) v.vibration = null;
        break;
      case "multi": // rpm and pressure decouple (each only ~1.5σ, jointly abnormal)
        v.rpm! += 1.5 * BASELINE.rpm.sd;
        v.pressure! -= 1.5 * BASELINE.pressure.sd;
        break;
    }
    const r: Reading = { t: now, scenario: this.scenario, vibration: 0, temperature: 0, rpm: 0, pressure: 0 };
    for (const ch of CHANNELS) r[ch] = v[ch] === null ? null : Math.round(v[ch]! * 100) / 100;
    return r;
  }
}
