// UniEducore online fee payments via Paystack.
//   POST /uni-payments            { action: "status" | "initialize" | "verify", ... }   (signed-in users)
//   POST /uni-payments/webhook    Paystack event, verified by HMAC signature           (Paystack servers)
// The Paystack secret key lives only in the PAYSTACK_SECRET_KEY function secret; until it is set,
// "status" reports online payment as not configured and the app keeps the demo flow.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { decide, newReference, safeCallback, toKobo, verifySignature, type Tx } from "./paystack.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const PAYSTACK = "https://api.paystack.co";

type Payment = { id: string; tenant_id: string; student_id: string; amount: number; status: string; reference: string; channel: string };

async function paystack(path: string, init?: RequestInit) {
  const res = await fetch(PAYSTACK + path, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status === false) throw new Error(body.message ?? `Paystack error (${res.status})`);
  return body.data;
}

/** Apply a Paystack transaction to our payment record. Idempotent: a successful payment is never downgraded. */
async function apply(db: SupabaseClient, p: Payment, tx: Tx, source: string) {
  if (p.status === "successful") return "successful";
  const outcome = decide(Number(p.amount), tx);
  const status = outcome === "successful" ? "successful" : outcome === "pending" ? "pending" : "failed";
  await db.from("uni_payments").update({
    status,
    paid_at: status === "successful" ? (tx.paid_at ?? new Date().toISOString()) : undefined,
    verified_at: status === "pending" ? null : new Date().toISOString(),
    gateway_response: { source, status: tx.status, gateway_response: tx.gateway_response, channel: tx.channel, amount_kobo: tx.amount, currency: tx.currency, outcome },
    note: outcome === "amount_mismatch" ? `Paystack amount ${tx.amount} kobo did not match expected ${toKobo(Number(p.amount))}` : null,
  }).eq("id", p.id).neq("status", "successful");
  await db.from("uni_audit_log").insert({
    tenant_id: p.tenant_id, table_name: "uni_payments", record_id: p.id, action: `PAYSTACK_${outcome.toUpperCase()}`,
    new_data: { reference: p.reference, amount: p.amount, source }, actor: null,
  });
  return outcome;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- Paystack webhook (no user; trust only a valid signature) ----
  if (new URL(req.url).pathname.endsWith("/webhook")) {
    const raw = await req.text();
    if (!(await verifySignature(raw, req.headers.get("x-paystack-signature"), SECRET))) return json({ error: "Invalid signature" }, 401);
    const event = JSON.parse(raw);
    if (event.event === "charge.success" && event.data?.reference) {
      const { data: p } = await db.from("uni_payments").select("id, tenant_id, student_id, amount, status, reference, channel").eq("reference", event.data.reference).maybeSingle();
      if (p) await apply(db, p as Payment, event.data, "webhook");
    }
    return json({ received: true }); // always 200 so Paystack stops retrying
  }

  // ---- Signed-in user calls ----
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db.auth.getUser(token);
  if (!auth?.user) return json({ error: "Please sign in again" }, 401);
  const { data: me } = await db.from("uni_profiles").select("id, tenant_id, role, email, full_name, is_active").eq("id", auth.user.id).maybeSingle();
  if (!me || !me.is_active) return json({ error: "Account not active" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

  try {
    if (body.action === "status") {
      const { data: s } = await db.from("uni_settings").select("allow_demo_payments").eq("tenant_id", me.tenant_id).maybeSingle();
      return json({ online: Boolean(SECRET), mode: SECRET.startsWith("sk_live_") ? "live" : SECRET ? "test" : null, demo: Boolean(s?.allow_demo_payments) });
    }

    if (body.action === "initialize") {
      if (!SECRET) return json({ error: "Online payment is not set up yet. Please contact the Bursary." }, 503);
      if (me.role !== "student") return json({ error: "Only students can pay fees online" }, 403);
      const callback = safeCallback(body.callback_url);
      if (!callback) return json({ error: "Invalid return address" }, 400);

      const { data: st } = await db.from("uni_students").select("id, matric_no, tenant_id").eq("id", me.id).single();
      const { data: sem } = await db.from("uni_semesters").select("session_id").eq("tenant_id", me.tenant_id).eq("is_current", true).single();
      const { data: due } = await db.rpc("uni_fees_due", { p_student: me.id, p_session: sem!.session_id });
      const { data: pays } = await db.from("uni_payments").select("amount").eq("student_id", me.id).eq("session_id", sem!.session_id).eq("status", "successful");
      const outstanding = Math.round((Number(due ?? 0) - (pays ?? []).reduce((a, p) => a + Number(p.amount), 0)) * 100) / 100;
      if (outstanding <= 0) return json({ error: "You have no outstanding fees for this session" }, 400);

      // Older unfinished attempts are superseded by this one
      await db.from("uni_payments").update({ status: "failed", note: "Superseded by a newer payment attempt" })
        .eq("student_id", me.id).eq("session_id", sem!.session_id).eq("status", "pending").eq("channel", "paystack");

      const reference = newReference();
      const { data: row, error: insErr } = await db.from("uni_payments").insert({
        tenant_id: me.tenant_id, student_id: me.id, session_id: sem!.session_id, amount: outstanding,
        reference, channel: "paystack", status: "pending",
      }).select("id").single();
      if (insErr) throw insErr;

      try {
        const data = await paystack("/transaction/initialize", {
          method: "POST",
          body: JSON.stringify({
            email: me.email, amount: toKobo(outstanding), currency: "NGN", reference, callback_url: callback,
            metadata: { student_id: me.id, matric_no: st?.matric_no, session_id: sem!.session_id, payment_id: row.id,
              custom_fields: [{ display_name: "Matric number", variable_name: "matric_no", value: st?.matric_no }] },
          }),
        });
        return json({ ok: true, reference, authorization_url: data.authorization_url, amount: outstanding });
      } catch (e) {
        await db.from("uni_payments").update({ status: "failed", note: `Could not start payment: ${(e as Error).message}` }).eq("id", row.id);
        throw e;
      }
    }

    if (body.action === "verify") {
      const reference = String(body.reference ?? "");
      const { data: p } = await db.from("uni_payments").select("id, tenant_id, student_id, amount, status, reference, channel").eq("reference", reference).maybeSingle();
      if (!p || p.tenant_id !== me.tenant_id) return json({ error: "Payment not found" }, 404);
      const staff = ["bursar", "registrar", "admin"].includes(me.role);
      if (p.student_id !== me.id && !staff) return json({ error: "Payment not found" }, 404);
      if (p.status === "successful" || p.channel !== "paystack") return json({ ok: true, status: p.status, amount: p.amount, reference });
      if (!SECRET) return json({ error: "Online payment is not set up" }, 503);
      const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
      const outcome = await apply(db, p as Payment, tx, staff ? "staff_verify" : "student_return");
      return json({ ok: true, status: outcome, amount: p.amount, reference });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
