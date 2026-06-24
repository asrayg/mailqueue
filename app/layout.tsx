import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MailQueue",
  description: "Controlled, scheduled, multi-provider email outreach.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-border bg-panel">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
              <Link href="/campaigns" className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">MailQueue</span>
                <span className="badge bg-slate-800 text-slate-400">
                  controlled outreach
                </span>
              </Link>
              <nav className="flex items-center gap-3 text-sm">
                <Link href="/campaigns" className="text-slate-300 hover:text-white">
                  Campaigns
                </Link>
                <Link href="/campaigns/new" className="btn-primary">
                  New Campaign
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
