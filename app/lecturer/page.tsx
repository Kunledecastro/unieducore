"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Table, td, Empty, StatusPill, Button } from "@/components/ui";
import { currentOfferings, approvedCount, type Offering } from "@/lib/staff";

function MyCourses() {
  const { profile } = useAuth();
  const [list, setList] = useState<Offering[] | null>(null);

  useEffect(() => {
    currentOfferings().then((all) => setList(all.filter((o) => o.lecturer_id === profile?.id)));
  }, [profile]);

  const sem = list?.[0]?.semester;
  return (
    <>
      <PageHead title="My courses" sub={sem ? `${sem.session?.name} session · ${sem.name}` : "Current semester"} />
      <Card title="Courses assigned to you">
        {!list ? <p className="text-sm text-ink-3">Loading…</p> : list.length === 0 ? <Empty>No courses are assigned to you this semester.</Empty> : (
          <Table head={["Code", "Title", "Units", "Students", "Result status", ""]}>
            {list.map((o) => (
              <tr key={o.id}>
                <td className={`${td} font-medium`}>{o.course?.code}</td>
                <td className={td}>{o.course?.title}</td>
                <td className={`${td} tabular-nums`}>{o.course?.units}</td>
                <td className={`${td} tabular-nums`}>{approvedCount(o)}</td>
                <td className={td}><StatusPill status={o.result_status} /></td>
                <td className={`${td} text-right`}>
                  <Link href={`/lecturer/${o.id}`}><Button small variant={o.result_status === "draft" ? "primary" : "secondary"}>{o.result_status === "draft" ? "Enter scores" : "View sheet"}</Button></Link>
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
  return <Shell allow={["lecturer", "hod"]}><MyCourses /></Shell>;
}
