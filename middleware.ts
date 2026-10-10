import { NextRequest, NextResponse } from "next/server";
import { COOKIE, verifySession } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const user = await verifySession(req.cookies.get(COOKIE)?.value, process.env.AUTH_SECRET);
  if (user) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/dashboard/:path*", "/api/notify", "/api/tts", "/api/explain", "/api/machines", "/api/readings"] };
