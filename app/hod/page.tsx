"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Table, td, Empty, StatusPill, Button, Notice, Pill, Stat } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";
import { currentOfferings, approvedCount, type Offering } from "@/lib/staff";

type Reg = {
  id: string; status: string; submitted_at: string;
  student: { matric_no: string; level: number; programme: { name: string; department_id: string } | null; profile: { full_name: string } | null } | null;
  courses: { id: string; is_carryover: boolean; offering: { course: { code: string; title: string; units: number } | null } | null }[];
};

function Approvals() {
  const { profile } = useAuth();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data }, offs] = await Promise.all([
      supabase.from("uni_registrations")
        .select("id, status, submitted_at, semester:uni_semesters!inner(is_current), student:uni_students(matric_no, level, programme:uni_programmes(name, department_id), profile:uni_profiles(full_name)), courses:uni_registration_courses(id, is_carryover, offering:uni_course_offerings(course:uni_courses(code, title, units)))")
        .eq("semester.is_current", true).order("submitted_at"),
      currentOfferings(),
    ]);
    setRegs(((data as unknown as Reg[]) ?? []).filter((r) => r.student?.programme?.department_id === profile?.department_id));
    setOfferings(offs.filter((o) => o.course?.department_id === profile?.department_id));
    setLoading(false);
  }, [profile]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, approve: boolean) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("uni_decide_registration", { p_registration: id, p_approve: approve });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: approve ? "Registration approved." : "Registration returned to the student." }); setOpen(null); load(); }
  }

  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;
  const pending = regs.filter((r) => r.status === "submitted");
  const resultsPending = offerings.filter((o) => o.result_status === "submitted");

  return (
    <>
      <PageHead title="Department approvals" sub={`${profile?.department?.name} · current semester`}
        right={<Link href="/registry/broadsheet"><Button variant="secondary">Department broadsheet</Button></Link>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Stat label="Course forms to approve" value={pending.length} tone={pending.length ? "warn" : undefined} />
        <Stat label="Results to approve" value={resultsPending.length} tone={resultsPending.length ? "warn" : undefined} />
        <Stat label="Students registered" value={regs.filter((r) => r.status === "approved").length} note={`of ${regs.length} course forms received`} />
      </div>

      <div className="space-y-6">
        <Card title="Course forms awaiting approval">
          {pending.length === 0 ? <Empty>No course forms are waiting for you.</Empty> : (
            <Table head={["Matric no.", "Student", "Programme", "Level", "Units", ""]}>
              {pending.map((r) => {
                const units = r.courses.reduce((a, c) => a + (c.offering?.course?.units ?? 0), 0);
                const isOpen = open === r.id;
                return [
                  <tr key={r.id}>
                    <td className={`${td} font-mono text-xs`}>{r.student?.matric_no}</td>
                    <td className={td}>{r.student?.profile?.full_name}</td>
                    <td className={td}>{r.student?.programme?.name}</td>
                    <td className={`${td} tabular-nums`}>{r.student?.level}</td>
                    <td className={`${td} tabular-nums`}>{units}</td>
                    <td className={`${td} text-right`}><Button small variant="secondary" onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? "Hide" : "Review"}</Button></td>
                  </tr>,
                  isOpen && (
                    <tr key={r.id + "-d"} className="bg-mute/60">
                      <td colSpan={6} className="px-5 py-4">
                        <ul className="grid gap-1 text-sm sm:grid-cols-2">
                          {r.courses.map((c) => (
                            <li key={c.id} className="flex justify-between gap-3 rounded bg-paper px-3 py-1.5">
                              <span><b>{c.offering?.course?.code}</b> {c.offering?.course?.title} {c.is_carryover && <Pill tone="bad">Carry-over</Pill>}</span>
                              <span className="tabular-nums text-ink-3">{c.offering?.course?.units}u</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex gap-2">
                          <Button small onClick={() => decide(r.id, true)} disabled={busy}>Approve course form</Button>
                          <Button small variant="danger" onClick={() => decide(r.id, false)} disabled={busy}>Return to student</Button>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </Table>
          )}
        </Card>

        <Card title="Department results">
          {offerings.length === 0 ? <Empty>No courses offered this semester.</Empty> : (
            <Table head={["Code", "Title", "Lecturer", "Students", "Status", ""]}>
              {offerings.map((o) => (
                <tr key={o.id}>
                  <td className={`${td} font-medium`}>{o.course?.code}</td>
                  <td className={td}>{o.course?.title}</td>
                  <td className={td}>{o.lecturer?.full_name ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{approvedCount(o)}</td>
                  <td className={td}><StatusPill status={o.result_status} /></td>
                  <td className={`${td} text-right`}>
                    <Link href={`/hod/result/${o.id}`}><Button small variant={o.result_status === "submitted" ? "primary" : "secondary"}>{o.result_status === "submitted" ? "Review" : "View"}</Button></Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return <Shell allow={["hod"]}><Approvals /></Shell>;
}
