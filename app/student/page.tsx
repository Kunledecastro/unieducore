"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Stat, Pill, Button, Notice } from "@/components/ui";
import { standingLabel, type Standing } from "@/lib/standing";
import { FeesCard } from "@/components/FeesCard";
import { supabase, naira } from "@/lib/supabase";
import { useStudent, degreeClass, type GpaRow, type DegreeClass } from "@/lib/student";

function Overview() {
  const { profile } = useAuth();
  const { student, semester, registration, due, paid, loading, reload } = useStudent(profile?.id);
  const [gpas, setGpas] = useState<GpaRow[]>([]);
  const [classes, setClasses] = useState<DegreeClass[]>([]);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [probation, setProbation] = useState(1);

  useEffect(() => {
    if (!profile) return;
    supabase.rpc("uni_academic_standing", { p_student: profile.id }).then(({ data }) => setStanding(((data as Standing[]) ?? [])[0] ?? null));
    supabase.from("uni_settings").select("probation_cgpa").single().then(({ data }) => data && setProbation(Number(data.probation_cgpa)));
    supabase.rpc("uni_semester_gpas", { p_student: profile.id }).then(({ data }) => setGpas((data as GpaRow[]) ?? []));
    supabase.from("uni_degree_classes").select("name, min_cgpa").then(({ data }) => setClasses((data as DegreeClass[]) ?? []));
  }, [profile]);

  if (loading || !student) return <p className="text-sm text-ink-3">Loading…</p>;

  const latest = gpas.at(-1);
  const outstanding = Math.max(0, due - paid);

  const regPill = !registration ? <Pill tone="warn">Not registered</Pill>
    : registration.status === "approved" ? <Pill tone="good">Approved</Pill>
    : registration.status === "submitted" ? <Pill tone="info">Awaiting HOD approval</Pill>
    : <Pill tone="bad">Returned, please resubmit</Pill>;

  return (
    <>
      <PageHead title={`Welcome, ${profile?.full_name.split(" ")[0]}`}
        sub={`${student.matric_no} · ${student.programme?.award} ${student.programme?.name} · ${student.level} Level`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="CGPA" value={latest ? Number(latest.cgpa).toFixed(2) : "—"} note={latest ? degreeClass(latest.cgpa, classes) : "No released results yet"} />
        <Stat label="Academic standing" value={<span className="text-lg">{standing ? standingLabel[standing.standing] : "—"}</span>}
          tone={standing?.standing === "withdrawal" ? "bad" : standing?.standing === "probation" ? "warn" : standing?.standing === "good" ? "good" : undefined}
          note={latest ? `Last GPA ${Number(latest.gpa).toFixed(2)} · ${latest.session_name}, ${latest.semester_name}` : undefined} />
        <Stat label="Units earned" value={standing?.earned_units ?? 0} note="Units passed in released results" />
        <Stat label="Fees outstanding" value={naira(outstanding)} tone={outstanding > 0 ? "bad" : "good"} note={`${semester?.session?.name} session`} />
      </div>

      {standing && (standing.standing === "probation" || standing.standing === "withdrawal") && (
        <Notice kind="error">
          {standing.standing === "probation"
            ? `Your CGPA is below ${probation.toFixed(2)}, so you are on academic probation. Speak to your level adviser about a plan to raise it.`
            : `Your CGPA has been below ${probation.toFixed(2)} for ${standing.probation_semesters} semesters in a row. Your department may recommend withdrawal. Please see your level adviser and Head of Department.`}
        </Notice>
      )}
      {standing && standing.outstanding.length > 0 && (
        <Notice kind="info">Courses you failed and must pass before graduating: <b>{standing.outstanding.join(", ")}</b>. They are added to your course form automatically as carry-overs when offered.</Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Course registration · ${semester?.session?.name} ${semester?.name}`} right={regPill}>
          <p className="text-sm text-ink-2">
            {!registration && (semester?.registration_open
              ? "Registration is open. Pay your fees, then select your courses."
              : "Registration is closed for this semester.")}
            {registration?.status === "submitted" && "Your course form has been submitted and is waiting for your Head of Department."}
            {registration?.status === "approved" && "Your course registration is approved. Your lecturers can now record your scores."}
            {registration?.status === "rejected" && "Your HOD returned your course form. Review your courses and submit again."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/student/registration"><Button variant="secondary">Open course registration</Button></Link>
            {registration && <Link href="/print/course-form/me"><Button variant="secondary">Print course form</Button></Link>}
          </div>
        </Card>

        <FeesCard studentId={student.id} sessionId={semester?.session?.id} sessionName={semester?.session?.name} due={due} paid={paid} onChange={reload} />
      </div>
    </>
  );
}

export default function Page() {
  return <Shell allow={["student"]}><Overview /></Shell>;
}
