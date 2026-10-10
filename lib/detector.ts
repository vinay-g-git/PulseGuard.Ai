import { CHANNELS, Channel, FAILURE_LIMIT, Reading } from "./simulator";

export type AnomalyType = "SPIKE" | "DRIFT" | "MULTIVARIATE" | "SENSOR_FAULT";
export type Severity = 0 | 1 | 2 | 3; // none, low, high, critical
export const SEVERITY_LABEL = ["None", "Low", "High", "Critical"] as const;

export interface ChannelMetric { value: number | null; z: number; slope: number; drift: number }
export interface Prediction { channel: Channel; limit: number; samples: number }
export interface Detection {
  type: AnomalyType; severity: Severity; score: number; channels: Channel[];
  metrics: Record<Channel, ChannelMetric>; message: string; prediction?: Prediction;
}
export interface Analysis { findings: Detection[]; mahalanobis: number | null }
export interface Baseline { mean: Record<Channel, number>; sd: Record<Channel, number> }

const Z_WINDOW = 30, SLOPE_WINDOW = 20;
const sevFrom = (x: number, [lo, hi, crit]: number[]): Severity => (x >= crit ? 3 : x >= hi ? 2 : x >= lo ? 1 : 0);
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function slope(y: number[]) {
  const n = y.length, mx = (n - 1) / 2, my = mean(y);
  let num = 0, den = 0;
  y.forEach((v, i) => { num += (i - mx) * (v - my); den += (i - mx) ** 2; });
  return den ? num / den : 0;
}

function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c] || 1e-12;
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map((r) => r.slice(n));
}

export class Detector {
  private buf: Record<Channel, number[]> = { vibration: [], temperature: [], rpm: [], pressure: [] };
  private base: (Baseline & { inv: number[][] }) | null = null;

  get baseline(): Baseline | null { return this.base ? { mean: this.base.mean, sd: this.base.sd } : null; }

  /** Learn "expected behavior" (mean, spread, inter-channel covariance) from historical readings. */
  calibrate(samples: Reading[]): boolean {
    const rows = samples.filter((r) => CHANNELS.every((c) => r[c] !== null && r[c] !== 0));
    if (rows.length < 20) return false;
    const col = (c: Channel) => rows.map((r) => r[c] as number);
    const mu = {} as Record<Channel, number>, sd = {} as Record<Channel, number>;
    for (const c of CHANNELS) { mu[c] = mean(col(c)); sd[c] = Math.max(std(col(c)), 1e-3 * Math.abs(mu[c]) + 1e-6); }
    const cov = CHANNELS.map((a) => CHANNELS.map((b) => mean(rows.map((r) => ((r[a] as number) - mu[a]) * ((r[b] as number) - mu[b])))));
    cov.forEach((row, i) => (row[i] *= 1.002)); // light ridge for numerical stability
    this.base = { mean: mu, sd, inv: invert(cov) };
    for (const c of CHANNELS) this.buf[c] = col(c).slice(-Z_WINDOW);
    return true;
  }

  analyze(r: Reading): Analysis {
    const base = this.base;
    if (!base) return { findings: [], mahalanobis: null };
    const metrics = {} as Record<Channel, ChannelMetric>;
    const faulty: Channel[] = [];

    for (const ch of CHANNELS) {
      const v = r[ch], h = this.buf[ch];
      if (v === null || v === 0) { // dead sensor: never feed into the statistics
        faulty.push(ch);
        metrics[ch] = { value: v, z: 0, slope: 0, drift: 0 };
        continue;
      }
      let z = 0;
      const w = h.slice(-Z_WINDOW); // rolling Z-score, window 30
      if (w.length >= 10) z = (v - mean(w)) / Math.max(std(w), base.sd[ch] * 0.8);
      if (Math.abs(z) < 6) h.push(v); // keep impulses out of the baseline window
      if (h.length > Z_WINDOW) h.shift();
      const sw = h.slice(-SLOPE_WINDOW); // rolling slope, window 20
      const sl = sw.length >= 10 ? slope(sw) : 0;
      metrics[ch] = { value: v, z, slope: sl, drift: (sl * SLOPE_WINDOW) / base.sd[ch] };
    }

    const healthy = CHANNELS.filter((c) => !faulty.includes(c));
    let md: number | null = null;
    if (faulty.length === 0) {
      const d = CHANNELS.map((c) => (r[c] as number) - base.mean[c]);
      let q = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) q += d[i] * base.inv[i][j] * d[j];
      md = Math.sqrt(Math.max(q, 0));
    }
    const mk = (type: AnomalyType, severity: Severity, score: number, channels: Channel[], message: string, prediction?: Prediction): Detection =>
      ({ type, severity, score, channels, metrics, message, prediction });
    const findings: Detection[] = [];

    // 1) Sensor fault isolation: a dead sensor while the rest look normal is NOT a machine failure
    if (faulty.length === CHANNELS.length) return { findings: [mk("SENSOR_FAULT", 3, 0, faulty, "All sensors offline")], mahalanobis: md };
    if (faulty.length > 0) {
      findings.push(mk("SENSOR_FAULT", 2, 0, faulty, `${faulty.join(", ")} reads 0/null while other channels are ${""}responding`));
      if (healthy.every((c) => Math.abs(metrics[c].z) < 4 && Math.abs(metrics[c].drift) < 4))
        return { findings: [mk("SENSOR_FAULT", 2, 0, faulty, `${faulty.join(", ")} reads 0/null while other channels are normal`)], mahalanobis: md };
    }

    // 2) Gradual deterioration (highest priority)
    const drifting = healthy.filter((c) => Math.abs(metrics[c].drift) >= 4);
    if (drifting.length) {
      const maxDrift = Math.max(...drifting.map((c) => Math.abs(metrics[c].drift)));
      let sev = sevFrom(maxDrift, [4, 6, 9]);
      if (drifting.length >= 2) sev = Math.min(3, sev + 1) as Severity; // correlated deterioration
      let pred: Prediction | undefined;
      for (const c of drifting) {
        const lim = FAILURE_LIMIT[c], v = metrics[c].value;
        if (!lim || v === null) continue;
        const remaining = (lim.limit - v) * lim.dir, rate = metrics[c].slope * lim.dir;
        if (rate > 0 && remaining > 0 && (!pred || remaining / rate < pred.samples))
          pred = { channel: c, limit: lim.limit, samples: Math.round(remaining / rate) };
      }
      findings.push(mk("DRIFT", sev, maxDrift, drifting, `Sustained trend on ${drifting.join(" + ")}`, pred));
    }

    // 3) Sudden spike
    const spiking = healthy.filter((c) => Math.abs(metrics[c].z) >= 5);
    if (spiking.length) {
      const maxZ = Math.max(...spiking.map((c) => Math.abs(metrics[c].z)));
      findings.push(mk("SPIKE", sevFrom(maxZ, [5, 7, 10]), maxZ, spiking, `Sudden deviation on ${spiking.join(", ")} (z=${maxZ.toFixed(1)})`));
    }

    // 4) Multi-sensor shift: jointly abnormal against the learned baseline/correlations
    if (!drifting.length && !spiking.length && md !== null) {
      const sev = sevFrom(md, [6, 8, 11]);
      if (sev) {
        const top = [...healthy].sort((a, b) => Math.abs((r[b] as number) - base.mean[b]) / base.sd[b] - Math.abs((r[a] as number) - base.mean[a]) / base.sd[a]).slice(0, 2);
        findings.push(mk("MULTIVARIATE", sev, md, top, `Combined shift across channels (Mahalanobis ${md.toFixed(1)}, limit 6)`));
      }
    }
    return { findings, mahalanobis: md };
  }
}
