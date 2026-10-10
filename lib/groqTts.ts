/** Groq Orpheus text-to-speech. Free tier is roughly 200 characters per request, so text is clipped. Returns WAV bytes. */
export const hasGroqKey = () => !!process.env.GROQ_API_KEY;

export async function synthesize(text: string): Promise<ArrayBuffer> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("no_key");
  const base = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_TTS_MODEL ?? "canopylabs/orpheus-v1-english",
      voice: process.env.GROQ_TTS_VOICE ?? "autumn",
      input: text.slice(0, 200),
      response_format: "wav",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`groq_tts_${res.status}`);
  return res.arrayBuffer();
}
