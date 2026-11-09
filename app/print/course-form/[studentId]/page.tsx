"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { PrintShell, Letterhead, SignatureLines, Watermark, printedOn } from "@/components/PrintShell";
import { supabase, naira } from "@/lib/supabase";

type Data = {
  student: { matric_no: string; level: number; profile: { full_name: string; email: string } | null; programme: { name: string; award: string; department: { name: string; faculty: { name: string } | null } | null } | null };
  semester: { id: string; name: string; session: { id: string; name: string } | null };
  reg: { status: string; submitted_at: string; decided_at: string | null; decider: { full_name: string } | null; courses: { id: string; is_carryover: boolean; offering: { course: { code: string; title: string; units: number } | null } | null }[] } | null;
  due: number; paid: number;
};

function CourseForm() {
  const { profile } = useAuth();
  const params = useParams<{ studentId: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    const sid = params.studentId === "me" ? profile.id : params.studentId;
    (async () => {
      const [{ data: st }, { data: sem }] = await Promise.all([
        supabase.from("uni_students").select("matric_no, level, profile:uni_profiles(full_name, email), programme:uni_programmes(name, award, department:uni_departments(name, faculty:uni_faculties(name)))").eq("id", sid).maybeSingle(),
        supabase.from("uni_semesters").select("id, name, session:uni_sessions(id, name)").eq("is_current", true).maybeSingle(),
      ]);
      if (!st || !sem) { setErr("Student or current semester not found."); return; }
      const s = sem as unknown as Data["semester"];
      const [{ data: reg }, { data: due }, { data: pays }] = await Promise.all([
        supabase.from("uni_registrations")
          .select("status, submitted_at, decided_at, decider:uni_profiles!uni_registrations_decided_by_fkey(full_name), courses:uni_registration_courses(id, is_carryover, offering:uni_course_offerings(course:uni_courses(code, title, units)))")
          .eq("student_id", sid).eq("semester_id", s.id).maybeSingle(),
        supabase.rpc("uni_fees_due", { p_student: sid, p_session: s.session?.id }),
        supabase.from("uni_payments").select("amount").eq("student_id", sid).eq("session_id", s.session?.id ?? "").eq("status", "successful"),
      ]);
      setD({
        student: st as unknown as Data["student"], semester: s, reg: reg as unknown as Data["reg"],
        due: Number(due ?? 0), paid: (pays ?? []).reduce((a, p) => a + Number(p.amount), 0),
      });
    })();
  }, [profile, params.studentId]);

  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!d) return <p className="text-sm text-ink-3">Loading…</p>;

  const courses = [...(d.reg?.courses ?? [])].sort((a, b) => (a.offering?.course?.code ?? "").localeCompare(b.offering?.course?.code ?? ""));
  const units = courses.reduce((a, c) => a + (c.offering?.course?.units ?? 0), 0);
  const approved = d.reg?.status === "approved";
  const p = d.student.programme;

  return (
    <>
      {!approved && <Watermark text={d.reg ? "Not approved" : "No registration"} />}
      <Letterhead university={profile?.tenant?.name ?? ""} short={profile?.tenant?.short_name} title="Course Registration Form"
        subtitle={`${d.semester.session?.name} Session · ${d.semester.name}`}
        right={<>Printed {printedOn()}</>} />

      <table className="tbl mb-4">
        <tbody>
          <tr><th className="w-36">Name</th><td>{d.student.profile?.full_name}</td><th className="w-32">Matric No.</th><td className="font-mono">{d.student.matric_no}</td></tr>
          <tr><th>Programme</th><td>{p?.award} {p?.name}</td><th>Level</th><td>{d.student.level}</td></tr>
          <tr><th>Department</th><td>{p?.department?.name}</td><th>Faculty</th><td>{p?.department?.faculty?.name}</td></tr>
          <tr><th>Fees ({d.semester.session?.name})</th><td>{naira(d.paid)} paid of {naira(d.due)}{d.paid >= d.due ? " · Cleared" : ` · ${naira(d.due - d.paid)} outstanding`}</td>
            <th>Status</th><td className="font-semibold">{!d.reg ? "Not registered" : approved ? "Approved" : d.reg.status === "submitted" ? "Awaiting HOD approval" : "Returned"}</td></tr>
        </tbody>
      </table>

      <table className="tbl">
        <thead><tr><th className="w-8 c">S/N</th><th className="w-24">Code</th><th>Course title</th><th className="w-16 c">Units</th><th className="w-24">Type</th></tr></thead>
        <tbody>
          {courses.length === 0 && <tr><td colSpan={5} className="c text-ink-3">No courses registered.</td></tr>}
          {courses.map((c, i) => (
            <tr key={c.id}>
              <td className="c">{i + 1}</td>
              <td className="font-medium">{c.offering?.course?.code}</td>
              <td>{c.offering?.course?.title}</td>
              <td className="c">{c.offering?.course?.units}</td>
              <td>{c.is_carryover ? "Carry-over" : "Normal"}</td>
            </tr>
          ))}
          <tr><td colSpan={3} className="num font-semibold">Total credit units</td><td className="c font-semibold">{units}</td><td /></tr>
        </tbody>
      </table>

      {d.reg && (
        <p className="mt-3 text-xs text-ink-2">
          Submitted {new Date(d.reg.submitted_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
          {approved && d.reg.decided_at && <> · Approved online by {d.reg.decider?.full_name ?? "the Head of Department"} on {new Date(d.reg.decided_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</>}
        </p>
      )}

      <SignatureLines roles={["Student", "Level Adviser", "Head of Department"]} />
      <p className="mt-6 text-[10px] text-ink-3">This form is generated by UniEducore. A student may only sit examinations for courses on an approved course form.</p>
    </>
  );
}

export default function Page() {
  return <PrintShell allow={["student", "hod", "registrar", "admin"]} title="Course registration form"><CourseForm /></PrintShell>;
}
