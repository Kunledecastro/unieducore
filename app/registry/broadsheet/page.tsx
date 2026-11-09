"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Field, Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";

type Sem = { id: string; name: string; number: number; is_current: boolean; session: { name: string } | null };
type Prog = { id: string; name: string; award: string; department_id: string };

const LEVELS = [100, 200, 300, 400, 500, 600, 700];

function BroadsheetPicker() {
  const { profile } = useAuth();
  const [sems, setSems] = useState<Sem[]>([]);
  const [progs, setProgs] = useState<Prog[]>([]);
  const [sel, setSel] = useState({ sem: "", prog: "", level: 100 });

  useEffect(() => {
    if (!profile) return;
    Promise.all([
      supabase.from("uni_semesters").select("id, name, number, is_current, session:uni_sessions(name)"),
      supabase.from("uni_programmes").select("id, name, award, department_id").order("name"),
    ]).then(([s, p]) => {
      const sl = ((s.data as unknown as Sem[]) ?? []).sort((a, b) => `${b.session?.name}${b.number}`.localeCompare(`${a.session?.name}${a.number}`));
      const pl = ((p.data as Prog[]) ?? []).filter((x) => profile.role !== "hod" || x.department_id === profile.department_id);
      setSems(sl); setProgs(pl);
      setSel((cur) => ({ ...cur, sem: sl.find((x) => x.is_current)?.id ?? sl[0]?.id ?? "", prog: pl[0]?.id ?? "" }));
    });
  }, [profile]);

  const back = profile?.role === "hod" ? "/hod" : "/registry";
  return (
    <>
      <PageHead title="Senate broadsheet" sub={<Link href={back} className="text-brand hover:underline">← Back</Link>} />
      <Card title="Choose the class">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Semester">
            <select className="input w-56" value={sel.sem} onChange={(e) => setSel({ ...sel, sem: e.target.value })}>
              {sems.map((s) => <option key={s.id} value={s.id}>{s.session?.name} · {s.name}{s.is_current ? " (current)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Programme">
            <select className="input w-64" value={sel.prog} onChange={(e) => setSel({ ...sel, prog: e.target.value })}>
              {progs.map((p) => <option key={p.id} value={p.id}>{p.award} {p.name}</option>)}
            </select>
          </Field>
          <Field label="Level">
            <select className="input w-28" value={sel.level} onChange={(e) => setSel({ ...sel, level: Number(e.target.value) })}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Link href={sel.sem && sel.prog ? `/print/broadsheet/${sel.sem}/${sel.prog}/${sel.level}` : "#"}><Button disabled={!sel.sem || !sel.prog}>Open broadsheet</Button></Link>
        </div>
        <p className="mt-4 text-xs text-ink-3">
          Shows every student in the class with their score and grade for each course, semester GPA, CGPA and remarks (carry-overs, probation).
          It is marked “Provisional” until every course result in it has Senate approval. Level means the students’ current level.
        </p>
      </Card>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin", "hod"]}><BroadsheetPicker /></Shell>;
}
