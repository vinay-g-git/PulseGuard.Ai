import { Mp3Encoder } from "@breezystack/lamejs";

/** Pure-JS WAV (16-bit PCM) -> MP3 converter, so Telegram can show the clip as a real voice message. No ffmpeg needed. */
export function wavToMp3(wav: ArrayBuffer, kbps = 64): { mp3: Uint8Array; seconds: number } {
  const v = new DataView(wav);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (wav.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not_wav");

  let channels = 0, rate = 0, bits = 0, format = 0, dataStart = -1, dataLen = 0;
  for (let o = 12; o + 8 <= wav.byteLength; ) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === "fmt ") { format = v.getUint16(o + 8, true); channels = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === "data") {
      dataStart = o + 8;
      // Streamed WAVs sometimes declare a size of 0 or 0xFFFFFFFF: use whatever bytes are actually there.
      dataLen = size === 0 || size > wav.byteLength - dataStart ? wav.byteLength - dataStart : size;
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (dataStart < 0 || format !== 1 || bits !== 16 || (channels !== 1 && channels !== 2)) throw new Error("unsupported_wav");

  const frames = Math.floor(dataLen / (2 * channels));
  const left = new Int16Array(frames), right = channels === 2 ? new Int16Array(frames) : undefined;
  for (let i = 0; i < frames; i++) {
    left[i] = v.getInt16(dataStart + i * 2 * channels, true);
    if (right) right[i] = v.getInt16(dataStart + i * 2 * channels + 2, true);
  }

  const enc = new Mp3Encoder(channels, rate, kbps);
  const chunks: Uint8Array[] = [];
  const BLOCK = 1152;
  for (let i = 0; i < frames; i += BLOCK) {
    const out = enc.encodeBuffer(left.subarray(i, i + BLOCK), right?.subarray(i, i + BLOCK));
    if (out.length) chunks.push(Uint8Array.from(out));
  }
  const tail = enc.flush();
  if (tail.length) chunks.push(Uint8Array.from(tail));

  const mp3 = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) { mp3.set(c, p); p += c.length; }
  if (!mp3.length) throw new Error("empty_mp3");
  return { mp3, seconds: Math.max(1, Math.round(frames / rate)) };
}
