# Machine Anomaly Monitor (PS-48)

Single Next.js (App Router, TS, Tailwind, Recharts) app. Runs on the Vercel free tier: no database, no backend services, no ML libraries.

## Run
    npm install
    npm run dev        # http://localhost:3000
    npm test           # verifies detection logic across 20 random seeds

## Deploy (free)
Push to GitHub and import in Vercel, or run `vercel`. Optional AI root-cause text: set `GROQ_API_KEY` (primary, free at console.groq.com/keys) and/or `GEMINI_API_KEY` (secondary, free at aistudio.google.com). Order: Groq, then Gemini, then built-in rule-based diagnostics, so the demo never breaks.

## How it works
- Learned baseline: mean, spread and inter-sensor covariance are learned from historical data (generated, or your own CSV).
- Sudden: rolling Z-score (30). Gradual: rolling slope (20), ranked above spikes. Multi-sensor: Mahalanobis distance.
- Sensor faults (0/null) are isolated and never reported as machine failure; flickering sensors auto-resolve.
- Failure prediction: drift slope is extrapolated to the engineering failure limit (samples to critical).
- Alerts are deduplicated per incident, ranked by priority, and can be acknowledged.

## CSV format
Header `vibration,temperature,rpm,pressure`; empty cells = sensor offline. Use as a live stream (replay) or as the baseline to learn from.

## Voice and Telegram alerts
- **Voice alerts** (dashboard button): each new incident is spoken once, and again only if its severity escalates. Uses Groq Orpheus TTS (free tier, about 200 characters per request) and falls back to the browser's built-in voice if Groq is missing or rate-limited. Click the button once per page load: browsers only allow sound after a click.
- **Telegram** (dashboard button): sends a text alert, plus a voice file when `GROQ_API_KEY` is set. Needs `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env.local` (see `.env.example`). Keys stay on the server.
- **Alert level**: All incidents / High and above (default, includes sensor faults) / Critical only. Applies to both channels.
- **Test alerts** plays a sample line and sends a Telegram test message.
- The voice clip is converted from Groq's WAV to MP3 inside the app (pure JavaScript, no ffmpeg) and sent as a real Telegram voice message. If Telegram refuses it, the app falls back to an audio file, then a plain attachment.

## Demo
Click "Run full demo": normal, spike, drift, dead sensor, flickering sensor, multi-sensor shift, back to normal.
