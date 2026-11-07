"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { roleHome } from "@/lib/supabase";

export default function Home() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(profile ? roleHome[profile.role] : "/login");
  }, [loading, profile, router]);
  return <div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>;
}
