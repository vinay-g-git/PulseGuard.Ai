import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--f-display", weight: ["500", "700", "800"] });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--f-body" });

export const metadata: Metadata = {
  title: "PulseGuard AI",
  description: "AI-based anomaly detection and voice alerts for machine data",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}
