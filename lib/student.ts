"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type StudentInfo = {
  id: string;
  matric_no: string;
  level: number;
  status: string;
  programme: { name: string; award: string; department: { name: string; faculty: { name: string } | null } | null } | null;
};
export type Semester = { id: string; name: string; number: number; registration_open: boolean; session: { id: string; name: string } | null };
export type Registration = { id: string; status: "submitted" | "approved" | "rejected"; submitted_at: string; decided_at: string | null };

export function useStudent(userId: string | undefined) {
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [semester, setSemester] = useState<Semester | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [due, setDue] = useState(0);
  const [paid, setPaid] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [{ data: st }, { data: sem }] = await Promise.all([
      supabase.from("uni_students")
        .select("id, matric_no, level, status, programme:uni_programmes(name, award, department:uni_departments(name, faculty:uni_faculties(name)))")
        .eq("id", userId).single(),
      supabase.from("uni_semesters").select("id, name, number, registration_open, session:uni_sessions(id, name)").eq("is_current", true).maybeSingle(),
    ]);
    setStudent(st as unknown as StudentInfo);
    const s = sem as unknown as Semester | null;
    setSemester(s);
    if (s?.session) {
      const [{ data: reg }, { data: d }, { data: pays }] = await Promise.all([
        supabase.from("uni_registrations").select("id, status, submitted_at, decided_at").eq("student_id", userId).eq("semester_id", s.id).maybeSingle(),
        supabase.rpc("uni_fees_due", { p_student: userId, p_session: s.session.id }),
        supabase.from("uni_payments").select("amount").eq("student_id", userId).eq("session_id", s.session.id).eq("status", "successful"),
      ]);
      setRegistration(reg as Registration | null);
      setDue(Number(d ?? 0));
      setPaid((pays ?? []).reduce((a, p) => a + Number(p.amount), 0));
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);
  return { student, semester, registration, due, paid, loading, reload };
}

export type GpaRow = {
  semester_id: string; session_name: string; semester_name: string; semester_number: number;
  units: number; quality_points: number; gpa: number; cum_units: number; cgpa: number;
};

export type DegreeClass = { name: string; min_cgpa: number };
export function degreeClass(cgpa: number | null | undefined, classes: DegreeClass[]) {
  if (cgpa === null || cgpa === undefined) return null;
  return [...classes].sort((a, b) => b.min_cgpa - a.min_cgpa).find((c) => cgpa >= Number(c.min_cgpa))?.name ?? "Below pass";
}
