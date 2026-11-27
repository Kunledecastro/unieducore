"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, roleHome, type Profile, type Role } from "@/lib/supabase";

/** ok: nothing more needed · challenge: enter an authenticator code · enrol: this role must set up an authenticator first */
export type MfaState = "ok" | "challenge" | "enrol";
type Ctx = { profile: Profile | null; loading: boolean; mfa: MfaState; signOut: () => Promise<void>; refresh: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ profile: null, loading: true, mfa: "ok", signOut: async () => {}, refresh: async () => {} });
export const useAuth = () => useContext(AuthCtx);

async function loadProfile(): Promise<Profile | null> {
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return null;
  const { data } = await supabase
    .from("uni_profiles")
    .select("id, tenant_id, full_name, email, role, department_id, hostel_id, must_change_password, is_active, tenant:uni_tenants(name, short_name), department:uni_departments(name, code), hostel:uni_hostels(name)")
    .eq("id", s.session.user.id)
    .single();
  return (data as unknown as Profile) ?? null;
}

async function loadMfa(): Promise<MfaState> {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal) return "ok";
  if (aal.currentLevel === "aal2") return "ok";
  if (aal.nextLevel === "aal2") return "challenge"; // has a verified authenticator: always ask for the code
  const { data: required } = await supabase.rpc("uni_mfa_required");
  return required ? "enrol" : "ok";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfa, setMfa] = useState<MfaState>("ok");

  useEffect(() => {
    const load = async () => {
      const p = await loadProfile();
      setMfa(p ? await loadMfa() : "ok");
      setProfile(p); setLoading(false);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "MFA_CHALLENGE_VERIFIED") {
        setLoading(true);
        setTimeout(load, 0); // run outside the auth callback, as Supabase recommends
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); setMfa("ok"); };
  const refresh = async () => { const p = await loadProfile(); setMfa(p ? await loadMfa() : "ok"); setProfile(p); };
  return <AuthCtx.Provider value={{ profile, loading, mfa, signOut, refresh }}>{children}</AuthCtx.Provider>;
}

const registryNav = [
  { href: "/registry", label: "Results" },
  { href: "/registry/students", label: "Students" },
  { href: "/registry/standing", label: "Standing" },
  { href: "/registry/staff", label: "Staff" },
  { href: "/registry/calendar", label: "Calendar" },
  { href: "/registry/courses", label: "Courses" },
  { href: "/registry/structure", label: "Structure" },
  { href: "/registry/rules", label: "Rules" },
  { href: "/registry/audit", label: "Audit" },
];

const navFor: Record<Role, { href: string; label: string }[]> = {
  student: [{ href: "/student", label: "Overview" }, { href: "/student/registration", label: "Course registration" }, { href: "/student/results", label: "Results" }, { href: "/student/hostel", label: "Hostel" }],
  lecturer: [{ href: "/lecturer", label: "My courses" }],
  hod: [{ href: "/hod", label: "Approvals" }, { href: "/registry/standing", label: "Standing" }, { href: "/lecturer", label: "My courses" }],
  registrar: registryNav,
  admin: [...registryNav, { href: "/hostel", label: "Hostels" }],
  bursar: [{ href: "/bursary", label: "Fees and payments" }],
  hostel_officer: [{ href: "/hostel", label: "Allocations" }, { href: "/hostel/requests", label: "Requests" }, { href: "/hostel/setup", label: "Halls and rooms" }],
  porter: [{ href: "/porter", label: "My hall" }],
};

const roleName: Record<Role, string> = {
  student: "Student", lecturer: "Lecturer", hod: "Head of Department", registrar: "Registry", admin: "Administrator", bursar: "Bursary", hostel_officer: "Hostel office", porter: "Porter",
};

export function Shell({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { profile, loading, mfa, signOut } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace("/login");
    else if (mfa === "challenge") router.replace("/account/mfa");
    else if (profile.must_change_password) router.replace("/account/password");
    else if (mfa === "enrol") router.replace("/account/security?required=1");
    else if (!allow.includes(profile.role)) router.replace(roleHome[profile.role]);
  }, [loading, profile, mfa, allow, router]);

  if (loading || !profile || mfa !== "ok" || profile.must_change_password || !allow.includes(profile.role)) {
    return <div className="min-h-screen grid place-items-center text-sm text-ink-3">Loading…</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-wrap items-center gap-x-8 gap-y-2 py-3">
          <Link href={roleHome[profile.role]} className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white font-semibold text-sm">U</span>
            <span className="leading-tight">
              <span className="block font-semibold text-ink">UniEducore</span>
              <span className="block text-xs text-ink-3">{profile.tenant?.name}</span>
            </span>
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {navFor[profile.role].map((n) => {
              const active = path === n.href;
              return (
                <Link key={n.href} href={n.href}
                  className={`rounded-md px-3 py-1.5 ${active ? "bg-brand-soft text-brand font-medium" : "text-ink-2 hover:bg-mute"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-right leading-tight hidden sm:block">
              <span className="block text-ink">{profile.full_name}</span>
              <span className="block text-xs text-ink-3">{roleName[profile.role]}{profile.department ? ` · ${profile.department.code}` : ""}{profile.hostel ? ` · ${profile.hostel.name}` : ""}</span>
            </span>
            <Link href="/account/security" className="text-ink-3 hover:text-ink text-xs">Account</Link>
            <button onClick={async () => { await signOut(); router.replace("/login"); }}
              className="rounded-md border border-line px-3 py-1.5 text-ink-2 hover:bg-mute">Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
