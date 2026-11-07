"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Modal, Field, Pill, Table, td, Credentials } from "@/components/ui";
import { supabase, errMsg, type Role } from "@/lib/supabase";
import { adminCall } from "@/lib/admin";

type Staff = { id: string; full_name: string; email: string; role: Role; department_id: string | null; is_active: boolean; must_change_password: boolean; department: { code: string; name: string } | null };
type Dept = { id: string; name: string; code: string };
type Form = { id?: string; full_name: string; email: string; role: Role; department_id: string };
type Cred = { name: string; email: string; password: string; extra?: string };

const roleLabel: Record<string, string> = { admin: "Administrator", registrar: "Registry", hod: "Head of Department", lecturer: "Lecturer", bursar: "Bursary" };
const needsDept = (r: Role) => r === "hod" || r === "lecturer";

function StaffPage() {
  const { profile } = useAuth();
  const [list, setList] = useState<Staff[] | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      supabase.from("uni_profiles").select("id, full_name, email, role, department_id, is_active, must_change_password, department:uni_departments(code, name)").neq("role", "student").order("full_name"),
      supabase.from("uni_departments").select("id, name, code").order("name"),
    ]);
    setList((s.data as unknown as Staff[]) ?? []);
    setDepts((d.data as Dept[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const roles: Role[] = profile?.role === "admin" ? ["lecturer", "hod", "registrar", "bursar", "admin"] : ["lecturer", "hod", "registrar", "bursar"];
  const shown = (list ?? []).filter((s) => (!roleFilter || s.role === roleFilter) && (!q || `${s.full_name} ${s.email}`.toLowerCase().includes(q.toLowerCase())));

  async function save() {
    if (!form) return;
    setBusy(true); setMsg(null);
    try {
      if (form.id) {
        const { error } = await supabase.from("uni_profiles").update({
          full_name: form.full_name.trim(), role: form.role, department_id: needsDept(form.role) ? form.department_id : null,
        }).eq("id", form.id);
        if (error) throw error;
        setMsg({ kind: "success", text: `${form.full_name} updated.` });
      } else {
        const out = await adminCall<{ user: { full_name: string; email: string; temp_password: string; role: string } }>({
          action: "create_user", user: { full_name: form.full_name, email: form.email, role: form.role, department_id: needsDept(form.role) ? form.department_id : null },
        });
        setCreds([{ name: out.user.full_name, email: out.user.email, password: out.user.temp_password, extra: roleLabel[out.user.role] }]);
      }
      setForm(null); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
    setBusy(false);
  }

  async function reset(s: Staff) {
    if (!confirm(`Reset the password for ${s.full_name}? Their current password will stop working.`)) return;
    try {
      const out = await adminCall<{ temp_password: string }>({ action: "reset_password", user_id: s.id });
      setCreds([{ name: s.full_name, email: s.email, password: out.temp_password }]); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
  }

  async function toggleActive(s: Staff) {
    if (!confirm(s.is_active ? `Deactivate ${s.full_name}? They will be signed out and unable to sign in.` : `Reactivate ${s.full_name}?`)) return;
    try {
      await adminCall({ action: "set_active", user_id: s.id, active: !s.is_active });
      setMsg({ kind: "success", text: `${s.full_name} ${s.is_active ? "deactivated" : "reactivated"}.` }); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
  }

  const formValid = form && form.full_name.trim() && (form.id || /\S+@\S+\.\S+/.test(form.email)) && (!needsDept(form.role) || form.department_id);

  return (
    <>
      <PageHead title="Staff" sub="Lecturers, Heads of Department, Registry and Bursary accounts."
        right={<Button onClick={() => setForm({ full_name: "", email: "", role: "lecturer", department_id: depts[0]?.id ?? "" })}>Add staff</Button>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {creds && <div className="mb-5"><Credentials items={creds} /><button className="mt-2 text-xs text-ink-3 hover:underline" onClick={() => setCreds(null)}>I have saved these, hide</button></div>}

      <Card title={`${shown.length} staff`}
        right={<div className="flex gap-2">
          <input className="input w-52 text-sm" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input text-sm" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>}>
        {!list ? <p className="text-sm text-ink-3">Loading…</p> : (
          <Table head={["Name", "Role", "Department", "Status", ""]}>
            {shown.map((s) => (
              <tr key={s.id} className={s.is_active ? "" : "opacity-60"}>
                <td className={td}>{s.full_name}<div className="text-xs text-ink-3">{s.email}</div></td>
                <td className={td}>{roleLabel[s.role] ?? s.role}</td>
                <td className={td}>{s.department?.name ?? "—"}</td>
                <td className={td}>{!s.is_active ? <Pill tone="bad">Deactivated</Pill> : s.must_change_password ? <Pill tone="warn">Awaiting first sign-in</Pill> : <Pill tone="good">Active</Pill>}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {s.id !== profile?.id && (s.role !== "admin" || profile?.role === "admin") && <>
                    <button className="mr-3 text-xs text-brand hover:underline" onClick={() => setForm({ id: s.id, full_name: s.full_name, email: s.email, role: s.role, department_id: s.department_id ?? depts[0]?.id ?? "" })}>Edit</button>
                    <button className="mr-3 text-xs text-brand hover:underline" onClick={() => reset(s)}>Reset password</button>
                    <button className={`text-xs hover:underline ${s.is_active ? "text-bad" : "text-good"}`} onClick={() => toggleActive(s)}>{s.is_active ? "Deactivate" : "Reactivate"}</button>
                  </>}
                  {s.id === profile?.id && <span className="text-xs text-ink-3">You</span>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {form && (
        <Modal title={form.id ? `Edit ${form.full_name}` : "Add staff member"} onClose={() => setForm(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Field label="Full name"><input className="input w-full" autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Dr. Ngozi Adeleke" /></Field>
            <Field label="University email" hint={form.id ? "Email cannot be changed here." : "They sign in with this email."}>
              <input className="input w-full" type="email" disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="n.adeleke@university.edu.ng" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <select className="input w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {roles.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </Field>
              {needsDept(form.role) && (
                <Field label="Department">
                  <select className="input w-full" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
            {!form.id && <p className="text-xs text-ink-3">A temporary password is generated and shown once. They must set their own password at first sign-in.</p>}
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !formValid}>{busy ? "Saving…" : form.id ? "Save" : "Create account"}</Button>
              <Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><StaffPage /></Shell>;
}
