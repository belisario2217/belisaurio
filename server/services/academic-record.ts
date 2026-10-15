import { all, get } from "../db.js";
import { ApiError } from "../utils.js";
import type { CertificateAuthority } from "../../shared/plan-certification.js";

/** Semester = curricular progress; cycle = calendar dates. Never infer one from the other. */
export function getAcademicStudent(studentId: number) {
  const student = get<{
    id: number; enrollment_id: number; student_number: string; student_name: string; curp: string | null;
    program_id: number; program_name: string; group_id: number; group_name: string; shift_name: string;
    modality: string; cycle_id: number; cycle_name: string; cycle_start_date: string; cycle_end_date: string;
    curricular_period_name: string | null; curricular_period_number: number | null;
    plan_id: number | null; plan_name: string | null; rvoe: string | null;
    certificate_authority: CertificateAuthority | null; assigned_plan_id: number | null;
    shift_start_time: string | null; shift_end_time: string | null;
  }>(
    `SELECT st.id, e.id AS enrollment_id, st.student_number, st.curp,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
      e.program_id, p.name AS program_name, g.id AS group_id, g.name AS group_name, sh.name AS shift_name,
      COALESCE(g.study_modality, 'escolarizado') AS modality,
      sc.id AS cycle_id, sc.name AS cycle_name, sc.start_date AS cycle_start_date, sc.end_date AS cycle_end_date,
      cp.name AS curricular_period_name, cp.sequence AS curricular_period_number,
      pl.id AS plan_id, pl.name AS plan_name, pl.rvoe, pl.certificate_authority,
      COALESCE(e.plan_id, g.plan_id) AS assigned_plan_id,
      sh.start_time AS shift_start_time, sh.end_time AS shift_end_time
     FROM students st
     JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
     JOIN programs p ON p.id = e.program_id
     JOIN groups g ON g.id = e.group_id
     JOIN shifts sh ON sh.id = e.shift_id
     JOIN institution_settings i ON i.id = 1
     JOIN school_cycles sc ON sc.id = COALESCE(g.active_cycle_id, i.active_cycle_id, e.cycle_id)
     LEFT JOIN curricular_periods cp ON cp.id = COALESCE(e.curricular_period_id, g.curricular_period_id)
     LEFT JOIN academic_plans pl ON pl.id = COALESCE(e.plan_id, g.plan_id, (
       SELECT fallback.id FROM academic_plans fallback
       WHERE fallback.program_id = e.program_id AND fallback.is_active = 1 ORDER BY fallback.id DESC LIMIT 1
     ))
     WHERE st.id = ? AND st.is_active = 1 ORDER BY e.id DESC LIMIT 1`, studentId
  );
  if (!student) throw new ApiError(404, "No se encontró una inscripción activa para el alumno.");
  if (!student.curricular_period_number) {
    throw new ApiError(409, "Configura el semestre actual del alumno o de su grupo antes de emitir el documento.");
  }
  return { ...student, curricular_period_number: student.curricular_period_number };
}

export type AcademicStudent = ReturnType<typeof getAcademicStudent>;
export type AcademicSubject = {
  subject_id: number; subject_code: string; subject_name: string; semester_number: number;
  subject_type: "mandatory" | "elective"; credits: number;
  cycle_id: number | null; cycle_name: string | null;
  partial_1: number | null; partial_2: number | null; partial_3: number | null;
  final_score: number | null; status: "pending" | "in_progress" | "completed" | "passed" | "failed";
  comments: string | null;
};
type ExplicitSubject = {
  id: number; subject_id: number; subject_code: string; subject_name: string; semester_number: number;
  subject_type: "mandatory" | "elective"; credits: number; school_cycle_id: number | null; cycle_name: string | null;
  status: "pending" | "in_progress" | "completed"; final_score: number | null; notes: string | null;
};
type GradeRow = {
  subject_id: number; subject_code: string; subject_name: string; credits: number;
  cycle_id: number; cycle_name: string; period_id: number; period_sequence: number;
  evaluation_mode: string; partial_1: number | null; partial_2: number | null; partial_3: number | null;
  final_score: number | null; passing_score: number; comments: string | null;
};
type PlanSubject = {
  subject_id: number; subject_code: string; subject_name: string; semester_number: number;
  subject_type: "mandatory" | "elective"; credits: number;
};

function subjectResult(base: PlanSubject, grades: GradeRow[], explicit?: ExplicitSubject): AcademicSubject {
  const partial = grades.filter(row => row.evaluation_mode === "partials"
    && (row.partial_1 != null || row.partial_2 != null || row.partial_3 != null)).at(-1);
  const partials = [1, 2, 3].map(n => partial
    ? partial[`partial_${n}` as "partial_1" | "partial_2" | "partial_3"]
    : grades.filter(row => row.period_sequence === n).at(-1)?.final_score ?? null);
  const scores = grades.map(row => row.final_score).filter((score): score is number => score != null);
  const incomplete = !!partial && partials.some(score => score == null);
  const score = incomplete ? null : explicit?.final_score ?? (partial?.final_score ?? (scores.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)) : null));
  const passing = grades.at(-1)?.passing_score
    ?? get<{passing_score: number}>("SELECT passing_score FROM grading_scales WHERE id = (SELECT default_scale_id FROM institution_settings WHERE id = 1)")?.passing_score;
  const status = score != null && passing != null ? (score >= passing ? "passed" : "failed")
    : incomplete ? "in_progress"
    : explicit?.status === "completed" ? "completed"
    : incomplete || explicit?.status === "in_progress" ? "in_progress" : "pending";
  return {
    ...base, cycle_id: explicit?.school_cycle_id ?? grades.at(-1)?.cycle_id ?? null,
    cycle_name: explicit?.cycle_name ?? grades.at(-1)?.cycle_name ?? null,
    partial_1: partials[0], partial_2: partials[1], partial_3: partials[2], final_score: score, status,
    comments: [...new Set([explicit?.notes, ...grades.map(row => row.comments)].filter(Boolean))].join(" | ") || null
  };
}

/** Only actual previous coursework and the current semester; never future plan subjects. */
export function getAcademicRecord(studentId: number, kind: "report_card" | "academic_history", periodId?: number) {
  const student = getAcademicStudent(studentId);
  const semester = student.curricular_period_number;
  if (periodId && !get("SELECT id FROM academic_periods WHERE id = ? AND cycle_id = ?", periodId, student.cycle_id)) {
    throw new ApiError(400, "El periodo de evaluación debe pertenecer al ciclo escolar activo del alumno.");
  }
  const plan = all<PlanSubject>(
    `SELECT ps.subject_id, s.code AS subject_code, s.name AS subject_name,
      ps.recommended_period AS semester_number, ps.subject_type, ps.credits
     FROM plan_subjects ps JOIN subjects s ON s.id = ps.subject_id
     WHERE ps.plan_id = ? AND ps.recommended_period <= ?`, student.plan_id, semester
  );
  const explicit = all<ExplicitSubject>(
    `SELECT ss.*, s.code AS subject_code, s.name AS subject_name, sc.name AS cycle_name
     FROM student_subjects ss JOIN subjects s ON s.id = ss.subject_id
     LEFT JOIN enrollments e ON e.id = ss.enrollment_id
     LEFT JOIN school_cycles sc ON sc.id = ss.school_cycle_id
     WHERE ss.student_id = ? AND ss.semester_number <= ?
       AND (ss.plan_id = ? OR (ss.plan_id IS NULL AND (e.program_id = ? OR ss.enrollment_id IS NULL)))
       AND (ss.school_cycle_id IS NULL OR sc.start_date <= ?)
     ORDER BY sc.start_date DESC, ss.id DESC`, student.id, semester, student.plan_id, student.program_id, student.cycle_start_date
  );
  const grades = all<GradeRow>(
    `SELECT a.subject_id, s.code AS subject_code, s.name AS subject_name, s.credits,
      ap.cycle_id, sc.name AS cycle_name, ap.id AS period_id, ap.sequence AS period_sequence,
      a.evaluation_mode, gr.partial_1, gr.partial_2, gr.partial_3, gr.final_score, gs.passing_score, gr.comments
     FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id
     JOIN subject_assignments a ON a.id = gr.assignment_id JOIN subjects s ON s.id = a.subject_id
     JOIN academic_periods ap ON ap.id = a.period_id JOIN school_cycles sc ON sc.id = ap.cycle_id
     JOIN grading_scales gs ON gs.id = a.grading_scale_id
     WHERE e.student_id = ? AND e.program_id = ? AND (e.plan_id = ? OR e.plan_id IS NULL)
       AND sc.start_date <= ?
     ORDER BY sc.start_date, ap.sequence, gr.updated_at, gr.id`,
    student.id, student.program_id, student.plan_id, student.cycle_start_date
  );
  const chosen = new Map<string, AcademicSubject>();
  const hasCurrentAssignments = explicit.some(subject => subject.semester_number === semester
    && (subject.school_cycle_id == null || subject.school_cycle_id === student.cycle_id));
  const hasCoursework = (rows: GradeRow[]) => rows.some(row => row.final_score != null
    || row.partial_1 != null || row.partial_2 != null || row.partial_3 != null);
  const matchingGrades = (subjectId: number, cycleId: number | null, current: boolean) => {
    let rows = grades.filter(row => row.subject_id === subjectId
      && (current ? row.cycle_id === student.cycle_id : cycleId == null || row.cycle_id === cycleId)
      && (!current || !periodId || row.period_id === periodId));
    // Repeated courses use the most recent attempt, never an average across school cycles.
    if (!current && cycleId == null && rows.length) rows = rows.filter(row => row.cycle_id === rows.at(-1)!.cycle_id);
    return rows;
  };
  for (const subject of explicit) {
    const current = subject.semester_number === semester;
    if (kind === "report_card" && !current) continue;
    if (current && subject.school_cycle_id != null && subject.school_cycle_id !== student.cycle_id) continue;
    const key = `${subject.semester_number}:${subject.subject_id}`;
    if (chosen.has(key)) continue;
    const rows = matchingGrades(subject.subject_id, subject.school_cycle_id, current);
    if (!current && subject.status === "pending" && subject.final_score == null && !hasCoursework(rows)) continue;
    chosen.set(key, subjectResult(subject, rows, subject));
  }
  for (const subject of plan) {
    const current = subject.semester_number === semester;
    if (kind === "report_card" && !current) continue;
    if (current && hasCurrentAssignments) continue;
    const key = `${subject.semester_number}:${subject.subject_id}`;
    // Explicit semester placement overrides a plan recommendation, including a future placement.
    const placement = get<{semester_number:number}>(
      "SELECT semester_number FROM student_subjects WHERE student_id = ? AND subject_id = ? AND (plan_id = ? OR plan_id IS NULL) ORDER BY id DESC LIMIT 1",
      student.id, subject.subject_id, student.plan_id
    );
    if (placement && placement.semester_number !== subject.semester_number) continue;
    if (chosen.has(key)) continue;
    const rows = matchingGrades(subject.subject_id, null, current);
    if (current && subject.subject_type === "elective" && !hasCoursework(rows)) continue;
    if (!current && !hasCoursework(rows)) continue;
    const result = subjectResult(subject, rows);
    if (current) { result.cycle_id = student.cycle_id; result.cycle_name = student.cycle_name; }
    chosen.set(key, result);
  }
  // Grade-only subjects without a curricular placement cannot establish a semester.
  // Keep them out of official documents until Control Escolar assigns that placement.
  const subjects = [...chosen.values()].sort((a, b) => a.semester_number - b.semester_number
    || a.subject_name.localeCompare(b.subject_name, "es-MX"));
  const scored = subjects.filter(subject => subject.final_score != null);
  const average = scored.length ? Number((scored.reduce((sum, subject) => sum + subject.final_score!, 0) / scored.length).toFixed(1)) : null;
  return { student, subjects, average };
}

export type AcademicRecord = ReturnType<typeof getAcademicRecord>;
