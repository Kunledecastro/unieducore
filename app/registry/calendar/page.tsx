"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Modal, Field, Pill, Empty, Table, td, StatusPill } from "@/components/ui";
import { supabase, errMsg, type ResultStatus } from "@/lib/supabase";

type Sem = { id: string; number: number; name: string; is_current: boolean; registration_open: boolean; starts_on: string | null };
type Ses = { id: string; name: string; is_current: boolean; semesters: Sem[] };
type Off = {
  id: string; lecturer_id: string | null; result_status: ResultStatus;
  course: { code: string; title: string; units: number; level: number; department_id: string; department: { code: string } | null } | null;
  regs: { id: string }[];
};
type Lect = { id: string; full_name: string; role: string; department_id: string | null; department: { code: string } | null };

function nextSessionName(list: Ses[]) {
  const years = list.map((s) => parseInt(s.name.slice(0, 4), 10)).filter((n) => !isNaN(n));
  const y = years.length ? Math.max(...years) + 1 : new Date().getFullYear();
  return `${y}/${y + 1}`;
}

function Calendar() {
  const { profile } = useAuth();
  const [sessions, setSessions] = useState<Ses[] | null>(null);
  const [semId, setSemId] = useState<string>("");
  const [offs, setOffs] = useState<Off[] | null>(null);
  const [lects, setLects] = useState<Lect[]>([]);
  const [deptFilter, setDeptFilter] = useState("");
  const [newSes, setNewSes] = useState<{ name: string; s1: string; s2: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s }, { data: l }] = await Promise.all([
      supabase.from("uni_sessions").select("id, name, is_current, semesters:uni_semesters(id, number, name, is_current, registration_open, starts_on)").order("name", { ascending: false }),
      supabase.from("uni_profiles").select("id, full_name, role, department_id, department:uni_departments(code)").in("role", ["lecturer", "hod"]).eq("is_active", true).order("full_name"),
    ]);
    const list = ((s as unknown as Ses[]) ?? []).map((x) => ({ ...x, semesters: [...x.semesters].sort((a, b) => a.number - b.number) }));
    setSessions(list);
    setLects((l as unknown as Lect[]) ?? []);
    setSemId((cur) => cur || list.flatMap((x) => x.semesters).find((m) => m.is_current)?.id || list[0]?.semesters[0]?.id || "");
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadOffs = useCallback(async () => {
    if (!semId) return;
    const { data } = await supabase.from("uni_course_offerings")
      .select("id, lecturer_id, result_status, course:uni_courses(code, title, units, level, department_id, department:uni_departments(code)), regs:uni_registration_courses(id)")
      .eq("semester_id", semId);
    setOffs(((data as unknown as Off[]) ?? []).sort((a, b) => (a.course?.code ?? "").localeCompare(b.course?.code ?? "")));
  }, [semId]);
  useEffect(() => { setOffs(null); loadOffs(); }, [loadOffs]);

  const sem = sessions?.flatMap((s) => s.semesters.map((m) => ({ ...m, session: s.name }))).find((m) => m.id === semId);
  const depts = useMemo(() => {
    const m = new Map<string, string>();
    (offs ?? []).forEach((o) => o.course && m.set(o.course.department_id, o.course.department?.code ?? ""));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [offs]);
  const shown = (offs ?? []).filter((o) => !deptFilter || o.course?.department_id === deptFilter);
  const unassigned = (offs ?? []).filter((o) => !o.lecturer_id).length;

  async function run(fn: () => PromiseLike<{ error: unknown; data?: unknown }>, ok: string | ((data: unknown) => string)) {
    setBusy(true); setMsg(null);
    const { error, data } = await fn();
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: typeof ok === "string" ? ok : ok(data) }); await load(); await loadOffs(); }
  }

  async function createSession() {
    if (!newSes || !profile) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.from("uni_sessions").insert({ tenant_id: profile.tenant_id, name: newSes.name.trim() }).select("id").single();
    if (error || !data) { setBusy(false); setMsg({ kind: "error", text: error?.code === "23505" ? "That session already exists." : errMsg(error) }); return; }
    const { error: e2 } = await supabase.from("uni_semesters").insert([
      { tenant_id: profile.tenant_id, session_id: data.id, number: 1, name: "First Semester", starts_on: newSes.s1 || null },
      { tenant_id: profile.tenant_id, session_id: data.id, number: 2, name: "Second Semester", starts_on: newSes.s2 || null },
    ]);
    setBusy(false);
    if (e2) setMsg({ kind: "error", text: errMsg(e2) });
    else { setMsg({ kind: "success", text: `${newSes.name} session created with two semesters.` }); setNewSes(null); load(); }
  }

  async function assign(o: Off, lecturerId: string) {
    const { error } = await supabase.rpc("uni_assign_lecturer", { p_offering: o.id, p_lecturer: lecturerId || null });
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setOffs((list) => (list ?? []).map((x) => x.id === o.id ? { ...x, lecturer_id: lecturerId || null } : x)); }
  }

  return (
    <>
      <PageHead title="Academic calendar" sub="Sessions and semesters, course registration windows, and who teaches what."
        right={<Button onClick={() => setNewSes({ name: nextSessionName(sessions ?? []), s1: "", s2: "" })}>Add session</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sessions" className="lg:col-span-1">
          {!sessions ? <p className="text-sm text-ink-3">Loading…</p> : sessions.length === 0 ? <Empty>No sessions yet.</Empty> : (
            <div className="space-y-4">
              {sessions.map((s) => (
                <div key={s.id}>
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">{s.name} {s.is_current && <Pill tone="good">Current</Pill>}</div>
                  <ul className="space-y-1.5">
                    {s.semesters.map((m) => (
                      <li key={m.id}>
                        <button onClick={() => setSemId(m.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${semId === m.id ? "border-brand bg-brand-soft" : "border-line hover:bg-mute"}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span>{m.name}</span>
                            <span className="flex gap-1">
                              {m.is_current && <Pill tone="good">Current</Pill>}
                              {m.registration_open && <Pill tone="info">Reg. open</Pill>}
                            </span>
                          </div>
                          {m.starts_on && <div className="text-xs text-ink-3">Starts {new Date(m.starts_on).toLocaleDateString("en-NG", { dateStyle: "medium" })}</div>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {sem && (
            <Card title={`${sem.session} · ${sem.name}`}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {sem.is_current ? <Pill tone="good">This is the current semester</Pill> : (
                  <Button small variant="secondary" disabled={busy}
                    onClick={() => confirm(`Make ${sem.session} ${sem.name} the current semester? Students will register and lecturers will score against it.`) &&
                      run(() => supabase.rpc("uni_set_current_semester", { p_semester: sem.id }), `${sem.session} ${sem.name} is now the current semester.`)}>
                    Make current semester
                  </Button>
                )}
                {sem.is_current && (
                  <Button small variant={sem.registration_open ? "danger" : "primary"} disabled={busy}
                    onClick={() => run(() => supabase.from("uni_semesters").update({ registration_open: !sem.registration_open }).eq("id", sem.id),
                      sem.registration_open ? "Course registration closed." : "Course registration is open.")}>
                    {sem.registration_open ? "Close course registration" : "Open course registration"}
                  </Button>
                )}
                {!sem.is_current && <span className="text-xs text-ink-3">Registration can only be opened for the current semester.</span>}
              </div>
            </Card>
          )}

          {sem && (
            <Card title={`Courses offered${offs ? ` · ${offs.length}` : ""}`}
              right={<div className="flex items-center gap-2">
                {offs && offs.length > 0 && unassigned > 0 && <Pill tone="warn">{unassigned} without a lecturer</Pill>}
                {depts.length > 1 && (
                  <select className="input text-sm" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="">All departments</option>
                    {depts.map(([id, code]) => <option key={id} value={id}>{code}</option>)}
                  </select>
                )}
                <Button small variant="secondary" disabled={busy}
                  onClick={() => run(() => supabase.rpc("uni_generate_offerings", { p_semester: sem.id }),
                    (n) => Number(n) > 0 ? `${n} course offering(s) added from the catalogue.` : "Every catalogue course for this semester is already offered.")}>
                  Add offerings from catalogue
                </Button>
              </div>}>
              {!offs ? <p className="text-sm text-ink-3">Loading…</p> : offs.length === 0 ? (
                <Empty>No courses offered yet. Use “Add offerings from catalogue” to offer every {sem.number === 1 ? "first" : "second"}-semester course.</Empty>
              ) : (
                <Table head={["Code", "Title", "Level", "Dept", "Lecturer", "Students", "Result"]}>
                  {shown.map((o) => {
                    const sameDept = lects.filter((l) => l.department_id === o.course?.department_id);
                    const others = lects.filter((l) => l.department_id !== o.course?.department_id);
                    return (
                      <tr key={o.id}>
                        <td className={`${td} font-medium`}>{o.course?.code}</td>
                        <td className={td}>{o.course?.title}</td>
                        <td className={`${td} tabular-nums`}>{o.course?.level}</td>
                        <td className={td}>{o.course?.department?.code}</td>
                        <td className={td}>
                          <select className={`input text-sm w-48 ${!o.lecturer_id ? "!border-warn" : ""}`} value={o.lecturer_id ?? ""}
                            disabled={o.result_status !== "draft"} onChange={(e) => assign(o, e.target.value)}>
                            <option value="">Unassigned</option>
                            {sameDept.length > 0 && <optgroup label={`${o.course?.department?.code} department`}>
                              {sameDept.map((l) => <option key={l.id} value={l.id}>{l.full_name}{l.role === "hod" ? " (HOD)" : ""}</option>)}
                            </optgroup>}
                            {others.length > 0 && <optgroup label="Other departments">
                              {others.map((l) => <option key={l.id} value={l.id}>{l.full_name} · {l.department?.code}</option>)}
                            </optgroup>}
                          </select>
                        </td>
                        <td className={`${td} tabular-nums`}>{o.regs.length}</td>
                        <td className={td}><StatusPill status={o.result_status} /></td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          )}
        </div>
      </div>

      {newSes && (
        <Modal title="Add academic session" onClose={() => setNewSes(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createSession(); }}>
            <Field label="Session" hint="Creates a First and a Second semester. It will not become current until you make it current.">
              <input className="input w-40" value={newSes.name} onChange={(e) => setNewSes({ ...newSes, name: e.target.value })} placeholder="2027/2028" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First semester starts (optional)"><input type="date" className="input w-full" value={newSes.s1} onChange={(e) => setNewSes({ ...newSes, s1: e.target.value })} /></Field>
              <Field label="Second semester starts (optional)"><input type="date" className="input w-full" value={newSes.s2} onChange={(e) => setNewSes({ ...newSes, s2: e.target.value })} /></Field>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !/^\d{4}\/\d{4}$/.test(newSes.name.trim())}>{busy ? "Creating…" : "Create session"}</Button>
              <Button variant="secondary" onClick={() => setNewSes(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Calendar /></Shell>;
}
