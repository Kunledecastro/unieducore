"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { PrintShell, Letterhead, SignatureLines, Watermark, printedOn } from "@/components/PrintShell";
import { supabase, gradeFor, statusLabel, type GradeBand, type ResultStatus } from "@/lib/supabase";
import { scoreSheet, type SheetRow } from "@/lib/staff";
import { gradeDistribution } from "@/lib/docs";

type Off = {
  result_status: ResultStatus; submitted_at: string | null; hod_approved_at: string | null; senate_approved_at: string | null; released_at: string | null;
  course: { code: string; title: string; units: number; level: number; department: { name: string; faculty: { name: string } | null } | null } | null;
  lecturer: { full_name: string } | null;
  semester: { name: string; session: { name: string } | null } | null;
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—";

function ResultSheet() {
  const { profile } = useAuth();
  const { offeringId } = useParams<{ offeringId: string }>();
  const [off, setOff] = useState<Off | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [bands, setBands] = useState<GradeBand[]>([]);
  const [limits, setLimits] = useState({ ca_max: 30, exam_max: 70 });

  useEffect(() => {
    if (!profile) return;
    Promise.all([
      supabase.from("uni_course_offerings")
        .select("result_status, submitted_at, hod_approved_at, senate_approved_at, released_at, course:uni_courses(code, title, units, level, department:uni_departments(name, faculty:uni_faculties(name))), lecturer:uni_profiles!uni_course_offerings_lecturer_id_fkey(full_name), semester:uni_semesters(name, session:uni_sessions(name))")
        .eq("id", offeringId).single(),
      scoreSheet(offeringId),
      supabase.from("uni_grade_bands").select("grade, min_score, points"),
      supabase.from("uni_settings").select("ca_max, exam_max").single(),
    ]).then(([o, s, b, st]) => {
      setOff(o.data as unknown as Off); setRows(s); setBands((b.data as GradeBand[]) ?? []);
      if (st.data) setLimits({ ca_max: Number(st.data.ca_max), exam_max: Number(st.data.exam_max) });
    });
  }, [profile, offeringId]);

  if (!off) return <p className="text-sm text-ink-3">Loading…</p>;
  const totals = rows.map((r) => (r.score?.ca != null && r.score?.exam != null ? Number(r.score.ca) + Number(r.score.exam) : null));
  const scored = totals.filter((t): t is number => t !== null);
  const { order, dist } = gradeDistribution(totals, bands);
  const passes = rows.filter((_, i) => { const g = gradeFor(totals[i], bands); return g && g.points > 0; }).length;
  const final = off.result_status === "senate_approved" || off.result_status === "released";

  return (
    <>
      {!final && <Watermark text="Provisional" />}
      <Letterhead university={profile?.tenant?.name ?? ""} short={profile?.tenant?.short_name} title="Course Result Sheet"
        subtitle={`${off.semester?.session?.name} Session · ${off.semester?.name}`} right={<>Printed {printedOn()}</>} />

      <table className="tbl mb-4">
        <tbody>
          <tr><th className="w-32">Course</th><td><b>{off.course?.code}</b> · {off.course?.title}</td><th className="w-28">Units / Level</th><td>{off.course?.units} units · {off.course?.level}L</td></tr>
          <tr><th>Department</th><td>{off.course?.department?.name}</td><th>Faculty</th><td>{off.course?.department?.faculty?.name}</td></tr>
          <tr><th>Course lecturer</th><td>{off.lecturer?.full_name ?? "—"}</td><th>Status</th><td className="font-semibold">{statusLabel[off.result_status]}</td></tr>
          <tr><th>Approval trail</th><td colSpan={3}>Submitted {fmt(off.submitted_at)} · HOD approved {fmt(off.hod_approved_at)} · Senate approved {fmt(off.senate_approved_at)} · Released {fmt(off.released_at)}</td></tr>
        </tbody>
      </table>

      <table className="tbl">
        <thead>
          <tr><th className="w-8 c">S/N</th><th className="w-36">Matric No.</th><th>Name</th><th className="w-14 c">CA /{limits.ca_max}</th><th className="w-14 c">Exam /{limits.exam_max}</th><th className="w-14 c">Total</th><th className="w-12 c">Grade</th><th className="w-20">Remark</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="c text-ink-3">No registered students.</td></tr>}
          {rows.map((r, i) => {
            const g = gradeFor(totals[i], bands);
            return (
              <tr key={r.id}>
                <td className="c">{i + 1}</td>
                <td className="font-mono">{r.registration?.student?.matric_no}</td>
                <td>{r.registration?.student?.profile?.full_name}</td>
                <td className="c">{r.score?.ca ?? "—"}</td>
                <td className="c">{r.score?.exam ?? "—"}</td>
                <td className="c font-semibold">{totals[i] ?? "—"}</td>
                <td className="c font-semibold">{g?.grade ?? "—"}</td>
                <td>{totals[i] === null ? "Incomplete" : g && g.points > 0 ? (r.is_carryover ? "Pass (C/O)" : "Pass") : "Fail"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 grid grid-cols-2 items-start gap-4 break-inside-avoid">
        <table className="tbl">
          <tbody>
            <tr><th>Students registered</th><td className="num">{rows.length}</td></tr>
            <tr><th>Scores recorded</th><td className="num">{scored.length}</td></tr>
            <tr><th>Passed</th><td className="num">{passes} ({scored.length ? Math.round((passes / scored.length) * 100) : 0}%)</td></tr>
            <tr><th>Average / highest / lowest</th><td className="num">{scored.length ? `${(scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1)} / ${Math.max(...scored)} / ${Math.min(...scored)}` : "—"}</td></tr>
          </tbody>
        </table>
        <table className="tbl">
          <thead><tr>{order.map((g) => <th key={g} className="c">{g}</th>)}</tr></thead>
          <tbody><tr>{order.map((g) => <td key={g} className="c">{dist[g]}</td>)}</tr></tbody>
        </table>
      </div>

      <SignatureLines roles={["Course Lecturer", "Head of Department", "Dean of Faculty"]} />
    </>
  );
}

export default function Page() {
  return <PrintShell allow={["lecturer", "hod", "registrar", "admin"]} title="Course result sheet"><ResultSheet /></PrintShell>;
}
