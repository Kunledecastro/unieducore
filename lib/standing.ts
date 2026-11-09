"use client";

export type Standing = {
  student_id: string; matric_no: string; full_name: string; programme_id: string; programme: string; department_id: string;
  level: number; status: string; final_level: number; cgpa: number | null; earned_units: number; min_units: number | null;
  standing: "good" | "probation" | "withdrawal" | "no_results" | "graduated"; probation_semesters: number;
  outstanding: string[]; missing_compulsory: string[]; eligible: boolean; reasons: string[]; degree_class: string | null; graduated_at: string | null;
};

export const standingLabel: Record<Standing["standing"], string> = {
  good: "Good standing", probation: "On probation", withdrawal: "Withdrawal recommended", no_results: "No results yet", graduated: "Graduated",
};

export const standingTone: Record<Standing["standing"], "good" | "warn" | "bad" | "mute" | "brand"> = {
  good: "good", probation: "warn", withdrawal: "bad", no_results: "mute", graduated: "brand",
};
