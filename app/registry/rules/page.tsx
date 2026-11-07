"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Button, Notice, Field } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";

type Settings = { min_units: number; max_units: number; ca_max: number; exam_max: number; probation_cgpa: number; require_fees_for_registration: boolean };
type Band = { id?: string; grade: string; min_score: number; points: number };
type Cls = { id?: string; name: string; min_cgpa: number };

function Rules() {
  const { profile } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [bands, setBands] = useState<Band[]>([]);
  const [classes, setClasses] = useState<Cls[]>([]);
  const [orig, setOrig] = useState<{ bands: string[]; classes: string[] }>({ bands: [], classes: [] });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [st, b, c] = await Promise.all([
      supabase.from("uni_settings").select("min_units, max_units, ca_max, exam_max, probation_cgpa, require_fees_for_registration").single(),
      supabase.from("uni_grade_bands").select("id, grade, min_score, points").order("min_score", { ascending: false }),
      supabase.from("uni_degree_classes").select("id, name, min_cgpa").order("min_cgpa", { ascending: false }),
    ]);
    if (st.data) setS({ ...st.data, ca_max: Number(st.data.ca_max), exam_max: Number(st.data.exam_max), probation_cgpa: Number(st.data.probation_cgpa) });
    const bl = ((b.data as Band[]) ?? []).map((x) => ({ ...x, min_score: Number(x.min_score), points: Number(x.points) }));
    const cl = ((c.data as Cls[]) ?? []).map((x) => ({ ...x, min_cgpa: Number(x.min_cgpa) }));
    setBands(bl); setClasses(cl);
    setOrig({ bands: bl.map((x) => x.id!), classes: cl.map((x) => x.id!) });
  }, []);
  useEffect(() => { load(); }, [load]);

  const settingsErr = !s ? null
    : s.min_units > s.max_units ? "Minimum units cannot be more than the maximum."
    : s.ca_max + s.exam_max !== 100 ? `CA and exam must add up to 100 (now ${s.ca_max + s.exam_max}).` : null;

  const bandErr = (() => {
    if (bands.length === 0) return "Add at least one grade.";
    if (bands.some((b) => !b.grade.trim())) return "Every band needs a grade letter.";
    if (new Set(bands.map((b) => b.grade.trim().toUpperCase())).size !== bands.length) return "Grade letters must be unique.";
    if (new Set(bands.map((b) => b.min_score)).size !== bands.length) return "Two bands cannot start at the same score.";
    if (!bands.some((b) => b.min_score === 0)) return "One band must start at 0 so every score gets a grade.";
    return null;
  })();
  const clsErr = classes.some((c) => !c.name.trim()) ? "Every class needs a name."
    : new Set(classes.map((c) => c.min_cgpa)).size !== classes.length ? "Two classes cannot share the same minimum CGPA." : null;

  async function saveSettings() {
    if (!s || !profile) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("uni_settings").update(s).eq("tenant_id", profile.tenant_id);
    setBusy(false);
    setMsg(error ? { kind: "error", text: errMsg(error) } : { kind: "success", text: "Registration and scoring rules saved." });
  }

  async function saveList<T extends { id?: string }>(table: string, items: T[], origIds: string[], label: string) {
    if (!profile) return;
    setBusy(true); setMsg(null);
    const keep = new Set(items.filter((i) => i.id).map((i) => i.id));
    const removed = origIds.filter((id) => !keep.has(id));
    let error = null;
    if (removed.length) ({ error } = await supabase.from(table).delete().in("id", removed));
    // Update existing first, then insert new rows (avoids unique-key clashes when letters are swapped)
    for (const i of items.filter((x) => x.id)) {
      if (error) break;
      const { id, ...rest } = i;
      ({ error } = await supabase.from(table).update(rest).eq("id", id!));
    }
    const fresh = items.filter((x) => !x.id).map(({ id: _id, ...rest }) => ({ ...rest, tenant_id: profile.tenant_id }));
    if (!error && fresh.length) ({ error } = await supabase.from(table).insert(fresh));
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `${label} saved.` }); load(); }
  }

  if (!s) return <p className="text-sm text-ink-3">Loading…</p>;
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <>
      <PageHead title="Rules" sub="Each university's academic regulations, set here rather than in code." />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <Card title="Registration and scoring" className="mb-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum credit units per semester"><input className="input w-full" type="number" min={0} value={s.min_units} onChange={(e) => setS({ ...s, min_units: num(e.target.value) })} /></Field>
          <Field label="Maximum credit units per semester"><input className="input w-full" type="number" min={1} value={s.max_units} onChange={(e) => setS({ ...s, max_units: num(e.target.value) })} /></Field>
          <Field label="Probation below CGPA"><input className="input w-full" type="number" step="0.01" min={0} max={5} value={s.probation_cgpa} onChange={(e) => setS({ ...s, probation_cgpa: num(e.target.value) })} /></Field>
          <Field label="Continuous assessment (CA) out of"><input className="input w-full" type="number" min={0} max={100} value={s.ca_max} onChange={(e) => setS({ ...s, ca_max: num(e.target.value) })} /></Field>
          <Field label="Examination out of"><input className="input w-full" type="number" min={0} max={100} value={s.exam_max} onChange={(e) => setS({ ...s, exam_max: num(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="accent-brand h-4 w-4" checked={s.require_fees_for_registration} onChange={(e) => setS({ ...s, require_fees_for_registration: e.target.checked })} />
            Students must pay fees before registering courses
          </label>
        </div>
        {settingsErr && <p className="mt-3 text-sm text-bad">{settingsErr}</p>}
        <div className="mt-4"><Button onClick={saveSettings} disabled={busy || !!settingsErr}>Save rules</Button></div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Grading scale" right={<span className="text-xs text-ink-3">Total score → grade → grade points</span>}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-3"><th className="pb-2 font-medium">Grade</th><th className="pb-2 font-medium">From score</th><th className="pb-2 font-medium">Points</th><th /></tr></thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={b.id ?? `n${i}`}>
                  <td className="py-1 pr-2"><input className="input w-16 uppercase" maxLength={2} value={b.grade} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, grade: e.target.value.toUpperCase() } : x))} /></td>
                  <td className="py-1 pr-2"><input className="input w-20" type="number" min={0} max={100} value={b.min_score} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, min_score: num(e.target.value) } : x))} /></td>
                  <td className="py-1 pr-2"><input className="input w-20" type="number" step="0.5" min={0} max={10} value={b.points} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, points: num(e.target.value) } : x))} /></td>
                  <td className="py-1 text-right"><button className="text-xs text-bad hover:underline" onClick={() => setBands(bands.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setBands([...bands, { grade: "", min_score: 0, points: 0 }])}>+ Add grade</button>
          {bandErr && <p className="mt-3 text-sm text-bad">{bandErr}</p>}
          <p className="mt-3 text-xs text-warn">Changing the scale regrades every result, including results already released. Set it before the first results cycle.</p>
          <div className="mt-3"><Button onClick={() => confirm("This regrades every result, including released results and students' CGPA. Continue?") && saveList("uni_grade_bands", bands.map((b) => ({ ...b, grade: b.grade.trim().toUpperCase() })), orig.bands, "Grading scale")} disabled={busy || !!bandErr}>Save grading scale</Button></div>
        </Card>

        <Card title="Class of degree" right={<span className="text-xs text-ink-3">Final CGPA → class</span>}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-ink-3"><th className="pb-2 font-medium">Class</th><th className="pb-2 font-medium">From CGPA</th><th /></tr></thead>
            <tbody>
              {classes.map((c, i) => (
                <tr key={c.id ?? `n${i}`}>
                  <td className="py-1 pr-2"><input className="input w-full" value={c.name} onChange={(e) => setClasses(classes.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></td>
                  <td className="py-1 pr-2"><input className="input w-24" type="number" step="0.01" min={0} max={5} value={c.min_cgpa} onChange={(e) => setClasses(classes.map((x, j) => j === i ? { ...x, min_cgpa: num(e.target.value) } : x))} /></td>
                  <td className="py-1 text-right"><button className="text-xs text-bad hover:underline" onClick={() => setClasses(classes.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="mt-2 text-sm text-brand hover:underline" onClick={() => setClasses([...classes, { name: "", min_cgpa: 0 }])}>+ Add class</button>
          {clsErr && <p className="mt-3 text-sm text-bad">{clsErr}</p>}
          <div className="mt-4"><Button onClick={() => saveList("uni_degree_classes", classes.map((c) => ({ ...c, name: c.name.trim() })), orig.classes, "Degree classes")} disabled={busy || !!clsErr}>Save degree classes</Button></div>
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Rules /></Shell>;
}
