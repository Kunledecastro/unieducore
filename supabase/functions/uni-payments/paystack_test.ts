import { deepStrictEqual as assertEquals } from "node:assert";
import { decide, safeCallback, toKobo, verifySignature } from "./paystack.ts";

Deno.test("naira to kobo has no floating-point drift", () => {
  assertEquals(toKobo(540000), 54000000);
  assertEquals(toKobo(1234.56), 123456);
  assertEquals(toKobo(0.1 + 0.2), 30);
});

Deno.test("only a successful charge of the exact amount counts", () => {
  assertEquals(decide(540000, { status: "success", amount: 54000000, currency: "NGN" }), "successful");
  assertEquals(decide(540000, { status: "success", amount: 100, currency: "NGN" }), "amount_mismatch");
  assertEquals(decide(540000, { status: "success", amount: 54000000, currency: "USD" }), "amount_mismatch");
  assertEquals(decide(540000, { status: "failed", amount: 54000000 }), "failed");
  assertEquals(decide(540000, { status: "abandoned" }), "failed");
  assertEquals(decide(540000, { status: "ongoing" }), "pending");
});

Deno.test("webhook signature is checked against the secret", async () => {
  const secret = "sk_test_example";
  const body = JSON.stringify({ event: "charge.success", data: { reference: "UNI-ABC" } });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (b) => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await verifySignature(body, sig, secret), true);
  assertEquals(await verifySignature(body + " ", sig, secret), false);
  assertEquals(await verifySignature(body, sig, "sk_test_other"), false);
  assertEquals(await verifySignature(body, null, secret), false);
});

Deno.test("students are only sent back to our own app", () => {
  assertEquals(safeCallback("https://unieducore.vercel.app/student"), "https://unieducore.vercel.app/student/payment");
  assertEquals(safeCallback("https://unieducore-git-main-adekunle.vercel.app/x"), "https://unieducore-git-main-adekunle.vercel.app/student/payment");
  assertEquals(safeCallback("http://localhost:3000/"), "http://localhost:3000/student/payment");
  assertEquals(safeCallback("https://evil.example.com/"), null);
  assertEquals(safeCallback("https://unieducore.vercel.app.evil.com/"), null);
  assertEquals(safeCallback("http://unieducore.vercel.app/"), null);
  assertEquals(safeCallback(42), null);
});
