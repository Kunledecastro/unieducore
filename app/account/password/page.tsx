"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { supabase, roleHome, errMsg } from "@/lib/supabase";
import { Field, Button } from "@/components/ui";

export default function ChangePassword() {
  const { profile, loading, refresh, signOut } = useAuth();
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!loading && !profile) router.replace("/login"); }, [loading, profile, router]);
  if (loading || !profile) return <div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>;

  const forced = profile.must_change_password;
  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;

  async function save() {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setError(errMsg(error)); setBusy(false); return; }
    await supabase.rpc("uni_password_changed");
    await refresh();
    router.replace(roleHome[profile!.role]);
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-paper p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white font-semibold text-sm">U</span>
          <span className="font-semibold">UniEducore</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{forced ? "Set your password" : "Change password"}</h1>
        <p className="mt-1 text-sm text-ink-3">
          {forced ? `Welcome, ${profile.full_name.split(" ")[0]}. You signed in with a temporary password. Choose your own to continue.` : "Choose a new password."}
        </p>
        <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="New password" hint="At least 8 characters">
            <input className="input w-full" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Confirm new password">
            <input className="input w-full" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          {tooShort && <p className="text-xs text-bad">Password must be at least 8 characters.</p>}
          {mismatch && <p className="text-xs text-bad">The two passwords do not match.</p>}
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={busy || pw.length < 8 || pw !== pw2}>{busy ? "Saving…" : "Save password"}</Button>
            <button type="button" className="text-sm text-ink-3 hover:text-ink"
              onClick={async () => { if (forced) { await signOut(); router.replace("/login"); } else router.back(); }}>
              {forced ? "Sign out" : "Cancel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
