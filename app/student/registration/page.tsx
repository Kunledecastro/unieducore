"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell, useAuth } from "@/components/auth";
import { Card, PageHead, Pill, Button, Notice, Table, td, Empty } from "@/components/ui";
import { supabase, errMsg, naira } from "@/lib/supabase";
import { useStudent } from "@/lib/student";

type Avail = { offering_id: string; code: string; title: string; units: number; is_compulsory: boolean; is_carryover: boolean; selected: boolean };
type Settings = { min_units: number; max_units: number };

function Registration() {
  const { profile } = useAuth();
  const { semester, registration, due, paid, loading, reload } = useStudent(profile?.id);
  const [courses, setCourses] = useState<Avail[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>({ min_units: 15, max_units: 24 });
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, { data: s }] = await Promise.all([
      supabase.rpc("uni_available_courses"),
      supabase.from("uni_settings").select("min_units, max_units").single(),
    ]);
    const list = (data as Avail[]) ?? [];
    setCourses(list);
    const already = list.filter((c) => c.selected).map((c) => c.offering_id);
    setPicked(new Set(already.length ? already : list.filter((c) => c.is_compulsory || c.is_carryover).map((c) => c.offering_id)));
    if (s) setSettings(s as Settings);
  }, []);
  useEffect(() => { load(); }, [load]);

  const units = useMemo(() => courses.filter((c) => picked.has(c.offering_id)).reduce((a, c) => a + c.units, 0), [courses, picked]);
  const locked = registration?.status === "approved" || registration?.status === "submitted";
  const outstanding = Math.max(0, due - paid);
  const unitsOk = units >= settings.min_units && units <= settings.max_units;

  function toggle(c: Avail) {
    if (locked || c.is_compulsory || c.is_carryover) return;
    const n = new Set(picked);
    if (n.has(c.offering_id)) n.delete(c.offering_id); else n.add(c.offering_id);
    setPicked(n);
  }

  async function submit() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("uni_submit_registration", { p_offering_ids: Array.from(picked) });
    setBusy(false);
    if (error) setMsg({ kind: "error", text: errMsg(error) });
    else { setMsg({ kind: "success", text: "Course form submitted to your Head of Department for approval." }); reload(); load(); }
  }

  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;

  return (
    <>
      <PageHead title="Course registration" sub={`${semester?.session?.name} session · ${semester?.name}`}
        right={registration && (
          registration.status === "approved" ? <Pill tone="good">Approved by HOD</Pill>
          : registration.status === "submitted" ? <Pill tone="info">Awaiting HOD approval</Pill>
          : <Pill tone="bad">Returned by HOD</Pill>)} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
      {!semester?.registration_open && !registration && <Notice kind="info">Registration is closed for this semester.</Notice>}
      {outstanding > 0 && !locked && <Notice kind="error">You have {naira(outstanding)} outstanding for this session. Pay from your Overview page before submitting.</Notice>}

      <Card title="Available courses"
        right={<span className={`text-sm tabular-nums ${unitsOk ? "text-good" : "text-bad"}`}>{units} units selected · allowed {settings.min_units}–{settings.max_units}</span>}>
        {courses.length === 0 ? <Empty>No courses are offered for your level this semester.</Empty> : (
          <Table head={["", "Code", "Title", "Units", "Type"]}>
            {courses.map((c) => {
              const on = picked.has(c.offering_id);
              const fixed = c.is_compulsory || c.is_carryover;
              return (
                <tr key={c.offering_id} onClick={() => toggle(c)} className={`${!locked && !fixed ? "cursor-pointer hover:bg-mute" : ""}`}>
                  <td className={td}><input type="checkbox" checked={on} readOnly disabled={locked || fixed} className="accent-brand h-4 w-4" /></td>
                  <td className={`${td} font-medium`}>{c.code}</td>
                  <td className={td}>{c.title}</td>
                  <td className={`${td} tabular-nums`}>{c.units}</td>
                  <td className={td}>{c.is_carryover ? <Pill tone="bad">Carry-over</Pill> : c.is_compulsory ? <Pill>Compulsory</Pill> : <Pill tone="brand">Elective</Pill>}</td>
                </tr>
              );
            })}
          </Table>
        )}
        {!locked && courses.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={busy || !unitsOk || !semester?.registration_open}>{busy ? "Submitting…" : "Submit course form"}</Button>
            <span className="text-xs text-ink-3">Compulsory and carry-over courses are added automatically. Rules are checked again on the server.</span>
          </div>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return <Shell allow={["student"]}><Registration /></Shell>;
}
