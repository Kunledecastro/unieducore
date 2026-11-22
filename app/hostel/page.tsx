"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/auth";
import { Card, PageHead, Button, Notice, Pill, Empty, Field, Modal, Table, td, Stat } from "@/components/ui";
import { supabase, naira, errMsg } from "@/lib/supabase";
import { allocLabel, allocTone, effectiveStatus, dt, type AllocStatus } from "@/lib/hostel";

type Occ = { hostel_id: string; hostel: string; gender: string; is_active: boolean; beds: number; reserved: number; confirmed: number; checked_in: number; free: number };
type Alloc = {
  id: string; student_id: string; hostel_id: string; bed_id: string; status: AllocStatus; amount: number; reserved_at: string; expires_at: string | null;
  checked_in_at: string | null; allocated_by: string | null;
  student: { matric_no: string; level: number; gender: string | null; profile: { full_name: string } | null } | null;
  bed: { label: string; room: { id: string; name: string; room_type: string } | null } | null;
  hostel: { name: string } | null;
};
type Bed = { id: string; label: string; is_active: boolean; room: { id: string; name: string; fee: number; room_type: string; is_active: boolean; hostel_id: string } | null };
type Student = { id: string; matric_no: string; level: number; gender: string | null; status: string; profile: { full_name: string } | null };

function Allocations() {
  const [occ, setOcc] = useState<Occ[]>([]);
  const [allocs, setAllocs] = useState<Alloc[] | null>(null);
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [beds, setBeds] = useState<Bed[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [hall, setHall] = useState("");
  const [st, setSt] = useState("active");
  const [q, setQ] = useState("");
  const [place, setPlace] = useState<{ student_id: string; hostel_id: string; bed_id: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: o } = await supabase.rpc("uni_hostel_occupancy"); // also releases lapsed holds
    setOcc((o as Occ[]) ?? []);
    const { data: ses } = await supabase.from("uni_sessions").select("id, name").eq("is_current", true).maybeSingle();
    setSession(ses);
    if (!ses) { setAllocs([]); return; }
    const [a, p, b, s] = await Promise.all([
      supabase.from("uni_hostel_allocations").select("id, student_id, hostel_id, bed_id, status, amount, reserved_at, expires_at, checked_in_at, allocated_by, student:uni_students(matric_no, level, gender, profile:uni_profiles(full_name)), bed:uni_hostel_beds(label, room:uni_hostel_rooms(id, name, room_type)), hostel:uni_hostels(name)")
        .eq("session_id", ses.id).order("reserved_at", { ascending: false }),
      supabase.from("uni_payments").select("student_id, amount").eq("session_id", ses.id).eq("purpose", "hostel").eq("status", "successful"),
      supabase.from("uni_hostel_beds").select("id, label, is_active, room:uni_hostel_rooms(id, name, fee, room_type, is_active, hostel_id)"),
      supabase.from("uni_students").select("id, matric_no, level, gender, status, profile:uni_profiles(full_name)").eq("status", "active").order("matric_no"),
    ]);
    setAllocs((a.data as unknown as Alloc[]) ?? []);
    const m: Record<string, number> = {};
    ((p.data as { student_id: string; amount: number }[]) ?? []).forEach((x) => { m[x.student_id] = (m[x.student_id] ?? 0) + Number(x.amount); });
    setPaid(m);
    setBeds((b.data as unknown as Bed[]) ?? []);
    setStudents((s.data as unknown as Student[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const live = (a: Alloc) => ["reserved", "confirmed", "checked_in"].includes(effectiveStatus(a.status, a.expires_at, paid[a.student_id] ?? 0, a.amount));
  // Paid for the session but holding no bed (their hold lapsed and someone took the bed): needs placing by hand
  const paidNoBed = useMemo(() => {
    if (!allocs) return [];
    const holders = new Set(allocs.filter(live).map((a) => a.student_id));
    const seen = new Set<string>();
    return allocs.filter((a) => a.status === "expired" && !holders.has(a.student_id) && (paid[a.student_id] ?? 0) >= a.amount && !seen.has(a.student_id) && seen.add(a.student_id));
  }, [allocs, paid]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (allocs ?? []).filter((a) => {
    const s = effectiveStatus(a.status, a.expires_at, paid[a.student_id] ?? 0, a.amount);
    if (hall && a.hostel_id !== hall) return false;
    if (st === "active" && !["reserved", "confirmed", "checked_in"].includes(s)) return false;
    if (st !== "active" && st !== "all" && s !== st) return false;
    return !q || `${a.student?.matric_no} ${a.student?.profile?.full_name} ${a.bed?.room?.name}`.toLowerCase().includes(q.toLowerCase());
  });

  const takenBeds = new Set((allocs ?? []).filter(live).map((a) => a.bed_id));
  const holders = new Set((allocs ?? []).filter(live).map((a) => a.student_id));
  const placeStudent = students.find((s) => s.id === place?.student_id);
  const halls = occ.filter((o) => o.is_active && (!placeStudent?.gender || o.gender === placeStudent.gender));
  const freeBeds = beds.filter((b) => b.is_active && b.room?.is_active && b.room.hostel_id === place?.hostel_id && !takenBeds.has(b.id))
    .sort((x, y) => `${x.room?.name}${x.label}`.localeCompare(`${y.room?.name}${y.label}`));

  async function act(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) }); else { setMsg({ kind: "success", text: ok }); setPlace(null); load(); }
  }

  const tot = occ.reduce((a, o) => ({ beds: a.beds + Number(o.beds), res: a.res + Number(o.reserved), paid: a.paid + Number(o.confirmed) + Number(o.checked_in), inn: a.inn + Number(o.checked_in) }), { beds: 0, res: 0, paid: 0, inn: 0 });

  return (
    <>
      <PageHead title="Hostel allocations" sub={session ? `${session.name} session` : undefined}
        right={<Button onClick={() => setPlace({ student_id: "", hostel_id: "", bed_id: "" })}>Place a student</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {paidNoBed.length > 0 && (
        <Notice kind="error">
          {paidNoBed.length} student(s) paid after their hold lapsed and their bed was taken. Place them by hand:{" "}
          {paidNoBed.map((a) => (
            <button key={a.id} className="ml-1 underline" onClick={() => setPlace({ student_id: a.student_id, hostel_id: a.hostel_id, bed_id: "" })}>{a.student?.profile?.full_name}</button>
          ))}
        </Notice>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Beds" value={tot.beds} note={`${occ.filter((o) => o.is_active).length} halls`} />
        <Stat label="Awaiting payment" value={tot.res} tone={tot.res ? "warn" : undefined} />
        <Stat label="Paid" value={tot.paid} tone="good" note={`${tot.inn} checked in`} />
        <Stat label="Free" value={tot.beds - tot.res - tot.paid} note={tot.beds ? `${Math.round(((tot.res + tot.paid) / tot.beds) * 100)}% taken` : undefined} />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {occ.map((o) => {
          const used = Number(o.reserved) + Number(o.confirmed) + Number(o.checked_in);
          const pct = Number(o.beds) ? Math.round((used / Number(o.beds)) * 100) : 0;
          return (
            <button key={o.hostel_id} onClick={() => setHall(hall === o.hostel_id ? "" : o.hostel_id)}
              className={`rounded-xl border bg-paper px-5 py-4 text-left ${hall === o.hostel_id ? "border-brand" : "border-line"} ${o.is_active ? "" : "opacity-60"}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{o.hostel}</span><Pill>{o.gender === "male" ? "Male" : "Female"}</Pill></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-mute"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div>
              <div className="mt-2 text-xs text-ink-3">{used} of {o.beds} beds taken · {o.free} free · {o.checked_in} checked in{!o.is_active ? " · closed" : ""}</div>
            </button>
          );
        })}
      </div>

      <Card title={`${shown.length} allocation${shown.length === 1 ? "" : "s"}`}
        right={<div className="flex flex-wrap gap-2">
          <input className="input w-44 text-sm" placeholder="Search name, matric, room" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input text-sm" value={hall} onChange={(e) => setHall(e.target.value)}>
            <option value="">All halls</option>{occ.map((o) => <option key={o.hostel_id} value={o.hostel_id}>{o.hostel}</option>)}
          </select>
          <select className="input text-sm" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="active">Holding a bed</option><option value="all">All</option>
            {(Object.keys(allocLabel) as AllocStatus[]).map((k) => <option key={k} value={k}>{allocLabel[k]}</option>)}
          </select>
        </div>}>
        {!allocs ? <p className="text-sm text-ink-3">Loading…</p> : shown.length === 0 ? <Empty>No allocations match.</Empty> : (
          <Table head={["Student", "Hall · room · bed", "Fee", "Paid", "Status", ""]}>
            {shown.map((a) => {
              const s = effectiveStatus(a.status, a.expires_at, paid[a.student_id] ?? 0, a.amount);
              return (
                <tr key={a.id}>
                  <td className={td}>{a.student?.profile?.full_name}<div className="font-mono text-xs text-ink-3">{a.student?.matric_no} · {a.student?.level}L</div></td>
                  <td className={td}>{a.hostel?.name}<div className="text-xs text-ink-3">Room {a.bed?.room?.name} · Bed {a.bed?.label} · {a.bed?.room?.room_type}</div></td>
                  <td className={`${td} tabular-nums`}>{naira(a.amount)}</td>
                  <td className={`${td} tabular-nums`}>{naira(paid[a.student_id] ?? 0)}</td>
                  <td className={td}><Pill tone={allocTone[s]}>{allocLabel[s]}</Pill>
                    <div className="mt-1 text-xs text-ink-3">{s === "reserved" ? `Hold ends ${dt(a.expires_at)}` : s === "checked_in" ? `Since ${dt(a.checked_in_at, false)}` : `Applied ${dt(a.reserved_at, false)}`}{a.allocated_by ? " · placed by office" : ""}</div></td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Link href={`/print/hostel-slip/${a.id}`} className="mr-3 text-xs text-brand hover:underline">Slip</Link>
                    {(s === "reserved" || s === "confirmed") && <button className="text-xs text-bad hover:underline" disabled={busy}
                      onClick={() => { const r = prompt(`Cancel ${a.student?.profile?.full_name}'s bed? Reason:`); if (r !== null) act(() => supabase.rpc("uni_hostel_cancel", { p_allocation: a.id, p_reason: r }), "Allocation cancelled. Any money paid stays on the student's hostel account for this session."); }}>Cancel</button>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {place && (
        <Modal title="Place a student in a bed" onClose={() => setPlace(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act(() => supabase.rpc("uni_hostel_allocate", { p_student: place.student_id, p_bed: place.bed_id }), "Student placed. If the fee is not yet paid, the bed is held for payment."); }}>
            <Field label="Student" hint="Active students without a bed this session">
              <select className="input w-full" value={place.student_id} onChange={(e) => setPlace({ ...place, student_id: e.target.value, hostel_id: "", bed_id: "" })}>
                <option value="">Choose…</option>
                {students.filter((s) => !holders.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.matric_no} · {s.profile?.full_name}{s.gender ? ` (${s.gender})` : " (no gender on record)"}</option>)}
              </select>
            </Field>
            {placeStudent && !placeStudent.gender && <p className="text-xs text-bad">This student has no gender on record. The Registry must add it before they can be placed.</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hall">
                <select className="input w-full" value={place.hostel_id} disabled={!placeStudent?.gender} onChange={(e) => setPlace({ ...place, hostel_id: e.target.value, bed_id: "" })}>
                  <option value="">Choose…</option>{halls.map((h) => <option key={h.hostel_id} value={h.hostel_id}>{h.hostel} ({h.free} free)</option>)}
                </select>
              </Field>
              <Field label="Bed">
                <select className="input w-full" value={place.bed_id} disabled={!place.hostel_id} onChange={(e) => setPlace({ ...place, bed_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {freeBeds.map((b) => <option key={b.id} value={b.id}>{b.room?.name} · Bed {b.label} · {naira(b.room?.fee)}</option>)}
                </select>
              </Field>
            </div>
            <p className="text-xs text-ink-3">The student is charged the room&apos;s fee. Money they have already paid for a hostel this session counts towards it.</p>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !place.student_id || !place.bed_id}>{busy ? "Placing…" : "Place student"}</Button>
              <Button variant="secondary" onClick={() => setPlace(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["hostel_officer", "admin"]}><Allocations /></Shell>;
}
