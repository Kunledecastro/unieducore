"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { supabase, roleHome, errMsg } from "@/lib/supabase";
import { Button, Notice, Pill } from "@/components/ui";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };
type Enrol = { id: string; qr: string; secret: string };

/** Supabase returns the QR code as "data:image/svg+xml;utf-8,<svg…>", which some browsers refuse; re-encode it. */
function qrSrc(qr: string) {
  const i = qr.indexOf(",");
  if (!qr.startsWith("data:image/svg+xml") || i < 0) return qr;
  let svg = qr.slice(i + 1);
  try { svg = decodeURIComponent(svg); } catch { /* already raw markup */ }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function Security() {
  const { profile, loading, mfa, refresh, signOut } = useAuth();
  const router = useRouter();
  const required = useSearchParams().get("required") === "1";
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.all ?? []) as Factor[]).filter((f) => f.status === "verified"));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace("/login");
    else if (mfa === "challenge") router.replace("/account/mfa");
    else load();
  }, [loading, profile, mfa, router, load]);

  async function start() {
    setBusy(true); setMsg(null);
    // Clear any half-finished set-up first, so the new one is the only pending authenticator
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of (all?.all ?? []).filter((x) => x.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `UniEducore ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) { setMsg({ kind: "error", text: error ? errMsg(error) : "Could not start set-up." }); return; }
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnrol() {
    if (!enrol) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.id, code: code.trim() });
    setBusy(false);
    if (error) { setMsg({ kind: "error", text: "That code did not match. Check the time on your phone is set automatically, then try the current code." }); setCode(""); return; }
    setEnrol(null); setCode("");
    setMsg({ kind: "success", text: "Two-factor sign-in is on. You will be asked for a code each time you sign in." });
    await refresh(); load();
  }

  async function remove(f: Factor) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: "Authenticator removed." }); await supabase.auth.refreshSession(); await refresh(); load(); }
  }

  if (loading || !profile) return <div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>;
  const on = (factors?.length ?? 0) > 0;
  const mustSetUp = mfa === "enrol";

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-paper p-6">
        <div className="mb-5 flex items-center justify-between gap-2.5">
          <span className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white font-semibold text-sm">U</span>
            <span className="font-semibold">UniEducore</span>
          </span>
          {!mustSetUp && <Link href={roleHome[profile.role]} className="text-sm text-brand hover:underline">Back to the portal</Link>}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Account security</h1>
        <p className="mt-1 text-sm text-ink-3">{profile.full_name} · {profile.email}</p>
        {msg && <div className="mt-4"><Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice></div>}
        {(mustSetUp || required) && !on && (
          <div className="mt-4"><Notice kind="info">Your university requires two-factor sign-in for your role. Set up an authenticator to continue.</Notice></div>
        )}

        <section className="mt-5 border-t border-line pt-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Two-factor sign-in</h2>
            {factors && (on ? <Pill tone="good">On</Pill> : <Pill>Off</Pill>)}
          </div>
          <p className="mt-1 text-sm text-ink-2">After your password, you also enter a 6-digit code from an authenticator app on your phone, so a stolen password alone cannot open your account.</p>

          {!enrol && !on && <div className="mt-4"><Button onClick={start} disabled={busy}>{busy ? "Starting…" : "Set up authenticator"}</Button></div>}

          {enrol && (
            <div className="mt-4 space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                <li>Install Google Authenticator, Microsoft Authenticator or a similar app.</li>
                <li>In the app, add an account and scan this code.</li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc(enrol.qr)} alt="QR code to add UniEducore to your authenticator app" className="mx-auto h-48 w-48 rounded-lg border border-line bg-white p-2" />
              <p className="text-center text-xs text-ink-3">Can&apos;t scan? Enter this key: <code className="select-all break-all rounded bg-mute px-1 font-mono">{enrol.secret}</code></p>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); confirmEnrol(); }}>
                <input id="enrol-code" className="input flex-1 text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="6-digit code" placeholder="000000" />
                <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Turn on"}</Button>
              </form>
              <button className="text-xs text-ink-3 hover:underline" onClick={() => { setEnrol(null); setCode(""); }}>Cancel set-up</button>
            </div>
          )}

          {on && factors && (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
              {factors.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>Authenticator app<span className="block text-xs text-ink-3">Added {new Date(f.created_at).toLocaleDateString("en-NG", { dateStyle: "medium" })}</span></span>
                  <button className="text-xs text-bad hover:underline disabled:opacity-50" disabled={busy}
                    onClick={() => remove(f)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          {on && <p className="mt-2 text-xs text-ink-3">If your role requires two-factor sign-in, removing your authenticator means setting up a new one before you can continue.</p>}
        </section>

        <section className="mt-5 border-t border-line pt-5">
          <h2 className="text-sm font-semibold">Password</h2>
          <p className="mt-1 text-sm text-ink-2">Change the password you sign in with.</p>
          <div className="mt-3 flex items-center gap-3">
            <Link href="/account/password"><Button variant="secondary">Change password</Button></Link>
            <button className="text-sm text-ink-3 hover:text-ink" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>}><Security /></Suspense>;
}
