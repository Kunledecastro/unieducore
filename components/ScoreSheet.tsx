"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, gradeFor, errMsg, type GradeBand } from "@/lib/supabase";
import { scoreSheet, offeringSelect, type Offering, type SheetRow } from "@/lib/staff";
import { Card, Table, td, Empty, Pill, StatusPill, Button, Notice } from "@/components/ui";

type Mode = "lecturer" | "hod" | "registry";

export function ScoreSheet({ offeringId, mode, onChanged }: { offeringId: string; mode: Mode; onChanged?: () => void }) {
  const [offering, setOffering] = useState<Offering | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [edits, setEdits] = useState<Record<string, { ca: string; exam: string }>>({});
  const [bands, setBands] = useState<GradeBand[]>([]);
  const [limits, setLimits] = useState({ ca_max: 30, exam_max: 70 });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: o }, sheet, { data: b }, { data: s }] = await Promise.all([
      supabase.from("uni_course_offerings").select(offeringSelect).eq("id", offeringId).single(),
      scoreSheet(offeringId),
      supabase.from("uni_grade_bands").select("grade, min_score, points"),
      supabase.from("uni_settings").select("ca_max, exam_max").single(),
    ]);
    setOffering(o as unknown as Offering);
    setRows(sheet);
    setBands((b as GradeBand[]) ?? []);
    if (s) setLimits({ ca_max: Number(s.ca_max), exam_max: Number(s.exam_max) });
    const e: Record<string, { ca: string; exam: string }> = {};
    sheet.forEach((r) => { e[r.id] = { ca: r.score?.ca?.toString() ?? "", exam: r.score?.exam?.toString() ?? "" }; });
    setEdits(e);
  }, [offeringId]);
  useEffect(() => { load(); }, [load]);

  const editable = mode === "lecturer" && offering?.result_status === "draft";

  const stats = useMemo(() => {
    let complete = 0, pass = 0, sum = 0;
    const dist: Record<string, number> = {};
    rows.forEach((r) => {
      const e = edits[r.id];
      if (!e || e.ca === "" || e.exam === "") return;
      const t = Number(e.ca) + Number(e.exam);
      complete++; sum += t;
      const g = gradeFor(t, bands);
      if (g) { dist[g.grade] = (dist[g.grade] ?? 0) + 1; if (g.points > 0) pass++; }
    });
    return { complete, pass, avg: complete ? sum / complete : 0, dist };
  }, [rows, edits, bands]);

  const dirty = rows.some((r) => {
    const e = edits[r.id];
    return e && (e.ca !== (r.score?.ca?.toString() ?? "") || e.exam !== (r.score?.exam?.toString() ?? ""));
  });

  async function save(quiet = false) {
    setBusy(true); if (!quiet) setMsg(null);
    const payload = rows.map((r) => ({ registration_course_id: r.id, ca: edits[r.id]?.ca ?? "", exam: edits[r.id]?.exam ?? "" }));
    const { error } = await supabase.rpc("uni_save_scores", { p_offering: offeringId, p_scores: payload });
    setBusy(false);
    if (error) { setMsg({ kind: "error", text: errMsg(error) }); return false; }
    if (!quiet) setMsg({ kind: "success", text: "Scores saved. Every change is recorded in the audit trail." });
    await load();
    return true;
  }

  async function act(action: string, okText: string) {
    setBusy(true); setMsg(null);
    if (action === "submit" && dirty) { const ok = await save(true); if (!ok) { setBusy(false); return; } setBusy(true); }
    const { error } = await supabase.rpc("uni_advance_result", { p_offering: offeringId, p_action: action });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: okText }); await load(); onChanged?.(); }
  }

  if (!offering) return <p className="text-sm text-ink-3">Loading…</p>;
  const st = offering.result_status;

  return (
    <>
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-2">
        <span><b className="text-ink">{offering.course?.code}</b> · {offering.course?.title} · {offering.course?.units} units</span>
        <span>Lecturer: {offering.lecturer?.full_name ?? "Unassigned"}</span>
        <StatusPill status={st} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4 mb-4">
        {[
          ["Students", rows.length],
          ["Scores complete", `${stats.complete}/${rows.length}`],
          ["Pass rate", stats.complete ? `${Math.round((stats.pass / stats.complete) * 100)}%` : "—"],
          ["Average total", stats.complete ? stats.avg.toFixed(1) : "—"],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-lg border border-line bg-paper px-4 py-3">
            <div className="text-xs text-ink-3">{l}</div><div className="text-lg font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <Card title="Score sheet" right={<span className="text-xs text-ink-3">CA max {limits.ca_max} · Exam max {limits.exam_max} · grade distribution {Object.entries(stats.dist).sort().map(([g, n]) => `${g}:${n}`).join("  ") || "—"}</span>}>
        {rows.length === 0 ? <Empty>No students with an approved registration on this course yet.</Empty> : (
          <Table head={["Matric no.", "Name", "Level", `CA /${limits.ca_max}`, `Exam /${limits.exam_max}`, "Total", "Grade"]}>
            {rows.map((r) => {
              const e = edits[r.id] ?? { ca: "", exam: "" };
              const total = e.ca !== "" && e.exam !== "" ? Number(e.ca) + Number(e.exam) : null;
              const g = gradeFor(total, bands);
              const caBad = e.ca !== "" && (Number(e.ca) < 0 || Number(e.ca) > limits.ca_max);
              const exBad = e.exam !== "" && (Number(e.exam) < 0 || Number(e.exam) > limits.exam_max);
              return (
                <tr key={r.id}>
                  <td className={`${td} font-mono text-xs`}>{r.registration?.student?.matric_no}</td>
                  <td className={td}>{r.registration?.student?.profile?.full_name}{r.is_carryover && <span className="ml-2"><Pill tone="bad">Carry-over</Pill></span>}</td>
                  <td className={`${td} tabular-nums`}>{r.registration?.student?.level}</td>
                  <td className={td}>
                    {editable ? <input className={`input w-20 tabular-nums ${caBad ? "!border-bad" : ""}`} inputMode="decimal" value={e.ca}
                      onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, ca: ev.target.value } })} /> : <span className="tabular-nums">{e.ca || "—"}</span>}
                  </td>
                  <td className={td}>
                    {editable ? <input className={`input w-20 tabular-nums ${exBad ? "!border-bad" : ""}`} inputMode="decimal" value={e.exam}
                      onChange={(ev) => setEdits({ ...edits, [r.id]: { ...e, exam: ev.target.value } })} /> : <span className="tabular-nums">{e.exam || "—"}</span>}
                  </td>
                  <td className={`${td} tabular-nums font-medium`}>{total ?? "—"}</td>
                  <td className={td}>{g ? <Pill tone={g.points === 0 ? "bad" : g.points >= 4 ? "good" : "mute"}>{g.grade}</Pill> : "—"}</td>
                </tr>
              );
            })}
          </Table>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {mode === "lecturer" && st === "draft" && rows.length > 0 && <>
            <Button variant="secondary" onClick={() => save()} disabled={busy || !dirty}>Save draft</Button>
            <Button onClick={() => act("submit", "Result submitted to your Head of Department.")} disabled={busy}>Submit to HOD</Button>
          </>}
          {mode === "lecturer" && st !== "draft" && <span className="text-sm text-ink-3">Scores are locked while the result is in approval. The HOD can return it to you for corrections.</span>}
          {mode === "hod" && st === "submitted" && <>
            <Button onClick={() => act("hod_approve", "Result approved and sent to the Registry for Senate.")} disabled={busy}>Approve result</Button>
            <Button variant="danger" onClick={() => act("return", "Result returned to the lecturer for correction.")} disabled={busy}>Return to lecturer</Button>
          </>}
          {mode === "registry" && st === "hod_approved" && <>
            <Button onClick={() => act("senate_approve", "Senate approval recorded.")} disabled={busy}>Record Senate approval</Button>
            <Button variant="danger" onClick={() => act("return", "Result returned to the lecturer.")} disabled={busy}>Return to lecturer</Button>
          </>}
          {mode === "registry" && st === "senate_approved" && <Button onClick={() => act("release", "Result released. Students can now see it.")} disabled={busy}>Release to students</Button>}
        </div>
      </Card>
    </>
  );
}
