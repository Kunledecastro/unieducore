"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Shell } from "@/components/auth";
import { Card, PageHead, Button } from "@/components/ui";
import { naira, errMsg } from "@/lib/supabase";
import { payCall } from "@/lib/admin";

type Result = { status: string; amount: number; reference: string };

function PaymentReturn() {
  const params = useSearchParams();
  const reference = params.get("reference") ?? params.get("trxref") ?? "";
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    if (!reference) { setErr("No payment reference was returned."); setChecking(false); return; }
    setChecking(true); setErr(null);
    try { setRes(await payCall<Result>({ action: "verify", reference })); }
    catch (e) { setErr(errMsg(e)); }
    setChecking(false);
  }, [reference]);
  useEffect(() => { check(); }, [check]);

  const ok = res?.status === "successful";
  const pending = res?.status === "pending";
  return (
    <>
      <PageHead title="Fee payment" sub={reference && <span className="font-mono">Ref: {reference}</span>} />
      <Card>
        {checking ? <p className="text-sm text-ink-2">Confirming your payment with Paystack…</p>
          : err ? <p className="text-sm text-bad">{err}</p>
          : ok ? (
            <div>
              <div className="text-lg font-semibold text-good">Payment confirmed</div>
              <p className="mt-1 text-sm text-ink-2">{naira(res!.amount)} has been received and your fees are updated. You can now register your courses.</p>
            </div>
          ) : pending ? (
            <div>
              <div className="text-lg font-semibold text-warn">Payment not confirmed yet</div>
              <p className="mt-1 text-sm text-ink-2">Paystack has not confirmed this payment yet. Bank transfers can take a few minutes. You will not be charged twice.</p>
            </div>
          ) : (
            <div>
              <div className="text-lg font-semibold text-bad">Payment not completed</div>
              <p className="mt-1 text-sm text-ink-2">
                {res?.status === "amount_mismatch" ? "The amount paid did not match your fees. The Bursary has been flagged to review it." : "The payment was cancelled or declined. No fees were recorded. You can try again from your overview."}
              </p>
            </div>
          )}
        <div className="mt-5 flex flex-wrap gap-2">
          {ok && <Link href={`/print/receipt/${encodeURIComponent(reference)}`}><Button>View receipt</Button></Link>}
          {pending && <Button onClick={check} disabled={checking}>Check again</Button>}
          <Link href="/student"><Button variant="secondary">Back to overview</Button></Link>
        </div>
      </Card>
    </>
  );
}

export default function Page() {
  return (
    <Shell allow={["student"]}>
      <Suspense fallback={<p className="text-sm text-ink-3">Loading…</p>}><PaymentReturn /></Suspense>
    </Shell>
  );
}
