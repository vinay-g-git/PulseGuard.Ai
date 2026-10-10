import Link from "next/link";

const CATCHES = [
  ["Sudden spikes", "A reading jumps far outside its normal range."],
  ["Gradual drift", "A value creeps toward its limit; we estimate how many samples are left."],
  ["Multi-sensor shifts", "Several channels move together in a way none of them shows alone."],
  ["Sensor faults", "Dead or flickering sensors are told apart from real machine problems."],
];

export default function Explore() {
  return (
    <main className="min-h-screen bg-[#10222B] text-[#EEF2F0]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10">
        <header className="f-display text-lg font-bold tracking-tight">PulseGuard AI</header>

        <section className="flex flex-1 flex-col justify-center py-12">
          <h1 className="f-display text-6xl font-extrabold leading-[0.95] tracking-tight sm:text-8xl">PulseGuard AI</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#EEF2F0]/80">
            Watches your machine data around the clock, explains what went wrong, and tells your team by voice on Telegram.
          </p>
          <div className="mt-8">
            <Link href="/login" className="inline-block rounded-lg bg-[#EEF2F0] px-7 py-3 text-base font-semibold text-[#10222B] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7FD6C2]">
              Explore
            </Link>
          </div>

          <svg viewBox="0 0 1200 240" className="mt-12 w-full" role="img" aria-label="A steady vibration trace that spikes once and is flagged as an anomaly">
            <line x1="0" y1="150" x2="1200" y2="150" stroke="#EEF2F0" strokeOpacity=".12" strokeDasharray="4 8" />
            <path className="trace" pathLength="1" fill="none" stroke="#7FD6C2" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
              d="M0 150 L60 146 L120 154 L180 148 L240 152 L300 145 L360 153 L420 149 L480 151 L540 147 L600 150 L640 148 L670 40 L700 210 L730 120 L770 150 L830 147 L900 152 L960 148 L1020 151 L1080 147 L1200 150" />
            <g className="flag">
              <circle className="ring" cx="670" cy="40" r="10" fill="none" stroke="#FF6B4A" strokeWidth="2" />
              <circle cx="670" cy="40" r="6" fill="#FF6B4A" />
              <text x="690" y="34" fill="#FF6B4A" fontSize="18" fontWeight="600">Vibration spike flagged</text>
            </g>
          </svg>
        </section>

        <section className="grid gap-8 border-t border-white/15 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {CATCHES.map(([t, d]) => (
            <div key={t}>
              <h2 className="f-display text-lg font-bold">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#EEF2F0]/70">{d}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
