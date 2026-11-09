"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Pill, Button, Notice, Modal, Field, Credentials } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";
import { degreeClass, type DegreeClass, type GpaRow } from "@/lib/student";
import { adminCall, parseCsv, downloadText } from "@/lib/admin";

type S = {
  id: string; matric_no: string; level: number; status: string; programme_id: string;
  profile: { full_name: string; email: string; is_active: boolean; must_change_password: boolean } | null;
  programme: { name: string; award: string; department: { code: string } | null } | null;
  regs: { status: string; semester: { is_current: boolean } | null }[];
};
type Prog = { id: string; name: string; award: string };
type Cred = { name: string; email: string; password: string; extra?: string };
type ImportResult = { row: number; ok: boolean; email: string; full_name: string; matric_no?: string; temp_password?: string; error?: string };

const LEVELS = [100, 200, 300, 400, 500, 600, 700];
const STATUSES = ["active", "deferred", "withdrawn", "graduated"];
const TEMPLATE = "full_name,email,programme,level,matric_no\nAmaka Obi,amaka.obi@example.edu.ng,Computer Science,100,\nYusuf Bello,yusuf.bello@example.edu.ng,Accounting,100,\n";

function Students() {
  const [list, setList] = useState<S[] | null>(null);
  const [progs, setProgs] = useState<Prog[]>([]);
  const [cgpa, setCgpa] = useState<Record<string, number | null>>({});
  const [classes, setClasses] = useState<DegreeClass[]>([]);
  const [q, setQ] = useState("");
  const [add, setAdd] = useState<{ full_name: string; email: string; programme_id: string; level: number; matric_no: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string; programme_id: string; level: number; status: string } | null>(null);
  const [importing, setImporting] = useState<{ rows: Record<string, string>[]; results: ImportResult[] | null; progress: number } | null>(null);
  const [creds, setCreds] = useState<Cred[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("uni_students")
        .select("id, matric_no, level, status, programme_id, profile:uni_profiles(full_name, email, is_active, must_change_password), programme:uni_programmes(name, award, department:uni_departments(code)), regs:uni_registrations(status, semester:uni_semesters(is_current))")
        .order("matric_no"),
      supabase.from("uni_programmes").select("id, name, award").order("name"),
      supabase.from("uni_degree_classes").select("name, min_cgpa"),
    ]);
    const rows = (data as unknown as S[]) ?? [];
    setList(rows); setProgs((p as Prog[]) ?? []); setClasses((c as DegreeClass[]) ?? []);
    const entries = await Promise.all(rows.map(async (s) => {
      const { data: g } = await supabase.rpc("uni_semester_gpas", { p_student: s.id });
      const last = (g as GpaRow[] | null)?.at(-1);
      return [s.id, last ? Number(last.cgpa) : null] as const;
    }));
    setCgpa(Object.fromEntries(entries));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = (list ?? []).filter((s) => !q || `${s.matric_no} ${s.profile?.full_name} ${s.profile?.email}`.toLowerCase().includes(q.toLowerCase()));

  async function createOne() {
    if (!add) return;
    setBusy(true); setMsg(null);
    try {
      const out = await adminCall<{ user: { full_name: string; email: string; temp_password: string; matric_no: string } }>({
        action: "create_user", user: { ...add, role: "student" },
      });
      setCreds([{ name: out.user.full_name, email: out.user.email, password: out.user.temp_password, extra: out.user.matric_no }]);
      setAdd(null); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
    setBusy(false);
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("uni_students").update({ programme_id: edit.programme_id, level: edit.level, status: edit.status }).eq("id", edit.id);
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `${edit.name}'s record updated.` }); setEdit(null); load(); }
  }

  async function onFile(file: File) {
    const rows = parseCsv(await file.text());
    if (!rows.length) { setMsg({ kind: "error", text: "That file has no student rows. Use the template: full_name, email, programme, level, matric_no." }); return; }
    const missing = ["full_name", "email", "programme", "level"].filter((h) => !(h in rows[0]));
    if (missing.length) { setMsg({ kind: "error", text: `The file is missing these columns: ${missing.join(", ")}.` }); return; }
    setImporting({ rows, results: null, progress: 0 });
  }

  async function runImport() {
    if (!importing) return;
    setBusy(true);
    const all: ImportResult[] = [];
    for (let i = 0; i < importing.rows.length; i += 50) {
      const chunk = importing.rows.slice(i, i + 50);
      try {
        const out = await adminCall<{ results: ImportResult[] }>({ action: "bulk_create_students", rows: chunk });
        all.push(...out.results.map((r) => ({ ...r, row: r.row + i })));
      } catch (e) {
        all.push(...chunk.map((r, j) => ({ row: i + j + 1, ok: false, email: r.email, full_name: r.full_name, error: errMsg(e) })));
      }
      setImporting((cur) => cur && { ...cur, progress: Math.min(i + 50, cur.rows.length) });
    }
    setImporting((cur) => cur && { ...cur, results: all });
    setBusy(false);
    load();
  }

  async function reset(s: S) {
    if (!confirm(`Reset the password for ${s.profile?.full_name}?`)) return;
    try {
      const out = await adminCall<{ temp_password: string }>({ action: "reset_password", user_id: s.id });
      setCreds([{ name: s.profile?.full_name ?? "", email: s.profile?.email ?? "", password: out.temp_password, extra: s.matric_no }]); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
  }

  async function toggleActive(s: S) {
    const active = s.profile?.is_active;
    if (!confirm(active ? `Deactivate ${s.profile?.full_name}'s account? They will not be able to sign in.` : `Reactivate ${s.profile?.full_name}'s account?`)) return;
    try {
      await adminCall({ action: "set_active", user_id: s.id, active: !active });
      setMsg({ kind: "success", text: `Account ${active ? "deactivated" : "reactivated"}.` }); load();
    } catch (e) { setMsg({ kind: "error", text: errMsg(e) }); }
  }

  const succeeded = importing?.results?.filter((r) => r.ok) ?? [];
  const failed = importing?.results?.filter((r) => !r.ok) ?? [];

  return (
    <>
      <PageHead title="Students" sub={`${list?.length ?? 0} students on record`}
        right={<div className="flex flex-wrap gap-2">
          <input className="input w-60" placeholder="Search name, email or matric no." value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="cursor-pointer rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium text-ink-2 hover:bg-mute">
            Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </label>
          <Button onClick={() => setAdd({ full_name: "", email: "", programme_id: progs[0]?.id ?? "", level: 100, matric_no: "" })} disabled={!progs.length}>Add student</Button>
        </div>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {creds && <div className="mb-5"><Credentials items={creds} /><button className="mt-2 text-xs text-ink-3 hover:underline" onClick={() => setCreds(null)}>I have saved these, hide</button></div>}

      <Card>
        {!list ? <p className="text-sm text-ink-3">Loading…</p> : (
          <Table head={["Matric no.", "Name", "Programme", "Level", "This semester", "CGPA", "Standing", ""]}>
            {shown.map((s) => {
              const cur = s.regs.find((r) => r.semester?.is_current);
              const c = cgpa[s.id];
              return (
                <tr key={s.id} className={s.profile?.is_active ? "" : "opacity-60"}>
                  <td className={`${td} font-mono text-xs`}>{s.matric_no}</td>
                  <td className={td}>{s.profile?.full_name}<div className="text-xs text-ink-3">{s.profile?.email}</div></td>
                  <td className={td}>{s.programme?.award} {s.programme?.name}</td>
                  <td className={`${td} tabular-nums`}>{s.level}</td>
                  <td className={td}>
                    {!s.profile?.is_active ? <Pill tone="bad">Account off</Pill>
                      : s.status !== "active" ? <Pill>{s.status[0].toUpperCase() + s.status.slice(1)}</Pill>
                      : s.profile?.must_change_password ? <Pill tone="warn">Awaiting first sign-in</Pill>
                      : !cur ? <Pill tone="warn">Not registered</Pill> : cur.status === "approved" ? <Pill tone="good">Registered</Pill> : cur.status === "submitted" ? <Pill tone="info">Awaiting HOD</Pill> : <Pill tone="bad">Returned</Pill>}
                  </td>
                  <td className={`${td} tabular-nums font-medium`}>{c === undefined ? "…" : c === null ? "—" : c.toFixed(2)}</td>
                  <td className={td}>{c ? <span className="text-sm">{degreeClass(c, classes)}</span> : <span className="text-xs text-ink-3">No results yet</span>}</td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <a className="mr-3 text-xs text-brand hover:underline" href={`/print/transcript/${s.id}`}>Transcript</a>
                    <a className="mr-3 text-xs text-brand hover:underline" href={`/print/course-form/${s.id}`}>Course form</a>
                    <button className="mr-3 text-xs text-brand hover:underline" onClick={() => setEdit({ id: s.id, name: s.profile?.full_name ?? "", programme_id: s.programme_id, level: s.level, status: s.status })}>Edit</button>
                    <button className="mr-3 text-xs text-brand hover:underline" onClick={() => reset(s)}>Reset password</button>
                    <button className={`text-xs hover:underline ${s.profile?.is_active ? "text-bad" : "text-good"}`} onClick={() => toggleActive(s)}>{s.profile?.is_active ? "Deactivate" : "Reactivate"}</button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {add && (
        <Modal title="Add student" onClose={() => setAdd(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createOne(); }}>
            <Field label="Full name"><input className="input w-full" autoFocus value={add.full_name} onChange={(e) => setAdd({ ...add, full_name: e.target.value })} placeholder="Amaka Obi" /></Field>
            <Field label="Email" hint="The student signs in with this email."><input className="input w-full" type="email" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Field label="Programme">
                <select className="input w-full" value={add.programme_id} onChange={(e) => setAdd({ ...add, programme_id: e.target.value })}>
                  {progs.map((p) => <option key={p.id} value={p.id}>{p.award} {p.name}</option>)}
                </select>
              </Field></div>
              <Field label="Level">
                <select className="input w-full" value={add.level} onChange={(e) => setAdd({ ...add, level: Number(e.target.value) })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Matric number (optional)" hint="Leave blank to generate one automatically, e.g. UDU/CSC/26/0004.">
              <input className="input w-full uppercase" value={add.matric_no} onChange={(e) => setAdd({ ...add, matric_no: e.target.value })} />
            </Field>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy || !add.full_name.trim() || !/\S+@\S+\.\S+/.test(add.email) || !add.programme_id}>{busy ? "Creating…" : "Create student"}</Button>
              <Button variant="secondary" onClick={() => setAdd(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {edit && (
        <Modal title={`Edit ${edit.name}`} onClose={() => setEdit(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
            <Field label="Programme">
              <select className="input w-full" value={edit.programme_id} onChange={(e) => setEdit({ ...edit, programme_id: e.target.value })}>
                {progs.map((p) => <option key={p.id} value={p.id}>{p.award} {p.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Level">
                <select className="input w-full" value={edit.level} onChange={(e) => setEdit({ ...edit, level: Number(e.target.value) })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="input w-full" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}

      {importing && (
        <Modal wide title="Import students from CSV" onClose={() => !busy && setImporting(null)}>
          {!importing.results ? (
            <>
              <p className="text-sm text-ink-2">{importing.rows.length} student{importing.rows.length === 1 ? "" : "s"} found. Each gets an account and a temporary password. Blank matric numbers are generated automatically.</p>
              <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-mute text-left"><tr>{["#", "Name", "Email", "Programme", "Level", "Matric no."].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {importing.rows.slice(0, 200).map((r, i) => {
                      const progOk = progs.some((p) => p.name.toLowerCase() === (r.programme ?? "").trim().toLowerCase());
                      return (
                        <tr key={i}>
                          <td className="px-3 py-1 text-ink-3">{i + 1}</td>
                          <td className="px-3 py-1">{r.full_name}</td>
                          <td className="px-3 py-1">{r.email}</td>
                          <td className={`px-3 py-1 ${progOk ? "" : "text-bad font-medium"}`}>{r.programme}{!progOk && " (unknown)"}</td>
                          <td className="px-3 py-1">{r.level}</td>
                          <td className="px-3 py-1 font-mono">{r.matric_no || <span className="text-ink-3">auto</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {importing.rows.length > 200 && <p className="mt-2 text-xs text-ink-3">Showing the first 200 rows.</p>}
              <p className="mt-2 text-xs text-ink-3">Programme names must match exactly: {progs.map((p) => p.name).join(", ")}.</p>
              <div className="mt-4 flex items-center gap-3">
                <Button onClick={runImport} disabled={busy}>{busy ? `Importing… ${importing.progress}/${importing.rows.length}` : `Import ${importing.rows.length} students`}</Button>
                <Button variant="secondary" onClick={() => setImporting(null)} disabled={busy}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 flex gap-3">
                <Pill tone="good">{succeeded.length} created</Pill>
                {failed.length > 0 && <Pill tone="bad">{failed.length} failed</Pill>}
              </div>
              {succeeded.length > 0 && <Credentials items={succeeded.map((r) => ({ name: r.full_name, email: r.email, password: r.temp_password ?? "", extra: r.matric_no }))} />}
              {succeeded.length > 0 && (
                <button className="mt-2 text-xs text-brand hover:underline"
                  onClick={() => downloadText("student-accounts.csv", "full_name,email,matric_no,temporary_password\n" + succeeded.map((r) => [r.full_name, r.email, r.matric_no, r.temp_password].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"))}>
                  Download sign-in details as CSV
                </button>
              )}
              {failed.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1 text-sm font-medium text-bad">These rows were not imported</div>
                  <ul className="max-h-48 overflow-auto rounded-lg border border-line text-xs divide-y divide-line">
                    {failed.map((r) => <li key={r.row} className="px-3 py-1.5">Row {r.row} · {r.full_name || r.email || "(blank)"}: <span className="text-bad">{r.error}</span></li>)}
                  </ul>
                </div>
              )}
              <div className="mt-4"><Button onClick={() => setImporting(null)}>Done</Button></div>
            </>
          )}
        </Modal>
      )}

      <p className="mt-4 text-xs text-ink-3">
        CSV columns: full_name, email, programme, level, matric_no (optional).{" "}
        <button className="text-brand hover:underline" onClick={() => downloadText("unieducore-students-template.csv", TEMPLATE)}>Download template</button>
      </p>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Students /></Shell>;
}
