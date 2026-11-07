// UniEducore user administration (Registry/admin only).
// Runs server-side with the service role, so account creation never needs elevated keys in the browser.
// Actions: create_user, bulk_create_students, reset_password, set_active
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Me = { id: string; tenant_id: string; role: string; tenant: { short_name: string } };
type Role = "admin" | "registrar" | "hod" | "lecturer" | "student" | "bursar";
const STAFF_ROLES: Role[] = ["registrar", "hod", "lecturer", "bursar"];

function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function audit(db: SupabaseClient, me: Me, action: string, recordId: string | null, data: Record<string, unknown>) {
  await db.from("uni_audit_log").insert({
    tenant_id: me.tenant_id, table_name: "accounts", record_id: recordId, action, new_data: data, actor: me.id,
  });
}

// Matric numbers look like UDU/CSC/26/0004: tenant / department code / entry year / sequence
async function nextMatric(db: SupabaseClient, me: Me, programmeId: string, counters: Map<string, number>) {
  const { data: prog } = await db.from("uni_programmes").select("department:uni_departments(code)").eq("id", programmeId).single();
  const { data: ses } = await db.from("uni_sessions").select("name").eq("tenant_id", me.tenant_id).eq("is_current", true).maybeSingle();
  const yy = (ses?.name ?? String(new Date().getFullYear())).slice(2, 4);
  // deno-lint-ignore no-explicit-any
  const prefix = `${me.tenant.short_name}/${(prog as any)?.department?.code ?? "GEN"}/${yy}/`;
  if (!counters.has(prefix)) {
    const { data: existing } = await db.from("uni_students").select("matric_no").eq("tenant_id", me.tenant_id).like("matric_no", `${prefix}%`);
    const max = (existing ?? []).reduce((m, r) => Math.max(m, parseInt(r.matric_no.slice(prefix.length), 10) || 0), 0);
    counters.set(prefix, max);
  }
  const n = counters.get(prefix)! + 1;
  counters.set(prefix, n);
  return prefix + String(n).padStart(4, "0");
}

type NewUser = {
  full_name: string; email: string; role: Role; department_id?: string | null;
  programme_id?: string | null; level?: number | null; matric_no?: string | null;
};

async function createAccount(db: SupabaseClient, me: Me, u: NewUser, counters: Map<string, number>) {
  const full_name = (u.full_name ?? "").trim();
  const email = (u.email ?? "").trim().toLowerCase();
  if (!full_name) throw new Error("Full name is required");
  if (!emailOk(email)) throw new Error("A valid email is required");
  const allowed: Role[] = me.role === "admin" ? [...STAFF_ROLES, "student", "admin"] : [...STAFF_ROLES, "student"];
  if (!allowed.includes(u.role)) throw new Error(`Role "${u.role}" is not allowed`);

  let department_id: string | null = null;
  if (u.role === "hod" || u.role === "lecturer") {
    if (!u.department_id) throw new Error("Choose a department for lecturers and HODs");
    const { data: d } = await db.from("uni_departments").select("id").eq("id", u.department_id).eq("tenant_id", me.tenant_id).maybeSingle();
    if (!d) throw new Error("Department not found");
    department_id = d.id;
  }

  let matric_no: string | null = null;
  if (u.role === "student") {
    if (!u.programme_id) throw new Error("Choose a programme");
    const { data: p } = await db.from("uni_programmes").select("id").eq("id", u.programme_id).eq("tenant_id", me.tenant_id).maybeSingle();
    if (!p) throw new Error("Programme not found");
    const level = Number(u.level);
    if (![100, 200, 300, 400, 500, 600, 700].includes(level)) throw new Error("Level must be 100–700");
    matric_no = (u.matric_no ?? "").trim().toUpperCase() || await nextMatric(db, me, u.programme_id, counters);
    const { data: dup } = await db.from("uni_students").select("id").eq("tenant_id", me.tenant_id).eq("matric_no", matric_no).maybeSingle();
    if (dup) throw new Error(`Matric number ${matric_no} is already in use`);
  }

  const password = tempPassword();
  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name },
  });
  if (authErr || !created.user) throw new Error(authErr?.message?.includes("already") ? `${email} already has an account` : (authErr?.message ?? "Could not create account"));
  const id = created.user.id;

  try {
    const { error: pErr } = await db.from("uni_profiles").insert({
      id, tenant_id: me.tenant_id, full_name, email, role: u.role, department_id, must_change_password: true,
    });
    if (pErr) throw pErr;
    if (u.role === "student") {
      const { data: ses } = await db.from("uni_sessions").select("id").eq("tenant_id", me.tenant_id).eq("is_current", true).maybeSingle();
      const { error: sErr } = await db.from("uni_students").insert({
        id, tenant_id: me.tenant_id, matric_no, programme_id: u.programme_id, level: Number(u.level), entry_session_id: ses?.id ?? null,
      });
      if (sErr) throw sErr;
    }
  } catch (e) {
    await db.auth.admin.deleteUser(id); // roll back the half-created account
    throw new Error(`Could not save the profile: ${(e as Error).message}`);
  }

  await audit(db, me, "CREATE_ACCOUNT", id, { email, role: u.role, matric_no });
  return { id, email, full_name, role: u.role, matric_no, temp_password: password };
}

async function targetInTenant(db: SupabaseClient, me: Me, userId: string) {
  const { data } = await db.from("uni_profiles").select("id, email, role").eq("id", userId).eq("tenant_id", me.tenant_id).maybeSingle();
  if (!data) throw new Error("User not found");
  if (data.role === "admin" && me.role !== "admin") throw new Error("Only an administrator can manage administrator accounts");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await db.auth.getUser(token);
  if (authErr || !auth.user) return json({ error: "Please sign in again" }, 401);
  const { data: meRow } = await db.from("uni_profiles")
    .select("id, tenant_id, role, is_active, tenant:uni_tenants(short_name)").eq("id", auth.user.id).maybeSingle();
  if (!meRow || !meRow.is_active || !["admin", "registrar"].includes(meRow.role)) {
    return json({ error: "Only the Registry can manage user accounts" }, 403);
  }
  const me = meRow as unknown as Me;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

  try {
    switch (body.action) {
      case "create_user": {
        const result = await createAccount(db, me, body.user as NewUser, new Map());
        return json({ ok: true, user: result });
      }

      case "bulk_create_students": {
        const rows = (body.rows as Record<string, string>[]) ?? [];
        if (!Array.isArray(rows) || rows.length === 0) return json({ error: "No rows to import" }, 400);
        if (rows.length > 100) return json({ error: "Send at most 100 rows per request" }, 400);
        const { data: progs } = await db.from("uni_programmes").select("id, name").eq("tenant_id", me.tenant_id);
        const byName = new Map((progs ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));
        const counters = new Map<string, number>();
        const results = [];
        for (const [i, r] of rows.entries()) {
          try {
            const programme_id = byName.get(String(r.programme ?? "").trim().toLowerCase());
            if (!programme_id) throw new Error(`Unknown programme "${r.programme ?? ""}"`);
            const u = await createAccount(db, me, {
              full_name: r.full_name, email: r.email, role: "student", programme_id, level: Number(r.level), matric_no: r.matric_no,
            }, counters);
            results.push({ row: i + 1, ok: true, ...u });
          } catch (e) {
            results.push({ row: i + 1, ok: false, email: r.email ?? "", full_name: r.full_name ?? "", error: (e as Error).message });
          }
        }
        return json({ ok: true, results });
      }

      case "reset_password": {
        const t = await targetInTenant(db, me, String(body.user_id));
        const password = tempPassword();
        const { error } = await db.auth.admin.updateUserById(t.id, { password });
        if (error) throw error;
        await db.from("uni_profiles").update({ must_change_password: true }).eq("id", t.id);
        await audit(db, me, "RESET_PASSWORD", t.id, { email: t.email });
        return json({ ok: true, email: t.email, temp_password: password });
      }

      case "set_active": {
        const t = await targetInTenant(db, me, String(body.user_id));
        if (t.id === me.id) throw new Error("You cannot deactivate your own account");
        const active = Boolean(body.active);
        const { error } = await db.auth.admin.updateUserById(t.id, { ban_duration: active ? "none" : "876000h" });
        if (error) throw error;
        await db.from("uni_profiles").update({ is_active: active }).eq("id", t.id);
        await audit(db, me, active ? "REACTIVATE_ACCOUNT" : "DEACTIVATE_ACCOUNT", t.id, { email: t.email });
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
