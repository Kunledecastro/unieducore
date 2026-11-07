"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Modal, Field, Pill, Empty, Table, td, Tabs } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";

type Dept = { id: string; name: string; code: string };
type Course = { id: string; code: string; title: string; units: number; level: number; semester_number: number; department_id: string; department: { code: string } | null };
type Prog = { id: string; name: string; award: string; department_id: string };
type PC = { id: string; is_compulsory: boolean; course: Course };
type CourseForm = { id?: string; code: string; title: string; units: number; level: number; semester_number: number; department_id: string };

const LEVELS = [100, 200, 300, 400, 500, 600, 700];

function Courses() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<"catalogue" | "curriculum">("catalogue");
  const [depts, setDepts] = useState<Dept[]>([]);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [progs, setProgs] = useState<Prog[]>([]);
  const [deptFilter, setDeptFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<CourseForm | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, c, p] = await Promise.all([
      supabase.from("uni_departments").select("id, name, code").order("name"),
      supabase.from("uni_courses").select("id, code, title, units, level, semester_number, department_id, department:uni_departments(code)").order("code"),
      supabase.from("uni_programmes").select("id, name, award, department_id").order("name"),
    ]);
    setDepts((d.data as Dept[]) ?? []);
    setCourses((c.data as unknown as Course[]) ?? []);
    setProgs((p.data as Prog[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = (courses ?? []).filter((c) =>
    (!deptFilter || c.department_id === deptFilter) && (!levelFilter || c.level === Number(levelFilter)) &&
    (!q || `${c.code} ${c.title}`.toLowerCase().includes(q.toLowerCase())));

  async function save() {
    if (!form || !profile) return;
    setBusy(true); setMsg(null);
    const row = { code: form.code.trim().toUpperCase().replace(/\s+/g, ""), title: form.title.trim(), units: form.units, level: form.level, semester_number: form.semester_number, department_id: form.department_id };
    const { error } = form.id ? await supabase.from("uni_courses").update(row).eq("id", form.id)
      : await supabase.from("uni_courses").insert({ ...row, tenant_id: profile.tenant_id });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: error.code === "23505" ? `Course code ${row.code} already exists.` : errMsg(error) });
    else { setMsg({ kind: "success", text: `${row.code} saved.` }); setForm(null); load(); }
  }

  async function remove(c: Course) {
    if (!confirm(`Delete ${c.code}? It will also be removed from programme curricula and unused offerings.`)) return;
    const { error } = await supabase.from("uni_courses").delete().eq("id", c.id);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `${c.code} deleted.` }); load(); }
  }

  return (
    <>
      <PageHead title="Courses" sub="The course catalogue, and which courses each programme requires at each level."
        right={tab === "catalogue" && <Button onClick={() => setForm({ code: "", title: "", units: 3, level: 100, semester_number: 1, department_id: deptFilter || depts[0]?.id || "" })} disabled={!depts.length}>Add course</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <Tabs value={tab} onChange={setTab} items={[{ value: "catalogue", label: "Catalogue" }, { value: "curriculum", label: "Programme curriculum" }]} />

      {tab === "catalogue" && (
        <Card title={`${shown.length} course${shown.length === 1 ? "" : "s"}`}
          right={<div className="flex flex-wrap gap-2">
            <input className="input w-44 text-sm" placeholder="Search code or title" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input text-sm" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="input text-sm" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
              <option value="">All levels</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}L</option>)}
            </select>
          </div>}>
          {!courses ? <p className="text-sm text-ink-3">Loading…</p> : shown.length === 0 ? <Empty>No courses match.</Empty> : (
            <Table head={["Code", "Title", "Units", "Level", "Semester", "Dept", ""]}>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td className={`${td} font-medium`}>{c.code}</td>
                  <td className={td}>{c.title}</td>
                  <td className={`${td} tabular-nums`}>{c.units}</td>
                  <td className={`${td} tabular-nums`}>{c.level}</td>
                  <td className={td}>{c.semester_number === 1 ? "First" : "Second"}</td>
                  <td className={td}>{c.department?.code}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <button className="text-xs text-brand hover:underline mr-3" onClick={() => setForm({ ...c })}>Edit</button>
                    <button className="text-xs text-bad hover:underline" onClick={() => remove(c)}>Delete</button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "curriculum" && <Curriculum progs={progs} courses={courses ?? []} tenantId={profile?.tenant_id ?? ""} />}

      {form && (
        <Modal title={form.id ? `Edit ${form.code}` : "Add course"} onClose={() => setForm(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code"><input className="input w-full uppercase" autoFocus value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CSC301" /></Field>
              <div className="col-span-2"><Field label="Title"><input className="input w-full" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Data Structures" /></Field></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Units"><input className="input w-full" type="number" min={0} max={12} value={form.units} onChange={(e) => setForm({ ...form, units: Number(e.target.value) })} /></Field>
              <Field label="Level">
                <select className="input w-full" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Semester">
                <select className="input w-full" value={form.semester_number} onChange={(e) => setForm({ ...form, semester_number: Number(e.target.value) })}>
                  <option value={1}>First</option><option value={2}>Second</option>
                </select>
              </Field>
            </div>
            <Field label="Department (owns the course and approves its results)">
              <select className="input w-full" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !form.code.trim() || !form.title.trim() || !form.department_id}>{busy ? "Saving…" : "Save"}</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Curriculum({ progs, courses, tenantId }: { progs: Prog[]; courses: Course[]; tenantId: string }) {
  const [progId, setProgId] = useState("");
  const [items, setItems] = useState<PC[]>([]);
  const [adding, setAdding] = useState({ course_id: "", is_compulsory: true });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => { if (!progId && progs[0]) setProgId(progs[0].id); }, [progs, progId]);

  const load = useCallback(async () => {
    if (!progId) return;
    const { data } = await supabase.from("uni_programme_courses")
      .select("id, is_compulsory, course:uni_courses(id, code, title, units, level, semester_number, department_id, department:uni_departments(code))")
      .eq("programme_id", progId);
    setItems((data as unknown as PC[]) ?? []);
  }, [progId]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const g = new Map<string, PC[]>();
    [...items].sort((a, b) => a.course.level - b.course.level || a.course.semester_number - b.course.semester_number || a.course.code.localeCompare(b.course.code))
      .forEach((i) => { const k = `${i.course.level}|${i.course.semester_number}`; g.set(k, [...(g.get(k) ?? []), i]); });
    return [...g.entries()];
  }, [items]);
  const available = courses.filter((c) => !items.some((i) => i.course.id === c.id));

  async function add() {
    const { error } = await supabase.from("uni_programme_courses").insert({ tenant_id: tenantId, programme_id: progId, ...adding });
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setAdding({ course_id: "", is_compulsory: true }); setMsg(null); load(); }
  }
  async function toggle(i: PC) {
    const { error } = await supabase.from("uni_programme_courses").update({ is_compulsory: !i.is_compulsory }).eq("id", i.id);
    if (error) setMsg({ kind: "error", text: errMsg(error) }); else load();
  }
  async function drop(i: PC) {
    const { error } = await supabase.from("uni_programme_courses").delete().eq("id", i.id);
    if (error) setMsg({ kind: "error", text: errMsg(error) }); else load();
  }

  if (!progs.length) return <Empty>Add a programme under Structure first.</Empty>;
  return (
    <>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Programme">
          <select className="input w-72" value={progId} onChange={(e) => setProgId(e.target.value)}>
            {progs.map((p) => <option key={p.id} value={p.id}>{p.award} {p.name}</option>)}
          </select>
        </Field>
        <Field label="Add a course to this programme">
          <select className="input w-80" value={adding.course_id} onChange={(e) => setAdding({ ...adding, course_id: e.target.value })}>
            <option value="">Choose a course…</option>
            {available.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title} ({c.level}L, {c.semester_number === 1 ? "1st" : "2nd"} sem)</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" className="accent-brand" checked={adding.is_compulsory} onChange={(e) => setAdding({ ...adding, is_compulsory: e.target.checked })} /> Compulsory
        </label>
        <div className="pb-0.5"><Button onClick={add} disabled={!adding.course_id}>Add</Button></div>
      </div>
      {groups.length === 0 ? <Empty>No courses in this programme yet.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map(([k, list]) => {
            const [level, sem] = k.split("|");
            const units = list.reduce((a, i) => a + i.course.units, 0);
            const core = list.filter((i) => i.is_compulsory).reduce((a, i) => a + i.course.units, 0);
            return (
              <Card key={k} title={`${level} Level · ${sem === "1" ? "First" : "Second"} semester`} right={<span className="text-xs text-ink-3">{core} compulsory units · {units} total</span>}>
                <ul className="divide-y divide-line -my-2 text-sm">
                  {list.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                      <span><b>{i.course.code}</b> {i.course.title} <span className="text-ink-3">· {i.course.units}u</span></span>
                      <span className="flex items-center gap-3 whitespace-nowrap">
                        <button onClick={() => toggle(i)} title="Click to switch">{i.is_compulsory ? <Pill>Compulsory</Pill> : <Pill tone="brand">Elective</Pill>}</button>
                        <button className="text-xs text-bad hover:underline" onClick={() => drop(i)}>Remove</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Courses /></Shell>;
}
