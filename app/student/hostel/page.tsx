"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Pill, Empty, Field, Tabs, Table, td } from "@/components/ui";
import { FeesCard } from "@/components/FeesCard";
import { supabase, naira, errMsg } from "@/lib/supabase";
import { allocLabel, allocTone, effectiveStatus, faultCategories, faultStatusLabel, faultTone, exeatLabel, exeatTone, changeLabel, cap, dt, toLocalInput, type AllocStatus } from "@/lib/hostel";

type MyRoom = { allocation_id: string; status: AllocStatus; hostel: string; room: string; floor: string | null; room_type: string; bed: string;
  amount: number; paid: number; expires_at: string | null; session_name: string; roommates: string[] };
type Option = { hostel_id: string; hostel: string; room_type: string; fee: number; free_beds: number };
type Change = { id: string; reason: string; status: string; decision_note: string | null; created_at: string };
type Fault = { id: string; category: string; priority: string; description: string; status: string; assigned_to: string | null; resolution_note: string | null; created_at: string };
type Exeat = { id: string; destination: string; reason: string; leave_at: string; return_by: string; status: string; decision_note: string | null; out_at: string | null; returned_at: string | null };
type Msg = { kind: "error" | "success" | "info"; text: string } | null;

function Hostel() {
  const { profile } = useAuth();
  const [room, setRoom] = useState<MyRoom | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [holdHours, setHoldHours] = useState(72);
  const [gender, setGender] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; name: string } | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [exeats, setExeats] = useState<Exeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState("any");
  const [tab, setTab] = useState<"room" | "faults" | "exeat" | "change">("room");

  const load = useCallback(async () => {
    if (!profile) return;
    const [r, o, s, st, ses, c, f, e] = await Promise.all([
      supabase.rpc("uni_hostel_my_room"),
      supabase.rpc("uni_hostel_options"),
      supabase.from("uni_settings").select("hostel_applications_open, hostel_hold_hours").maybeSingle(),
      supabase.from("uni_students").select("gender").eq("id", profile.id).single(),
      supabase.from("uni_sessions").select("id, name").eq("is_current", true).maybeSingle(),
      supabase.from("uni_hostel_change_requests").select("id, reason, status, decision_note, created_at").order("created_at", { ascending: false }),
      supabase.from("uni_hostel_maintenance").select("id, category, priority, description, status, assigned_to, resolution_note, created_at").order("created_at", { ascending: false }),
      supabase.from("uni_hostel_exeats").select("id, destination, reason, leave_at, return_by, status, decision_note, out_at, returned_at").order("created_at", { ascending: false }),
    ]);
    setRoom(((r.data as MyRoom[]) ?? [])[0] ?? null);
    setOptions((o.data as Option[]) ?? []);
    setOpen(Boolean(s.data?.hostel_applications_open));
    setHoldHours(Number(s.data?.hostel_hold_hours ?? 72));
    setGender((st.data as { gender: string | null } | null)?.gender ?? null);
    setSession(ses.data as { id: string; name: string } | null);
    setChanges((c.data as Change[]) ?? []);
    setFaults((f.data as Fault[]) ?? []);
    setExeats((e.data as Exeat[]) ?? []);
    setLoading(false);
  }, [profile]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: ok }); await load(); }
    return !error;
  }

  if (loading || !profile) return <p className="text-sm text-ink-3">Loading…</p>;
  const status = room ? effectiveStatus(room.status, room.expires_at, Number(room.paid), Number(room.amount)) : null;
  const holding = status && ["reserved", "confirmed", "checked_in"].includes(status);

  const apply = () => {
    const [hid, type] = choice === "any" ? [null, null] : choice.split("|");
    return run(() => supabase.rpc("uni_hostel_apply", { p_hostel: hid, p_room_type: type }), "Bed reserved. Pay the hostel fee to confirm it.");
  };

  return (
    <>
      <PageHead title="Hostel" sub={session ? `${session.name} session` : undefined}
        right={holding && status !== "reserved" ? <Link href="/print/hostel-slip/me"><Button variant="secondary">Print allocation slip</Button></Link> : undefined} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      {/* ---------- no current space ---------- */}
      {!holding && (
        <>
          {status === "expired" && <Notice kind="info">Your reservation of {room!.hostel} {room!.room}{room!.bed} lapsed because it was not paid within {holdHours} hours. You can apply again below.</Notice>}
          {status === "checked_out" && <Notice kind="info">You checked out of {room!.hostel} this session.</Notice>}
          {!gender ? <Notice kind="error">Your student record has no gender, which decides your hall. Ask the Registry to update your record.</Notice>
            : !open ? <Card><Empty>Hostel applications are closed. Check back when the hostel office opens them.</Empty></Card>
            : (
            <Card title="Apply for a bed">
              <p className="mb-4 text-sm text-ink-2">Choose a hall and room type. You get the first free bed that matches, held for {holdHours} hours. It is confirmed once you pay the hostel fee; unpaid reservations are released.</p>
              {options.length === 0 ? <Empty>No beds are free for your level right now.</Empty> : (
                <div className="space-y-2">
                  <label className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm hover:bg-mute">
                    <input type="radio" className="accent-brand" checked={choice === "any"} onChange={() => setChoice("any")} />
                    <span className="flex-1"><b>Any hall, any room type</b><span className="block text-xs text-ink-3">The first free bed in any hall open to you</span></span>
                  </label>
                  {options.map((o) => {
                    const v = `${o.hostel_id}|${o.room_type}`;
                    return (
                      <label key={v} className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm hover:bg-mute">
                        <input type="radio" className="accent-brand" checked={choice === v} onChange={() => setChoice(v)} />
                        <span className="flex-1"><b>{o.hostel}</b> · {o.room_type}<span className="block text-xs text-ink-3">{o.free_beds} bed{Number(o.free_beds) === 1 ? "" : "s"} free</span></span>
                        <span className="font-medium tabular-nums">{naira(o.fee)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="mt-4"><Button onClick={apply} disabled={busy || options.length === 0}>{busy ? "Reserving…" : "Reserve a bed"}</Button></div>
            </Card>
          )}
        </>
      )}

      {/* ---------- reserved, awaiting payment ---------- */}
      {status === "reserved" && room && session && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Your reservation" right={<Pill tone="warn">Awaiting payment</Pill>}>
            <RoomFacts room={room} />
            <p className="mt-4 text-sm text-warn">Pay by {dt(room.expires_at)} or the bed is released to another student.</p>
            <div className="mt-4"><Button variant="danger" disabled={busy}
              onClick={() => confirm("Cancel this reservation? The bed will be released.") && run(() => supabase.rpc("uni_hostel_cancel", { p_allocation: room.allocation_id, p_reason: "Cancelled by student" }), "Reservation cancelled.")}>Cancel reservation</Button></div>
          </Card>
          <FeesCard studentId={profile.id} sessionId={session.id} sessionName={session.name} purpose="hostel" title="Hostel fee"
            due={Number(room.amount)} paid={Number(room.paid)} onChange={load} />
        </div>
      )}

      {/* ---------- confirmed or checked in ---------- */}
      {(status === "confirmed" || status === "checked_in") && room && session && (
        <>
          <Tabs value={tab} onChange={setTab} items={[
            { value: "room", label: "My room" },
            { value: "faults", label: `Report a fault${faults.filter((f) => f.status === "open" || f.status === "in_progress").length ? ` (${faults.filter((f) => f.status === "open" || f.status === "in_progress").length})` : ""}` },
            { value: "exeat", label: "Exeat" },
            { value: "change", label: "Room change" },
          ]} />
          {tab === "room" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={`${room.hostel} · Room ${room.room}`} right={<Pill tone={allocTone[status]}>{allocLabel[status]}</Pill>}>
                <RoomFacts room={room} />
                <div className="mt-4 text-sm">
                  <div className="text-xs font-medium text-ink-2">Room-mates</div>
                  {room.roommates.length ? <ul className="mt-1 list-disc pl-5">{room.roommates.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="mt-1 text-ink-3">None yet</p>}
                </div>
                {status === "confirmed" && <p className="mt-4 rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Your bed is paid for. Take your allocation slip to the hall porter to check in.</p>}
              </Card>
              <FeesCard studentId={profile.id} sessionId={session.id} sessionName={session.name} purpose="hostel" title="Hostel fee"
                due={Number(room.amount)} paid={Number(room.paid)} onChange={load} payable={false} />
            </div>
          )}
          {tab === "faults" && <Faults faults={faults} busy={busy} run={run} />}
          {tab === "exeat" && <Exeats exeats={exeats} checkedIn={status === "checked_in"} busy={busy} run={run} />}
          {tab === "change" && <Changes changes={changes} options={options} busy={busy} run={run} />}
        </>
      )}
    </>
  );
}

function RoomFacts({ room }: { room: MyRoom }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div><dt className="text-ink-3">Hall</dt><dd className="font-medium">{room.hostel}</dd></div>
      <div><dt className="text-ink-3">Room and bed</dt><dd className="font-medium">{room.room} · Bed {room.bed}</dd></div>
      <div><dt className="text-ink-3">Room type</dt><dd>{room.room_type}</dd></div>
      <div><dt className="text-ink-3">Floor</dt><dd>{room.floor ?? "—"}</dd></div>
      <div><dt className="text-ink-3">Hostel fee</dt><dd className="tabular-nums">{naira(room.amount)}</dd></div>
      <div><dt className="text-ink-3">Session</dt><dd>{room.session_name}</dd></div>
    </dl>
  );
}

type Run = (fn: () => PromiseLike<{ error: unknown }>, ok: string) => Promise<boolean>;

function Faults({ faults, busy, run }: { faults: Fault[]; busy: boolean; run: Run }) {
  const [f, setF] = useState({ category: "plumbing", priority: "normal", description: "" });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Report a fault in your room">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
          if (await run(() => supabase.rpc("uni_hostel_report_fault", { p_category: f.category, p_description: f.description, p_priority: f.priority }), "Fault reported to the hostel office.")) setF({ ...f, description: "" }); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type"><select className="input w-full" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{faultCategories.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select></Field>
            <Field label="Urgency"><select className="input w-full" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option></select></Field>
          </div>
          <Field label="What is wrong?"><textarea className="input w-full" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. The tap in the bathroom will not stop running" /></Field>
          <Button type="submit" disabled={busy || !f.description.trim()}>Report fault</Button>
        </form>
      </Card>
      <Card title="Your reports" className="lg:col-span-2">
        {faults.length === 0 ? <Empty>No faults reported.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {faults.map((x) => (
              <li key={x.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{cap(x.category)}{x.priority === "urgent" && <span className="ml-2"><Pill tone="bad">Urgent</Pill></span>}</span>
                  <Pill tone={faultTone[x.status]}>{faultStatusLabel[x.status]}</Pill>
                </div>
                <p className="mt-1 text-ink-2">{x.description}</p>
                <p className="mt-1 text-xs text-ink-3">Reported {dt(x.created_at)}{x.assigned_to ? ` · With ${x.assigned_to}` : ""}{x.resolution_note ? ` · ${x.resolution_note}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Exeats({ exeats, checkedIn, busy, run }: { exeats: Exeat[]; checkedIn: boolean; busy: boolean; run: Run }) {
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(8, 0, 0, 0);
  const back = new Date(tomorrow.getTime() + 2 * 86400000); back.setHours(18, 0, 0, 0);
  const [f, setF] = useState({ destination: "", reason: "", phone: "", leave: toLocalInput(tomorrow), ret: toLocalInput(back) });
  const active = exeats.find((e) => ["pending", "approved", "out"].includes(e.status));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Request an exeat (leave of absence)">
        {!checkedIn ? <p className="text-sm text-ink-3">You can request an exeat once the porter has checked you in.</p>
          : active ? <p className="text-sm text-ink-2">You have an exeat that is {exeatLabel[active.status].toLowerCase()}. You can request another once you are back.</p> : (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
            await run(() => supabase.rpc("uni_hostel_request_exeat", { p_destination: f.destination, p_reason: f.reason, p_phone: f.phone, p_leave: new Date(f.leave).toISOString(), p_return: new Date(f.ret).toISOString() }), "Exeat requested. The hostel office will review it."); }}>
            <Field label="Where are you going?"><input className="input w-full" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Town and address" /></Field>
            <Field label="Reason"><input className="input w-full" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <Field label="Contact phone while away" hint="Parent or guardian, or your own"><input className="input w-full" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Leaving"><input className="input w-full" type="datetime-local" value={f.leave} onChange={(e) => setF({ ...f, leave: e.target.value })} /></Field>
              <Field label="Back by"><input className="input w-full" type="datetime-local" value={f.ret} onChange={(e) => setF({ ...f, ret: e.target.value })} /></Field>
            </div>
            <Button type="submit" disabled={busy || !f.destination.trim() || !f.reason.trim() || !f.phone.trim() || !(new Date(f.ret) > new Date(f.leave))}>Request exeat</Button>
          </form>
        )}
      </Card>
      <Card title="Your exeats" className="lg:col-span-2">
        {exeats.length === 0 ? <Empty>No exeats yet.</Empty> : (
          <Table head={["Destination", "Leaving", "Back by", "Status", ""]}>
            {exeats.map((x) => (
              <tr key={x.id}>
                <td className={td}>{x.destination}<div className="text-xs text-ink-3">{x.reason}</div></td>
                <td className={`${td} text-xs`}>{dt(x.leave_at)}</td>
                <td className={`${td} text-xs`}>{dt(x.return_by)}</td>
                <td className={td}><Pill tone={exeatTone[x.status]}>{exeatLabel[x.status]}</Pill>{x.decision_note && <div className="mt-1 text-xs text-ink-3">{x.decision_note}</div>}</td>
                <td className={`${td} text-right`}>{["pending", "approved"].includes(x.status) &&
                  <button className="text-xs text-bad hover:underline" disabled={busy} onClick={() => run(() => supabase.rpc("uni_hostel_cancel_exeat", { p_exeat: x.id }), "Exeat cancelled.")}>Cancel</button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Changes({ changes, options, busy, run }: { changes: Change[]; options: Option[]; busy: boolean; run: Run }) {
  const [f, setF] = useState({ reason: "", pref: "any" });
  const pending = changes.find((c) => c.status === "pending");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Ask to change room">
        {pending ? (
          <div className="text-sm">
            <p className="text-ink-2">Your request is waiting for the hostel office.</p>
            <div className="mt-3"><Button variant="secondary" disabled={busy} onClick={() => run(() => supabase.rpc("uni_hostel_cancel_change", { p_request: pending.id }), "Request withdrawn.")}>Withdraw request</Button></div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault();
            const [hid, type] = f.pref === "any" ? [null, null] : f.pref.split("|");
            if (await run(() => supabase.rpc("uni_hostel_request_change", { p_reason: f.reason, p_hostel: hid, p_room_type: type }), "Room change requested.")) setF({ reason: "", pref: "any" }); }}>
            <Field label="Why do you want to move?"><textarea className="input w-full" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <Field label="Preferred hall and room type" hint="You can only move to a room that costs the same or less than you paid.">
              <select className="input w-full" value={f.pref} onChange={(e) => setF({ ...f, pref: e.target.value })}>
                <option value="any">No preference</option>
                {options.map((o) => <option key={`${o.hostel_id}|${o.room_type}`} value={`${o.hostel_id}|${o.room_type}`}>{o.hostel} · {o.room_type} ({naira(o.fee)})</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={busy || !f.reason.trim()}>Request room change</Button>
          </form>
        )}
      </Card>
      <Card title="Your requests" className="lg:col-span-2">
        {changes.length === 0 ? <Empty>No room change requests.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <span>{c.reason}<span className="block text-xs text-ink-3">{dt(c.created_at)}{c.decision_note ? ` · ${c.decision_note}` : ""}</span></span>
                <Pill tone={c.status === "approved" ? "good" : c.status === "pending" ? "warn" : "mute"}>{changeLabel[c.status]}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function Page() {
  return <Shell allow={["student"]}><Hostel /></Shell>;
}
