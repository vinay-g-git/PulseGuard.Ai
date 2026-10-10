import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Provider order: Groq (primary) -> Gemini (secondary) -> rule-based (always available). */

function fallback(inc: any) {
  const ch = (inc.channels ?? []).join(", ") || "unknown channels";
  const map: Record<string, string> = {
    SPIKE: `A sudden impulse on ${ch} suggests a mechanical shock, loose component or momentary imbalance. Inspect mounting bolts and couplings, then re-check vibration after the next cycle.`,
    DRIFT: `Correlated drift on ${ch} points to progressive bearing wear or lubrication/cooling degradation${inc.prediction ? `, and ${inc.prediction.channel} is projected to hit ${inc.prediction.limit} in about ${inc.prediction.samples} samples` : ""}. Schedule a bearing inspection and lubrication/cooling check before the limit is reached.`,
    MULTIVARIATE: `${ch} have shifted together even though each is within range, which suggests a loss of normal coupling such as a leak, blockage or load imbalance. Inspect flow path and pressure lines and compare against the load setpoint.`,
    SENSOR_FAULT: `${ch} reads zero while other channels are steady, so this is likely a sensor or wiring fault, not a machine failure. Check the connector and replace the sensor; keep running under watch.`,
  };
  return map[inc.type] ?? "No diagnosis available.";
}

function buildPrompt(inc: any) {
  const deltas = Object.entries(inc.metrics ?? {})
    .map(([c, m]: any) => `${c}: value=${m.value}, z=${m.z?.toFixed(1)}, drift=${m.drift?.toFixed(1)} sd/window`)
    .join("\n");
  const pred = inc.prediction ? `Projected: ${inc.prediction.channel} reaches ${inc.prediction.limit} in ~${inc.prediction.samples} samples.` : "";
  return `You are an industrial maintenance assistant. Anomaly type: ${inc.type}, peak severity: ${inc.peakSeverity}/3, affected: ${(inc.channels ?? []).join(", ")}.
Sensor deltas:\n${deltas}\n${pred}\nIf type is SENSOR_FAULT, say it is a sensor problem, not machine failure.
Reply in exactly 2 sentences: likely root cause, then one recommended maintenance action.`;
}

async function groq(prompt: string, key: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 160,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const text = (await res.json())?.choices?.[0]?.message?.content;
  if (!text) throw new Error("groq empty");
  return text.trim();
}

async function gemini(prompt: string, key: string): Promise<string> {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // thinkingBudget 0 stops 2.5-flash from spending the whole token budget on hidden reasoning
      generationConfig: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const text = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("gemini empty");
  return text.trim();
}

export async function POST(req: Request) {
  const { incident } = await req.json();
  const prompt = buildPrompt(incident);
  const providers: [string, string | undefined, (p: string, k: string) => Promise<string>][] = [
    ["groq", process.env.GROQ_API_KEY, groq],
    ["gemini", process.env.GEMINI_API_KEY, gemini],
  ];
  for (const [name, key, call] of providers) {
    if (!key) continue;
    try {
      return NextResponse.json({ explanation: await call(prompt, key), source: name });
    } catch { /* try the next provider */ }
  }
  return NextResponse.json({ explanation: fallback(incident), source: "rule-based" });
}
