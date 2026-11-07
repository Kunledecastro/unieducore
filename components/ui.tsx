"use client";

import type { ReactNode } from "react";
import type { ResultStatus } from "@/lib/supabase";
import { statusLabel } from "@/lib/supabase";

export function PageHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-paper ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  const toneCls = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  );
}

const statusTone: Record<ResultStatus, string> = {
  draft: "bg-mute text-ink-2",
  submitted: "bg-warn-soft text-warn",
  hod_approved: "bg-info-soft text-info",
  senate_approved: "bg-brand-soft text-brand",
  released: "bg-good-soft text-good",
};

export function StatusPill({ status }: { status: ResultStatus }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone[status]}`}>{statusLabel[status]}</span>;
}

export function Pill({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "good" | "warn" | "bad" | "info" | "brand" }) {
  const cls = { mute: "bg-mute text-ink-2", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info", brand: "bg-brand-soft text-brand" }[tone];
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function Button({ children, onClick, variant = "primary", disabled, type = "button", small }: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "danger"; disabled?: boolean; type?: "button" | "submit"; small?: boolean;
}) {
  const v = {
    primary: "bg-brand text-white hover:bg-brand-dark",
    secondary: "border border-line bg-paper text-ink-2 hover:bg-mute",
    danger: "border border-bad/30 bg-paper text-bad hover:bg-bad-soft",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed ${v}`}>
      {children}
    </button>
  );
}

export function Notice({ kind, children, onClose }: { kind: "error" | "success" | "info"; children: ReactNode; onClose?: () => void }) {
  const cls = { error: "border-bad/30 bg-bad-soft text-bad", success: "border-good/30 bg-good-soft text-good", info: "border-info/30 bg-info-soft text-info" }[kind];
  return (
    <div className={`mb-5 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <div>{children}</div>
      {onClose && <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">×</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">{children}</div>;
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            {head.map((h, i) => <th key={i} className="px-5 py-2 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-5 py-2.5 align-middle";
