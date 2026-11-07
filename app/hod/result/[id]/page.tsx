"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "@/components/auth";
import { PageHead } from "@/components/ui";
import { ScoreSheet } from "@/components/ScoreSheet";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell allow={["hod"]}>
      <PageHead title="Result review" sub={<Link href="/hod" className="text-brand hover:underline">← Back to approvals</Link>} />
      <ScoreSheet offeringId={id} mode="hod" />
    </Shell>
  );
}
