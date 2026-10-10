"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: f.get("username"), password: f.get("password") }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { window.location.href = "/dashboard"; return; }
      setError(data.error ?? "Could not sign in. Try again.");
    } catch { setError("Could not reach the server. Check your connection and try again."); }
    setBusy(false);
  }

  const input = "mt-1.5 w-full rounded-lg border border-[#10222B]/25 bg-white px-3.5 py-2.5 text-base focus:border-[#10222B] focus:outline focus:outline-2 focus:outline-[#7FD6C2]";
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-[#10222B] p-10 text-[#EEF2F0] lg:flex">
        <Link href="/" className="f-display text-lg font-bold tracking-tight">PulseGuard AI</Link>
        <p className="f-display max-w-sm text-4xl font-bold leading-tight tracking-tight">Know about the problem before the machine stops.</p>
        <p className="text-sm text-[#EEF2F0]/60">Alerts reach your team by voice on Telegram.</p>
      </aside>
      <section className="flex items-center justify-center bg-[#EEF2F0] px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm text-[#10222B]">
          <Link href="/" className="f-display mb-8 block text-lg font-bold lg:hidden">PulseGuard AI</Link>
          <h1 className="f-display text-3xl font-bold tracking-tight">Sign in to your company account</h1>
          <label className="mt-8 block text-sm font-medium">Username
            <input name="username" autoComplete="username" required className={input} />
          </label>
          <label className="mt-5 block text-sm font-medium">Password
            <input name="password" type="password" autoComplete="current-password" required className={input} />
          </label>
          {error && <p role="alert" className="mt-4 rounded-lg bg-[#FF6B4A]/15 px-3 py-2 text-sm text-[#8A2410]">{error}</p>}
          <button disabled={busy} className="mt-6 w-full rounded-lg bg-[#10222B] py-3 font-semibold text-white transition hover:bg-[#1B3744] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7FD6C2]">
            {busy ? "Signing in" : "Sign in"}
          </button>
          <p className="mt-6 text-sm text-[#10222B]/60">No account? Ask your company admin to add you.</p>
        </form>
      </section>
    </main>
  );
}
