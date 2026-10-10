import type { Incident } from "./alertManager";

/** Alert-level filter shared by voice and Telegram. Value = minimum peak severity that triggers an alert. */
export const LEVELS = [
  { v: 1, l: "All incidents" },
  { v: 2, l: "High and above" },
  { v: 3, l: "Critical only" },
] as const;

type Alertable = Pick<Incident, "type" | "peakSeverity" | "channels" | "prediction">;

const SEV_WORD = ["Notice", "Low", "High", "Critical"];
const SAY: Record<string, string> = { vibration: "vibration", temperature: "temperature", rpm: "R P M", pressure: "pressure" };
const join = (a: string[]) => (a.length <= 1 ? a[0] ?? "the machine" : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** Short, speakable sentence(s). Kept under ~195 chars so it fits Groq's free-tier 200-character TTS limit. */
export function alertText(inc: Alertable, max = 195): string {
  const ch = join(inc.channels.map((c) => SAY[c] ?? c));
  const parts: string[] = [`${SEV_WORD[inc.peakSeverity] ?? "Alert"} alert.`];
  switch (inc.type) {
    case "SENSOR_FAULT":
      parts.push(`${ch} sensor failure.`, "Other readings look normal, so check the sensor connection.");
      break;
    case "SPIKE":
      parts.push(`Sudden spike on ${ch}.`, "Inspect the machine.");
      break;
    case "DRIFT":
      parts.push(`Gradual deterioration on ${ch}.`);
      if (inc.prediction) parts.push(`About ${inc.prediction.samples} readings until the ${SAY[inc.prediction.channel] ?? inc.prediction.channel} limit.`);
      parts.push("Schedule maintenance.");
      break;
    case "MULTIVARIATE":
      parts.push(`Several sensors shifted together: ${ch}.`, "Check the machine.");
      break;
    default:
      parts.push("Anomaly detected.");
  }
  while (parts.length > 2 && parts.join(" ").length > max) parts.pop(); // drop least important trailing sentence first
  const s = parts.join(" ");
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

const TYPE_TEXT: Record<string, string> = { SPIKE: "Sudden spike", DRIFT: "Gradual deterioration", MULTIVARIATE: "Multi-sensor shift", SENSOR_FAULT: "Sensor fault" };
const SEV_ICON = ["ℹ️", "🟡", "🟠", "🔴"];

/** Plain-text Telegram message (no parse_mode, so nothing needs escaping). */
export function telegramText(inc: Incident | (Alertable & { incidentId: string; message: string; count?: number; metrics?: Incident["metrics"] })): string {
  const lines = [
    `${SEV_ICON[inc.peakSeverity] ?? "⚠️"} PulseGuard · ${SEV_WORD[inc.peakSeverity]?.toUpperCase()} · ${inc.incidentId}`,
    `${TYPE_TEXT[inc.type] ?? inc.type} on ${inc.channels.join(", ") || "unknown channels"}`,
    inc.message,
  ];
  const m = inc.metrics;
  if (m) {
    const ev = inc.channels.map((c) => (m[c] ? `${c}=${m[c].value ?? "null"} (z ${m[c].z.toFixed(1)}, drift ${m[c].drift.toFixed(1)}σ)` : "")).filter(Boolean);
    if (ev.length) lines.push(`Evidence: ${ev.join("; ")}`);
  }
  if (inc.prediction) lines.push(`Predicted: ${inc.prediction.channel} reaches ${inc.prediction.limit} in ~${inc.prediction.samples} samples at the current trend.`);
  if (inc.type === "SENSOR_FAULT") lines.push("Likely a sensor/wiring problem, not a machine failure.");
  return lines.join("\n");
}
