"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { PrintShell, Letterhead, SignatureLines, Watermark, printedOn } from "@/components/PrintShell";
import { supabase, naira } from "@/lib/supabase";
import { allocLabel, effectiveStatus, dt, type AllocStatus } from "@/lib/hostel";

type Slip = {
  id: string; student_id: string; session_id: string; status: AllocStatus; amount: number; reserved_at: string; expires_at: string | null; confirmed_at: string | null;
  checked_in_at: string | null; condition_in: string | null;
  student: { matric_no: string; level: number; gender: string | null; profile: { full_name: string } | null; programme: { name: string; award: string } | null } | null;
  hostel: { name: string } | null; session: { name: string } | null;
  bed: { label: string; room: { name: string; floor: string | null; room_type: string } | null } | null;
};

function HostelSlip() {
  const { profile } = useAuth();
  const { allocationId } = useParams<{ allocationId: string }>();
  const [s, setS] = useState<Slip | null>(null);
  const [paid, setPaid] = useState(0);
  const [refs, setRefs] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const cols = "id, student_id, session_id, status, amount, reserved_at, expires_at, confirmed_at, checked_in_at, condition_in, student:uni_students(matric_no, level, gender, profile:uni_profiles(full_name), programme:uni_programmes(name, award)), hostel:uni_hostels(name), session:uni_sessions(name), bed:uni_hostel_beds(label, room:uni_hostel_rooms(name, floor, room_type))";
      let id = allocationId;
      if (allocationId === "me") {
        const { data } = await supabase.rpc("uni_hostel_my_room");
        id = ((data as { allocation_id: string }[]) ?? [])[0]?.allocation_id;
        if (!id) { setErr("You have no hostel allocation this session."); return; }
      }
      const { data } = await supabase.from("uni_hostel_allocations").select(cols).eq("id", id).maybeSingle();
      if (!data) { setErr("Allocation not found."); return; }
      const slip = data as unknown as Slip;
      const { data: pays } = await supabase.from("uni_payments").select("amount, reference").eq("student_id", slip.student_id).eq("session_id", slip.session_id).eq("purpose", "hostel").eq("status", "successful");
      setS(slip);
      setPaid(((pays as { amount: number }[]) ?? []).reduce((a, p) => a + Number(p.amount), 0));
      setRefs(((pays as { reference: string }[]) ?? []).map((p) => p.reference));
    })();
  }, [profile, allocationId]);

  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!s) return <p className="text-sm text-ink-3">Loading…</p>;
  const status = effectiveStatus(s.status, s.expires_at, paid, Number(s.amount));
  const valid = status === "confirmed" || status === "checked_in";

  return (
    <>
      {!valid && <Watermark text={status === "reserved" ? "Not paid" : "Not valid"} />}
      <Letterhead university={profile?.tenant?.name ?? ""} short={profile?.tenant?.short_name} title="Hostel Allocation Slip"
        subtitle={`${s.session?.name} Session · Office of Student Affairs`}
        right={<>Slip no. <span className="font-mono">{s.id.slice(0, 8).toUpperCase()}</span><br />Printed {printedOn()}</>} />

      <table className="tbl mb-4">
        <tbody>
          <tr><th className="w-36">Name</th><td>{s.student?.profile?.full_name}</td><th className="w-32">Matric No.</th><td className="font-mono">{s.student?.matric_no}</td></tr>
          <tr><th>Programme</th><td>{s.student?.programme?.award} {s.student?.programme?.name}</td><th>Level</th><td>{s.student?.level}</td></tr>
        </tbody>
      </table>

      <table className="tbl mb-4">
        <tbody>
          <tr><th className="w-36">Hall</th><td className="text-base font-bold">{s.hostel?.name}</td><th className="w-32">Room · Bed</th><td className="text-base font-bold">{s.bed?.room?.name} · {s.bed?.label}</td></tr>
          <tr><th>Room type</th><td>{s.bed?.room?.room_type}</td><th>Floor</th><td>{s.bed?.room?.floor ?? "—"}</td></tr>
          <tr><th>Hostel fee</th><td>{naira(s.amount)}</td><th>Paid</th><td>{naira(paid)}{refs.length ? <span className="block font-mono text-[10px]">{refs.join(", ")}</span> : null}</td></tr>
          <tr><th>Status</th><td className="font-semibold">{allocLabel[status]}</td><th>Checked in</th><td>{s.checked_in_at ? dt(s.checked_in_at) : "—"}</td></tr>
          {s.condition_in && <tr><th>Room condition</th><td colSpan={3}>{s.condition_in}</td></tr>}
        </tbody>
      </table>

      <ol className="list-decimal space-y-1 pl-5 text-[11px] text-ink-2">
        <li>Present this slip and your student ID card to the hall porter to check in and collect your key.</li>
        <li>This bed is for the named student only. Squatting, sub-letting or swapping beds without approval is not allowed.</li>
        <li>Report faults through the portal. Request an exeat through the portal before leaving campus overnight.</li>
        <li>Return your key and have the room inspected by the porter when you check out.</li>
      </ol>

      <SignatureLines roles={["Student", "Hall porter", "Hostel officer"]} />
    </>
  );
}

export default function Page() {
  return <PrintShell allow={["student", "hostel_officer", "admin", "registrar", "bursar"]} title="Hostel allocation slip"><HostelSlip /></PrintShell>;
}
