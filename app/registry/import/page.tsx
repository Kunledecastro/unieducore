"use client";

import { useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/auth";
import { Card, PageHead, Button, Notice, Table, td, Pill, Stat } from "@/components/ui";
import { supabase, errMsg } from "@/lib/supabase";
import { parseCsv, downloadText } from "@/lib/admin";

type Row = Record<string, string> & { _line: string };
type Res = { row: number; ok: boolean; matric_no?: string; course_code?: string; session?: string; semester?: number; total?: number; grade?: string; carryover?: boolean; error?: string; line: number };
type Summary = { imported: number; failed: number; new_sessions: string[]; rows: Res[] };

const TEMPLATE = "matric_no,session,semester,course_code,ca,exam,total\n" +
  "UDU/CSC/25/0001,2024/2025,1,CSC101,22,51,\n" +
  "UDU/CSC/25/0001,2024/2025,2,CSC102,,,58\n";
const CHUNK = 500;

/** Chronological order matters: a course failed earlier and passed later is marked as a carry-over. */
const chrono = (a: Row, b: Row) => `${a.session}|${a.semester}`.localeCompare(`${b.session}|${b.semester}`);

function ImportResults() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  async function run(dry: boolean): Promise<Summary | null> {
    if (!rows) return null;
    const all: Res[] = []; const sessions = new Set<string>(); let imported = 0, failed = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      setBusy(`${dry ? "Checking" : "Importing"} ${Math.min(i + CHUNK, rows.length)} of ${rows.length}…`);
      const { data, error } = await supabase.rpc("uni_import_results", { p_rows: chunk, p_dry_run: dry });
      if (error) { setMsg({ kind: "error", text: errMsg(error) }); setBusy(null); return null; }
      const s = data as Omit<Summary, "rows"> & { rows: Omit<Res, "line">[] };
      imported += s.imported; failed += s.failed; s.new_sessions.forEach((x) => sessions.add(x));
      all.push(...s.rows.map((r) => ({ ...r, line: Number(chunk[r.row - 1]._line) })));
    }
    setBusy(null);
    return { imported, failed, new_sessions: [...sessions], rows: all.sort((a, b) => a.line - b.line) };
  }

  async function onFile(file: File) {
    setMsg(null); setPreview(null); setDone(null);
    const parsed = parseCsv(await file.text());
    if (!parsed.length) { setMsg({ kind: "error", text: "No result rows found. Use the template's columns." }); return; }
    const cols = Object.keys(parsed[0]);
    const missing = ["matric_no", "session", "semester", "course_code"].filter((c) => !cols.includes(c));
    if (!cols.includes("total") && !(cols.includes("ca") && cols.includes("exam"))) missing.push("ca + exam, or total");
    if (missing.length) { setMsg({ kind: "error", text: `The file is missing: ${missing.join(", ")}.` }); return; }
    const withLines = parsed.map((r, i) => ({ ...r, _line: String(i + 2) }) as Row).sort(chrono);
    setRows(withLines); setFileName(file.name);
  }

  async function check() { const s = await run(true); if (s) setPreview(s); }
  async function commit() {
    if (!preview) return;
    if (!confirm(`Import ${preview.imported} result(s)? They will count as released results immediately and change students' CGPA.`)) return;
    const s = await run(false);
    if (s) { setDone(s); setPreview(null); setMsg({ kind: "success", text: `${s.imported} result(s) imported.${s.failed ? ` ${s.failed} row(s) skipped.` : ""}` }); }
  }

  function downloadProblems(list: Res[]) {
    downloadText("results-import-problems.csv", "line,matric_no,course_code,problem\n" +
      list.map((r) => [r.line, r.matric_no, r.course_code, r.error].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"));
  }

  const view = done ?? preview;
  const problems = view?.rows.filter((r) => !r.ok) ?? [];
  const good = view?.rows.filter((r) => r.ok) ?? [];

  return (
    <>
      <PageHead title="Import past results" sub={<Link href="/registry/students" className="text-brand hover:underline">← Students</Link>} />
      {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}

      <Card title="1. Choose a CSV file" className="mb-4">
        <div className="text-sm text-ink-2 space-y-1.5">
          <p>One row per student per course. Columns: <code className="rounded bg-mute px-1">matric_no, session, semester, course_code</code> and either <code className="rounded bg-mute px-1">ca, exam</code> or <code className="rounded bg-mute px-1">total</code>.</p>
          <p className="text-xs text-ink-3">Students and courses must already exist. Past sessions are created automatically. The current semester cannot be imported because its results come from lecturers. Imported results count as Senate-approved and released.</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            Choose file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </label>
          {rows && <span className="text-sm text-ink-2">{fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}</span>}
          <button className="text-sm text-brand hover:underline" onClick={() => downloadText("unieducore-results-template.csv", TEMPLATE)}>Download template</button>
        </div>
      </Card>

      {rows && !done && (
        <Card title="2. Check the file" className="mb-4">
          <p className="text-sm text-ink-2">Every row is checked against students, courses and your grading rules. Nothing is saved at this step.</p>
          <div className="mt-3"><Button onClick={check} disabled={!!busy}>{busy && !preview ? busy : preview ? "Check again" : "Check file"}</Button></div>
        </Card>
      )}

      {view && (
        <>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <Stat label={done ? "Imported" : "Ready to import"} value={view.imported} tone="good" />
            <Stat label={done ? "Skipped" : "Problems"} value={view.failed} tone={view.failed ? "bad" : undefined} />
            <Stat label="New past sessions" value={view.new_sessions.length || "—"} note={view.new_sessions.join(", ") || undefined} />
          </div>

          {preview && (
            <Card title="3. Import" className="mb-4">
              {preview.imported === 0 ? <p className="text-sm text-bad">No rows can be imported. Fix the problems below and choose the file again.</p> : (
                <>
                  <p className="text-sm text-ink-2">{preview.imported} result(s) will be saved{preview.failed ? ` and ${preview.failed} row(s) with problems will be skipped` : ""}. You can fix skipped rows and import them later; rows already imported are never duplicated.</p>
                  <div className="mt-3"><Button onClick={commit} disabled={!!busy}>{busy ?? `Import ${preview.imported} result(s)`}</Button></div>
                </>
              )}
            </Card>
          )}

          {problems.length > 0 && (
            <Card title={`${done ? "Skipped rows" : "Problems"} (${problems.length})`} className="mb-4"
              right={<button className="text-xs text-brand hover:underline" onClick={() => downloadProblems(problems)}>Download as CSV</button>}>
              <Table head={["Line", "Matric no.", "Course", "Problem"]}>
                {problems.slice(0, 300).map((r) => (
                  <tr key={r.line}>
                    <td className={`${td} tabular-nums text-ink-3`}>{r.line}</td>
                    <td className={`${td} font-mono text-xs`}>{r.matric_no}</td>
                    <td className={td}>{r.course_code}</td>
                    <td className={`${td} text-bad`}>{r.error}</td>
                  </tr>
                ))}
              </Table>
              {problems.length > 300 && <p className="mt-2 text-xs text-ink-3">Showing the first 300. Download the CSV for all of them.</p>}
            </Card>
          )}

          {good.length > 0 && (
            <Card title={`${done ? "Imported" : "Valid"} rows (${good.length})`}>
              <Table head={["Line", "Matric no.", "Session", "Sem.", "Course", "Total", "Grade", ""]}>
                {good.slice(0, 300).map((r) => (
                  <tr key={r.line}>
                    <td className={`${td} tabular-nums text-ink-3`}>{r.line}</td>
                    <td className={`${td} font-mono text-xs`}>{r.matric_no}</td>
                    <td className={td}>{r.session}</td>
                    <td className={td}>{r.semester}</td>
                    <td className={`${td} font-medium`}>{r.course_code}</td>
                    <td className={`${td} tabular-nums`}>{r.total}</td>
                    <td className={td}><Pill tone={r.grade === "F" ? "bad" : "mute"}>{r.grade}</Pill></td>
                    <td className={td}>{r.carryover && <Pill tone="warn">Carry-over</Pill>}</td>
                  </tr>
                ))}
              </Table>
              {good.length > 300 && <p className="mt-2 text-xs text-ink-3">Showing the first 300.</p>}
            </Card>
          )}

          {done && <div className="mt-4 flex gap-2"><Button onClick={() => { setRows(null); setDone(null); setMsg(null); }}>Import another file</Button><Link href="/registry/students"><Button variant="secondary">Back to students</Button></Link></div>}
        </>
      )}
    </>
  );
}

export default function Page() {
  return <Shell allow={["registrar", "admin"]}><ImportResults /></Shell>;
}
