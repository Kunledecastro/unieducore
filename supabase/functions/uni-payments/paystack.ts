// Pure helpers for Paystack, kept separate so they can be unit-tested without network or database.

/** Naira to kobo, avoiding floating-point drift (e.g. 1234.56 → 123456). */
export const toKobo = (naira: number) => Math.round(Number(naira) * 100);

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key, hex-encoded. */
export async function verifySignature(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0; // constant-time comparison
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export type Tx = { status?: string; amount?: number; currency?: string; reference?: string; gateway_response?: string; paid_at?: string; channel?: string };
export type Outcome = "successful" | "failed" | "pending" | "amount_mismatch";

/**
 * Decide what a Paystack transaction means for our payment record.
 * A payment only counts when Paystack says "success" AND the amount and currency match what we asked for.
 */
export function decide(expectedNaira: number, tx: Tx): Outcome {
  if (tx.status === "success") {
    if (tx.amount !== toKobo(expectedNaira) || (tx.currency ?? "NGN") !== "NGN") return "amount_mismatch";
    return "successful";
  }
  if (tx.status === "failed" || tx.status === "abandoned" || tx.status === "reversed") return "failed";
  return "pending";
}

/** Only redirect students back to our own app after paying. */
export function safeCallback(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const okHost = /^unieducore([a-z0-9-]*)\.vercel\.app$/.test(u.hostname) || u.hostname === "localhost";
    if (!okHost || (u.protocol !== "https:" && u.hostname !== "localhost")) return null;
    return `${u.origin}/student/payment`;
  } catch {
    return null;
  }
}

export const newReference = () => `UNI-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
