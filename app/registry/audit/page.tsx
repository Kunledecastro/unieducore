"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Pill, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";

type Log = { id: number; table_name: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; actor: string | null; at: string };

const label: Record<string, string> = {
  uni_scores: "Score", uni_course_offerings: "Course offering", uni_registrations: "Registration", uni_payments: "Payment",
  accounts: "User account", uni_profiles: "Profile", uni_students: "Student record", uni_grade_bands: "Grading scale", uni_courses: "Course",
};
const accountAction: Record<string, string> = {
  CREATE_ACCOUNT: "Account created", RESET_PASSWORD: "Password reset", DEACTIVATE_ACCOUNT: "Account deactivated", REACTIVATE_ACCOUNT: "Account reactivated",
};

function changed(o: Record<string, unknown>, n: Record<string, unknown>, keys: string[]) {
  return keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => `${k.replace(/_/g, " ")}: ${o[k] ?? "—"} → ${n[k] ?? "—"}`).join("; ");
}

function describe(l: Log) {
  const o = l.old_data ?? {}, n = l.new_data ?? {};
  if (l.table_name === "accounts") return `${accountAction[l.action] ?? l.action} · ${n.email ?? ""}${n.role ? ` (${n.role})` : ""}${n.matric_no ? ` · ${n.matric_no}` : ""}`;
  if (l.table_name === "uni_profiles") return l.action === "INSERT" ? `${n.full_name} (${n.role})` : l.action === "DELETE" ? `${o.full_name} removed` : `${n.full_name}: ${changed(o, n, ["full_name", "role", "department_id", "is_active", "must_change_password"]) || "no visible change"}`;
  if (l.table_name === "uni_students") return l.action === "INSERT" ? `${n.matric_no} enrolled at ${n.level}L` : `${n.matric_no ?? o.matric_no}: ${changed(o, n, ["level", "status", "programme_id"]) || "no visible change"}`;
  if (l.table_name === "uni_grade_bands") return l.action === "INSERT" ? `Grade ${n.grade} from ${n.min_score} = ${n.points} pts` : l.action === "DELETE" ? `Grade ${o.grade} removed` : `Grade ${n.grade}: ${changed(o, n, ["grade", "min_score", "points"])}`;
  if (l.table_name === "uni_courses") return l.action === "INSERT" ? `${n.code} ${n.title} added` : l.action === "DELETE" ? `${o.code} deleted` : `${n.code}: ${changed(o, n, ["code", "title", "units", "level", "semester_number", "department_id"])}`;
  if (l.table_name === "uni_course_offerings" && o.result_status === n.result_status) return `Lecturer: ${o.lecturer_id ? "changed" : "assigned"}`;
  if (l.table_name === "uni_scores") {
    if (l.action === "INSERT") return `CA ${n.ca ?? "—"}, Exam ${n.exam ?? "—"}`;
    return `CA ${o.ca ?? "—"} → ${n.ca ?? "—"}, Exam ${o.exam ?? "—"} → ${n.exam ?? "—"}`;
  }
  if (l.table_name === "uni_course_offerings") return `${o.result_status} → ${n.result_status}`;
  if (l.table_name === "uni_registrations") return l.action === "INSERT" ? `Submitted (${n.status})` : `${o.status ?? "—"} → ${n.status ?? "deleted"}`;
  if (l.table_name === "uni_payments") return `₦${Number(n.amount ?? 0).toLocaleString()} · ${n.reference}`;
  return l.action;
}

function Audit() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      supabase.from("uni_audit_log").select("id, table_name, action, old_data, new_data, actor, at").order("at", { ascending: false }).limit(200),
      supabase.from("uni_profiles").select("id, full_name"),
    ]).then(([l, p]) => {
      setLogs((l.data as Log[]) ?? []);
      setNames(Object.fromEntries(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name])));
    });
  }, []);

  return (
    <>
      <PageHead title="Audit trail" sub="Every score change, result decision, registration and payment is recorded with who did it and when. Records cannot be edited." />
      <Card>
        {!logs ? <p className="text-sm text-ink-3">Loading…</p> : logs.length === 0 ? <Empty>No activity recorded yet.</Empty> : (
          <Table head={["When", "Who", "Record", "Action", "Change"]}>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap text-xs text-ink-3`}>{new Date(l.at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className={td}>{l.actor ? names[l.actor] ?? "Unknown user" : <span className="text-ink-3">System</span>}</td>
                <td className={td}>{label[l.table_name] ?? l.table_name}</td>
                <td className={td}><Pill tone={/DELETE|DEACTIVATE/.test(l.action) ? "bad" : /INSERT|CREATE/.test(l.action) ? "good" : "info"}>{(accountAction[l.action] ?? l.action).toLowerCase()}</Pill></td>
                <td className={`${td} text-xs font-mono`}>{describe(l)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Audit /></Shell>;
}
