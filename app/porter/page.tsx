"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Pill, Empty, Field, Modal, Table, td, Tabs, Stat } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";
import { allocLabel, allocTone, effectiveStatus, faultCategories, faultStatusLabel, faultTone, exeatLabel, exeatTone, cap, dt, type AllocStatus } from "@/lib/hostel";

type Resident = { allocation_id: string; student_id: string; full_name: string; matric_no: string; level: number; programme: string; room: string; bed: string;
  status: AllocStatus; amount: number; paid: number; expires_at: string | null; checked_in_at: string | null; checked_out_at: string | null };
type Exeat = { id: string; student_id: string; destination: string; reason: string; contact_phone: string; leave_at: string; return_by: string; status: string; out_at: string | null; returned_at: string | null };
type Visit = { id: string; student_id: string; visitor_name: string; visitor_phone: string | null; relationship: string | null; purpose: string | null; time_in: string; time_out: string | null };
type Fault = { id: string; category: string; priority: string; description: string; status: string; assigned_to: string | null; created_at: string; room: { name: string } | null };
type Room = { id: string; name: string };

function Porter() {
  const { profile } = useAuth();
  const hostelId = profile?.hostel_id ?? "";
  const [tab, setTab] = useState<"residents" | "exeats" | "visitors" | "faults">("residents");
  const [res, setRes] = useState<Resident[] | null>(null);
  const [exeats, setExeats] = useState<Exeat[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"here" | "all">("here");
  const [gate, setGate] = useState<{ r: Resident; mode: "in" | "out"; condition: string } | null>(null);
  const [visitor, setVisitor] = useState({ student_id: "", name: "", phone: "", relationship: "", purpose: "" });
  const [fault, setFault] = useState({ room: "", category: "plumbing", priority: "normal", description: "" });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!hostelId) return;
    const since = new Date(); since.setDate(since.getDate() - 7);
    const [r, e, v, f, rm] = await Promise.all([
      supabase.rpc("uni_hostel_residents", { p_hostel: hostelId }),
      supabase.from("uni_hostel_exeats").select("id, student_id, destination, reason, contact_phone, leave_at, return_by, status, out_at, returned_at").eq("hostel_id", hostelId).in("status", ["approved", "out", "returned"]).order("leave_at", { ascending: false }).limit(100),
      supabase.from("uni_hostel_visitors").select("id, student_id, visitor_name, visitor_phone, relationship, purpose, time_in, time_out").eq("hostel_id", hostelId).gte("time_in", since.toISOString()).order("time_in", { ascending: false }),
      supabase.from("uni_hostel_maintenance").select("id, category, priority, description, status, assigned_to, created_at, room:uni_hostel_rooms(name)").eq("hostel_id", hostelId).in("status", ["open", "in_progress", "resolved"]).order("created_at", { ascending: false }),
      supabase.from("uni_hostel_rooms").select("id, name").eq("hostel_id", hostelId).order("name"),
    ]);
    if (r.error) setMsg({ kind: "error", text: errMsg(r.error) });
    setRes((r.data as Resident[]) ?? []);
    setExeats((e.data as Exeat[]) ?? []);
    setVisits((v.data as Visit[]) ?? []);
    setFaults((f.data as unknown as Fault[]) ?? []);
    setRooms((rm.data as Room[]) ?? []);
  }, [hostelId]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setMsg({ kind: "error", text: errMsg(error) }); return false; }
    setMsg({ kind: "success", text: ok }); load(); return true;
  }

  if (!hostelId) return <Notice kind="error">Your account is not linked to a hall. Ask the Registry to set your hall on the Staff page.</Notice>;
  const who = Object.fromEntries((res ?? []).map((r) => [r.student_id, `${r.full_name} · ${r.room}${r.bed}`]));
  const st = (r: Resident) => effectiveStatus(r.status, r.expires_at, Number(r.paid), Number(r.amount));
  const shown = (res ?? []).filter((r) => (show === "all" || ["confirmed", "checked_in"].includes(st(r)))
    && (!q || `${r.full_name} ${r.matric_no} ${r.room}`.toLowerCase().includes(q.toLowerCase())));
  const inside = (res ?? []).filter((r) => r.status === "checked_in");
  const away = exeats.filter((e) => e.status === "out");
  const late = away.filter((e) => new Date(e.return_by) < new Date());
  const visitorsIn = visits.filter((v) => !v.time_out);

  return (
    <>
      <PageHead title={profile?.hostel?.name ?? "My hall"} sub="Check students in and out, sign exeats at the gate, log visitors and report faults." />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {late.length > 0 && <Notice kind="error">{late.length} student(s) are past their exeat return time: {late.map((e) => who[e.student_id]).join(", ")}.</Notice>}

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Checked in" value={inside.length} />
        <Stat label="Waiting to check in" value={(res ?? []).filter((r) => r.status === "confirmed").length} note="Paid, not yet arrived" />
        <Stat label="Away on exeat" value={away.length} tone={late.length ? "bad" : undefined} note={late.length ? `${late.length} overdue` : undefined} />
        <Stat label="Visitors in now" value={visitorsIn.length} />
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { value: "residents", label: "Residents" }, { value: "exeats", label: `Exeats${exeats.filter((e) => e.status === "approved").length ? ` (${exeats.filter((e) => e.status === "approved").length} to leave)` : ""}` },
        { value: "visitors", label: "Visitors" }, { value: "faults", label: `Faults${faults.filter((f) => f.status !== "resolved").length ? ` (${faults.filter((f) => f.status !== "resolved").length})` : ""}` },
      ]} />

      {tab === "residents" && (
        <Card right={<div className="flex gap-2">
          <input className="input w-48 text-sm" placeholder="Search name, matric, room" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input text-sm" value={show} onChange={(e) => setShow(e.target.value as typeof show)}><option value="here">Paid and checked in</option><option value="all">Everyone allocated</option></select>
        </div>} title={`${shown.length} student${shown.length === 1 ? "" : "s"}`}>
          {!res ? <p className="text-sm text-ink-3">Loading…</p> : shown.length === 0 ? <Empty>No students match.</Empty> : (
            <Table head={["Room", "Student", "Status", ""]}>
              {shown.map((r) => {
                const s = st(r);
                return (
                  <tr key={r.allocation_id}>
                    <td className={`${td} font-medium whitespace-nowrap`}>{r.room} · {r.bed}</td>
                    <td className={td}>{r.full_name}<div className="text-xs text-ink-3">{r.matric_no} · {r.level}L {r.programme}</div></td>
                    <td className={td}><Pill tone={allocTone[s]}>{allocLabel[s]}</Pill>{r.checked_in_at && s === "checked_in" && <div className="mt-1 text-xs text-ink-3">Since {dt(r.checked_in_at, false)}</div>}</td>
                    <td className={`${td} text-right`}>
                      {s === "confirmed" && <Button small onClick={() => setGate({ r, mode: "in", condition: "" })}>Check in</Button>}
                      {s === "checked_in" && <Button small variant="secondary" onClick={() => setGate({ r, mode: "out", condition: "" })}>Check out</Button>}
                      {s === "reserved" && <span className="text-xs text-ink-3">Not paid</span>}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {tab === "exeats" && (
        <Card title="Exeats approved by the hostel office">
          {exeats.length === 0 ? <Empty>No approved exeats.</Empty> : (
            <Table head={["Student", "Going to", "Leaving", "Back by", "Status", ""]}>
              {exeats.map((e) => {
                const overdue = e.status === "out" && new Date(e.return_by) < new Date();
                return (
                  <tr key={e.id}>
                    <td className={td}>{who[e.student_id] ?? "—"}</td>
                    <td className={td}>{e.destination}<div className="text-xs text-ink-3">{e.contact_phone}</div></td>
                    <td className={`${td} text-xs`}>{dt(e.leave_at)}{e.out_at && <div className="text-ink-3">Left {dt(e.out_at)}</div>}</td>
                    <td className={`${td} text-xs`}>{dt(e.return_by)}{e.returned_at && <div className="text-ink-3">Back {dt(e.returned_at)}</div>}</td>
                    <td className={td}><Pill tone={overdue ? "bad" : exeatTone[e.status]}>{overdue ? "Overdue" : exeatLabel[e.status]}</Pill></td>
                    <td className={`${td} text-right`}>
                      {e.status === "approved" && <Button small disabled={busy} onClick={() => act(() => supabase.rpc("uni_hostel_exeat_gate", { p_exeat: e.id, p_action: "out" }), "Signed out at the gate.")}>Sign out</Button>}
                      {e.status === "out" && <Button small disabled={busy} onClick={() => act(() => supabase.rpc("uni_hostel_exeat_gate", { p_exeat: e.id, p_action: "returned" }), "Signed back in.")}>Signed back</Button>}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {tab === "visitors" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Sign a visitor in">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
              if (await act(() => supabase.rpc("uni_hostel_visitor_in", { p_student: visitor.student_id, p_name: visitor.name, p_phone: visitor.phone, p_relationship: visitor.relationship, p_purpose: visitor.purpose }), `${visitor.name} signed in.`))
                setVisitor({ student_id: "", name: "", phone: "", relationship: "", purpose: "" }); }}>
              <Field label="Visiting">
                <select className="input w-full" value={visitor.student_id} onChange={(e) => setVisitor({ ...visitor, student_id: e.target.value })}>
                  <option value="">Choose resident…</option>{inside.map((r) => <option key={r.student_id} value={r.student_id}>{r.room}{r.bed} · {r.full_name}</option>)}
                </select>
              </Field>
              <Field label="Visitor's name"><input className="input w-full" value={visitor.name} onChange={(e) => setVisitor({ ...visitor, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone"><input className="input w-full" value={visitor.phone} onChange={(e) => setVisitor({ ...visitor, phone: e.target.value })} /></Field>
                <Field label="Relationship"><input className="input w-full" value={visitor.relationship} onChange={(e) => setVisitor({ ...visitor, relationship: e.target.value })} placeholder="Mother, friend…" /></Field>
              </div>
              <Field label="Purpose"><input className="input w-full" value={visitor.purpose} onChange={(e) => setVisitor({ ...visitor, purpose: e.target.value })} /></Field>
              <Button type="submit" disabled={busy || !visitor.student_id || !visitor.name.trim()}>Sign in visitor</Button>
            </form>
          </Card>
          <Card title="Last 7 days" className="lg:col-span-2">
            {visits.length === 0 ? <Empty>No visitors logged.</Empty> : (
              <Table head={["Visitor", "Visiting", "In", "Out"]}>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td className={td}>{v.visitor_name}<div className="text-xs text-ink-3">{[v.relationship, v.visitor_phone].filter(Boolean).join(" · ")}</div></td>
                    <td className={td}>{who[v.student_id] ?? "—"}</td>
                    <td className={`${td} text-xs`}>{dt(v.time_in)}</td>
                    <td className={`${td} text-xs`}>{v.time_out ? dt(v.time_out) : <Button small variant="secondary" disabled={busy} onClick={() => act(() => supabase.rpc("uni_hostel_visitor_out", { p_visit: v.id }), `${v.visitor_name} signed out.`)}>Sign out</Button>}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === "faults" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Report a fault">
            <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
              if (await act(() => supabase.rpc("uni_hostel_report_fault", { p_category: fault.category, p_description: fault.description, p_priority: fault.priority, p_room: fault.room }), "Fault reported to the hostel office."))
                setFault({ ...fault, description: "" }); }}>
              <Field label="Room"><select className="input w-full" value={fault.room} onChange={(e) => setFault({ ...fault, room: e.target.value })}><option value="">Choose room…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type"><select className="input w-full" value={fault.category} onChange={(e) => setFault({ ...fault, category: e.target.value })}>{faultCategories.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select></Field>
                <Field label="Urgency"><select className="input w-full" value={fault.priority} onChange={(e) => setFault({ ...fault, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option></select></Field>
              </div>
              <Field label="What is wrong?"><textarea className="input w-full" rows={3} value={fault.description} onChange={(e) => setFault({ ...fault, description: e.target.value })} /></Field>
              <Button type="submit" disabled={busy || !fault.room || !fault.description.trim()}>Report fault</Button>
            </form>
          </Card>
          <Card title="Faults in this hall" className="lg:col-span-2">
            {faults.length === 0 ? <Empty>No open faults.</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {faults.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <span className="flex-1"><b>{f.room ? `Room ${f.room.name}` : "Common area"}</b> · {cap(f.category)}{f.priority === "urgent" && <span className="ml-2"><Pill tone="bad">Urgent</Pill></span>}
                      <span className="block text-ink-2">{f.description}</span>
                      <span className="block text-xs text-ink-3">{dt(f.created_at)}{f.assigned_to ? ` · With ${f.assigned_to}` : ""}</span></span>
                    <span className="flex items-center gap-2">
                      <Pill tone={faultTone[f.status]}>{faultStatusLabel[f.status]}</Pill>
                      {f.status === "open" && <Button small variant="secondary" disabled={busy} onClick={() => act(() => supabase.rpc("uni_hostel_update_fault", { p_fault: f.id, p_status: "in_progress" }), "Marked in progress.")}>Start</Button>}
                      {f.status !== "resolved" && <Button small disabled={busy} onClick={() => act(() => supabase.rpc("uni_hostel_update_fault", { p_fault: f.id, p_status: "resolved" }), "Marked fixed.")}>Fixed</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {gate && (
        <Modal title={`${gate.mode === "in" ? "Check in" : "Check out"} ${gate.r.full_name}`} onClose={() => setGate(null)}>
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
            if (await act(() => supabase.rpc(gate.mode === "in" ? "uni_hostel_check_in" : "uni_hostel_check_out", { p_allocation: gate.r.allocation_id, p_condition: gate.condition }),
              gate.mode === "in" ? `${gate.r.full_name} checked in to ${gate.r.room}${gate.r.bed}.` : `${gate.r.full_name} checked out.`)) setGate(null); }}>
            <p className="text-sm text-ink-2">Room {gate.r.room} · Bed {gate.r.bed} · {gate.r.matric_no}</p>
            {gate.mode === "in" && <p className="text-xs text-ink-3">Check the student&apos;s ID card against the allocation slip before handing over the key.</p>}
            <Field label={gate.mode === "in" ? "Room condition on arrival" : "Room condition on leaving"}>
              <textarea className="input w-full" rows={3} value={gate.condition} onChange={(e) => setGate({ ...gate, condition: e.target.value })} placeholder="Mattress, wardrobe, door lock, windows, key returned…" />
            </Field>
            <div className="flex gap-2 pt-2"><Button type="submit" disabled={busy}>{gate.mode === "in" ? "Check in" : "Check out"}</Button><Button variant="secondary" onClick={() => setGate(null)}>Cancel</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["porter"]}><Porter /></Shell>;
}
