import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export type Role = "admin" | "registrar" | "hod" | "lecturer" | "student" | "bursar";
export type ResultStatus = "draft" | "submitted" | "hod_approved" | "senate_approved" | "released";

export type Profile = {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  role: Role;
  department_id: string | null;
  tenant?: { name: string; short_name: string } | null;
  department?: { name: string; code: string } | null;
};

export type GradeBand = { grade: string; min_score: number; points: number };

export function gradeFor(total: number | null | undefined, bands: GradeBand[]) {
  if (total === null || total === undefined) return null;
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score);
  return sorted.find((b) => total >= Number(b.min_score)) ?? null;
}

export const naira = (n: number | string | null | undefined) =>
  "₦" + Number(n ?? 0).toLocaleString("en-NG", { maximumFractionDigits: 0 });

export const statusLabel: Record<ResultStatus, string> = {
  draft: "Draft",
  submitted: "Awaiting HOD",
  hod_approved: "Awaiting Senate",
  senate_approved: "Approved, not released",
  released: "Released",
};

export const roleHome: Record<Role, string> = {
  student: "/student",
  lecturer: "/lecturer",
  hod: "/hod",
  registrar: "/registry",
  admin: "/registry",
  bursar: "/bursary",
};

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return String(e);
}
