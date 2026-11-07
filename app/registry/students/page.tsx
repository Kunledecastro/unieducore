"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Pill } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { degreeClass, type DegreeClass, type GpaRow } from "@/lib/student";

type S = {
  id: string; matric_no: string; level: number; status: string;
  profile: { full_name: string; email: string } | null;
  programme: { name: string; award: string; department: { code: string } | null } | null;
  regs: { status: string; semester: { is_current: boolean } | null }[];
};

function Students() {
  const [list, setList] = useState<S[] | null>(null);
  const [cgpa, setCgpa] = useState<Record<string, number | null>>({});
  const [classes, setClasses] = useState<DegreeClass[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase.from("uni_students")
      .select("id, matric_no, level, status, profile:uni_profiles(full_name, email), programme:uni_programmes(name, award, department:uni_departments(code)), regs:uni_registrations(status, semester:uni_semesters(is_current))")
      .order("matric_no")
      .then(async ({ data }) => {
        const rows = (data as unknown as S[]) ?? [];
        setList(rows);
        const entries = await Promise.all(rows.map(async (s) => {
          const { data: g } = await supabase.rpc("uni_semester_gpas", { p_student: s.id });
          const last = (g as GpaRow[] | null)?.at(-1);
          return [s.id, last ? Number(last.cgpa) : null] as const;
        }));
        setCgpa(Object.fromEntries(entries));
      });
    supabase.from("uni_degree_classes").select("name, min_cgpa").then(({ data }) => setClasses((data as DegreeClass[]) ?? []));
  }, []);

  const shown = (list ?? []).filter((s) => !q || `${s.matric_no} ${s.profile?.full_name}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="Students" sub={`${list?.length ?? 0} students on record`}
        right={<input className="input w-64" placeholder="Search name or matric number" value={q} onChange={(e) => setQ(e.target.value)} />} />
      <Card>
        {!list ? <p className="text-sm text-ink-3">Loading…</p> : (
          <Table head={["Matric no.", "Name", "Programme", "Level", "This semester", "CGPA", "Standing"]}>
            {shown.map((s) => {
              const cur = s.regs.find((r) => r.semester?.is_current);
              const c = cgpa[s.id];
              return (
                <tr key={s.id}>
                  <td className={`${td} font-mono text-xs`}>{s.matric_no}</td>
                  <td className={td}>{s.profile?.full_name}<div className="text-xs text-ink-3">{s.profile?.email}</div></td>
                  <td className={td}>{s.programme?.award} {s.programme?.name}</td>
                  <td className={`${td} tabular-nums`}>{s.level}</td>
                  <td className={td}>{!cur ? <Pill tone="warn">Not registered</Pill> : cur.status === "approved" ? <Pill tone="good">Registered</Pill> : cur.status === "submitted" ? <Pill tone="info">Awaiting HOD</Pill> : <Pill tone="bad">Returned</Pill>}</td>
                  <td className={`${td} tabular-nums font-medium`}>{c === undefined ? "…" : c === null ? "—" : c.toFixed(2)}</td>
                  <td className={td}>{c ? <span className="text-sm">{degreeClass(c, classes)}</span> : <span className="text-xs text-ink-3">No results yet</span>}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Students /></Shell>;
}
