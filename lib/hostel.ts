"use client";

export type AllocStatus = "reserved" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired";

export const allocLabel: Record<AllocStatus, string> = {
  reserved: "Reserved, awaiting payment",
  confirmed: "Paid, not yet checked in",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  expired: "Reservation lapsed",
};

export const allocTone: Record<AllocStatus, "warn" | "info" | "good" | "mute" | "bad"> = {
  reserved: "warn", confirmed: "info", checked_in: "good", checked_out: "mute", cancelled: "mute", expired: "bad",
};

/** A reservation whose hold has run out is shown as lapsed even before the database marks it. */
export const effectiveStatus = (s: AllocStatus, expiresAt: string | null, paid = 0, amount = 0): AllocStatus =>
  s === "reserved" && expiresAt && new Date(expiresAt) < new Date() && paid < amount ? "expired" : s;

export const faultCategories = ["plumbing", "electrical", "carpentry", "cleaning", "furniture", "security", "other"] as const;
export const faultStatusLabel: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };
export const faultTone: Record<string, "warn" | "info" | "good" | "mute"> = { open: "warn", in_progress: "info", resolved: "good", closed: "mute" };

export const exeatLabel: Record<string, string> = {
  pending: "Awaiting approval", approved: "Approved", rejected: "Not approved", cancelled: "Cancelled", out: "Away", returned: "Returned",
};
export const exeatTone: Record<string, "warn" | "info" | "good" | "mute" | "bad"> = {
  pending: "warn", approved: "info", rejected: "bad", cancelled: "mute", out: "warn", returned: "good",
};

export const changeLabel: Record<string, string> = { pending: "Awaiting decision", approved: "Approved", rejected: "Not approved", cancelled: "Cancelled" };

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export const dt = (iso: string | null | undefined, withTime = true) =>
  iso ? new Date(iso).toLocaleString("en-NG", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }) : "—";

/** Value for <input type="datetime-local"> from a Date. */
export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
