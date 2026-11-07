"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Pill, Button, Notice } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";

type Fac = { id: string; name: string; code: string; departments: { id: string; name: string; code: string; programmes: { id: string; name: string; award: string }[]; courses: { id: string }[] }[] };
type Band = { grade: string; min_score: number; points: number };
type Cls = { name: string; min_cgpa: number };
type Sem = { id: string; name: string; is_current: boolean; registration_open: boolean; session: { name: string } | null };
type Settings = { min_units: number; max_units: number; ca_max: number; exam_max: number; probation_cgpa: number; require_fees_for_registration: boolean };

function Setup() {
  const [facs, setFacs] = useState<Fac[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [classes, setClasses] = useState<Cls[]>([]);
  const [sem, setSem] = useState<Sem | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [f, b, c, s, st] = await Promise.all([
      supabase.from("uni_faculties").select("id, name, code, departments:uni_departments(id, name, code, programmes:uni_programmes(id, name, award), courses:uni_courses(id))").order("code"),
      supabase.from("uni_grade_bands").select("grade, min_score, points").order("min_score", { ascending: false }),
      supabase.from("uni_degree_classes").select("name, min_cgpa").order("min_cgpa", { ascending: false }),
      supabase.from("uni_semesters").select("id, name, is_current, registration_open, session:uni_sessions(name)").eq("is_current", true).maybeSingle(),
      supabase.from("uni_settings").select("min_units, max_units, ca_max, exam_max, probation_cgpa, require_fees_for_registration").single(),
    ]);
    setFacs((f.data as unknown as Fac[]) ?? []);
    setBands((b.data as Band[]) ?? []);
    setClasses((c.data as Cls[]) ?? []);
    setSem(s.data as unknown as Sem);
    setSettings(st.data as Settings);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleRegistration() {
    if (!sem) return;
    const { error } = await supabase.from("uni_semesters").update({ registration_open: !sem.registration_open }).eq("id", sem.id);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `Course registration ${sem.registration_open ? "closed" : "opened"}.` }); load(); }
  }

  return (
    <>
      <PageHead title="Academic setup" sub="Each university is configured here rather than in code: structure, grading scale and registration rules." />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Card title="Current semester" className="lg:col-span-1">
          {sem && <>
            <p className="text-sm"><b>{sem.session?.name}</b> · {sem.name}</p>
            <div className="mt-3 flex items-center gap-3">
              {sem.registration_open ? <Pill tone="good">Registration open</Pill> : <Pill>Registration closed</Pill>}
              <Button small variant="secondary" onClick={toggleRegistration}>{sem.registration_open ? "Close registration" : "Open registration"}</Button>
            </div>
          </>}
        </Card>
        <Card title="Registration and scoring rules" className="lg:col-span-2">
          {settings && (
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-ink-3">Credit units per semester</dt><dd className="font-medium">{settings.min_units}–{settings.max_units}</dd></div>
              <div><dt className="text-ink-3">Score split</dt><dd className="font-medium">CA {Number(settings.ca_max)} / Exam {Number(settings.exam_max)}</dd></div>
              <div><dt className="text-ink-3">Probation below CGPA</dt><dd className="font-medium">{Number(settings.probation_cgpa).toFixed(2)}</dd></div>
              <div><dt className="text-ink-3">Fees before registration</dt><dd className="font-medium">{settings.require_fees_for_registration ? "Required" : "Not required"}</dd></div>
            </dl>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Faculties, departments and programmes" className="lg:col-span-2">
          <div className="space-y-4">
            {facs.map((f) => (
              <div key={f.id}>
                <div className="text-sm font-semibold">{f.name} <span className="text-ink-3 font-normal">({f.code})</span></div>
                <ul className="mt-1.5 space-y-1.5 border-l-2 border-line pl-4">
                  {f.departments.map((d) => (
                    <li key={d.id} className="text-sm">
                      <span className="font-medium">{d.name}</span> <span className="text-ink-3">· {d.courses.length} courses</span>
                      {d.programmes.length > 0 && <span className="ml-2 inline-flex flex-wrap gap-1">{d.programmes.map((p) => <Pill key={p.id} tone="brand">{p.award} {p.name}</Pill>)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Grading scale (5-point)">
            <Table head={["Grade", "Min score", "Points"]}>
              {bands.map((b) => <tr key={b.grade}><td className={`${td} font-medium`}>{b.grade}</td><td className={`${td} tabular-nums`}>{Number(b.min_score)}</td><td className={`${td} tabular-nums`}>{Number(b.points)}</td></tr>)}
            </Table>
          </Card>
          <Card title="Class of degree">
            <Table head={["Class", "Min CGPA"]}>
              {classes.map((c) => <tr key={c.name}><td className={td}>{c.name}</td><td className={`${td} tabular-nums`}>{Number(c.min_cgpa).toFixed(2)}</td></tr>)}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Setup /></Shell>;
}
