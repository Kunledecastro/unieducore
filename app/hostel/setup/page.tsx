"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Pill, Empty, Field, Modal, Table, td } from "@/components/ui";
import { supabase, naira, errMsg } from "@/lib/supabase";

type Hall = { id: string; name: string; gender: "male" | "female"; description: string | null; is_active: boolean };
type Room = { id: string; hostel_id: string; name: string; floor: string | null; room_type: string; capacity: number; fee: number; levels: number[] | null; is_active: boolean };
type Settings = { hostel_applications_open: boolean; hostel_hold_hours: number; hostel_require_school_fees: boolean };
type RoomForm = { id?: string; hostel_id: string; name: string; floor: string; room_type: string; capacity: number; fee: number; levels: string; is_active: boolean; count: number };

const LEVELS = [100, 200, 300, 400, 500, 600];

function Setup() {
  const { profile } = useAuth();
  const [halls, setHalls] = useState<Hall[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [set, setSet] = useState<Settings | null>(null);
  const [hallForm, setHallForm] = useState<Partial<Hall> | null>(null);
  const [roomForm, setRoomForm] = useState<RoomForm | null>(null);
  const [selected, setSelected] = useState("");
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [h, r, s] = await Promise.all([
      supabase.from("uni_hostels").select("id, name, gender, description, is_active").order("name"),
      supabase.from("uni_hostel_rooms").select("id, hostel_id, name, floor, room_type, capacity, fee, levels, is_active").order("name"),
      supabase.from("uni_settings").select("hostel_applications_open, hostel_hold_hours, hostel_require_school_fees").maybeSingle(),
    ]);
    const hl = (h.data as Hall[]) ?? [];
    setHalls(hl); setRooms(((r.data as Room[]) ?? []).map((x) => ({ ...x, fee: Number(x.fee) })));
    setSet(s.data as Settings);
    setSelected((cur) => cur || hl[0]?.id || "");
  }, []);
  useEffect(() => { load(); }, [load]);

  async function step(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setMsg({ kind: "error", text: errMsg(error) }); return false; }
    setMsg({ kind: "success", text: ok }); load(); return true;
  }

  const saveSettings = () => set && step(() => supabase.rpc("uni_hostel_save_settings", { p_open: set.hostel_applications_open, p_hold_hours: set.hostel_hold_hours, p_require_school_fees: set.hostel_require_school_fees }), "Hostel settings saved.");

  async function saveHall() {
    if (!hallForm || !profile) return;
    const row = { name: (hallForm.name ?? "").trim(), gender: hallForm.gender ?? "female", description: hallForm.description?.trim() || null, is_active: hallForm.is_active ?? true };
    const ok = hallForm.id
      ? await step(() => supabase.from("uni_hostels").update(row).eq("id", hallForm.id!), `${row.name} saved.`)
      : await step(() => supabase.from("uni_hostels").insert({ ...row, tenant_id: profile.tenant_id }), `${row.name} added. Now add its rooms.`);
    if (ok) setHallForm(null);
  }

  async function saveRoom() {
    if (!roomForm || !profile) return;
    const levels = roomForm.levels ? roomForm.levels.split(",").map(Number) : null;
    const base = { floor: roomForm.floor.trim() || null, room_type: roomForm.room_type.trim() || "Standard", capacity: roomForm.capacity, fee: roomForm.fee, levels, is_active: roomForm.is_active };
    let ok: boolean;
    if (roomForm.id) {
      ok = await step(() => supabase.from("uni_hostel_rooms").update({ ...base, name: roomForm.name.trim() }).eq("id", roomForm.id!), `Room ${roomForm.name} saved.`);
    } else {
      // "A101" with count 5 adds A101…A105
      const m = roomForm.name.trim().match(/^(.*?)(\d+)$/);
      const names = roomForm.count > 1 && m
        ? Array.from({ length: roomForm.count }, (_, i) => `${m[1]}${String(Number(m[2]) + i).padStart(m[2].length, "0")}`)
        : [roomForm.name.trim()];
      ok = await step(() => supabase.from("uni_hostel_rooms").insert(names.map((name) => ({ ...base, name, hostel_id: roomForm.hostel_id, tenant_id: profile.tenant_id }))),
        names.length > 1 ? `${names.length} rooms added (${names[0]}–${names.at(-1)}).` : `Room ${names[0]} added.`);
    }
    if (ok) setRoomForm(null);
  }

  const hall = halls.find((h) => h.id === selected);
  const hallRooms = rooms.filter((r) => r.hostel_id === selected);
  const levelSet = new Set(roomForm?.levels ? roomForm.levels.split(",").map(Number) : []);

  return (
    <>
      <PageHead title="Halls and rooms" sub="Set up halls, rooms and fees. Beds are created from each room's capacity (A, B, C…)."
        right={<Button onClick={() => setHallForm({ gender: "female", is_active: true })}>Add hall</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      {set && (
        <Card title="Applications" className="mb-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-brand h-4 w-4" checked={set.hostel_applications_open} onChange={(e) => setSet({ ...set, hostel_applications_open: e.target.checked })} />
              Students can apply for beds now
            </label>
            <Field label="Hold an unpaid bed for (hours)" hint="Then it is released to other students">
              <input className="input w-full" type="number" min={1} max={720} value={set.hostel_hold_hours} onChange={(e) => setSet({ ...set, hostel_hold_hours: Number(e.target.value) })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="accent-brand h-4 w-4" checked={set.hostel_require_school_fees} onChange={(e) => setSet({ ...set, hostel_require_school_fees: e.target.checked })} />
              School fees must be paid before applying
            </label>
          </div>
          <div className="mt-4"><Button onClick={saveSettings} disabled={busy || !(set.hostel_hold_hours >= 1 && set.hostel_hold_hours <= 720)}>Save</Button></div>
        </Card>
      )}

      {halls.length === 0 ? <Card><Empty>No halls yet. Add your first hall.</Empty></Card> : (
        <div className="grid gap-4 lg:grid-cols-4">
          <Card title="Halls">
            <ul className="-mx-2 space-y-1">
              {halls.map((h) => {
                const rs = rooms.filter((r) => r.hostel_id === h.id && r.is_active);
                return (
                  <li key={h.id}>
                    <button onClick={() => setSelected(h.id)} className={`w-full rounded-md px-2 py-2 text-left text-sm ${selected === h.id ? "bg-brand-soft text-brand" : "hover:bg-mute"}`}>
                      <span className="font-medium">{h.name}</span>{!h.is_active && <span className="ml-2"><Pill tone="mute">Closed</Pill></span>}
                      <span className="block text-xs text-ink-3">{h.gender === "male" ? "Male" : "Female"} · {rs.length} rooms · {rs.reduce((a, r) => a + r.capacity, 0)} beds</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {hall && (
            <Card className="lg:col-span-3" title={`${hall.name} · ${hall.gender === "male" ? "Male" : "Female"}`}
              right={<div className="flex gap-2">
                <Button small variant="secondary" onClick={() => setHallForm(hall)}>Edit hall</Button>
                <Button small onClick={() => setRoomForm({ hostel_id: hall.id, name: "", floor: "", room_type: hallRooms[0]?.room_type ?? "Standard (4 per room)", capacity: hallRooms[0]?.capacity ?? 4, fee: hallRooms[0]?.fee ?? 0, levels: "", is_active: true, count: 1 })}>Add rooms</Button>
              </div>}>
              {hall.description && <p className="mb-3 text-sm text-ink-2">{hall.description}</p>}
              {hallRooms.length === 0 ? <Empty>No rooms yet.</Empty> : (
                <Table head={["Room", "Floor", "Type", "Beds", "Fee", "Levels", ""]}>
                  {hallRooms.map((r) => (
                    <tr key={r.id} className={r.is_active ? "" : "opacity-60"}>
                      <td className={`${td} font-medium`}>{r.name}{!r.is_active && <span className="ml-2"><Pill tone="mute">Not in use</Pill></span>}</td>
                      <td className={td}>{r.floor ?? "—"}</td>
                      <td className={td}>{r.room_type}</td>
                      <td className={`${td} tabular-nums`}>{r.capacity}</td>
                      <td className={`${td} tabular-nums`}>{naira(r.fee)}</td>
                      <td className={td}>{r.levels?.length ? r.levels.map((l) => `${l}L`).join(", ") : "All"}</td>
                      <td className={`${td} text-right`}><button className="text-xs text-brand hover:underline"
                        onClick={() => setRoomForm({ id: r.id, hostel_id: r.hostel_id, name: r.name, floor: r.floor ?? "", room_type: r.room_type, capacity: r.capacity, fee: r.fee, levels: (r.levels ?? []).join(","), is_active: r.is_active, count: 1 })}>Edit</button></td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )}
        </div>
      )}

      {hallForm && (
        <Modal title={hallForm.id ? `Edit ${hallForm.name}` : "Add hall"} onClose={() => setHallForm(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveHall(); }}>
            <Field label="Hall name"><input className="input w-full" autoFocus value={hallForm.name ?? ""} onChange={(e) => setHallForm({ ...hallForm, name: e.target.value })} placeholder="Queen Amina Hall" /></Field>
            <Field label="For">
              <select className="input w-full" value={hallForm.gender} onChange={(e) => setHallForm({ ...hallForm, gender: e.target.value as Hall["gender"] })}>
                <option value="female">Female students</option><option value="male">Male students</option>
              </select>
            </Field>
            <Field label="Description (optional)"><input className="input w-full" value={hallForm.description ?? ""} onChange={(e) => setHallForm({ ...hallForm, description: e.target.value })} /></Field>
            {hallForm.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand h-4 w-4" checked={hallForm.is_active ?? true} onChange={(e) => setHallForm({ ...hallForm, is_active: e.target.checked })} />
                Open for allocation <span className="text-xs text-ink-3">(closing stops new allocations; current residents stay)</span>
              </label>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !(hallForm.name ?? "").trim()}>Save</Button>
              <Button variant="secondary" onClick={() => setHallForm(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {roomForm && (
        <Modal title={roomForm.id ? `Edit room ${roomForm.name}` : "Add rooms"} onClose={() => setRoomForm(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveRoom(); }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={roomForm.id ? "Room name" : "First room name"}><input className="input w-full" autoFocus value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} placeholder="A101" /></Field>
              {!roomForm.id ? (
                <Field label="How many rooms" hint="Numbers count up from the first name"><input className="input w-full" type="number" min={1} max={100} value={roomForm.count} onChange={(e) => setRoomForm({ ...roomForm, count: Number(e.target.value) })} /></Field>
              ) : <Field label="Floor"><input className="input w-full" value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} /></Field>}
            </div>
            {!roomForm.id && <Field label="Floor"><input className="input w-full" value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} placeholder="Ground" /></Field>}
            <Field label="Room type" hint="Students choose by type, e.g. Standard (4 per room), Premium (2 per room)">
              <input className="input w-full" value={roomForm.room_type} onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Beds per room"><input className="input w-full" type="number" min={1} max={12} value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: Number(e.target.value) })} /></Field>
              <Field label="Fee per bed for the session (₦)"><input className="input w-full" type="number" min={0} step="500" value={roomForm.fee} onChange={(e) => setRoomForm({ ...roomForm, fee: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Levels allowed" hint="None ticked = every level">
              <div className="flex flex-wrap gap-3 pt-1">
                {LEVELS.map((l) => (
                  <label key={l} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="accent-brand" checked={levelSet.has(l)}
                      onChange={(e) => { const n = new Set(levelSet); if (e.target.checked) n.add(l); else n.delete(l); setRoomForm({ ...roomForm, levels: [...n].sort().join(",") }); }} />{l}L
                  </label>
                ))}
              </div>
            </Field>
            {roomForm.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand h-4 w-4" checked={roomForm.is_active} onChange={(e) => setRoomForm({ ...roomForm, is_active: e.target.checked })} />
                In use <span className="text-xs text-ink-3">(untick for repairs; no new students are placed)</span>
              </label>
            )}
            {roomForm.id && <p className="text-xs text-ink-3">Changing the fee applies to new allocations only. Reducing beds is refused while students occupy the beds being removed.</p>}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !roomForm.name.trim() || !(roomForm.capacity >= 1 && roomForm.capacity <= 12) || !(roomForm.fee >= 0) || !(roomForm.count >= 1 && roomForm.count <= 100)}>Save</Button>
              <Button variant="secondary" onClick={() => setRoomForm(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["hostel_officer", "admin"]}><Setup /></Shell>;
}
