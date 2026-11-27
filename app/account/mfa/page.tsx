"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { supabase, roleHome, errMsg } from "@/lib/supabase";
import { Button } from "@/components/ui";

/** Second step of sign-in: the 6-digit code from the person's authenticator app. */
export default function MfaChallenge() {
  const { profile, loading, mfa, refresh, signOut } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace("/login");
    else if (mfa !== "challenge") router.replace(roleHome[profile.role]);
  }, [loading, profile, mfa, router]);

  async function verify() {
    setBusy(true); setError(null);
    const { data: f, error: fe } = await supabase.auth.mfa.listFactors();
    const factor = f?.totp.find((x) => x.status === "verified");
    if (fe || !factor) { setError(fe ? errMsg(fe) : "No authenticator is set up on this account. Ask the Registry to reset your two-factor sign-in."); setBusy(false); return; }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (error) { setError(error.message.toLowerCase().includes("invalid") ? "That code is not right, or it has expired. Codes change every 30 seconds; try the current one." : errMsg(error)); setBusy(false); setCode(""); return; }
    await refresh();
  }

  if (loading || !profile) return <div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>;
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-paper p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white font-semibold text-sm">U</span>
          <span className="font-semibold">UniEducore</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Enter your sign-in code</h1>
        <p className="mt-1 text-sm text-ink-3">Open your authenticator app (Google Authenticator, Microsoft Authenticator or similar) and type the 6-digit code for UniEducore.</p>
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <input id="mfa-code" className="input w-full text-center font-mono text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" autoFocus
            maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="6-digit code" />
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</Button>
            <button type="button" className="text-sm text-ink-3 hover:text-ink" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</button>
          </div>
        </form>
        <p className="mt-5 text-xs text-ink-3">Lost your phone? Ask the Registry to reset your two-factor sign-in, then set it up again.</p>
      </div>
    </div>
  );
}
