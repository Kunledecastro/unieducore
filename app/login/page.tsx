"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, roleHome } from "@/lib/supabase";
import { useAuth } from "@/components/auth";

const DEMO_PASSWORD = "UniDemo2026!";
const demos = [
  { email: "ada@udu.demo", who: "Ada Okafor", role: "Student · 200L Computer Science", note: "Has a carry-over, CGPA history" },
  { email: "tunde@udu.demo", who: "Tunde Bakare", role: "Student · 100L Computer Science", note: "Registration awaiting HOD" },
  { email: "lecturer@udu.demo", who: "Dr. Bayo Ogunleye", role: "Lecturer · CSC", note: "Enter and submit scores" },
  { email: "hod.csc@udu.demo", who: "Dr. Emeka Nwosu", role: "HOD · Computer Science", note: "Approve registrations and results" },
  { email: "registrar@udu.demo", who: "Mrs. Folake Adeyemi", role: "Registry", note: "Senate approval and result release" },
  { email: "bursar@udu.demo", who: "Mr. Kola Adebayo", role: "Bursary", note: "Fees and payments" },
];

export default function Login() {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!loading && profile) router.replace(roleHome[profile.role]); }, [loading, profile, router]);

  async function signIn(e: string, p: string) {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
    if (error) { setError(error.message); setBusy(false); }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-brand p-12 text-white">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-white text-brand font-bold">U</span>
          <span className="text-lg font-semibold">UniEducore</span>
        </div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">From admission to approved results, in one place.</h1>
          <p className="mt-4 max-w-md text-white/75">Course registration with credit-unit rules, lecturer score entry, HOD and Senate approval, CGPA and fees, built for Nigerian universities.</p>
        </div>
        <p className="text-sm text-white/60">Prototype · Unity Demo University, Lagos</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-ink-3">Use your university email, or pick a demo account below.</p>

          <form className="mt-6 space-y-3" onSubmit={(ev) => { ev.preventDefault(); signIn(email, password); }}>
            <input className="input w-full" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className="input w-full" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <p className="text-sm text-bad">{error}</p>}
            <button disabled={busy} className="w-full rounded-md bg-brand py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-8">
            <div className="mb-2 text-xs uppercase tracking-wide text-ink-3">Demo accounts</div>
            <div className="grid gap-2">
              {demos.map((d) => (
                <button key={d.email} disabled={busy} onClick={() => signIn(d.email, DEMO_PASSWORD)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-2.5 text-left hover:border-brand hover:bg-brand-soft disabled:opacity-50">
                  <span>
                    <span className="block text-sm font-medium text-ink">{d.who}</span>
                    <span className="block text-xs text-ink-3">{d.role}</span>
                  </span>
                  <span className="text-xs text-ink-3 text-right">{d.note}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-3">All demo accounts use the password <code className="rounded bg-mute px-1">{DEMO_PASSWORD}</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}
