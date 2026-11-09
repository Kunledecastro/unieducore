"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Table, td, Empty, Pill, Stat } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { degreeClass, type GpaRow, type DegreeClass } from "@/lib/student";

type Row = { registration_course_id: string; semester_id: string; code: string; title: string; units: number; is_carryover: boolean; ca: number; exam: number; total: number; grade: string; points: number };

function Results() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [gpas, setGpas] = useState<GpaRow[]>([]);
  const [classes, setClasses] = useState<DegreeClass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    Promise.all([
      supabase.from("uni_v_results").select("registration_course_id, semester_id, code, title, units, is_carryover, ca, exam, total, grade, points")
        .eq("student_id", profile.id).eq("result_status", "released").order("code"),
      supabase.rpc("uni_semester_gpas", { p_student: profile.id }),
      supabase.from("uni_degree_classes").select("name, min_cgpa"),
    ]).then(([r, g, c]) => {
      setRows((r.data as Row[]) ?? []);
      setGpas(((g.data as GpaRow[]) ?? []).slice().reverse());
      setClasses((c.data as DegreeClass[]) ?? []);
      setLoading(false);
    });
  }, [profile]);

  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;
  const latest = gpas[0];

  return (
    <>
      <PageHead title="Results" sub="Only results approved by Senate and released by the Registry appear here."
        right={gpas.length > 0 && <Link href="/print/transcript/me" className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium text-ink-2 hover:bg-mute">Print statement of results</Link>} />
      {latest && (
        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <Stat label="CGPA" value={Number(latest.cgpa).toFixed(2)} note="5-point scale" />
          <Stat label="Class of degree (current)" value={<span className="text-lg">{degreeClass(latest.cgpa, classes)}</span>} />
          <Stat label="Total units" value={latest.cum_units} note={`Across ${gpas.length} semester${gpas.length === 1 ? "" : "s"}`} />
        </div>
      )}
      {gpas.length === 0 && <Empty>No released results yet.</Empty>}
      <div className="space-y-4">
        {gpas.map((g) => (
          <Card key={g.semester_id} title={`${g.session_name} · ${g.semester_name}`}
            right={<span className="text-sm text-ink-2">GPA <b className="tabular-nums">{Number(g.gpa).toFixed(2)}</b> · CGPA <b className="tabular-nums">{Number(g.cgpa).toFixed(2)}</b></span>}>
            <Table head={["Code", "Title", "Units", "CA", "Exam", "Total", "Grade", "Points"]}>
              {rows.filter((r) => r.semester_id === g.semester_id).map((r) => (
                <tr key={r.registration_course_id}>
                  <td className={`${td} font-medium`}>{r.code}{r.is_carryover && <span className="ml-2"><Pill tone="bad">Carry-over</Pill></span>}</td>
                  <td className={td}>{r.title}</td>
                  <td className={`${td} tabular-nums`}>{r.units}</td>
                  <td className={`${td} tabular-nums`}>{Number(r.ca)}</td>
                  <td className={`${td} tabular-nums`}>{Number(r.exam)}</td>
                  <td className={`${td} tabular-nums font-medium`}>{Number(r.total)}</td>
                  <td className={td}><Pill tone={r.points === 0 ? "bad" : r.points >= 4 ? "good" : "mute"}>{r.grade}</Pill></td>
                  <td className={`${td} tabular-nums`}>{Number(r.points) * r.units}</td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-ink-3">{g.units} units · {Number(g.quality_points)} quality points</p>
          </Card>
        ))}
      </div>
    </>
  );
}

export default function Page() {
  return <Shell allow={["student"]}><Results /></Shell>;
}
