"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import type { Role } from "@/lib/supabase";

/** Wrapper for printable documents: checks sign-in and role, shows a toolbar that is hidden when printing. */
export function PrintShell({ allow, landscape, title, children }: { allow: Role[]; landscape?: boolean; title: string; children: ReactNode }) {
  const { profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace("/login");
    else if (profile.must_change_password) router.replace("/account/password");
  }, [loading, profile, router]);
  useEffect(() => { document.title = title; }, [title]);

  if (loading || !profile) return <div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>;
  if (!allow.includes(profile.role)) return <div className="min-h-screen grid place-items-center text-sm text-ink-3">You do not have access to this document.</div>;

  return (
    <div className="print-root min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm; }`}</style>
      <div className="no-print sticky top-0 z-10 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5 text-sm">
          <button onClick={() => router.back()} className="text-brand hover:underline">← Back</button>
          <span className="text-ink-3">{title}</span>
          <span className="ml-auto text-xs text-ink-3 hidden sm:block">Use “Save as PDF” in the print dialog to keep a copy{landscape ? " · prints landscape" : ""}</span>
          <button onClick={() => window.print()} className="rounded-md bg-brand px-4 py-1.5 font-medium text-white hover:bg-brand-dark">Print / Save PDF</button>
        </div>
      </div>
      <div className={`doc mx-auto my-6 bg-white shadow-sm print:my-0 print:shadow-none ${landscape ? "max-w-[297mm]" : "max-w-[210mm]"} p-[12mm] print:p-0`}>
        {children}
      </div>
    </div>
  );
}

/** University letterhead used at the top of every document. */
export function Letterhead({ university, short, title, subtitle, right }: { university: string; short?: string; title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-5 border-b-2 border-ink pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-brand text-sm font-bold text-brand">{short ?? university.slice(0, 3).toUpperCase()}</span>
          <div>
            <div className="text-lg font-bold uppercase tracking-wide text-ink">{university}</div>
            <div className="text-xs text-ink-2">Office of the Registrar</div>
          </div>
        </div>
        {right && <div className="text-right text-xs text-ink-2">{right}</div>}
      </div>
      <h1 className="mt-3 text-center text-base font-bold uppercase tracking-wider">{title}</h1>
      {subtitle && <div className="mt-0.5 text-center text-xs text-ink-2">{subtitle}</div>}
    </header>
  );
}

export function SignatureLines({ roles }: { roles: string[] }) {
  return (
    <div className={`mt-10 grid gap-8 break-inside-avoid`} style={{ gridTemplateColumns: `repeat(${roles.length}, minmax(0, 1fr))` }}>
      {roles.map((r) => (
        <div key={r} className="text-xs">
          <div className="h-10 border-b border-ink" />
          <div className="mt-1 font-medium">{r}</div>
          <div className="mt-3 text-ink-3">Name: ____________________</div>
          <div className="mt-2 text-ink-3">Date: _____________</div>
        </div>
      ))}
    </div>
  );
}

export function Watermark({ text }: { text: string }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center print:fixed">
      <span className="rotate-[-30deg] select-none text-[90px] font-black uppercase tracking-widest text-bad/10">{text}</span>
    </div>
  );
}

export const printedOn = () => new Date().toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" });
