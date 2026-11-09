"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, roleHome, type Profile, type Role } from "@/lib/supabase";

type Ctx = { profile: Profile | null; loading: boolean; signOut: () => Promise<void>; refresh: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ profile: null, loading: true, signOut: async () => {}, refresh: async () => {} });
export const useAuth = () => useContext(AuthCtx);

async function loadProfile(): Promise<Profile | null> {
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) return null;
  const { data } = await supabase
    .from("uni_profiles")
    .select("id, tenant_id, full_name, email, role, department_id, must_change_password, is_active, tenant:uni_tenants(name, short_name), department:uni_departments(name, code)")
    .eq("id", s.session.user.id)
    .single();
  return (data as unknown as Profile) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile().then((p) => { setProfile(p); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setLoading(true);
        loadProfile().then((p) => { setProfile(p); setLoading(false); });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); };
  const refresh = async () => { setProfile(await loadProfile()); };
  return <AuthCtx.Provider value={{ profile, loading, signOut, refresh }}>{children}</AuthCtx.Provider>;
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
  student: [{ href: "/student", label: "Overview" }, { href: "/student/registration", label: "Course registration" }, { href: "/student/results", label: "Results" }],
  lecturer: [{ href: "/lecturer", label: "My courses" }],
  hod: [{ href: "/hod", label: "Approvals" }, { href: "/registry/standing", label: "Standing" }, { href: "/lecturer", label: "My courses" }],
  registrar: registryNav,
  admin: registryNav,
  bursar: [{ href: "/bursary", label: "Fees and payments" }],
};

const roleName: Record<Role, string> = {
  student: "Student", lecturer: "Lecturer", hod: "Head of Department", registrar: "Registry", admin: "Administrator", bursar: "Bursary",
};

export function Shell({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { profile, loading, signOut } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!profile) router.replace("/login");
    else if (profile.must_change_password) router.replace("/account/password");
    else if (!allow.includes(profile.role)) router.replace(roleHome[profile.role]);
  }, [loading, profile, allow, router]);

  if (loading || !profile || profile.must_change_password || !allow.includes(profile.role)) {
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
              <span className="block text-xs text-ink-3">{roleName[profile.role]}{profile.department ? ` · ${profile.department.code}` : ""}</span>
            </span>
            <Link href="/account/password" className="text-ink-3 hover:text-ink text-xs">Password</Link>
            <button onClick={async () => { await signOut(); router.replace("/login"); }}
              className="rounded-md border border-line px-3 py-1.5 text-ink-2 hover:bg-mute">Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
