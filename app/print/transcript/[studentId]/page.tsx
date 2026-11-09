"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/auth";
import { PrintShell, Letterhead, SignatureLines, Watermark, printedOn } from "@/components/PrintShell";
import { supabase } from "@/lib/supabase";
import { resultCols, semKey, summarise, type ResultRow } from "@/lib/docs";
import { degreeClass, type DegreeClass } from "@/lib/student";

type Student = {
  id: string; matric_no: string; level: number; status: string;
  profile: { full_name: string; email: string } | null;
  programme: { name: string; award: string; duration_years: number; department: { name: string; faculty: { name: string } | null } | null } | null;
  entry: { name: string } | null;
};

function Transcript() {
  const { profile } = useAuth();
  const params = useParams<{ studentId: string }>();
  const [st, setSt] = useState<Student | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [classes, setClasses] = useState<DegreeClass[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [scale, setScale] = useState("");

  const isStudent = profile?.role === "student";
  const sid = params.studentId === "me" ? profile?.id : params.studentId;

  useEffect(() => {
    if (!profile || !sid) return;
    if (isStudent && sid !== profile.id) { setErr("You can only print your own transcript."); return; }
    Promise.all([
      supabase.from("uni_students").select("id, matric_no, level, status, profile:uni_profiles(full_name, email), programme:uni_programmes(name, award, duration_years, department:uni_departments(name, faculty:uni_faculties(name))), entry:uni_sessions!uni_students_entry_session_id_fkey(name)").eq("id", sid).maybeSingle(),
      supabase.from("uni_v_results").select(resultCols).eq("student_id", sid).eq("result_status", "released"),
      supabase.from("uni_degree_classes").select("name, min_cgpa"),
      supabase.from("uni_grade_bands").select("grade, min_score, points").order("min_score", { ascending: false }),
    ]).then(([s, r, c, b]) => {
      setScale(((b.data as { grade: string; min_score: number; points: number }[]) ?? []).map((x) => `${x.grade} (${Number(x.min_score)}+) = ${Number(x.points)}`).join(", "));
      if (!s.data) { setErr("Student not found."); return; }
      setSt(s.data as unknown as Student);
      setRows(((r.data as ResultRow[]) ?? []).filter((x) => x.grade !== null));
      setClasses((c.data as DegreeClass[]) ?? []);
    });
  }, [profile, sid, isStudent]);

  const semesters = useMemo(() => {
    const keys = [...new Set(rows.map(semKey))].sort();
    return keys.map((k) => {
      const list = rows.filter((r) => semKey(r) === k).sort((a, b) => a.code.localeCompare(b.code));
      return { key: k, session: list[0].session_name, name: list[0].semester_name, list, sum: summarise(rows, k) };
    });
  }, [rows]);

  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!st) return <p className="text-sm text-ink-3">Loading…</p>;

  const final = semesters.at(-1)?.sum;
  const today = new Date();
  const ref = `${profile?.tenant?.short_name ?? "UNI"}/TR/${st.matric_no.replace(/\D/g, "")}/${today.toISOString().slice(0, 10).replace(/-/g, "")}`;
  const p = st.programme;

  return (
    <>
      {isStudent && <Watermark text="Unofficial copy" />}
      <Letterhead university={profile?.tenant?.name ?? ""} short={profile?.tenant?.short_name}
        title={isStudent ? "Statement of Results (Unofficial)" : "Academic Transcript"}
        right={<>Ref: <span className="font-mono">{ref}</span><br />Issued {printedOn()}</>} />

      <table className="tbl mb-4">
        <tbody>
          <tr><th className="w-32">Name</th><td>{st.profile?.full_name}</td><th className="w-32">Matric No.</th><td className="font-mono">{st.matric_no}</td></tr>
          <tr><th>Programme</th><td>{p?.award} {p?.name} ({p?.duration_years} years)</td><th>Current level</th><td>{st.level}</td></tr>
          <tr><th>Department</th><td>{p?.department?.name}</td><th>Faculty</th><td>{p?.department?.faculty?.name}</td></tr>
          <tr><th>Year of entry</th><td>{st.entry?.name ?? "—"}</td><th>Status</th><td className="capitalize">{st.status}</td></tr>
        </tbody>
      </table>

      {semesters.length === 0 && <p className="my-8 text-center text-sm text-ink-3">No released results yet.</p>}
      {semesters.map((s) => (
        <section key={s.key} className="mb-4 break-inside-avoid">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wide">{s.session} Session · {s.name}</h2>
          <table className="tbl">
            <thead><tr><th className="w-24">Code</th><th>Course title</th><th className="w-12 c">Units</th><th className="w-14 c">Score</th><th className="w-12 c">Grade</th><th className="w-14 c">Points</th></tr></thead>
            <tbody>
              {s.list.map((r) => (
                <tr key={r.registration_course_id}>
                  <td>{r.code}{r.is_carryover ? "*" : ""}</td><td>{r.title}</td>
                  <td className="c">{r.units}</td><td className="c">{Number(r.total)}</td><td className="c font-semibold">{r.grade}</td><td className="c">{r.units * Number(r.points)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="num font-semibold">Semester: TCU {s.sum.tcu} · TGP {s.sum.tgp} · GPA {s.sum.gpa?.toFixed(2)}</td>
                <td colSpan={4} className="c font-semibold">CGPA {s.sum.cgpa?.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}

      {final && (
        <table className="tbl mt-2 break-inside-avoid">
          <tbody>
            <tr>
              <th>Total credit units</th><td className="num">{final.cumTcu}</td>
              <th>Total grade points</th><td className="num">{final.cumTgp}</td>
              <th>Cumulative GPA</th><td className="num font-bold">{final.cgpa?.toFixed(2)}</td>
              <th>{st.status === "graduated" ? "Class of degree" : "Current standing"}</th><td className="font-bold">{degreeClass(final.cgpa, classes)}</td>
            </tr>
            {final.outstanding.length > 0 && <tr><th>Outstanding courses</th><td colSpan={7}>{final.outstanding.join(", ")}</td></tr>}
          </tbody>
        </table>
      )}

      <p className="mt-3 text-[10px] text-ink-2">
        Grading scale: {scale}. * carry-over course.
        {!isStudent && " This transcript is valid only with the Registrar's signature and the university seal."}
      </p>
      {isStudent ? (
        <p className="mt-6 text-[10px] text-ink-3">This is an unofficial statement printed by the student. Official transcripts are issued by the Office of the Registrar.</p>
      ) : (
        <SignatureLines roles={["Registrar", "University seal"]} />
      )}
    </>
  );
}

export default function Page() {
  return <PrintShell allow={["student", "registrar", "admin"]} title="Academic transcript"><Transcript /></PrintShell>;
}
