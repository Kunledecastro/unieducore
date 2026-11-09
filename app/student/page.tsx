"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Stat, Pill, Button } from "@/components/ui";
import { FeesCard } from "@/components/FeesCard";
import { supabase, naira } from "@/lib/supabase";
import { useStudent, degreeClass, type GpaRow, type DegreeClass } from "@/lib/student";

function Overview() {
  const { profile } = useAuth();
  const { student, semester, registration, due, paid, loading, reload } = useStudent(profile?.id);
  const [gpas, setGpas] = useState<GpaRow[]>([]);
  const [classes, setClasses] = useState<DegreeClass[]>([]);

  useEffect(() => {
    if (!profile) return;
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
        <Stat label="Last semester GPA" value={latest ? Number(latest.gpa).toFixed(2) : "—"} note={latest ? `${latest.session_name}, ${latest.semester_name}` : undefined} />
        <Stat label="Units earned" value={latest ? latest.cum_units : 0} note="Credit units with released results" />
        <Stat label="Fees outstanding" value={naira(outstanding)} tone={outstanding > 0 ? "bad" : "good"} note={`${semester?.session?.name} session`} />
      </div>

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
