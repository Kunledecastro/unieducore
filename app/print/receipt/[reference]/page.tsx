"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { PrintShell, Letterhead, Watermark, printedOn } from "@/components/PrintShell";
import { supabase, naira } from "@/lib/supabase";
import { channelLabel } from "@/components/FeesCard";

type Payment = {
  id: string; amount: number; reference: string; channel: string; status: string; paid_at: string; verified_at: string | null; note: string | null;
  student_id: string; session: { id: string; name: string } | null;
  recorder: { full_name: string } | null;
};
type Student = { id: string; matric_no: string; level: number; programme_id: string; profile: { full_name: string; email: string } | null; programme: { name: string; award: string } | null };
type Fee = { name: string; amount: number; programme_id: string | null; level: number | null };

function Receipt() {
  const { profile } = useAuth();
  const { reference } = useParams<{ reference: string }>();
  const [p, setP] = useState<Payment | null>(null);
  const [st, setSt] = useState<Student | null>(null);
  const [fees, setFees] = useState<Fee[]>([]);
  const [paidTotal, setPaidTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const { data } = await supabase.from("uni_payments")
        .select("id, amount, reference, channel, status, paid_at, verified_at, note, student_id, session:uni_sessions(id, name), recorder:uni_profiles!uni_payments_recorded_by_fkey(full_name)")
        .eq("reference", decodeURIComponent(reference)).maybeSingle();
      if (!data) { setErr("Receipt not found."); return; }
      const pay = data as unknown as Payment;
      const [{ data: s }, { data: f }, { data: all }] = await Promise.all([
        supabase.from("uni_students").select("id, matric_no, level, programme_id, profile:uni_profiles(full_name, email), programme:uni_programmes(name, award)").eq("id", pay.student_id).single(),
        supabase.from("uni_fee_items").select("name, amount, programme_id, level").eq("session_id", pay.session?.id ?? ""),
        supabase.from("uni_payments").select("amount, paid_at").eq("student_id", pay.student_id).eq("session_id", pay.session?.id ?? "").eq("status", "successful"),
      ]);
      const stu = s as unknown as Student;
      setP(pay); setSt(stu);
      setFees(((f as Fee[]) ?? []).filter((x) => (!x.programme_id || x.programme_id === stu.programme_id) && (!x.level || x.level === stu.level)));
      setPaidTotal(((all as { amount: number; paid_at: string }[]) ?? []).filter((x) => x.paid_at <= pay.paid_at).reduce((a, x) => a + Number(x.amount), 0));
    })();
  }, [profile, reference]);

  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!p || !st) return <p className="text-sm text-ink-3">Loading…</p>;
  const due = fees.reduce((a, f) => a + Number(f.amount), 0);
  const ok = p.status === "successful";

  return (
    <>
      {!ok && <Watermark text={p.status === "pending" ? "Not confirmed" : "Not paid"} />}
      <Letterhead university={profile?.tenant?.name ?? ""} short={profile?.tenant?.short_name} title={ok ? "Official Receipt" : "Payment Record"}
        subtitle={`School fees · ${p.session?.name} Session`} right={<>Receipt no. <span className="font-mono">{p.reference}</span><br />Printed {printedOn()}</>} />

      <table className="tbl mb-4">
        <tbody>
          <tr><th className="w-36">Received from</th><td>{st.profile?.full_name}</td><th className="w-32">Matric No.</th><td className="font-mono">{st.matric_no}</td></tr>
          <tr><th>Programme</th><td>{st.programme?.award} {st.programme?.name}</td><th>Level</th><td>{st.level}</td></tr>
          <tr><th>Amount</th><td className="text-base font-bold">{naira(p.amount)}</td><th>Status</th><td className="font-semibold">{ok ? "Paid" : p.status === "pending" ? "Awaiting confirmation" : "Failed"}</td></tr>
          <tr><th>Payment method</th><td>{channelLabel[p.channel] ?? p.channel}</td><th>Date paid</th><td>{new Date(p.paid_at).toLocaleString("en-NG", { dateStyle: "long", timeStyle: p.channel === "paystack" ? "short" : undefined })}</td></tr>
          {(p.recorder || p.note) && <tr><th>Recorded by</th><td>{p.recorder?.full_name ?? "—"}</td><th>Note</th><td>{p.note ?? "—"}</td></tr>}
        </tbody>
      </table>

      <h2 className="mb-1 text-xs font-bold uppercase tracking-wide">Fees for the {p.session?.name} session</h2>
      <table className="tbl">
        <thead><tr><th>Item</th><th className="num w-32">Amount</th></tr></thead>
        <tbody>
          {fees.map((f, i) => <tr key={i}><td>{f.name}</td><td className="num">{naira(f.amount)}</td></tr>)}
          <tr><td className="num font-semibold">Total due</td><td className="num font-semibold">{naira(due)}</td></tr>
          <tr><td className="num">Paid to date{ok ? " (including this payment)" : ""}</td><td className="num">{naira(paidTotal)}</td></tr>
          <tr><td className="num font-semibold">Balance</td><td className="num font-semibold">{naira(Math.max(0, due - paidTotal))}</td></tr>
        </tbody>
      </table>

      <p className="mt-6 text-[10px] text-ink-3">
        {p.channel === "paystack" ? "Paid online through Paystack and confirmed automatically. " : ""}
        Verify this receipt with the Bursary using the receipt number. Generated by UniEducore.
      </p>
      <div className="mt-10 w-64 text-xs break-inside-avoid">
        <div className="h-10 border-b border-ink" />
        <div className="mt-1 font-medium">Bursar</div>
      </div>
    </>
  );
}

export default function Page() {
  return <PrintShell allow={["student", "bursar", "registrar", "admin"]} title="Payment receipt"><Receipt /></PrintShell>;
}
