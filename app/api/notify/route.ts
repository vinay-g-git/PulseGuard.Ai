import { NextResponse } from "next/server";
import { CHANNELS } from "@/lib/simulator";
import { alertText, telegramText } from "@/lib/voice";
import { hasGroqKey, synthesize } from "@/lib/groqTts";
import { wavToMp3 } from "@/lib/wavToMp3";

export const runtime = "nodejs";

const TYPES = ["SPIKE", "DRIFT", "MULTIVARIATE", "SENSOR_FAULT"] as const;
const tgBase = () => process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
const configured = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

// One Telegram alert per incident per severity level, even if the page is reloaded or two tabs are open.
const sent = new Map<string, number>();
const DEDUPE_MS = 10 * 60_000;

/** The browser sends the incident, so rebuild a clean object instead of trusting it. */
function clean(raw: any) {
  const type = TYPES.includes(raw?.type) ? raw.type : null;
  if (!type) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const metrics: any = {};
  for (const c of CHANNELS) {
    const m = raw?.metrics?.[c];
    if (m) metrics[c] = { value: num(m.value), z: num(m.z) ?? 0, slope: 0, drift: num(m.drift) ?? 0 };
  }
  const p = raw?.prediction;
  return {
    incidentId: String(raw?.incidentId ?? "INC").slice(0, 16),
    type,
    peakSeverity: Math.min(3, Math.max(0, Math.round(num(raw?.peakSeverity) ?? 1))) as 0 | 1 | 2 | 3,
    channels: (Array.isArray(raw?.channels) ? raw.channels : []).filter((c: any) => (CHANNELS as readonly string[]).includes(c)),
    message: String(raw?.message ?? "").slice(0, 240),
    metrics,
    prediction: p && CHANNELS.includes(p.channel) && num(p.limit) !== null && num(p.samples) !== null ? { channel: p.channel, limit: p.limit, samples: p.samples } : undefined,
  };
}

async function tg(method: string, payload: BodyInit, json: boolean) {
  const res = await fetch(`${tgBase()}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: json ? { "Content-Type": "application/json" } : undefined,
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok === true, desc: data?.description as string | undefined };
}

export async function GET() {
  return NextResponse.json({ configured: configured(), voice: hasGroqKey() });
}

export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const wantVoice = body?.voice !== false;
  const inc = body?.test
    ? { incidentId: "TEST", type: "SENSOR_FAULT" as const, peakSeverity: 3 as const, channels: ["vibration"] as any, message: "This is a test alert from PulseGuard.", metrics: undefined, prediction: undefined }
    : clean(body?.incident);
  if (!inc) return NextResponse.json({ ok: false, error: "bad_incident" }, { status: 400 });

  if (!body?.test) {
    const key = `${inc.incidentId}:${inc.peakSeverity}`, now = Date.now();
    if (sent.size > 500) for (const [k, t] of sent) if (now - t > DEDUPE_MS) sent.delete(k);
    if (now - (sent.get(key) ?? 0) < DEDUPE_MS) return NextResponse.json({ ok: true, skipped: "duplicate" });
    sent.set(key, now);
  }

  const chat = process.env.TELEGRAM_CHAT_ID!;
  try {
    const text = await tg("sendMessage", JSON.stringify({ chat_id: chat, text: telegramText(inc as any) }), true);
    if (!text.ok) return NextResponse.json({ ok: false, error: text.desc ?? "telegram_rejected" }, { status: 502 });

    let voice: "voice" | "audio" | "document" | false = false;
    if (wantVoice && hasGroqKey()) {
      try {
        const wav = await synthesize(alertText(inc as any));
        const file = (field: string, data: BlobPart, type: string, name: string, extra: Record<string, string> = {}) => {
          const f = new FormData();
          f.append("chat_id", chat);
          f.append(field, new Blob([data], { type }), name);
          for (const [k, val] of Object.entries(extra)) f.append(k, val);
          return f;
        };
        // 1) Best: convert to MP3 and send as a real voice message bubble.
        try {
          const { mp3, seconds } = wavToMp3(wav);
          if ((await tg("sendVoice", file("voice", mp3 as BlobPart, "audio/mpeg", "pulseguard-alert.mp3", { duration: String(seconds) }), false)).ok) voice = "voice";
        } catch { /* conversion failed: fall through to the plain WAV options */ }
        // 2) Fallbacks: raw WAV as an audio file, then as a plain document attachment.
        if (!voice && (await tg("sendAudio", file("audio", wav, "audio/wav", "pulseguard-alert.wav", { title: "PulseGuard voice alert", performer: "PulseGuard" }), false)).ok) voice = "audio";
        if (!voice && (await tg("sendDocument", file("document", wav, "audio/wav", "pulseguard-alert.wav"), false)).ok) voice = "document";
      } catch { /* the text alert already went out; the voice note is a bonus */ }
    }
    return NextResponse.json({ ok: true, voice });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error).message) }, { status: 502 });
  }
}
