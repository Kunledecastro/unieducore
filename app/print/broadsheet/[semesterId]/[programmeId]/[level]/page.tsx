"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { PrintShell, Letterhead, SignatureLines, Watermark, printedOn } from "@/components/PrintShell";
import { supabase } from "@/lib/supabase";
import { resultCols, semKey, summarise, remark, type ResultRow } from "@/lib/docs";

type Student = { id: string; matric_no: string; profile: { full_name: string } | null };
type Meta = {
  sem: { name: string; number: number; session: { name: string } | null } | null;
  prog: { name: string; award: string; department: { name: string; faculty: { name: string } | null } | null } | null;
  probation: number;
};

function Broadsheet() {
  const { profile } = useAuth();
  const { semesterId, programmeId, level } = useParams<{ semesterId: string; programmeId: string; level: string }>();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const [{ data: sem }, { data: prog }, { data: st }, { data: set }] = await Promise.all([
        supabase.from("uni_semesters").select("name, number, session:uni_sessions(name)").eq("id", semesterId).single(),
        supabase.from("uni_programmes").select("name, award, department:uni_departments(name, faculty:uni_faculties(name))").eq("id", programmeId).single(),
        supabase.from("uni_students").select("id, matric_no, profile:uni_profiles(full_name)").eq("programme_id", programmeId).eq("level", Number(level)).order("matric_no"),
        supabase.from("uni_settings").select("probation_cgpa").single(),
      ]);
      const list = (st as unknown as Student[]) ?? [];
      setMeta({ sem: sem as unknown as Meta["sem"], prog: prog as unknown as Meta["prog"], probation: Number(set?.probation_cgpa ?? 1) });
      setStudents(list);
      if (list.length) {
        const all: ResultRow[] = [];
        for (let i = 0; i < list.length; i += 80) { // keep request URLs short for large classes
          const ids = list.slice(i, i + 80).map((s) => s.id);
          for (let from = 0; ; from += 1000) { // the API returns at most 1000 rows per request
            const { data: r } = await supabase.from("uni_v_results").select(resultCols).in("student_id", ids).order("registration_course_id").range(from, from + 999);
            all.push(...((r as ResultRow[]) ?? []));
            if (!r || r.length < 1000) break;
          }
        }
        setRows(all);
      }
      setLoaded(true);
    })();
  }, [profile, semesterId, programmeId, level]);

  const view = useMemo(() => {
    const cur = rows.filter((r) => r.semester_id === semesterId);
    const key = cur[0] ? semKey(cur[0]) : meta?.sem ? `${meta.sem.session?.name}#${meta.sem.number}` : "";
    const courses = [...new Map(cur.map((r) => [r.course_id, { id: r.course_id, code: r.code, units: r.units }])).values()].sort((a, b) => a.code.localeCompare(b.code));
    const statuses = new Set(cur.map((r) => r.result_status));
    const allFinal = cur.length > 0 && [...statuses].every((s) => s === "senate_approved" || s === "released");
    const table = students.filter((s) => cur.some((r) => r.student_id === s.id)).map((s) => {
      const mine = rows.filter((r) => r.student_id === s.id);
      const cells = new Map(mine.filter((r) => r.semester_id === semesterId).map((r) => [r.course_id, r]));
      return { s, cells, sum: summarise(mine, key) };
    });
    return { courses, table, allFinal, pending: cur.filter((r) => r.grade === null).length };
  }, [rows, students, semesterId, meta]);

  if (!loaded || !meta) return <p className="text-sm text-ink-3">Loading…</p>;
  const p = meta.prog;
  const passCount = view.table.filter((t) => t.sum.outstanding.length === 0 && (t.sum.cgpa ?? 0) >= meta.probation).length;

  return (
    <>
      {!view.allFinal && <Watermark text="Provisional" />}
      <Letterhead university={profile?.tenant?.name ?? ""} short={profile?.tenant?.short_name} title="Senate Result Broadsheet"
        subtitle={<>{meta.sem?.session?.name} Session · {meta.sem?.name} · {p?.award} {p?.name} · {level} Level</>}
        right={<>{p?.department?.faculty?.name}<br />Department of {p?.department?.name}<br />Printed {printedOn()}</>} />

      {view.table.length === 0 ? <p className="text-center text-sm text-ink-3">No approved registrations for this programme and level in this semester.</p> : (
        <>
          <table className="tbl text-[9.5px]">
            <thead>
              <tr>
                <th rowSpan={2} className="c">S/N</th>
                <th rowSpan={2}>Matric No.</th>
                <th rowSpan={2}>Name</th>
                {view.courses.map((c) => <th key={c.id} className="c whitespace-nowrap">{c.code}</th>)}
                <th colSpan={3} className="c">This semester</th>
                <th colSpan={3} className="c">Cumulative</th>
                <th rowSpan={2}>Remarks</th>
              </tr>
              <tr>
                {view.courses.map((c) => <th key={c.id} className="c font-normal">{c.units}u</th>)}
                <th className="c">TCU</th><th className="c">TGP</th><th className="c">GPA</th>
                <th className="c">TCU</th><th className="c">TGP</th><th className="c">CGPA</th>
              </tr>
            </thead>
            <tbody>
              {view.table.map(({ s, cells, sum }, i) => (
                <tr key={s.id}>
                  <td className="c">{i + 1}</td>
                  <td className="font-mono whitespace-nowrap">{s.matric_no}</td>
                  <td className="whitespace-nowrap">{s.profile?.full_name}</td>
                  {view.courses.map((c) => {
                    const r = cells.get(c.id);
                    return <td key={c.id} className="c whitespace-nowrap">{!r ? "" : r.grade === null ? "—" : <>{Number(r.total)}<b className="ml-0.5">{r.grade}</b>{r.is_carryover ? "*" : ""}</>}</td>;
                  })}
                  <td className="c">{sum.tcu}</td><td className="c">{sum.tgp}</td><td className="c font-semibold">{sum.gpa?.toFixed(2) ?? "—"}</td>
                  <td className="c">{sum.cumTcu}</td><td className="c">{sum.cumTgp}</td><td className="c font-semibold">{sum.cgpa?.toFixed(2) ?? "—"}</td>
                  <td className="text-[9px]">{remark(sum, meta.probation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-x-6 text-[10px] text-ink-2">
            <span>Cells show total score and grade. * carry-over course. — score not yet recorded.</span>
            <span>TCU total credit units · TGP total grade points (units × points) · GPA = TGP ÷ TCU</span>
            <span>Probation below CGPA {meta.probation.toFixed(2)}</span>
          </div>
          <table className="tbl mt-3 w-auto text-[10px] break-inside-avoid">
            <tbody>
              <tr><th>Students</th><td className="num">{view.table.length}</td><th>Clear pass</th><td className="num">{passCount}</td>
                <th>With carry-overs or on probation</th><td className="num">{view.table.length - passCount}</td>
                {view.pending > 0 && <><th>Scores outstanding</th><td className="num">{view.pending}</td></>}</tr>
            </tbody>
          </table>
        </>
      )}

      <SignatureLines roles={["Head of Department", "Dean of Faculty", "Registrar (Secretary to Senate)", "Vice-Chancellor (Chairman of Senate)"]} />
    </>
  );
}

export default function Page() {
  return <PrintShell landscape allow={["hod", "registrar", "admin"]} title="Senate result broadsheet"><Broadsheet /></PrintShell>;
}
