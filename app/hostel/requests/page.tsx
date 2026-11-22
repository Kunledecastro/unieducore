"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Button, Notice, Pill, Empty, Field, Modal, Table, td, Tabs } from "@/components/ui";
import { supabase, naira, errMsg } from "@/lib/supabase";
import { faultStatusLabel, faultTone, exeatLabel, exeatTone, changeLabel, cap, dt } from "@/lib/hostel";

type Who = { matric_no: string; level: number; profile: { full_name: string } | null } | null;
type Change = { id: string; allocation_id: string; student_id: string; reason: string; status: string; preferred_room_type: string | null; decision_note: string | null; created_at: string;
  student: Who; hostel: { name: string } | null; preferred: { name: string } | null;
  from_bed: { label: string; room: { name: string } | null } | null; to_bed: { label: string; room: { name: string } | null } | null };
type Fault = { id: string; hostel_id: string; category: string; priority: string; description: string; status: string; assigned_to: string | null; resolution_note: string | null; created_at: string; resolved_at: string | null;
  hostel: { name: string } | null; room: { name: string } | null; reporter: { full_name: string; role: string } | null };
type Exeat = { id: string; hostel_id: string; destination: string; reason: string; contact_phone: string; leave_at: string; return_by: string; status: string; decision_note: string | null; out_at: string | null; returned_at: string | null; created_at: string;
  student: Who; hostel: { name: string } | null };
type Visit = { id: string; visitor_name: string; visitor_phone: string | null; relationship: string | null; purpose: string | null; time_in: string; time_out: string | null; student: Who; hostel: { name: string } | null };
type Bed = { id: string; label: string; is_active: boolean; room: { name: string; fee: number; is_active: boolean; hostel: { id: string; name: string; gender: string } | null } | null };
type Hall = { id: string; name: string };

const name = (w: Who) => `${w?.profile?.full_name ?? ""} · ${w?.matric_no ?? ""}`;

function Requests() {
  const [tab, setTab] = useState<"changes" | "faults" | "exeats" | "visitors">("changes");
  const [changes, setChanges] = useState<Change[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [exeats, setExeats] = useState<Exeat[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [hall, setHall] = useState("");
  const [faultFilter, setFaultFilter] = useState("active");
  const [decide, setDecide] = useState<{ c: Change; bed: string; note: string; beds: Bed[]; amount: number } | null>(null);
  const [fault, setFault] = useState<{ f: Fault; status: string; assigned_to: string; note: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, f, e, v, h] = await Promise.all([
      supabase.from("uni_hostel_change_requests").select("id, allocation_id, student_id, reason, status, preferred_room_type, decision_note, created_at, student:uni_students(matric_no, level, profile:uni_profiles(full_name)), hostel:uni_hostels!uni_hostel_change_requests_hostel_id_fkey(name), preferred:uni_hostels!uni_hostel_change_requests_preferred_hostel_id_fkey(name), from_bed:uni_hostel_beds!uni_hostel_change_requests_from_bed_id_fkey(label, room:uni_hostel_rooms(name)), to_bed:uni_hostel_beds!uni_hostel_change_requests_to_bed_id_fkey(label, room:uni_hostel_rooms(name))").order("created_at", { ascending: false }),
      supabase.from("uni_hostel_maintenance").select("id, hostel_id, category, priority, description, status, assigned_to, resolution_note, created_at, resolved_at, hostel:uni_hostels(name), room:uni_hostel_rooms(name), reporter:uni_profiles!uni_hostel_maintenance_reported_by_fkey(full_name, role)").order("created_at", { ascending: false }),
      supabase.from("uni_hostel_exeats").select("id, hostel_id, destination, reason, contact_phone, leave_at, return_by, status, decision_note, out_at, returned_at, created_at, student:uni_students(matric_no, level, profile:uni_profiles(full_name)), hostel:uni_hostels(name)").order("created_at", { ascending: false }),
      supabase.from("uni_hostel_visitors").select("id, visitor_name, visitor_phone, relationship, purpose, time_in, time_out, student:uni_students(matric_no, level, profile:uni_profiles(full_name)), hostel:uni_hostels(name)").order("time_in", { ascending: false }).limit(200),
      supabase.from("uni_hostels").select("id, name").order("name"),
    ]);
    setChanges((c.data as unknown as Change[]) ?? []);
    setFaults((f.data as unknown as Fault[]) ?? []);
    setExeats((e.data as unknown as Exeat[]) ?? []);
    setVisits((v.data as unknown as Visit[]) ?? []);
    setHalls((h.data as Hall[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setMsg({ kind: "error", text: errMsg(error) }); return false; }
    setMsg({ kind: "success", text: ok }); load(); return true;
  }

  async function openDecide(c: Change) {
    const [{ data: b }, { data: taken }, { data: al }] = await Promise.all([
      supabase.from("uni_hostel_beds").select("id, label, is_active, room:uni_hostel_rooms(name, fee, is_active, hostel:uni_hostels(id, name, gender))"),
      supabase.from("uni_hostel_allocations").select("bed_id, status, expires_at").in("status", ["reserved", "confirmed", "checked_in"]),
      supabase.from("uni_hostel_allocations").select("amount, hostel:uni_hostels(gender)").eq("id", c.allocation_id).single(),
    ]);
    const busyBeds = new Set(((taken as { bed_id: string; status: string; expires_at: string | null }[]) ?? [])
      .filter((t) => t.status !== "reserved" || !t.expires_at || new Date(t.expires_at) > new Date()).map((t) => t.bed_id));
    const amount = Number((al as { amount: number } | null)?.amount ?? 0);
    const gender = (al as unknown as { hostel: { gender: string } | null } | null)?.hostel?.gender;
    const beds = ((b as unknown as Bed[]) ?? []).filter((x) => x.is_active && x.room?.is_active && x.room.hostel?.gender === gender && Number(x.room.fee) <= amount && !busyBeds.has(x.id))
      .sort((x, y) => `${x.room?.hostel?.name}${x.room?.name}${x.label}`.localeCompare(`${y.room?.hostel?.name}${y.room?.name}${y.label}`));
    setDecide({ c, bed: "", note: "", beds, amount });
  }

  const inHall = <T extends { hostel_id?: string; hostel?: { name: string } | null }>(x: T) => !hall || x.hostel_id === hall || x.hostel?.name === halls.find((h) => h.id === hall)?.name;
  const pendingChanges = changes.filter((c) => c.status === "pending").length;
  const openFaults = faults.filter((f) => f.status === "open" || f.status === "in_progress").length;
  const pendingExeats = exeats.filter((e) => e.status === "pending").length;
  const lateBack = (e: Exeat) => e.status === "out" && new Date(e.return_by) < new Date();

  return (
    <>
      <PageHead title="Hostel requests" sub="Room changes, maintenance, exeats and the visitor log across all halls."
        right={<select className="input text-sm" value={hall} onChange={(e) => setHall(e.target.value)}><option value="">All halls</option>{halls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {exeats.some(lateBack) && <Notice kind="error">{exeats.filter(lateBack).length} student(s) are past their exeat return time and not yet signed back in.</Notice>}
      <Tabs value={tab} onChange={setTab} items={[
        { value: "changes", label: `Room changes${pendingChanges ? ` (${pendingChanges})` : ""}` },
        { value: "faults", label: `Maintenance${openFaults ? ` (${openFaults})` : ""}` },
        { value: "exeats", label: `Exeats${pendingExeats ? ` (${pendingExeats})` : ""}` },
        { value: "visitors", label: "Visitors" },
      ]} />

      {tab === "changes" && (
        <Card>
          {changes.filter(inHall).length === 0 ? <Empty>No room change requests.</Empty> : (
            <Table head={["Student", "Now in", "Wants", "Reason", "Status", ""]}>
              {changes.filter(inHall).map((c) => (
                <tr key={c.id}>
                  <td className={td}>{c.student?.profile?.full_name}<div className="font-mono text-xs text-ink-3">{c.student?.matric_no}</div></td>
                  <td className={td}>{c.hostel?.name}<div className="text-xs text-ink-3">{c.from_bed?.room?.name}{c.from_bed?.label}</div></td>
                  <td className={td}>{c.preferred?.name ?? "Any hall"}<div className="text-xs text-ink-3">{c.preferred_room_type ?? "Any room type"}</div></td>
                  <td className={`${td} max-w-xs`}>{c.reason}<div className="text-xs text-ink-3">{dt(c.created_at)}</div></td>
                  <td className={td}><Pill tone={c.status === "approved" ? "good" : c.status === "pending" ? "warn" : "mute"}>{changeLabel[c.status]}</Pill>
                    {c.status === "approved" && c.to_bed && <div className="mt-1 text-xs text-ink-3">Moved to {c.to_bed.room?.name}{c.to_bed.label}</div>}
                    {c.decision_note && <div className="mt-1 text-xs text-ink-3">{c.decision_note}</div>}</td>
                  <td className={`${td} text-right`}>{c.status === "pending" && <Button small onClick={() => openDecide(c)}>Decide</Button>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "faults" && (
        <Card right={<select className="input text-sm" value={faultFilter} onChange={(e) => setFaultFilter(e.target.value)}>
          <option value="active">Open and in progress</option><option value="all">All</option>
          {Object.entries(faultStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>} title="Maintenance">
          {(() => {
            const list = faults.filter(inHall).filter((f) => faultFilter === "all" || (faultFilter === "active" ? f.status === "open" || f.status === "in_progress" : f.status === faultFilter))
              .sort((a, b) => Number(b.priority === "urgent") - Number(a.priority === "urgent"));
            return list.length === 0 ? <Empty>Nothing here.</Empty> : (
              <Table head={["Where", "Fault", "Reported", "Status", ""]}>
                {list.map((f) => (
                  <tr key={f.id}>
                    <td className={td}>{f.hostel?.name}<div className="text-xs text-ink-3">{f.room ? `Room ${f.room.name}` : "Common area"}</div></td>
                    <td className={`${td} max-w-sm`}><span className="font-medium">{cap(f.category)}</span>{f.priority === "urgent" && <span className="ml-2"><Pill tone="bad">Urgent</Pill></span>}
                      <div className="text-ink-2">{f.description}</div></td>
                    <td className={`${td} text-xs`}>{f.reporter?.full_name}<div className="text-ink-3">{dt(f.created_at)}</div></td>
                    <td className={td}><Pill tone={faultTone[f.status]}>{faultStatusLabel[f.status]}</Pill>
                      {(f.assigned_to || f.resolution_note) && <div className="mt-1 text-xs text-ink-3">{[f.assigned_to, f.resolution_note].filter(Boolean).join(" · ")}</div>}</td>
                    <td className={`${td} text-right`}>{f.status !== "closed" && <Button small variant="secondary" onClick={() => setFault({ f, status: f.status, assigned_to: f.assigned_to ?? "", note: "" })}>Update</Button>}</td>
                  </tr>
                ))}
              </Table>
            );
          })()}
        </Card>
      )}

      {tab === "exeats" && (
        <Card>
          {exeats.filter(inHall).length === 0 ? <Empty>No exeat requests.</Empty> : (
            <Table head={["Student", "Going to", "Leaving", "Back by", "Status", ""]}>
              {exeats.filter(inHall).map((e) => (
                <tr key={e.id}>
                  <td className={td}>{e.student?.profile?.full_name}<div className="text-xs text-ink-3">{e.student?.matric_no} · {e.hostel?.name}</div></td>
                  <td className={`${td} max-w-xs`}>{e.destination}<div className="text-xs text-ink-3">{e.reason} · {e.contact_phone}</div></td>
                  <td className={`${td} text-xs`}>{dt(e.leave_at)}{e.out_at && <div className="text-ink-3">Left {dt(e.out_at)}</div>}</td>
                  <td className={`${td} text-xs`}>{dt(e.return_by)}{e.returned_at && <div className={new Date(e.returned_at) > new Date(e.return_by) ? "text-bad" : "text-ink-3"}>Back {dt(e.returned_at)}</div>}</td>
                  <td className={td}><Pill tone={lateBack(e) ? "bad" : exeatTone[e.status]}>{lateBack(e) ? "Overdue" : exeatLabel[e.status]}</Pill>{e.decision_note && <div className="mt-1 text-xs text-ink-3">{e.decision_note}</div>}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{e.status === "pending" && <>
                    <Button small disabled={busy} onClick={() => act(() => supabase.rpc("uni_hostel_decide_exeat", { p_exeat: e.id, p_approve: true }), `Exeat approved for ${e.student?.profile?.full_name}.`)}>Approve</Button>{" "}
                    <Button small variant="danger" disabled={busy} onClick={() => { const n = prompt("Reason for not approving:"); if (n !== null) act(() => supabase.rpc("uni_hostel_decide_exeat", { p_exeat: e.id, p_approve: false, p_note: n }), "Exeat not approved."); }}>Decline</Button>
                  </>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "visitors" && (
        <Card title="Visitor log" right={<span className="text-xs text-ink-3">Recorded by porters · latest 200</span>}>
          {visits.filter(inHall).length === 0 ? <Empty>No visitors logged.</Empty> : (
            <Table head={["Visitor", "Visiting", "In", "Out"]}>
              {visits.filter(inHall).map((v) => (
                <tr key={v.id}>
                  <td className={td}>{v.visitor_name}<div className="text-xs text-ink-3">{[v.relationship, v.visitor_phone, v.purpose].filter(Boolean).join(" · ")}</div></td>
                  <td className={td}>{name(v.student)}<div className="text-xs text-ink-3">{v.hostel?.name}</div></td>
                  <td className={`${td} text-xs`}>{dt(v.time_in)}</td>
                  <td className={`${td} text-xs`}>{v.time_out ? dt(v.time_out) : <Pill tone="warn">Still in</Pill>}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {decide && (
        <Modal title={`Room change for ${decide.c.student?.profile?.full_name}`} onClose={() => setDecide(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-ink-2">&ldquo;{decide.c.reason}&rdquo;</p>
            <p className="text-xs text-ink-3">Wants {decide.c.preferred?.name ?? "any hall"}, {decide.c.preferred_room_type ?? "any room type"}. Paid {naira(decide.amount)}, so only rooms at that fee or lower are offered.</p>
            <Field label="Move to">
              <select className="input w-full" value={decide.bed} onChange={(e) => setDecide({ ...decide, bed: e.target.value })}>
                <option value="">First free bed in another room matching their preference</option>
                {decide.beds.map((b) => <option key={b.id} value={b.id}>{b.room?.hostel?.name} · {b.room?.name} · Bed {b.label} ({naira(b.room?.fee)})</option>)}
              </select>
            </Field>
            <Field label="Note to the student (optional)"><input className="input w-full" value={decide.note} onChange={(e) => setDecide({ ...decide, note: e.target.value })} /></Field>
            <div className="flex gap-2 pt-2">
              <Button disabled={busy} onClick={async () => { if (await act(() => supabase.rpc("uni_hostel_decide_change", { p_request: decide.c.id, p_approve: true, p_bed: decide.bed || null, p_note: decide.note }), "Room change approved. Tell the porter so the student can move.")) setDecide(null); }}>Approve and move</Button>
              <Button variant="danger" disabled={busy} onClick={async () => { if (await act(() => supabase.rpc("uni_hostel_decide_change", { p_request: decide.c.id, p_approve: false, p_note: decide.note }), "Room change declined.")) setDecide(null); }}>Decline</Button>
            </div>
          </div>
        </Modal>
      )}

      {fault && (
        <Modal title={`${cap(fault.f.category)} · ${fault.f.hostel?.name}${fault.f.room ? ` ${fault.f.room.name}` : ""}`} onClose={() => setFault(null)}>
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
            if (await act(() => supabase.rpc("uni_hostel_update_fault", { p_fault: fault.f.id, p_status: fault.status, p_assigned_to: fault.assigned_to, p_note: fault.note }), "Fault updated.")) setFault(null); }}>
            <p className="text-sm text-ink-2">{fault.f.description}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status"><select className="input w-full" value={fault.status} onChange={(e) => setFault({ ...fault, status: e.target.value })}>
                {Object.entries(faultStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Assigned to"><input className="input w-full" value={fault.assigned_to} onChange={(e) => setFault({ ...fault, assigned_to: e.target.value })} placeholder="Works dept, plumber…" /></Field>
            </div>
            <Field label="Note"><input className="input w-full" value={fault.note} onChange={(e) => setFault({ ...fault, note: e.target.value })} placeholder="What was done" /></Field>
            <div className="flex gap-2 pt-2"><Button type="submit" disabled={busy}>Save</Button><Button variant="secondary" onClick={() => setFault(null)}>Cancel</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["hostel_officer", "admin"]}><Requests /></Shell>;
}
