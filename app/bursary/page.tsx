"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Pill, Stat, Empty, Button, Notice, Modal, Field, Tabs } from "@/components/ui";
import { supabase, naira, errMsg } from "@/lib/supabase";
import { payCall } from "@/lib/admin";
import { channelLabel } from "@/components/FeesCard";

type Student = { id: string; matric_no: string; level: number; profile: { full_name: string } | null; programme: { name: string } | null };
type Payment = { id: string; amount: number; reference: string; channel: string; status: string; paid_at: string; note: string | null; student_id: string; session_id: string };
type Fee = { name: string; amount: number; level: number | null; programme: { name: string } | null };
type Manual = { student_id: string; amount: string; reference: string; channel: string; paid_on: string; note: string };
type PayStatus = { online: boolean; mode: "test" | "live" | null; demo: boolean };

function Bursary() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [rows, setRows] = useState<{ s: Student; due: number; paid: number }[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [tab, setTab] = useState<"balances" | "payments">("balances");
  const [filter, setFilter] = useState<"all" | "owing" | "cleared">("all");
  const [payFilter, setPayFilter] = useState("all");
  const [q, setQ] = useState("");
  const [manual, setManual] = useState<Manual | null>(null);
  const [status, setStatus] = useState<PayStatus | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: ses } = await supabase.from("uni_sessions").select("id, name").eq("is_current", true).single();
    if (!ses) return;
    setSession(ses);
    const [{ data: st }, { data: pay }, { data: fi }] = await Promise.all([
      supabase.from("uni_students").select("id, matric_no, level, profile:uni_profiles(full_name), programme:uni_programmes(name)").order("matric_no"),
      supabase.from("uni_payments").select("id, amount, reference, channel, status, paid_at, note, student_id, session_id").eq("session_id", ses.id).order("paid_at", { ascending: false }),
      supabase.from("uni_fee_items").select("name, amount, level, programme:uni_programmes(name)").eq("session_id", ses.id).order("amount", { ascending: false }),
    ]);
    const students = (st as unknown as Student[]) ?? [];
    const pays = (pay as Payment[]) ?? [];
    setPayments(pays);
    setFees((fi as unknown as Fee[]) ?? []);
    const withDue = await Promise.all(students.map(async (s) => {
      const { data: d } = await supabase.rpc("uni_fees_due", { p_student: s.id, p_session: ses.id });
      const paid = pays.filter((p) => p.student_id === s.id && p.status === "successful").reduce((a, p) => a + Number(p.amount), 0);
      return { s, due: Number(d ?? 0), paid };
    }));
    setRows(withDue);
  }, []);
  useEffect(() => { load(); payCall<PayStatus>({ action: "status" }).then(setStatus).catch(() => null); }, [load]);

  const totalDue = (rows ?? []).reduce((a, r) => a + r.due, 0);
  const totalPaid = (rows ?? []).reduce((a, r) => a + Math.min(r.paid, r.due), 0);
  const owing = (rows ?? []).filter((r) => r.paid < r.due).length;
  const names = Object.fromEntries((rows ?? []).map((r) => [r.s.id, `${r.s.profile?.full_name ?? ""} · ${r.s.matric_no}`]));
  const flagged = payments.filter((p) => p.note?.startsWith("Paystack amount"));
  const pending = payments.filter((p) => p.status === "pending");

  const shownRows = (rows ?? []).filter((r) => (filter === "all" || (filter === "owing" ? r.paid < r.due : r.paid >= r.due))
    && (!q || `${r.s.matric_no} ${r.s.profile?.full_name}`.toLowerCase().includes(q.toLowerCase())));
  const shownPays = payments.filter((p) => (payFilter === "all" || (payFilter === "flagged" ? p.note?.startsWith("Paystack amount") : p.status === payFilter || p.channel === payFilter))
    && (!q || `${p.reference} ${names[p.student_id]}`.toLowerCase().includes(q.toLowerCase())));

  async function saveManual() {
    if (!manual) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("uni_record_manual_payment", {
      p_student: manual.student_id, p_amount: Number(manual.amount), p_reference: manual.reference, p_channel: manual.channel, p_paid_on: manual.paid_on, p_note: manual.note,
    });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `${naira(Number(manual.amount))} recorded for ${names[manual.student_id]}.` }); setManual(null); load(); }
  }

  async function verify(p: Payment) {
    try {
      const out = await payCall<{ status: string }>({ action: "verify", reference: p.reference });
      setMsg({ kind: out.status === "successful" ? "success" : "error", text: `Paystack says ${p.reference} is ${out.status.replace("_", " ")}.` }); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
  }

  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHead title="Fees and payments" sub={session ? `${session.name} session` : undefined}
        right={<Button onClick={() => setManual({ student_id: rows?.[0]?.s.id ?? "", amount: "", reference: "", channel: "bank_teller", paid_on: today, note: "" })} disabled={!rows?.length}>Record bank payment</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {status && !status.online && <Notice kind="info">Online payment (Paystack) is not switched on yet. Students {status.demo ? "see a demo pay button that records payments without moving money" : "pay at the bank; record their tellers here"}.</Notice>}
      {status?.online && status.demo && <Notice kind="error">Paystack is on, but demo payments are still allowed. Switch them off under Rules so students cannot mark fees paid without paying.</Notice>}
      {flagged.length > 0 && <Notice kind="error">{flagged.length} Paystack payment(s) had an amount that did not match the fees and were not counted. Review them in the Payments tab.</Notice>}

      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <Stat label="Expected" value={naira(totalDue)} />
        <Stat label="Collected" value={naira(totalPaid)} tone="good" />
        <Stat label="Collection rate" value={totalDue ? `${Math.round((totalPaid / totalDue) * 100)}%` : "—"} note={status?.online ? `Paystack ${status.mode} mode` : undefined} />
        <Stat label="Students owing" value={owing} tone={owing ? "bad" : "good"} note={pending.length ? `${pending.length} online payment(s) pending` : "Blocked from course registration"} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[{ value: "balances", label: "Student balances" }, { value: "payments", label: `Payments (${payments.length})` }]} />

      {tab === "balances" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Student balances" className="lg:col-span-2"
            right={<div className="flex gap-2">
              <input className="input w-44 text-sm" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="input text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                <option value="all">All</option><option value="owing">Owing</option><option value="cleared">Cleared</option>
              </select>
            </div>}>
            {!rows ? <p className="text-sm text-ink-3">Loading…</p> : (
              <Table head={["Matric no.", "Name", "Programme", "Due", "Paid", "Balance"]}>
                {shownRows.map(({ s, due, paid }) => {
                  const bal = due - paid;
                  return (
                    <tr key={s.id}>
                      <td className={`${td} font-mono text-xs`}>{s.matric_no}</td>
                      <td className={td}>{s.profile?.full_name}</td>
                      <td className={td}>{s.programme?.name} · {s.level}L</td>
                      <td className={`${td} tabular-nums`}>{naira(due)}</td>
                      <td className={`${td} tabular-nums`}>{naira(paid)}</td>
                      <td className={td}>{bal > 0 ? <Pill tone="bad">{naira(bal)}</Pill> : <Pill tone="good">Cleared</Pill>}</td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
          <Card title="Fee schedule">
            <ul className="divide-y divide-line text-sm">
              {fees.map((f, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span>{f.name}<span className="block text-xs text-ink-3">{f.programme ? f.programme.name : "All programmes"}{f.level ? ` · ${f.level}L only` : ""}</span></span>
                  <span className="tabular-nums font-medium">{naira(f.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "payments" && (
        <Card title="All payments this session"
          right={<div className="flex gap-2">
            <input className="input w-44 text-sm" placeholder="Search reference or name" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input text-sm" value={payFilter} onChange={(e) => setPayFilter(e.target.value)}>
              <option value="all">All</option><option value="successful">Successful</option><option value="pending">Pending</option><option value="failed">Failed</option>
              <option value="flagged">Amount mismatch</option><option value="paystack">Paystack</option><option value="bank_teller">Bank teller</option><option value="bank_transfer">Bank transfer</option><option value="demo">Demo</option>
            </select>
          </div>}>
          {shownPays.length === 0 ? <Empty>No payments match.</Empty> : (
            <Table head={["Date", "Student", "Reference", "Method", "Amount", "Status", ""]}>
              {shownPays.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} text-xs text-ink-3 whitespace-nowrap`}>{new Date(p.paid_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
                  <td className={td}>{names[p.student_id]}</td>
                  <td className={`${td} font-mono text-xs`}>{p.reference}{p.note && <div className="font-sans text-ink-3">{p.note}</div>}</td>
                  <td className={td}><Pill>{channelLabel[p.channel] ?? p.channel}</Pill></td>
                  <td className={`${td} tabular-nums font-medium`}>{naira(p.amount)}</td>
                  <td className={td}>{p.status === "successful" ? <Pill tone="good">Paid</Pill> : p.status === "pending" ? <Pill tone="warn">Pending</Pill> : <Pill tone="bad">Failed</Pill>}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {p.status === "successful" && <a href={`/print/receipt/${encodeURIComponent(p.reference)}`} className="text-xs text-brand hover:underline">Receipt</a>}
                    {p.status === "pending" && p.channel === "paystack" && <button className="text-xs text-brand hover:underline" onClick={() => verify(p)}>Check with Paystack</button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {manual && rows && (
        <Modal title="Record bank payment" onClose={() => setManual(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveManual(); }}>
            <Field label="Student">
              <select className="input w-full" value={manual.student_id} onChange={(e) => setManual({ ...manual, student_id: e.target.value })}>
                {rows.map(({ s, due, paid }) => <option key={s.id} value={s.id}>{s.matric_no} · {s.profile?.full_name}{due - paid > 0 ? ` (owes ${naira(due - paid)})` : " (cleared)"}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (₦)"><input className="input w-full" type="number" min={1} step="0.01" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></Field>
              <Field label="Date paid"><input className="input w-full" type="date" max={today} value={manual.paid_on} onChange={(e) => setManual({ ...manual, paid_on: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Method">
                <select className="input w-full" value={manual.channel} onChange={(e) => setManual({ ...manual, channel: e.target.value })}>
                  <option value="bank_teller">Bank teller</option><option value="bank_transfer">Bank transfer</option><option value="pos">POS</option>
                </select>
              </Field>
              <Field label="Teller / transfer reference"><input className="input w-full uppercase" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} /></Field>
            </div>
            <Field label="Note (optional)"><input className="input w-full" value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} placeholder="e.g. First Bank, Yaba branch" /></Field>
            <p className="text-xs text-ink-3">Confirm the money is in the university account before recording it. Each reference can only be recorded once.</p>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !manual.student_id || !(Number(manual.amount) > 0) || !manual.reference.trim()}>{busy ? "Saving…" : "Record payment"}</Button>
              <Button variant="secondary" onClick={() => setManual(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["bursar", "registrar", "admin"]}><Bursary /></Shell>;
}
