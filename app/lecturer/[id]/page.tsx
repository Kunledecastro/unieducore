"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "@/components/auth";
import { PageHead } from "@/components/ui";
import { ScoreSheet } from "@/components/ScoreSheet";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell allow={["lecturer", "hod"]}>
      <PageHead title="Score entry" sub={<Link href="/lecturer" className="text-brand hover:underline">← Back to my courses</Link>} />
      <ScoreSheet offeringId={id} mode="lecturer" />
    </Shell>
  );
}
