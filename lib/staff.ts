"use client";

import { supabase, type ResultStatus } from "@/lib/supabase";

export type Offering = {
  id: string;
  result_status: ResultStatus;
  submitted_at: string | null;
  lecturer_id: string | null;
  course: { id: string; code: string; title: string; units: number; level: number; department_id: string; department: { code: string; name: string } | null } | null;
  lecturer: { full_name: string } | null;
  semester: { id: string; name: string; is_current: boolean; session: { name: string } | null } | null;
  regs: { id: string; registration: { status: string } | null }[];
};

export const offeringSelect =
  "id, result_status, submitted_at, lecturer_id, " +
  "course:uni_courses(id, code, title, units, level, department_id, department:uni_departments(code, name)), " +
  "lecturer:uni_profiles!uni_course_offerings_lecturer_id_fkey(full_name), " +
  "semester:uni_semesters!inner(id, name, is_current, session:uni_sessions(name)), " +
  "regs:uni_registration_courses(id, registration:uni_registrations(status))";

export async function currentOfferings() {
  const { data, error } = await supabase.from("uni_course_offerings").select(offeringSelect).eq("semester.is_current", true);
  if (error) throw error;
  return ((data as unknown as Offering[]) ?? []).sort((a, b) => (a.course?.code ?? "").localeCompare(b.course?.code ?? ""));
}

export const approvedCount = (o: Offering) => o.regs.filter((r) => r.registration?.status === "approved").length;

export type SheetRow = {
  id: string;
  is_carryover: boolean;
  registration: { status: string; student: { matric_no: string; level: number; profile: { full_name: string } | null } | null } | null;
  score: { ca: number | null; exam: number | null; total: number | null } | null;
};

export async function scoreSheet(offeringId: string) {
  const { data, error } = await supabase
    .from("uni_registration_courses")
    .select("id, is_carryover, registration:uni_registrations!inner(status, student:uni_students(matric_no, level, profile:uni_profiles(full_name))), score:uni_scores(ca, exam, total)")
    .eq("offering_id", offeringId)
    .eq("registration.status", "approved");
  if (error) throw error;
  return ((data as unknown as SheetRow[]) ?? []).sort((a, b) =>
    (a.registration?.student?.matric_no ?? "").localeCompare(b.registration?.student?.matric_no ?? ""));
}
