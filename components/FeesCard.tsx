"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Button, Pill, Notice } from "@/components/ui";
import { supabase, naira, errMsg } from "@/lib/supabase";
import { payCall } from "@/lib/admin";

type Pay = { id: string; amount: number; reference: string; channel: string; status: string; paid_at: string };
type Status = { online: boolean; mode: "test" | "live" | null; demo: boolean };

export const channelLabel: Record<string, string> = {
  paystack: "Paystack (card/transfer)", bank_teller: "Bank teller", bank_transfer: "Bank transfer", pos: "POS", demo: "Demo",
};

export function FeesCard({ studentId, sessionId, sessionName, due, paid, onChange }: {
  studentId: string; sessionId?: string; sessionName?: string; due: number; paid: number; onChange: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pays, setPays] = useState<Pay[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const outstanding = Math.max(0, Math.round((due - paid) * 100) / 100);

  const load = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await supabase.from("uni_payments").select("id, amount, reference, channel, status, paid_at")
      .eq("student_id", studentId).eq("session_id", sessionId).order("paid_at", { ascending: false });
    setPays((data as Pay[]) ?? []);
  }, [studentId, sessionId]);

  useEffect(() => {
    load();
    payCall<Status>({ action: "status" }).then(setStatus).catch(() => setStatus({ online: false, mode: null, demo: true }));
  }, [load]);

  async function payOnline() {
    setBusy(true); setMsg(null);
    try {
      const out = await payCall<{ authorization_url: string }>({ action: "initialize", callback_url: window.location.href });
      window.location.href = out.authorization_url; // Paystack checkout, then back to /student/payment
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); setBusy(false); }
  }

  async function payDemo() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("uni_pay_fees_demo");
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `Demo payment of ${naira(data as number)} recorded. No money moved.` }); load(); onChange(); }
  }

  return (
    <Card title={`Fees · ${sessionName ?? ""}`} right={status?.online && status.mode === "test" ? <Pill tone="warn">Paystack test mode</Pill> : undefined}>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-ink-3">Due</dt><dd className="font-medium tabular-nums">{naira(due)}</dd></div>
        <div><dt className="text-ink-3">Paid</dt><dd className="font-medium tabular-nums">{naira(paid)}</dd></div>
        <div><dt className="text-ink-3">Balance</dt><dd className={`font-medium tabular-nums ${outstanding > 0 ? "text-bad" : "text-good"}`}>{naira(outstanding)}</dd></div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {outstanding <= 0 ? <Pill tone="good">Fully paid</Pill> : !status ? <span className="text-xs text-ink-3">Checking payment options…</span> : (
          <>
            {status.online && <Button onClick={payOnline} disabled={busy}>{busy ? "Opening Paystack…" : `Pay ${naira(outstanding)} online`}</Button>}
            {!status.online && status.demo && <Button onClick={payDemo} disabled={busy}>{busy ? "Processing…" : `Pay ${naira(outstanding)} (demo)`}</Button>}
            {!status.online && !status.demo && <span className="text-sm text-ink-2">Pay at the bank and present your teller to the Bursary.</span>}
          </>
        )}
      </div>
      {outstanding > 0 && status?.online && <p className="mt-2 text-xs text-ink-3">Card, bank transfer or USSD through Paystack. Your fees are marked paid as soon as Paystack confirms.</p>}
      {outstanding > 0 && status && !status.online && status.demo && <p className="mt-2 text-xs text-ink-3">Online payment is not set up yet, so this demo button records a payment without moving money.</p>}

      {pays.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
          {pays.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium tabular-nums">{naira(p.amount)}</span>
                <span className="ml-2 text-xs text-ink-3">{channelLabel[p.channel] ?? p.channel} · {new Date(p.paid_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</span>
              </span>
              <span className="flex items-center gap-2">
                {p.status === "successful" ? <Pill tone="good">Paid</Pill> : p.status === "pending" ? <Pill tone="warn">Pending</Pill> : <Pill tone="bad">Failed</Pill>}
                {p.status === "successful" && <Link href={`/print/receipt/${encodeURIComponent(p.reference)}`} className="text-xs text-brand hover:underline">Receipt</Link>}
                {p.status === "pending" && p.channel === "paystack" && <Link href={`/student/payment?reference=${encodeURIComponent(p.reference)}`} className="text-xs text-brand hover:underline">Check status</Link>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
