"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The old "Academic setup" page is now split into Structure, Courses, Calendar and Rules.
export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace("/registry/rules"); }, [router]);
  return null;
}
