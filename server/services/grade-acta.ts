import * as XLSX from "xlsx";
import { all, get } from "../db.js";
import type { AuthUser } from "../auth.js";
import { ApiError, asId } from "../utils.js";
import { assertTeacherAssignment, isTeacherUser, teacherIdForUser } from "./teacher-scope.js";
import { evaluationEligibility } from "./evaluation-eligibility.js";

export type GradeImportRow = {
  row: number; sheet?: string; enrollmentId: number; assignmentId: number;
  studentNumber: string; studentName: string; subject: string; group: string;
  period: string; semester?: number; score: number; comments: string;
  existingGradeId: number | null;
  partials?: Record<string, number>;
  resultingPartials?: Array<number | null>;
};
export type ImportError = { row: number; sheet?: string; message: string };
export const normalizeActaText = (input: unknown) => String(input ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Use the student's curriculum semester, not the evaluation period (Primer parcial, etc.).
const semesterSql = "COALESCE(ps.recommended_period, ap.sequence, 1)";
export function actaOptions(user: AuthUser | undefined) {
  const teacherId = teacherIdForUser(user);
  return all<any>(`SELECT DISTINCT a.id, a.group_id, g.name AS group_name,
    s.name AS subject_name, s.code AS subject_code, ap.name AS period_name,
    sc.name AS cycle_name, ${semesterSql} AS semester
    FROM subject_assignments a JOIN groups g ON g.id = a.group_id
    JOIN subjects s ON s.id = a.subject_id JOIN academic_periods ap ON ap.id = a.period_id
    JOIN school_cycles sc ON sc.id = ap.cycle_id
    JOIN enrollments e ON e.group_id = g.id AND e.is_active = 1
    LEFT JOIN plan_subjects ps ON ps.plan_id = e.plan_id AND ps.subject_id = a.subject_id
    WHERE a.is_active = 1 AND a.evaluation_mode = 'partials'
    AND (? IS NULL OR a.teacher_id = ?)
    ORDER BY g.name, semester, s.name, ap.sequence`, teacherId, teacherId);
}

function idList(input: unknown, label: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(input ?? "[]")); } catch { throw new ApiError(400, `${label}: selección inválida.`); }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 300) throw new ApiError(400, `Selecciona ${label}.`);
  return [...new Set(parsed.map((id) => asId(id, label)))];
}

function semesterNumber(value: unknown) {
  const text = normalizeActaText(value).replace(/semestre/g, "").replace(/[°º.]/g, "").trim().replace(/^primer$/, "primero").replace(/^tercer$/, "tercero");
  const words = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo", "noveno", "decimo"];
  const roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
  if (words.includes(text)) return words.indexOf(text) + 1;
  if (roman.includes(text)) return roman.indexOf(text) + 1;
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

export function previewActa(buffer: Buffer, body: Record<string, unknown>, user: AuthUser | undefined) {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: "buffer" }); }
  catch { throw new ApiError(400, "No se pudo leer el archivo. Guarda una copia válida de Excel e inténtalo de nuevo."); }
  const sheets = workbook.SheetNames.filter((name) => normalizeActaText(workbook.Sheets[name].A1?.v) === "acta grupal de calificaciones");
  if (!sheets.length) return null;
  const groupId = asId(body.groupId, "Grupo");
  const assignmentIds = idList(body.assignmentIds, "las materias");
  const semesters = idList(body.semesters, "los semestres");
  assignmentIds.forEach((id) => assertTeacherAssignment(user, id));
  const options = actaOptions(user).filter((a) => a.group_id === groupId && semesters.includes(a.semester));
  if (assignmentIds.some((id) => !options.some((a) => a.id === id))) {
    throw new ApiError(400, "Las materias deben pertenecer al grupo y semestres seleccionados y usar tres parciales.");
  }
  const candidates = all<any>(`SELECT e.id AS enrollment_id, st.student_number,
    TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
    TRIM(st.last_name || ' ' || COALESCE(st.second_last_name, '') || ' ' || st.first_name) AS surname_first,
    a.id AS assignment_id, a.grade_entry_locked, s.name AS subject_name, s.code AS subject_code,
    g.name AS group_name, ap.name AS period_name, sc.name AS cycle_name, p.name AS program_name,
    ${semesterSql} AS semester, gs.min_score, gs.max_score, gs.decimals
    FROM enrollments e JOIN students st ON st.id = e.student_id
    JOIN groups g ON g.id = e.group_id JOIN programs p ON p.id = g.program_id
    JOIN subject_assignments a ON a.group_id = g.id
    JOIN subjects s ON s.id = a.subject_id JOIN academic_periods ap ON ap.id = a.period_id
    JOIN school_cycles sc ON sc.id = ap.cycle_id JOIN grading_scales gs ON gs.id = a.grading_scale_id
    LEFT JOIN plan_subjects ps ON ps.plan_id = e.plan_id AND ps.subject_id = a.subject_id
    WHERE e.is_active = 1 AND st.is_active = 1 AND a.is_active = 1 AND g.id = ?`, groupId)
    .filter((a) => assignmentIds.includes(a.assignment_id) && semesters.includes(a.semester));
  const valid: GradeImportRow[] = [];
  const errors: ImportError[] = [];
  const seen = new Map<string, GradeImportRow>();
  const duplicates = new Set<string>();
  let total = 0;
  for (const sheetName of sheets) {
    const sheet = workbook.Sheets[sheetName];
    const text = (cell: string) => normalizeActaText(sheet[cell]?.v);
    if (!["alumnos", "primero", "segundo", "tercero"].every((label, i) => text(["A5", "E5", "F5", "G5"][i]) === label)) {
      errors.push({ sheet: sheetName, row: 5, message: "Encabezados del acta inválidos. Usa la plantilla original." });
      continue;
    }
    const subject = text("E3");
    const semester = text("C3");
    const scoped = candidates.filter((a) =>
      (!text("C2") || text("C2") === normalizeActaText(a.group_name)) &&
      (!text("E2") || text("E2") === normalizeActaText(a.cycle_name)) &&
      (!text("H3") || text("H3") === normalizeActaText(a.program_name)) &&
      (!subject || [a.subject_name, a.subject_code].some((v) => normalizeActaText(v) === subject)) &&
      (!semester || semesterNumber(semester) === a.semester));
    if (!scoped.length) {
      errors.push({ sheet: sheetName, row: 3, message: "Grupo, ciclo, semestre, materia o programa del acta no coinciden con la selección." });
      continue;
    }
    if (new Set(scoped.map((a) => a.assignment_id)).size !== 1 || new Set(scoped.map((a) => a.semester)).size !== 1) {
      errors.push({ sheet: sheetName, row: 3, message: "El acta corresponde a varias asignaciones. Completa materia, semestre y ciclo, o selecciona una sola asignación." });
      continue;
    }
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:H28");
    if (range.e.r > 3050) throw new ApiError(400, "El acta excede el límite de 3,000 filas.");
    for (let row = 6; row <= range.e.r + 1; row++) {
      if (text(`A${row}`) === "promedio grupal") break;
      const name = text(`B${row}`);
      if (!name) continue; // The supplied template contains zero placeholders on unnamed lines.
      const inputs = ["E", "F", "G"].map((col) => sheet[`${col}${row}`]);
      if (inputs.every((cell) => !cell?.f && (cell?.v == null || cell.v === ""))) continue;
      total++;
      if (total > 3000) throw new ApiError(400, "El archivo excede el límite de 3,000 filas.");
      const fail = (message: string) => errors.push({ sheet: sheetName, row, message });
      const matches = scoped.filter((a) => [a.student_name, a.surname_first, a.student_number].some((v) => normalizeActaText(v) === name));
      if (matches.length !== 1) {
        fail(matches.length ? "Nombre repetido en el grupo. Escribe la matrícula en la celda del alumno para identificarlo." : "Alumno no encontrado en el grupo y semestre seleccionados. Verifica el nombre completo o escribe su matrícula.");
        continue;
      }
      const match = matches[0];
      if (match.grade_entry_locked) { fail("La captura de esta materia está cerrada."); continue; }
      if (isTeacherUser(user)) {
        const eligibility = evaluationEligibility(match.assignment_id, match.enrollment_id);
        if (!eligibility.eligible) { fail(eligibility.reasons.join(" ")); continue; }
      }
      const partials: Record<string, number> = {};
      let invalid = false;
      inputs.forEach((cell, index) => {
        if (!cell?.f && (cell?.v == null || cell.v === "")) return;
        if (!cell) return;
        const raw = String(cell.v).trim().replace(",", ".");
        const score = Number(raw);
        if (cell.f || !/^-?\d+(\.\d+)?$/.test(raw) || !Number.isFinite(score) || score < match.min_score || score > match.max_score) {
          fail(`Parcial ${index + 1}: escribe un número entre ${match.min_score} y ${match.max_score}, sin fórmulas.`);
          invalid = true;
        } else partials[`partial${index + 1}`] = score;
      });
      if (invalid) continue;
      const key = `${match.enrollment_id}:${match.assignment_id}`;
      if (seen.has(key)) {
        duplicates.add(key);
        fail(`Alumno y materia duplicados; primera aparición en ${seen.get(key)!.sheet}, fila ${seen.get(key)!.row}. Corrige ambas filas.`);
        continue;
      }
      const existing = get<any>("SELECT * FROM grades WHERE enrollment_id = ? AND assignment_id = ?", match.enrollment_id, match.assignment_id);
      const resultingPartials = [1, 2, 3].map((i) => partials[`partial${i}`] ?? existing?.[`partial_${i}`] ?? null);
      const captured = resultingPartials.filter((v): v is number => v !== null);
      const item: GradeImportRow = {
        sheet: sheetName, row, enrollmentId: match.enrollment_id, assignmentId: match.assignment_id,
        studentNumber: match.student_number, studentName: match.student_name,
        subject: match.subject_name, group: match.group_name, period: match.period_name, semester: match.semester,
        score: Number((captured.reduce((sum, v) => sum + v, 0) / captured.length).toFixed(match.decimals)),
        comments: existing?.comments ?? "", existingGradeId: existing?.id ?? null, partials, resultingPartials
      };
      seen.set(key, item);
      valid.push(item);
    }
  }
  return { total, valid: valid.filter((item) => !duplicates.has(`${item.enrollmentId}:${item.assignmentId}`)), errors };
}
