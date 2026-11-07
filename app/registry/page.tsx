"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/auth";
import { Card, PageHead, Table, td, Empty, StatusPill, Button } from "@/components/ui";
import { currentOfferings, approvedCount, type Offering } from "@/lib/staff";
import { statusLabel, type ResultStatus } from "@/lib/supabase";

const stages: ResultStatus[] = ["draft", "submitted", "hod_approved", "senate_approved", "released"];

function Pipeline() {
  const [list, setList] = useState<Offering[] | null>(null);
  const [filter, setFilter] = useState<ResultStatus | "all" | "active">("active");

  useEffect(() => { currentOfferings().then(setList); }, []);

  const active = useMemo(() => (list ?? []).filter((o) => approvedCount(o) > 0), [list]);
  const counts = useMemo(() => Object.fromEntries(stages.map((s) => [s, active.filter((o) => o.result_status === s).length])) as Record<ResultStatus, number>, [active]);
  const shown = (list ?? []).filter((o) => filter === "all" ? true : filter === "active" ? approvedCount(o) > 0 : o.result_status === filter && approvedCount(o) > 0);
  const sem = list?.[0]?.semester;

  return (
    <>
      <PageHead title="Results pipeline" sub={sem ? `${sem.session?.name} session · ${sem.name} · courses with registered students` : undefined} />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stages.map((s, i) => (
          <button key={s} onClick={() => setFilter(filter === s ? "active" : s)}
            className={`relative rounded-xl border px-4 py-3 text-left ${filter === s ? "border-brand bg-brand-soft" : "border-line bg-paper hover:bg-mute"}`}>
            <div className="text-xs text-ink-3">{i + 1}. {statusLabel[s]}</div>
            <div className="text-2xl font-semibold tabular-nums">{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <Card title={filter === "active" ? "All active courses" : filter === "all" ? "All offered courses" : statusLabel[filter as ResultStatus]}
        right={<button className="text-xs text-brand hover:underline" onClick={() => setFilter(filter === "all" ? "active" : "all")}>{filter === "all" ? "Hide courses with no students" : "Show all offered courses"}</button>}>
        {!list ? <p className="text-sm text-ink-3">Loading…</p> : shown.length === 0 ? <Empty>Nothing at this stage.</Empty> : (
          <Table head={["Code", "Title", "Dept", "Lecturer", "Students", "Status", ""]}>
            {shown.map((o) => (
              <tr key={o.id}>
                <td className={`${td} font-medium`}>{o.course?.code}</td>
                <td className={td}>{o.course?.title}</td>
                <td className={td}>{o.course?.department?.code}</td>
                <td className={td}>{o.lecturer?.full_name ?? "—"}</td>
                <td className={`${td} tabular-nums`}>{approvedCount(o)}</td>
                <td className={td}><StatusPill status={o.result_status} /></td>
                <td className={`${td} text-right`}>
                  <Link href={`/registry/result/${o.id}`}>
                    <Button small variant={o.result_status === "hod_approved" || o.result_status === "senate_approved" ? "primary" : "secondary"}>
                      {o.result_status === "hod_approved" ? "Senate approval" : o.result_status === "senate_approved" ? "Release" : "View"}
                    </Button>
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><Pipeline /></Shell>;
}
