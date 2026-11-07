"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Pill, Stat, Empty } from "@/components/ui";
import { supabase, naira } from "@/lib/supabase";

type Student = { id: string; matric_no: string; level: number; profile: { full_name: string } | null; programme: { name: string } | null };
type Payment = { id: string; amount: number; reference: string; channel: string; paid_at: string; student_id: string; session_id: string };
type Fee = { name: string; amount: number; level: number | null; programme: { name: string } | null };

function Bursary() {
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [rows, setRows] = useState<{ s: Student; due: number; paid: number }[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);

  useEffect(() => {
    (async () => {
      const { data: ses } = await supabase.from("uni_sessions").select("id, name").eq("is_current", true).single();
      if (!ses) return;
      setSession(ses);
      const [{ data: st }, { data: pay }, { data: fi }] = await Promise.all([
        supabase.from("uni_students").select("id, matric_no, level, profile:uni_profiles(full_name), programme:uni_programmes(name)").order("matric_no"),
        supabase.from("uni_payments").select("id, amount, reference, channel, paid_at, student_id, session_id").eq("status", "successful").order("paid_at", { ascending: false }),
        supabase.from("uni_fee_items").select("name, amount, level, programme:uni_programmes(name)").eq("session_id", ses.id).order("amount", { ascending: false }),
      ]);
      const students = (st as unknown as Student[]) ?? [];
      const pays = (pay as Payment[]) ?? [];
      setPayments(pays);
      setFees((fi as unknown as Fee[]) ?? []);
      const withDue = await Promise.all(students.map(async (s) => {
        const { data: d } = await supabase.rpc("uni_fees_due", { p_student: s.id, p_session: ses.id });
        const paid = pays.filter((p) => p.student_id === s.id && p.session_id === ses.id).reduce((a, p) => a + Number(p.amount), 0);
        return { s, due: Number(d ?? 0), paid };
      }));
      setRows(withDue);
    })();
  }, []);

  const totalDue = (rows ?? []).reduce((a, r) => a + r.due, 0);
  const totalPaid = (rows ?? []).reduce((a, r) => a + Math.min(r.paid, r.due), 0);
  const owing = (rows ?? []).filter((r) => r.paid < r.due).length;
  const names = Object.fromEntries((rows ?? []).map((r) => [r.s.id, r.s.profile?.full_name ?? ""]));

  return (
    <>
      <PageHead title="Fees and payments" sub={session ? `${session.name} session` : undefined} />
      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <Stat label="Expected" value={naira(totalDue)} />
        <Stat label="Collected" value={naira(totalPaid)} tone="good" />
        <Stat label="Collection rate" value={totalDue ? `${Math.round((totalPaid / totalDue) * 100)}%` : "—"} />
        <Stat label="Students owing" value={owing} tone={owing ? "bad" : "good"} note="Blocked from course registration" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Student balances" className="lg:col-span-2">
          {!rows ? <p className="text-sm text-ink-3">Loading…</p> : (
            <Table head={["Matric no.", "Name", "Programme", "Due", "Paid", "Balance"]}>
              {rows.map(({ s, due, paid }) => {
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

      <Card title="Recent payments" className="mt-4">
        {payments.length === 0 ? <Empty>No payments yet.</Empty> : (
          <Table head={["Date", "Student", "Reference", "Channel", "Amount"]}>
            {payments.slice(0, 25).map((p) => (
              <tr key={p.id}>
                <td className={`${td} text-xs text-ink-3 whitespace-nowrap`}>{new Date(p.paid_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
                <td className={td}>{names[p.student_id]}</td>
                <td className={`${td} font-mono text-xs`}>{p.reference}</td>
                <td className={td}><Pill>{p.channel}</Pill></td>
                <td className={`${td} tabular-nums font-medium`}>{naira(p.amount)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return <Shell allow={["bursar", "registrar", "admin"]}><Bursary /></Shell>;
}
