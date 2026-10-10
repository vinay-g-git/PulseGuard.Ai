import { NextResponse } from "next/server";
import { hasGroqKey, synthesize } from "@/lib/groqTts";

export const runtime = "nodejs";

// Light guard so a runaway client cannot burn the free Groq quota: 30 requests per minute per server instance.
let windowStart = 0, used = 0;

export async function POST(req: Request) {
  if (!hasGroqKey()) return NextResponse.json({ error: "no_key" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty" }, { status: 400 });
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; used = 0; }
  if (++used > 30) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  try {
    const wav = await synthesize(text);
    return new Response(wav, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 502 }); // client falls back to the browser voice
  }
}
