"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Table, td, Pill, Stat, Empty, Button, Notice, Tabs } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";
import { standingLabel, standingTone, type Standing } from "@/lib/standing";

type Prog = { id: string; name: string; award: string; department_id: string };

function StandingPage() {
  const { profile } = useAuth();
  const isHod = profile?.role === "hod";
  const [rows, setRows] = useState<Standing[] | null>(null);
  const [progs, setProgs] = useState<Prog[]>([]);
  const [settings, setSettings] = useState<{ probation_cgpa: number; withdraw_after_probation: number } | null>(null);
  const [tab, setTab] = useState<"standing" | "graduation">("standing");
  const [filter, setFilter] = useState<string>("attention");
  const [prog, setProg] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data, error }, { data: p }, { data: s }] = await Promise.all([
      supabase.rpc("uni_academic_standing"),
      supabase.from("uni_programmes").select("id, name, award, department_id").order("name"),
      supabase.from("uni_settings").select("probation_cgpa, withdraw_after_probation").single(),
    ]);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    const all = (data as Standing[]) ?? [];
    setRows(isHod ? all.filter((r) => r.department_id === profile?.department_id) : all);
    setProgs(((p as Prog[]) ?? []).filter((x) => !isHod || x.department_id === profile?.department_id));
    if (s) setSettings({ probation_cgpa: Number(s.probation_cgpa), withdraw_after_probation: s.withdraw_after_probation });
    setPicked(new Set());
  }, [isHod, profile]);
  useEffect(() => { load(); }, [load]);

  const scoped = (rows ?? []).filter((r) => (!prog || r.programme_id === prog) && (!q || `${r.matric_no} ${r.full_name}`.toLowerCase().includes(q.toLowerCase())));
  const counts = useMemo(() => {
    const c = { good: 0, probation: 0, withdrawal: 0, no_results: 0, graduated: 0 } as Record<Standing["standing"], number>;
    scoped.forEach((r) => c[r.standing]++);
    return c;
  }, [scoped]);
  const standingRows = scoped.filter((r) => filter === "all" || (filter === "attention" ? r.standing === "probation" || r.standing === "withdrawal" : r.standing === filter));
  const finalYear = scoped.filter((r) => r.status === "active" && r.level >= r.final_level);
  const graduated = scoped.filter((r) => r.standing === "graduated");
  const eligible = finalYear.filter((r) => r.eligible);

  async function confirmGraduation() {
    const ids = [...picked];
    if (!confirm(`Confirm graduation for ${ids.length} student(s)? Their status becomes Graduated and their class of degree is fixed.`)) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("uni_confirm_graduation", { p_students: ids });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: `${data} student(s) graduated.` }); load(); }
  }

  return (
    <>
      <PageHead title="Academic standing" sub={settings ? `From released results only · probation below CGPA ${settings.probation_cgpa.toFixed(2)} · withdrawal recommended after ${settings.withdraw_after_probation} consecutive semester(s) on probation` : undefined}
        right={<div className="flex flex-wrap gap-2">
          <input className="input w-52" placeholder="Search name or matric no." value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={prog} onChange={(e) => setProg(e.target.value)}>
            <option value="">{isHod ? "All department programmes" : "All programmes"}</option>
            {progs.map((p) => <option key={p.id} value={p.id}>{p.award} {p.name}</option>)}
          </select>
        </div>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <Tabs value={tab} onChange={setTab} items={[{ value: "standing", label: "Standing" }, { value: "graduation", label: `Graduation (${finalYear.length} final year)` }]} />

      {tab === "standing" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["withdrawal", "probation", "good", "no_results"] as const).map((k) => (
              <button key={k} onClick={() => setFilter(filter === k ? "attention" : k)} className={`rounded-xl border px-4 py-3 text-left ${filter === k ? "border-brand bg-brand-soft" : "border-line bg-paper hover:bg-mute"}`}>
                <div className="text-xs text-ink-3">{standingLabel[k]}</div>
                <div className={`text-2xl font-semibold tabular-nums ${k === "withdrawal" && counts[k] ? "text-bad" : k === "probation" && counts[k] ? "text-warn" : ""}`}>{counts[k]}</div>
              </button>
            ))}
          </div>
          <Card title={filter === "attention" ? "Students needing attention" : filter === "all" ? "All students" : standingLabel[filter as Standing["standing"]]}
            right={<button className="text-xs text-brand hover:underline" onClick={() => setFilter(filter === "all" ? "attention" : "all")}>{filter === "all" ? "Show only students needing attention" : "Show all students"}</button>}>
            {!rows ? <p className="text-sm text-ink-3">Loading…</p> : standingRows.length === 0 ? (
              <Empty>{filter === "attention" ? "No students on probation or recommended for withdrawal." : "No students match."}</Empty>
            ) : (
              <Table head={["Matric no.", "Name", "Programme", "Level", "CGPA", "Standing", "Failed, not yet passed", ""]}>
                {standingRows.map((r) => (
                  <tr key={r.student_id}>
                    <td className={`${td} font-mono text-xs`}>{r.matric_no}</td>
                    <td className={td}>{r.full_name}</td>
                    <td className={td}>{r.programme}</td>
                    <td className={`${td} tabular-nums`}>{r.level}</td>
                    <td className={`${td} tabular-nums font-medium`}>{r.cgpa != null ? Number(r.cgpa).toFixed(2) : "—"}</td>
                    <td className={td}>
                      <Pill tone={standingTone[r.standing]}>{standingLabel[r.standing]}</Pill>
                      {(r.standing === "probation" || r.standing === "withdrawal") && <div className="mt-0.5 text-xs text-ink-3">{r.probation_semesters} semester{r.probation_semesters === 1 ? "" : "s"} in a row</div>}
                    </td>
                    <td className={`${td} text-xs`}>{r.outstanding.length ? r.outstanding.join(", ") : <span className="text-ink-3">None</span>}</td>
                    <td className={`${td} text-right`}>{!isHod && <a href={`/print/transcript/${r.student_id}`} className="text-xs text-brand hover:underline">Transcript</a>}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === "graduation" && (
        <>
          <Card title="Final-year students" className="mb-4"
            right={!isHod && eligible.length > 0 && (
              <div className="flex items-center gap-3">
                <button className="text-xs text-brand hover:underline" onClick={() => setPicked(new Set(picked.size === eligible.length ? [] : eligible.map((r) => r.student_id)))}>
                  {picked.size === eligible.length ? "Clear selection" : `Select all ${eligible.length} eligible`}
                </button>
                <Button small onClick={confirmGraduation} disabled={busy || picked.size === 0}>{busy ? "Confirming…" : `Confirm graduation (${picked.size})`}</Button>
              </div>
            )}>
            {!rows ? <p className="text-sm text-ink-3">Loading…</p> : finalYear.length === 0 ? (
              <Empty>No active students are in the final year of their programme.</Empty>
            ) : (
              <Table head={["", "Matric no.", "Name", "Programme", "CGPA", "Units", "Class of degree", "Status"]}>
                {finalYear.map((r) => (
                  <tr key={r.student_id} className={r.eligible ? "" : "bg-mute/40"}>
                    <td className={td}>{!isHod && <input type="checkbox" className="accent-brand h-4 w-4" disabled={!r.eligible} checked={picked.has(r.student_id)}
                      onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.student_id); else n.delete(r.student_id); setPicked(n); }} />}</td>
                    <td className={`${td} font-mono text-xs`}>{r.matric_no}</td>
                    <td className={td}>{r.full_name}</td>
                    <td className={td}>{r.programme}</td>
                    <td className={`${td} tabular-nums font-medium`}>{r.cgpa != null ? Number(r.cgpa).toFixed(2) : "—"}</td>
                    <td className={`${td} tabular-nums`}>{r.earned_units}{r.min_units ? ` / ${r.min_units}` : ""}</td>
                    <td className={td}>{r.degree_class ?? "—"}</td>
                    <td className={td}>
                      {r.eligible ? <Pill tone="good">Eligible</Pill> : (
                        <div><Pill tone="bad">Not eligible</Pill><ul className="mt-1 list-disc pl-4 text-xs text-ink-2">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul></div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-xs text-ink-3">
              Eligible means: final year of the programme, every compulsory course passed, no failed course outstanding, CGPA at or above the lowest class of degree,
              and the programme’s minimum units if one is set under Structure. Confirming fixes the class of degree; later rule changes do not alter it.
            </p>
          </Card>

          {graduated.length > 0 && (
            <Card title={`Graduated (${graduated.length})`}>
              <Table head={["Matric no.", "Name", "Programme", "Final CGPA", "Class of degree", "Confirmed", ""]}>
                {graduated.map((r) => (
                  <tr key={r.student_id}>
                    <td className={`${td} font-mono text-xs`}>{r.matric_no}</td>
                    <td className={td}>{r.full_name}</td>
                    <td className={td}>{r.programme}</td>
                    <td className={`${td} tabular-nums font-medium`}>{r.cgpa != null ? Number(r.cgpa).toFixed(2) : "—"}</td>
                    <td className={td}><Pill tone="brand">{r.degree_class}</Pill></td>
                    <td className={`${td} text-xs text-ink-3`}>{r.graduated_at ? new Date(r.graduated_at).toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—"}</td>
                    <td className={`${td} text-right`}>{!isHod && <a href={`/print/transcript/${r.student_id}`} className="text-xs text-brand hover:underline">Transcript</a>}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
      {isHod && <p className="mt-4 text-xs text-ink-3">Showing students in your department’s programmes. Graduation is confirmed by the Registry. <Link href="/hod" className="text-brand hover:underline">Back to approvals</Link></p>}
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin", "hod"]}><StandingPage /></Shell>;
}
