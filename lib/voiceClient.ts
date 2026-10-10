/** Browser-side speech queue: Groq voice first (via /api/tts), browser built-in voice as the fallback. */
export type VoiceSource = "groq" | "browser" | "none";
interface Item { text: string; browserOnly: boolean }

let queue: Item[] = [];
let busy = false;
let audio: HTMLAudioElement | null = null;
let stopCurrent: (() => void) | null = null; // lets Mute end the clip that is playing right now
let groqDownUntil = 0; // after a Groq failure, skip it for a minute so alerts are not delayed
let listener: ((s: VoiceSource) => void) | null = null;

export const onVoiceSource = (fn: ((s: VoiceSource) => void) | null) => { listener = fn; };

async function playGroq(text: string): Promise<boolean> {
  if (Date.now() < groqDownUntil) return false;
  try {
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) { groqDownUntil = Date.now() + 60_000; return false; }
    const blob = await res.blob();
    if (!blob.type.startsWith("audio")) return false;
    const url = URL.createObjectURL(blob);
    try {
      const a = new Audio(url);
      audio = a;
      await new Promise<void>((resolve, reject) => { stopCurrent = resolve; a.onended = () => resolve(); a.onerror = () => reject(new Error("audio")); a.play().catch(reject); });
      return true;
    } finally { URL.revokeObjectURL(url); audio = null; stopCurrent = null; }
  } catch { return false; }
}

function playBrowser(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    const done = (ok: boolean) => { clearTimeout(t); resolve(ok); };
    const t = setTimeout(() => done(true), 15000); // some browsers never fire onend
    u.onend = () => done(true);
    u.onerror = () => done(false);
    window.speechSynthesis.speak(u);
  });
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const { text, browserOnly } = queue.shift()!;
    let src: VoiceSource = "none";
    if (!browserOnly && (await playGroq(text))) src = "groq";
    else if (await playBrowser(text)) src = "browser";
    listener?.(src);
  }
  busy = false;
}

/** Queue a spoken alert. At most 3 wait in line, so a burst of incidents never turns into minutes of talking. */
export function enqueueSpeech(text: string, opts: { browserOnly?: boolean } = {}) {
  queue.push({ text, browserOnly: !!opts.browserOnly });
  if (queue.length > 3) queue = queue.slice(-3);
  void pump();
}

export function stopSpeech() {
  queue = [];
  audio?.pause();
  stopCurrent?.();
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
