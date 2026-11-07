"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Modal, Field, Pill, Empty } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";

type Prog = { id: string; name: string; award: string; duration_years: number; students: { id: string }[] };
type Dept = { id: string; name: string; code: string; faculty_id: string; programmes: Prog[]; courses: { id: string }[] };
type Fac = { id: string; name: string; code: string; departments: Dept[] };

type Form =
  | { kind: "faculty"; id?: string; name: string; code: string }
  | { kind: "department"; id?: string; faculty_id: string; name: string; code: string }
  | { kind: "programme"; id?: string; department_id: string; name: string; award: string; duration_years: number };

const AWARDS = ["B.Sc.", "B.A.", "B.Eng.", "B.Tech.", "LL.B.", "MBBS", "B.Ed.", "M.Sc.", "MBA", "Ph.D."];

function Structure() {
  const { profile } = useAuth();
  const [facs, setFacs] = useState<Fac[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("uni_faculties")
      .select("id, name, code, departments:uni_departments(id, name, code, faculty_id, programmes:uni_programmes(id, name, award, duration_years, students:uni_students(id)), courses:uni_courses(id))")
      .order("name");
    const list = ((data as unknown as Fac[]) ?? []).map((f) => ({
      ...f, departments: [...f.departments].sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ ...d, programmes: [...d.programmes].sort((a, b) => a.name.localeCompare(b.name)) })),
    }));
    setFacs(list);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form || !profile) return;
    setBusy(true); setMsg(null);
    const t = profile.tenant_id;
    let error;
    if (form.kind === "faculty") {
      const row = { name: form.name.trim(), code: form.code.trim().toUpperCase() };
      ({ error } = form.id ? await supabase.from("uni_faculties").update(row).eq("id", form.id)
        : await supabase.from("uni_faculties").insert({ ...row, tenant_id: t }));
    } else if (form.kind === "department") {
      const row = { name: form.name.trim(), code: form.code.trim().toUpperCase(), faculty_id: form.faculty_id };
      ({ error } = form.id ? await supabase.from("uni_departments").update(row).eq("id", form.id)
        : await supabase.from("uni_departments").insert({ ...row, tenant_id: t }));
    } else {
      const row = { name: form.name.trim(), award: form.award, duration_years: form.duration_years, department_id: form.department_id };
      ({ error } = form.id ? await supabase.from("uni_programmes").update(row).eq("id", form.id)
        : await supabase.from("uni_programmes").insert({ ...row, tenant_id: t }));
    }
    setBusy(false);
    if (error) setMsg({ kind: "error", text: error.code === "23505" ? "That code is already used. Codes must be unique." : errMsg(error) });
    else { setMsg({ kind: "success", text: `${form.kind[0].toUpperCase() + form.kind.slice(1)} saved.` }); setForm(null); load(); }
  }

  async function remove(table: string, id: string, label: string) {
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) setMsg({ kind: "error", text: error.code === "23503" ? `${label} is still in use and cannot be deleted.` : errMsg(error) });
    else { setMsg({ kind: "success", text: `${label} deleted.` }); load(); }
  }

  const valid = form && form.name.trim() && (form.kind === "programme" || ("code" in form && form.code.trim()));

  return (
    <>
      <PageHead title="Academic structure" sub="Faculties, departments and the degree programmes they run."
        right={<Button onClick={() => setForm({ kind: "faculty", name: "", code: "" })}>Add faculty</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      {!facs ? <p className="text-sm text-ink-3">Loading…</p> : facs.length === 0 ? <Empty>No faculties yet. Add the first one.</Empty> : (
        <div className="space-y-4">
          {facs.map((f) => (
            <Card key={f.id} title={<span>{f.name} <span className="font-normal text-ink-3">({f.code})</span></span>}
              right={<div className="flex gap-2">
                <Button small variant="secondary" onClick={() => setForm({ kind: "department", faculty_id: f.id, name: "", code: "" })}>Add department</Button>
                <Button small variant="secondary" onClick={() => setForm({ kind: "faculty", id: f.id, name: f.name, code: f.code })}>Edit</Button>
                {f.departments.length === 0 && <Button small variant="danger" onClick={() => remove("uni_faculties", f.id, f.name)}>Delete</Button>}
              </div>}>
              {f.departments.length === 0 ? <p className="text-sm text-ink-3">No departments yet.</p> : (
                <div className="divide-y divide-line -my-2">
                  {f.departments.map((d) => (
                    <div key={d.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-medium">{d.name}</span> <span className="text-ink-3">({d.code}) · {d.courses.length} courses</span>
                        </div>
                        <div className="flex gap-2">
                          <Button small variant="secondary" onClick={() => setForm({ kind: "programme", department_id: d.id, name: "", award: "B.Sc.", duration_years: 4 })}>Add programme</Button>
                          <Button small variant="secondary" onClick={() => setForm({ kind: "department", id: d.id, faculty_id: d.faculty_id, name: d.name, code: d.code })}>Edit</Button>
                          {d.programmes.length === 0 && d.courses.length === 0 && <Button small variant="danger" onClick={() => remove("uni_departments", d.id, d.name)}>Delete</Button>}
                        </div>
                      </div>
                      {d.programmes.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {d.programmes.map((p) => (
                            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                              <Pill tone="brand">{p.award}</Pill> {p.name}
                              <span className="text-xs text-ink-3">{p.duration_years} yrs · {p.students.length} students</span>
                              <button className="text-xs text-brand hover:underline" onClick={() => setForm({ kind: "programme", id: p.id, department_id: d.id, name: p.name, award: p.award, duration_years: p.duration_years })}>Edit</button>
                              {p.students.length === 0 && <button className="text-xs text-bad hover:underline" onClick={() => remove("uni_programmes", p.id, p.name)}>Delete</button>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {form && (
        <Modal title={`${form.id ? "Edit" : "Add"} ${form.kind}`} onClose={() => setForm(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            {form.kind === "department" && facs && (
              <Field label="Faculty">
                <select className="input w-full" value={form.faculty_id} onChange={(e) => setForm({ ...form, faculty_id: e.target.value })}>
                  {facs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Name">
              <input className="input w-full" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value } as Form)}
                placeholder={form.kind === "faculty" ? "Faculty of Engineering" : form.kind === "department" ? "Electrical Engineering" : "Electrical Engineering"} />
            </Field>
            {form.kind !== "programme" && (
              <Field label="Code" hint={form.kind === "department" ? "Used in matric numbers, e.g. UDU/EEE/26/0001" : undefined}>
                <input className="input w-32 uppercase" maxLength={8} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value } as Form)} placeholder="EEE" />
              </Field>
            )}
            {form.kind === "programme" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Award">
                  <select className="input w-full" value={form.award} onChange={(e) => setForm({ ...form, award: e.target.value })}>
                    {AWARDS.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Duration (years)">
                  <input className="input w-full" type="number" min={1} max={7} value={form.duration_years}
                    onChange={(e) => setForm({ ...form, duration_years: Number(e.target.value) })} />
                </Field>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !valid}>{busy ? "Saving…" : "Save"}</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Structure /></Shell>;
}
