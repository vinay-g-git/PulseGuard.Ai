import { AnomalyType, ChannelMetric, Detection, Prediction, Severity } from "./detector";
import { Channel, Reading } from "./simulator";

export type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export interface Incident {
  incidentId: string;
  type: AnomalyType;
  severity: Severity; // current
  peakSeverity: Severity;
  peakScore: number;
  status: IncidentStatus;
  channels: Channel[];
  startedAt: number;
  lastSeenAt: number;
  resolvedAt?: number;
  count: number; // ticks the anomaly persisted (dedup counter)
  message: string;
  metrics: Record<Channel, ChannelMetric>; // snapshot at peak
  prediction?: Prediction; // latest time-to-critical estimate
  evidence: { channel: Channel; values: (number | null)[] }; // recent series snapshot
  lastTick: number;
}

const RESOLVE_AFTER = 5; // clean ticks before an incident auto-resolves
/** Gradual deterioration outranks sudden spikes. */
export const TYPE_WEIGHT: Record<AnomalyType, number> = { DRIFT: 4, MULTIVARIATE: 3, SPIKE: 2, SENSOR_FAULT: 1 };

export class AlertManager {
  private incidents: Incident[] = [];
  private tick = 0;
  private seq = 0;

  reset() { this.incidents = []; this.tick = 0; }

  ingest(findings: Detection[], now: number, recent: Reading[]) {
    this.tick++;
    for (const d of findings) {
      const ch = d.prediction?.channel ?? d.channels[0] ?? "vibration";
      const evidence = { channel: ch, values: recent.slice(-30).map((r) => r[ch]) };
      const inc = this.incidents.find((i) => i.type === d.type && i.status !== "RESOLVED");
      if (!inc) {
        this.incidents.push({
          incidentId: `INC-${String(++this.seq).padStart(3, "0")}`, type: d.type, severity: d.severity,
          peakSeverity: d.severity, peakScore: d.score, status: "OPEN", channels: [...d.channels],
          startedAt: now, lastSeenAt: now, count: 1, message: d.message, metrics: d.metrics,
          prediction: d.prediction, evidence, lastTick: this.tick,
        });
      } else { // same anomaly continues: update, never duplicate
        inc.lastSeenAt = now; inc.lastTick = this.tick; inc.count++; inc.severity = d.severity;
        inc.prediction = d.prediction;
        inc.channels = Array.from(new Set([...inc.channels, ...d.channels]));
        if (d.severity > inc.peakSeverity) {
          inc.peakSeverity = d.severity;
          if (inc.status === "ACKNOWLEDGED") inc.status = "OPEN"; // escalation re-alerts the operator
        }
        if (d.score >= inc.peakScore) { inc.peakScore = d.score; inc.metrics = d.metrics; inc.message = d.message; inc.evidence = evidence; }
      }
    }
    for (const i of this.incidents)
      if (i.status !== "RESOLVED" && this.tick - i.lastTick >= RESOLVE_AFTER) { i.status = "RESOLVED"; i.resolvedAt = now; }
  }

  acknowledge(id: string) {
    const i = this.incidents.find((x) => x.incidentId === id);
    if (i && i.status === "OPEN") i.status = "ACKNOWLEDGED";
  }

  /** Active incidents first, ranked by type priority (drift > multi-sensor > spike > fault) then severity; resolved last. */
  list(): Incident[] {
    const rank = (i: Incident) => TYPE_WEIGHT[i.type] * 10 + i.peakSeverity;
    return this.incidents.map((i) => ({ ...i })).sort((a, b) => {
      const ra = a.status === "RESOLVED" ? 1 : 0, rb = b.status === "RESOLVED" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return ra ? b.lastSeenAt - a.lastSeenAt : rank(b) - rank(a);
    });
  }
}
