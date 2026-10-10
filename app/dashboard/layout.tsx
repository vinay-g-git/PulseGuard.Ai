export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="flex items-center justify-between bg-[#10222B] px-4 py-2 text-sm text-white">
        <nav className="flex items-center gap-5"><span className="f-display font-semibold tracking-tight">PulseGuard AI</span><a href="/dashboard" className="hover:underline">Dashboard</a><a href="/dashboard/devices" className="hover:underline">Devices</a></nav>
        <form action="/api/logout" method="post">
          <button className="rounded-md border border-white/25 px-3 py-1 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7FD6C2]">Sign out</button>
        </form>
      </header>
      {children}
    </>
  );
}
