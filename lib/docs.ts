"use client";

import type { GradeBand } from "@/lib/supabase";

export type ResultRow = {
  registration_course_id: string; student_id: string; semester_id: string; session_name: string; semester_name: string; semester_number: number;
  course_id: string; code: string; title: string; units: number; is_carryover: boolean; result_status: string;
  ca: number | null; exam: number | null; total: number | null; grade: string | null; points: number | null;
};

export const resultCols =
  "registration_course_id, student_id, semester_id, session_name, semester_name, semester_number, course_id, code, title, units, is_carryover, result_status, ca, exam, total, grade, points";

/** Chronological order of semesters: by session name (e.g. 2025/2026) then semester number. */
export const semKey = (r: { session_name: string; semester_number: number }) => `${r.session_name}#${r.semester_number}`;

export type Summary = { tcu: number; tgp: number; gpa: number | null; cumTcu: number; cumTgp: number; cgpa: number | null; outstanding: string[] };

/**
 * GPA for one semester and CGPA up to and including it, for one student's rows.
 * Only graded rows count. A failed course stays "outstanding" until a later pass.
 */
export function summarise(rows: ResultRow[], uptoKey: string): Summary {
  const graded = rows.filter((r) => r.grade !== null && r.points !== null);
  const cur = graded.filter((r) => semKey(r) === uptoKey);
  const cum = graded.filter((r) => semKey(r) <= uptoKey);
  const tcu = cur.reduce((a, r) => a + r.units, 0);
  const tgp = cur.reduce((a, r) => a + r.units * Number(r.points), 0);
  const cumTcu = cum.reduce((a, r) => a + r.units, 0);
  const cumTgp = cum.reduce((a, r) => a + r.units * Number(r.points), 0);
  const best = new Map<string, { code: string; pts: number }>();
  cum.forEach((r) => { const b = best.get(r.course_id); if (!b || Number(r.points) > b.pts) best.set(r.course_id, { code: r.code, pts: Number(r.points) }); });
  const outstanding = [...best.values()].filter((b) => b.pts === 0).map((b) => b.code).sort();
  return {
    tcu, tgp, gpa: tcu ? Math.round((tgp / tcu) * 100) / 100 : null,
    cumTcu, cumTgp, cgpa: cumTcu ? Math.round((cumTgp / cumTcu) * 100) / 100 : null, outstanding,
  };
}

export function remark(s: Summary, probation: number) {
  if (s.cgpa === null) return "—";
  if (s.cgpa < probation) return s.outstanding.length ? `Probation · Repeat ${s.outstanding.join(", ")}` : "Probation";
  return s.outstanding.length ? `Pass · Carry over ${s.outstanding.join(", ")}` : "Pass";
}

export function gradeDistribution(totals: (number | null)[], bands: GradeBand[]) {
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score);
  const dist = Object.fromEntries(sorted.map((b) => [b.grade, 0])) as Record<string, number>;
  totals.forEach((t) => { if (t === null) return; const b = sorted.find((x) => t >= Number(x.min_score)); if (b) dist[b.grade]++; });
  return { order: sorted.map((b) => b.grade), dist };
}
