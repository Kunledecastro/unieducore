"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "@/components/auth";
import { PageHead } from "@/components/ui";
import { ScoreSheet } from "@/components/ScoreSheet";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <Shell allow={["registrar", "admin"]}>
      <PageHead title="Result" sub={<Link href="/registry" className="text-brand hover:underline">← Back to results pipeline</Link>} />
      <ScoreSheet offeringId={id} mode="registry" />
    </Shell>
  );
}
