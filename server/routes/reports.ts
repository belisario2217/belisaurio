import { Router } from "express";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { createPdf, pdfTable, sendWorkbook } from "../services/files.js";
import { syncGroupSubjects } from "../services/group-subjects.js";
import { getCycleCalendar, syncAcademicSubjectStatuses } from "../services/academic-calendar.js";
import { sendStudyCertificate } from "../services/study-certificate.js";
import { getAcademicRecord } from "../services/academic-record.js";
import { drawAcademicDocument, printedSubjects, publicAcademicStudent } from "../services/academic-documents.js";
import { issueDocument, type IssuedDocument } from "../services/document-verification.js";
import { ApiError, asId, asNumber, cleanText, optionalText, sendCsv } from "../utils.js";
import { displayProgramName } from "../../shared/program-name.js";

export const reportsRouter = Router();
 
// Opciones específicas de Documentos: no dependen del permiso de catálogos,
// ni del listado paginado de Alumnos (que solo entrega hasta 100 por página).
reportsRouter.get("/document-options", requirePermission("reports.view"), (_req, res) => {
  const students = all<{id:number;student_number:string;full_name:string}>(`
    SELECT st.id,st.student_number,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name,'')) AS full_name
    FROM students st WHERE st.is_active=1
    ORDER BY spanish_sort(st.last_name),spanish_sort(COALESCE(st.second_last_name,'')),
      spanish_sort(st.first_name),st.id
  `).map(student => ({id:student.id,name:`${student.student_number} - ${student.full_name}`}));
  const groups = all<{id:number;name:string;active_cycle_id:number|null;plan_id:number|null}>(`
    SELECT id,name,active_cycle_id,plan_id FROM groups WHERE is_active=1
    ORDER BY spanish_sort(name),id
  `);
  const cycles = all<{id:number;name:string}>(`
    SELECT id,name FROM school_cycles WHERE is_active=1 ORDER BY spanish_sort(name),id
  `);
  res.json({students,groups,cycles});
});


const studentListFieldDefinitions = {
  matricula: { label: "Matrícula", expression: "st.student_number" },
  nombre: { label: "Nombre", expression: "st.first_name" },
  apellido_paterno: { label: "Apellido paterno", expression: "st.last_name" },
  apellido_materno: { label: "Apellido materno", expression: "COALESCE(st.second_last_name, '')" },
  nombre_completo: { label: "Alumno", expression: "TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, ''))" },
  curp: { label: "CURP", expression: "COALESCE(st.curp, '')" },
  fecha_nacimiento: { label: "Fecha de nacimiento", expression: "COALESCE(st.birth_date, '')" },
  correo: { label: "Correo", expression: "COALESCE(st.email, '')" },
  telefono: { label: "Teléfono", expression: "COALESCE(st.phone, '')" },
  programa: { label: "Programa", expression: "COALESCE(p.name, '')" },
  turno: { label: "Turno", expression: "COALESCE(sh.name, '')" },
  grupo: { label: "Grupo", expression: "COALESCE(g.name, '')" },
  ciclo: { label: "Ciclo", expression: "COALESCE(sc.name, '')" },
  periodo: { label: "Periodo", expression: "COALESCE(ap.name, '')" },
  estatus: { label: "Estatus", expression: "COALESCE(ss.name, '')" }
} as const;

type StudentListField = keyof typeof studentListFieldDefinitions;
const defaultStudentListFields: StudentListField[] = ["matricula", "nombre_completo", "programa", "turno", "grupo", "estatus"];

function resolveStudentListFields(input: unknown) {
  const requested = String(input ?? "").split(",").map((value) => value.trim())
    .filter((value): value is StudentListField => value in studentListFieldDefinitions);
  const unique = [...new Set(requested)];
  return (unique.length ? unique : defaultStudentListFields).slice(0, 8);
}

function studentListRows(groupId?: number, fields = defaultStudentListFields) {
  const selected = fields.map((field) => studentListFieldDefinitions[field]);
  const columns = selected.map((field, index) => `${field.expression} AS "${fields[index]}"`).join(",\n      ");
  return all<any>(
    `WITH latest_enrollments AS (
       SELECT e.* FROM enrollments e
       WHERE e.is_active = 1
         AND e.id = (SELECT e2.id FROM enrollments e2 WHERE e2.student_id = e.student_id AND e2.is_active = 1 ORDER BY e2.id DESC LIMIT 1)
     )
     SELECT ${columns}
     FROM students st
     JOIN student_statuses ss ON ss.id = st.status_id
     LEFT JOIN latest_enrollments e ON e.student_id = st.id
     LEFT JOIN programs p ON p.id = e.program_id
     LEFT JOIN shifts sh ON sh.id = e.shift_id
     LEFT JOIN groups g ON g.id = e.group_id
     LEFT JOIN school_cycles sc ON sc.id = e.cycle_id
     LEFT JOIN academic_periods ap ON ap.id = e.period_id
     WHERE (? IS NULL OR e.group_id = ?)
     ORDER BY COALESCE(g.name, ''), spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name)`,
    groupId ?? null, groupId ?? null
  ).map(row => fields.includes("programa") ? { ...row, programa: displayProgramName(row.programa) } : row);
}

function ensureAcademicPeriod(cycleId: number) {
  const activePeriod = get<{ id: number }>(
    "SELECT id FROM academic_periods WHERE cycle_id = ? AND is_active = 1 ORDER BY sequence, id LIMIT 1",
    cycleId
  );
  if (activePeriod) return activePeriod;

  const inactivePeriod = get<{ id: number }>(
    "SELECT id FROM academic_periods WHERE cycle_id = ? ORDER BY sequence, id LIMIT 1",
    cycleId
  );
  if (inactivePeriod) {
    run("UPDATE academic_periods SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", inactivePeriod.id);
    return inactivePeriod;
  }

  const cycle = get<{ start_date: string; end_date: string }>(
    "SELECT start_date, end_date FROM school_cycles WHERE id = ? AND is_active = 1",
    cycleId
  );
  if (!cycle) throw new ApiError(400, "El ciclo escolar seleccionado no existe o está inactivo.");

  const result = run(
    `INSERT INTO academic_periods(cycle_id, name, sequence, start_date, end_date, grade_entry_open, is_active)
     VALUES (?, 'Periodo general', 1, ?, ?, 1, 1)`,
    cycleId,
    cycle.start_date,
    cycle.end_date
  );
  return { id: Number(result.lastInsertRowid) };
}

function defaultAcademicContext(groupId: number, cycleId: number | null) {
  const group = get<any>(
    `SELECT g.id, g.cycle_id, g.active_cycle_id, e.period_id
     FROM groups g
     LEFT JOIN enrollments e ON e.group_id = g.id AND e.is_active = 1
     WHERE g.id = ? ORDER BY e.id DESC LIMIT 1`,
    groupId
  );
  const effectiveCycleId = group?.active_cycle_id ?? group?.cycle_id ?? cycleId ?? null;
  const period = effectiveCycleId ? ensureAcademicPeriod(effectiveCycleId) : null;
  const fallbackPeriod = group?.period_id
    ? get<{ id: number }>("SELECT id FROM academic_periods WHERE id = ?", group.period_id)
    : null;
  const scale = get<{ default_scale_id: number | null }>("SELECT default_scale_id FROM institution_settings WHERE id = 1");
  const fallbackScale = scale?.default_scale_id
    ? get<{ id: number }>("SELECT id FROM grading_scales WHERE id = ?", scale.default_scale_id)
    : get<{ id: number }>("SELECT id FROM grading_scales WHERE is_active = 1 ORDER BY is_default DESC, id LIMIT 1");
  const teacher = get<{ id: number }>("SELECT id FROM teachers WHERE is_active = 1 ORDER BY id LIMIT 1");
  if (!teacher) throw new ApiError(400, "Agrega al menos un docente activo para crear materias en Calificaciones.");
  if (!fallbackScale) throw new ApiError(400, "Configura una escala de calificacion activa.");
  const effectivePeriod = period ?? fallbackPeriod;
  if (!effectivePeriod) throw new ApiError(400, "Configura un periodo academico para el ciclo seleccionado.");
  return { periodId: effectivePeriod.id, teacherId: teacher.id, scaleId: fallbackScale.id };
}

function ensureGradeAssignment(groupId: number, subjectId: number, cycleId: number | null) {
  const context = defaultAcademicContext(groupId, cycleId);
  const existing = get<{ id: number }>(
    "SELECT id FROM subject_assignments WHERE subject_id = ? AND group_id = ? AND period_id = ?",
    subjectId,
    groupId,
    context.periodId
  );
  if (existing) return existing.id;
  const inserted = run(
    `INSERT INTO subject_assignments(subject_id, group_id, teacher_id, period_id, grading_scale_id, evaluation_mode)
     VALUES (?, ?, ?, ?, ?, 'partials')`,
    subjectId,
    groupId,
    context.teacherId,
    context.periodId,
    context.scaleId
  );
  syncGroupSubjects(groupId);
  return Number(inserted.lastInsertRowid);
}

function gradeStatus(score: number | null, passingScore: number | null) {
  if (score == null) return "pending";
  return score >= Number(passingScore ?? 0) ? "passed" : "failed";
}

function syncCurricularGrade(userId: number, enrollmentId: number, assignmentId: number, score: number | null, comments: string | null) {
  const assignment = get<{ passing_score: number; min_score: number; max_score: number }>(
    `${assignmentSelectForSync("a.id = ?")}`,
    assignmentId
  );
  if (!assignment) throw new ApiError(404, "No existe la asignacion academica.");
  if (score != null && (score < assignment.min_score || score > assignment.max_score)) {
    throw new ApiError(400, `El promedio debe estar entre ${assignment.min_score} y ${assignment.max_score}.`);
  }
  const status = gradeStatus(score, assignment.passing_score);
  const current = get<{ id: number; final_score: number | null }>(
    "SELECT id, final_score FROM grades WHERE enrollment_id = ? AND assignment_id = ?",
    enrollmentId,
    assignmentId
  );
  if (current) {
    run(
      `UPDATE grades SET final_score = ?,
       status = ?, comments = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      score,
      status,
      comments,
      userId,
      current.id
    );
    run(
      "INSERT INTO grade_history(grade_id, old_score, new_score, reason, changed_by) VALUES (?, ?, ?, ?, ?)",
      current.id,
      current.final_score,
      score,
      "Sincronizacion desde trayectoria curricular",
      userId
    );
    return current.id;
  }
  const inserted = run(
    `INSERT INTO grades(enrollment_id, assignment_id, final_score,
     status, comments, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    enrollmentId,
    assignmentId,
    score,
    status,
    comments,
    userId,
    userId
  );
  run(
    "INSERT INTO grade_history(grade_id, old_score, new_score, reason, changed_by) VALUES (?, NULL, ?, ?, ?)",
    Number(inserted.lastInsertRowid),
    score,
    "Sincronizacion desde trayectoria curricular",
    userId
  );
  return Number(inserted.lastInsertRowid);
}

function assignmentSelectForSync(where = "1 = 1") {
  return `SELECT a.id, gs.min_score, gs.max_score, gs.passing_score
    FROM subject_assignments a
    JOIN grading_scales gs ON gs.id = a.grading_scale_id
    WHERE ${where}`;
}

function deleteGradeAssignmentsForSubjects(groupId: number, subjectIds: number[]) {
  if (!subjectIds.length) return 0;
  const placeholders = subjectIds.map(() => "?").join(",");
  const assignmentIds = all<{ id: number }>(
    `SELECT id FROM subject_assignments WHERE group_id = ? AND subject_id IN (${placeholders})`,
    groupId,
    ...subjectIds
  ).map((row) => row.id);
  if (!assignmentIds.length) return 0;
  const assignmentPlaceholders = assignmentIds.map(() => "?").join(",");
  run(`DELETE FROM grade_history WHERE grade_id IN (SELECT id FROM grades WHERE assignment_id IN (${assignmentPlaceholders}))`, ...assignmentIds);
  run(`DELETE FROM grade_components WHERE grade_id IN (SELECT id FROM grades WHERE assignment_id IN (${assignmentPlaceholders}))`, ...assignmentIds);
  run(`DELETE FROM grades WHERE assignment_id IN (${assignmentPlaceholders})`, ...assignmentIds);
  run(`DELETE FROM assignment_criteria WHERE assignment_id IN (${assignmentPlaceholders})`, ...assignmentIds);
  run(`DELETE FROM subject_assignments WHERE id IN (${assignmentPlaceholders})`, ...assignmentIds);
  return assignmentIds.length;
}

reportsRouter.get("/report-card.pdf", requirePermission("reports.generate"), async (req: AuthenticatedRequest, res) => {
  const studentId = req.query.studentId ? asId(req.query.studentId, "Alumno") : null;
  const groupId = req.query.groupId ? asId(req.query.groupId, "Grupo") : null;
  const periodId = req.query.periodId ? asId(req.query.periodId, "Periodo") : undefined;
  if (!studentId && !groupId) throw new ApiError(400, "Selecciona un alumno o grupo.");
  const studentIds = studentId
    ? [studentId]
    : all<{ id: number }>(
      `SELECT st.id FROM students st JOIN enrollments e ON e.student_id = st.id
       WHERE e.group_id = ? AND e.is_active = 1 AND st.is_active = 1
         AND e.id = (SELECT latest.id FROM enrollments latest WHERE latest.student_id = st.id AND latest.is_active = 1 ORDER BY latest.id DESC LIMIT 1)
       ORDER BY spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name)`,
      groupId!
    ).map((student) => student.id);
  if (!studentIds.length) throw new ApiError(404, "El grupo no tiene alumnos activos.");
  const records = studentIds.map(id => getAcademicRecord(id, "report_card", periodId));
  const documents: IssuedDocument[] = [];
  for (const record of records) documents.push(await issueDocument("report_card", record.student.id, req.user!.id,
    publicAcademicStudent(record.student), { subjects: printedSubjects(record.subjects), average: record.average }));
  const doc = createPdf(res, groupId ? `boletas-grupo-${groupId}.pdf` : `boleta-${studentId}.pdf`);
  records.forEach((record, index) => {
    if (index) doc.addPage();
    drawAcademicDocument(doc, record, documents[index]);
  });
  doc.end();
});

reportsRouter.get("/academic-history.pdf", requirePermission("reports.generate"), async (req: AuthenticatedRequest, res) => {
  const studentId = asId(req.query.studentId, "Alumno");
  const record = getAcademicRecord(studentId, "academic_history");
  const issued = await issueDocument("academic_history", studentId, req.user!.id, publicAcademicStudent(record.student), {
    subjects: printedSubjects(record.subjects), average: record.average
  });
  const doc = createPdf(res, `historial-academico-${record.student.student_number}.pdf`);
  drawAcademicDocument(doc, record, issued);
  doc.end();
});

reportsRouter.get("/academic-context", requirePermission("reports.generate"), (req, res) => {
  const record = getAcademicRecord(asId(req.query.studentId, "Alumno"), "report_card");
  res.json({ student: publicAcademicStudent(record.student), calendar: getCycleCalendar(record.student.cycle_id) });
});

reportsRouter.get("/study-certificate.pdf", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const studentId = asId(req.query.studentId, "Alumno");
  return sendStudyCertificate(res, studentId, req.user!.id);
});

reportsRouter.get("/issued-documents", requirePermission("reports.generate"), (req, res) => {
  const studentId = asId(req.query.studentId, "Alumno");
  res.json(all(`SELECT id, folio, document_type, issued_at, verification_url, revoked_at FROM issued_documents
    WHERE student_id = ? ORDER BY issued_at DESC, id DESC LIMIT 50`, studentId));
});

reportsRouter.post("/issued-documents/:id/revoke", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  if (!get("SELECT id FROM issued_documents WHERE id = ?", id)) throw new ApiError(404, "No se encontró el documento.");
  const reason = cleanText(req.body.reason, 300);
  if (!reason) throw new ApiError(400, "Escribe el motivo de revocación.");
  run("UPDATE issued_documents SET revoked_at = COALESCE(revoked_at, ?), revocation_reason = ? WHERE id = ?", new Date().toISOString(), reason, id);
  logActivity(req, "revoke-document", "issued_documents", id, { reason });
  res.json({ message: "Documento revocado. El QR mostrará que ya no es válido." });
});

function curricularWhere(req: any) {
  const clauses = ["st.is_active = 1"];
  const params: number[] = [];
  if (req.query.groupId) {
    clauses.push("e.group_id = ?");
    params.push(asId(req.query.groupId, "Grupo"));
  }
  if (req.query.studentId) {
    clauses.push("ss.student_id = ?");
    params.push(asId(req.query.studentId, "Alumno"));
  }
  if (req.query.semester) {
    clauses.push("ss.semester_number = ?");
    params.push(Math.max(1, Math.trunc(asNumber(req.query.semester, "Semestre"))));
  }
  if (req.query.cycleId) {
    clauses.push("ss.school_cycle_id = ?");
    params.push(asId(req.query.cycleId, "Ciclo escolar"));
  }
  return { clauses, params };
}

reportsRouter.get("/curricular-subjects", requirePermission("reports.view"), (req, res) => {
  syncAcademicSubjectStatuses();
  const { clauses, params } = curricularWhere(req);
  res.json(all<any>(
    `SELECT ss.id, ss.student_id, ss.enrollment_id, ss.plan_id, ss.subject_id, ss.school_cycle_id,
     ss.semester_number, ss.subject_type, ss.credits, ss.status, ss.final_score, ss.notes,
     st.student_number, TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     s.code AS subject_code, s.name AS subject_name, g.name AS group_name, sc.name AS cycle_name,
     t.full_name AS teacher_name
     FROM student_subjects ss
     JOIN students st ON st.id = ss.student_id
     JOIN subjects s ON s.id = ss.subject_id
     LEFT JOIN enrollments e ON e.id = ss.enrollment_id
     LEFT JOIN groups g ON g.id = e.group_id
     LEFT JOIN school_cycles sc ON sc.id = ss.school_cycle_id
     LEFT JOIN subject_assignments a ON a.id = (
       SELECT candidate.id FROM subject_assignments candidate
       JOIN academic_periods candidate_period ON candidate_period.id = candidate.period_id
       WHERE candidate.group_id = e.group_id AND candidate.subject_id = ss.subject_id
       AND candidate.is_active = 1
       AND (ss.school_cycle_id IS NULL OR candidate_period.cycle_id = ss.school_cycle_id)
       ORDER BY candidate_period.sequence DESC, candidate.id DESC LIMIT 1
     )
     LEFT JOIN teachers t ON t.id = a.teacher_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ss.semester_number, spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name), s.name`,
    ...params
  ));
});

reportsRouter.patch("/curricular-subjects/status-group", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.body.groupId, "Grupo");
  const cycleId = req.body.cycleId ? asId(req.body.cycleId, "Ciclo escolar") : null;
  const semester = req.body.semester ? Math.max(1, Math.trunc(asNumber(req.body.semester, "Semestre"))) : null;
  const status = String(req.body.status);
  if (!["pending", "in_progress", "completed"].includes(status)) throw new ApiError(400, "Selecciona un estado válido.");
  const result = run(
    `UPDATE student_subjects SET status = ?, status_manual_override = 1, updated_at = CURRENT_TIMESTAMP
     WHERE id IN (
       SELECT ss.id FROM student_subjects ss JOIN enrollments e ON e.id = ss.enrollment_id
       WHERE e.group_id = ? AND e.is_active = 1
       AND (? IS NULL OR ss.school_cycle_id = ?)
       AND (? IS NULL OR ss.semester_number = ?)
     )`,
    status, groupId, cycleId, cycleId, semester, semester
  );
  const count = Number(result.changes);
  logActivity(req, "bulk-update-curricular-status", "student_subjects", groupId, { cycleId, semester, status, count });
  res.json({ count, status });
});

reportsRouter.post("/curricular-subjects/bulk", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.body.groupId, "Grupo");
  const semester = Math.max(1, Math.trunc(asNumber(req.body.semester || 1, "Semestre")));
  const planId = req.body.planId ? asId(req.body.planId, "Plan") : null;
  const requestedCycleId = req.body.cycleId ? asId(req.body.cycleId, "Ciclo escolar") : null;
  const initialStatus = ["pending", "in_progress", "completed"].includes(String(req.body.status))
    ? String(req.body.status)
    : "in_progress";
  const subjectIds = Array.isArray(req.body.subjectIds)
    ? req.body.subjectIds.map((id: unknown) => asId(id, "Materia"))
    : [];
  const group = get<{ id: number; cycle_id: number; active_cycle_id: number | null }>(
    "SELECT id, cycle_id, active_cycle_id FROM groups WHERE id = ? AND is_active = 1",
    groupId
  );
  if (!group) throw new ApiError(404, "El grupo no existe o está inactivo.");
  const cycleId = group.active_cycle_id ?? group.cycle_id ?? requestedCycleId;
  if (!cycleId) throw new ApiError(400, "El grupo seleccionado no tiene un ciclo escolar.");
  const enrollments = all<any>(
    `SELECT e.id, e.student_id, e.plan_id, e.cycle_id
     FROM enrollments e JOIN students st ON st.id = e.student_id
     WHERE e.group_id = ? AND e.is_active = 1 AND st.is_active = 1`,
    groupId
  );
  if (!enrollments.length) throw new ApiError(404, "El grupo no tiene alumnos activos.");

  let inserted = 0;
  transaction(() => {
    enrollments.forEach((enrollment) => {
      const effectivePlanId = planId ?? enrollment.plan_id;
      const subjects = subjectIds.length
        ? all<any>(
          `SELECT s.id AS subject_id, COALESCE(ps.subject_type, 'mandatory') AS subject_type,
           COALESCE(ps.credits, NULLIF(s.credits, 0), 1) AS credits
           FROM subjects s
           LEFT JOIN plan_subjects ps ON ps.subject_id = s.id AND (? IS NULL OR ps.plan_id = ?)
           WHERE s.id IN (${subjectIds.map(() => "?").join(",")})`,
          effectivePlanId, effectivePlanId, ...subjectIds
        )
        : all<any>(
          `SELECT ps.subject_id, ps.subject_type, ps.credits
           FROM plan_subjects ps
           WHERE ps.plan_id = ? AND ps.recommended_period = ?
           ORDER BY ps.id`,
          effectivePlanId, semester
        );
      subjects.forEach((subject) => {
        ensureGradeAssignment(groupId, subject.subject_id, cycleId);
        const result = run(
          `INSERT INTO student_subjects(student_id, enrollment_id, plan_id, subject_id, school_cycle_id,
           semester_number, subject_type, credits, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_id, subject_id, school_cycle_id, semester_number)
           DO UPDATE SET enrollment_id = excluded.enrollment_id, plan_id = excluded.plan_id,
             subject_type = excluded.subject_type, credits = excluded.credits, updated_at = CURRENT_TIMESTAMP`,
          enrollment.student_id,
          enrollment.id,
          effectivePlanId,
          subject.subject_id,
          cycleId,
          semester,
          subject.subject_type,
          subject.credits,
          initialStatus
        );
        inserted += Number(result.changes);
      });
    });
  });
  logActivity(req, "assign-curricular-subjects", "student_subjects", groupId, { semester, planId, cycleId, subjectCount: subjectIds.length, rows: inserted });
  res.status(201).json({ count: inserted });
});

reportsRouter.post("/curricular-subjects/delete-many", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id: unknown) => asId(id, "Materia del alumno")) : [];
  if (!ids.length) throw new ApiError(400, "Selecciona al menos una materia para borrar.");
  const placeholders = ids.map(() => "?").join(",");
  const existing = all<any>(
    `SELECT ss.*, e.group_id FROM student_subjects ss
     LEFT JOIN enrollments e ON e.id = ss.enrollment_id
     WHERE ss.id IN (${placeholders})`,
    ...ids
  );
  transaction(() => {
    const byGroup = existing.reduce<Record<number, number[]>>((grouped, row) => {
      if (row.group_id) (grouped[Number(row.group_id)] ??= []).push(Number(row.subject_id));
      return grouped;
    }, {});
    Object.entries(byGroup).forEach(([groupId, subjectIds]) => {
      deleteGradeAssignmentsForSubjects(Number(groupId), [...new Set(subjectIds)]);
    });
    run(`DELETE FROM student_subjects WHERE id IN (${placeholders})`, ...ids);
  });
  logActivity(req, "bulk-delete-curricular-subjects", "student_subjects", undefined, { ids, count: existing.length });
  res.json({ count: existing.length });
});

reportsRouter.post("/curricular-subjects/clear-group", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.body.groupId, "Grupo");
  const confirmation = cleanText(req.body.confirmation, 30).toUpperCase();
  if (confirmation !== "LIMPIAR") throw new ApiError(400, "Confirma escribiendo LIMPIAR.");
  const rows = all<any>(
    `SELECT ss.id, ss.subject_id FROM student_subjects ss
     JOIN enrollments e ON e.id = ss.enrollment_id
     WHERE e.group_id = ?`,
    groupId
  );
  const subjectIds = [...new Set(rows.map((row: any) => Number(row.subject_id)).filter(Boolean))];
  transaction(() => {
    deleteGradeAssignmentsForSubjects(groupId, subjectIds);
    run(
      `DELETE FROM student_subjects
       WHERE id IN (
         SELECT ss.id FROM student_subjects ss
         JOIN enrollments e ON e.id = ss.enrollment_id
         WHERE e.group_id = ?
       )`,
      groupId
    );
  });
  logActivity(req, "clear-curricular-group", "student_subjects", groupId, { count: rows.length });
  res.json({ count: rows.length });
});

reportsRouter.patch("/curricular-subjects/:id", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Registro curricular");
  const current = get<any>("SELECT * FROM student_subjects WHERE id = ?", id);
  if (!current) throw new ApiError(404, "No se encontro la materia del alumno.");
  const enrollment = get<{ id: number; group_id: number; cycle_id: number }>(
    "SELECT id, group_id, cycle_id FROM enrollments WHERE id = ?",
    current.enrollment_id
  );
  if (!enrollment) throw new ApiError(404, "No se encontro la inscripcion vinculada.");
  const subjectId = req.body.subjectId ? asId(req.body.subjectId, "Materia") : current.subject_id;
  const semester = req.body.semester ? Math.max(1, Math.trunc(asNumber(req.body.semester, "Semestre"))) : current.semester_number;
  const cycleId = req.body.cycleId === "" || req.body.cycleId == null ? current.school_cycle_id : asId(req.body.cycleId, "Ciclo escolar");
  const status = ["pending", "in_progress", "completed"].includes(String(req.body.status)) ? String(req.body.status) : current.status;
  const finalScore = req.body.finalScore === "" || req.body.finalScore == null ? null : asNumber(req.body.finalScore, "Promedio");
  const credits = req.body.credits === "" || req.body.credits == null ? current.credits : Math.max(0, asNumber(req.body.credits, "Creditos"));
  const subjectType = req.body.subjectType === "elective" ? "elective" : req.body.subjectType === "mandatory" ? "mandatory" : current.subject_type;
  const notes = optionalText(req.body.notes, 500);
  transaction(() => {
    run(
      `UPDATE student_subjects SET subject_id = ?, school_cycle_id = ?, semester_number = ?, subject_type = ?,
       credits = ?, status = ?, status_manual_override = 1, final_score = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      subjectId,
      cycleId,
      semester,
      subjectType,
      credits,
      status,
      finalScore,
      notes,
      id
    );
    const assignmentId = ensureGradeAssignment(enrollment.group_id, subjectId, cycleId ?? enrollment.cycle_id);
    syncCurricularGrade(req.user!.id, enrollment.id, assignmentId, finalScore, notes);
  });
  const updated = get("SELECT * FROM student_subjects WHERE id = ?", id);
  logActivity(req, "update-curricular-subject", "student_subjects", id, updated);
  res.json(updated);
});

reportsRouter.patch("/curricular-subjects/:id", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Registro curricular");
  const current = get<any>("SELECT * FROM student_subjects WHERE id = ?", id);
  if (!current) throw new ApiError(404, "No se encontrÃ³ la materia del alumno.");
  const subjectId = req.body.subjectId ? asId(req.body.subjectId, "Materia") : current.subject_id;
  const semester = req.body.semester ? Math.max(1, Math.trunc(asNumber(req.body.semester, "Semestre"))) : current.semester_number;
  const cycleId = req.body.cycleId === "" || req.body.cycleId == null ? current.school_cycle_id : asId(req.body.cycleId, "Ciclo escolar");
  const status = ["pending", "in_progress", "completed"].includes(String(req.body.status)) ? String(req.body.status) : current.status;
  const finalScore = req.body.finalScore === "" || req.body.finalScore == null ? null : asNumber(req.body.finalScore, "Promedio");
  const credits = req.body.credits === "" || req.body.credits == null ? current.credits : Math.max(0, asNumber(req.body.credits, "CrÃ©ditos"));
  const subjectType = req.body.subjectType === "elective" ? "elective" : req.body.subjectType === "mandatory" ? "mandatory" : current.subject_type;
  run(
    `UPDATE student_subjects SET subject_id = ?, school_cycle_id = ?, semester_number = ?, subject_type = ?,
     credits = ?, status = ?, status_manual_override = 1, final_score = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    subjectId,
    cycleId,
    semester,
    subjectType,
    credits,
    status,
    finalScore,
    optionalText(req.body.notes, 500),
    id
  );
  const updated = get("SELECT * FROM student_subjects WHERE id = ?", id);
  logActivity(req, "update-curricular-subject", "student_subjects", id, updated);
  res.json(updated);
});

reportsRouter.delete("/curricular-subjects/:id", requirePermission("reports.generate"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Registro curricular");
  const current = get("SELECT * FROM student_subjects WHERE id = ?", id);
  if (!current) throw new ApiError(404, "La materia del alumno ya no existe.");
  run("DELETE FROM student_subjects WHERE id = ?", id);
  logActivity(req, "delete-curricular-subject", "student_subjects", id, current);
  res.status(204).end();
});

reportsRouter.get("/student-list", requirePermission("reports.view"), (req, res) => {
  const fields = resolveStudentListFields(req.query.fields);
  const groupId = req.query.groupId ? asId(req.query.groupId, "Grupo") : undefined;
  const rows = studentListRows(groupId, fields);
  const records = rows.map((row) => Object.fromEntries(fields.map((field) => [studentListFieldDefinitions[field].label, row[field] ?? ""])));
  const format = cleanText(req.query.format || "pdf", 10).toLowerCase();
  if (format === "xlsx") return sendWorkbook(res, "lista-alumnos.xlsx", "Alumnos", records);
  if (format === "csv") return sendCsv(res, "lista-alumnos.csv", Object.keys(records[0] ?? {}), records.map((row) => Object.values(row)));

  const doc = createPdf(res, "lista-alumnos.pdf", { layout: "landscape" });
  const group = groupId ? get<{ name: string }>("SELECT name FROM groups WHERE id = ?", groupId)?.name : null;
  const title = group ? `Lista general de alumnos · ${group}` : "Lista general de alumnos";
  doc.fillColor("#102a43").font("Helvetica-Bold").fontSize(19).text(title);
  doc.moveDown(0.2).fillColor("#627d98").font("Helvetica").fontSize(9)
    .text(`${rows.length} alumno${rows.length === 1 ? "" : "s"} · Formato de directorio institucional · ${new Date().toLocaleString("es-MX")}`);
  doc.moveDown();
  const available = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const weights = fields.map((field) => ["nombre_completo", "nombre", "apellido_paterno", "apellido_materno"].includes(field) ? 1.7 : ["programa", "correo", "curp"].includes(field) ? 1.45 : 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  pdfTable(doc, fields.map((field) => studentListFieldDefinitions[field].label), rows.map((row) => fields.map((field) => row[field] ?? "")), weights.map((weight) => available * weight / totalWeight));
  doc.end();
});

const reportDefinitions = {
  students: {
    title: "Lista de alumnos por grupo",
    query: `SELECT st.student_number AS Matricula,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS Alumno,
      g.name AS Grupo, p.name AS Programa, sh.name AS Turno, ss.name AS Estatus
      FROM students st JOIN student_statuses ss ON ss.id = st.status_id
      JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1 JOIN groups g ON g.id = e.group_id
      JOIN programs p ON p.id = e.program_id JOIN shifts sh ON sh.id = e.shift_id
      WHERE (? IS NULL OR e.group_id = ?) ORDER BY spanish_sort(g.name), spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name)`,
    headers: ["Matricula", "Alumno", "Grupo", "Programa", "Turno", "Estatus"]
  },
  gradebook: {
    title: "Concentrado de calificaciones",
    query: `SELECT st.student_number AS Matricula,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS Alumno,
      g.name AS Grupo, s.name AS Materia, ap.name AS Periodo, gr.final_score AS Calificacion
      FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id JOIN students st ON st.id = e.student_id
      JOIN groups g ON g.id = e.group_id JOIN subject_assignments a ON a.id = gr.assignment_id
      JOIN subjects s ON s.id = a.subject_id JOIN academic_periods ap ON ap.id = a.period_id
      WHERE (? IS NULL OR e.group_id = ?) ORDER BY spanish_sort(g.name), spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name), spanish_sort(s.name)`,
    headers: ["Matricula", "Alumno", "Grupo", "Materia", "Periodo", "Calificacion"]
  },
  subjects: {
    title: "Reporte por materia",
    query: `SELECT s.code AS Clave, s.name AS Materia, g.name AS Grupo,
      COUNT(gr.id) AS Evaluaciones, ROUND(AVG(gr.final_score), 2) AS Promedio,
      SUM(CASE WHEN gr.final_score < gs.passing_score THEN 1 ELSE 0 END) AS Reprobadas
      FROM subject_assignments a JOIN subjects s ON s.id = a.subject_id JOIN groups g ON g.id = a.group_id
      JOIN grading_scales gs ON gs.id = a.grading_scale_id LEFT JOIN grades gr ON gr.assignment_id = a.id
      WHERE (? IS NULL OR a.group_id = ?) GROUP BY s.id, s.code, s.name, g.name ORDER BY s.name, g.name`,
    headers: ["Clave", "Materia", "Grupo", "Evaluaciones", "Promedio", "Reprobadas"]
  },
  teachers: {
    title: "Reporte por docente",
    query: `SELECT t.employee_number AS Clave, t.full_name AS Docente, s.name AS Materia,
      g.name AS Grupo, COUNT(gr.id) AS Evaluaciones, ROUND(AVG(gr.final_score), 2) AS Promedio
      FROM subject_assignments a JOIN teachers t ON t.id = a.teacher_id JOIN subjects s ON s.id = a.subject_id
      JOIN groups g ON g.id = a.group_id LEFT JOIN grades gr ON gr.assignment_id = a.id
      WHERE (? IS NULL OR a.group_id = ?) GROUP BY t.id, t.employee_number, t.full_name, s.name, g.name
      ORDER BY t.full_name, s.name`,
    headers: ["Clave", "Docente", "Materia", "Grupo", "Evaluaciones", "Promedio"]
  },
  failed: {
    title: "Alumnos reprobados",
    query: `SELECT st.student_number AS Matricula,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS Alumno,
      g.name AS Grupo, s.name AS Materia, gr.final_score AS Calificacion
      FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id JOIN students st ON st.id = e.student_id
      JOIN groups g ON g.id = e.group_id JOIN subject_assignments a ON a.id = gr.assignment_id
      JOIN subjects s ON s.id = a.subject_id JOIN grading_scales gs ON gs.id = a.grading_scale_id
      WHERE gr.final_score < gs.passing_score AND (? IS NULL OR e.group_id = ?)
      ORDER BY spanish_sort(g.name), spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name), spanish_sort(s.name)`,
    headers: ["Matricula", "Alumno", "Grupo", "Materia", "Calificacion"]
  },
  outstanding: {
    title: "Alumnos destacados",
    query: `SELECT st.student_number AS Matricula,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS Alumno,
      g.name AS Grupo, ROUND(AVG(gr.final_score), 2) AS Promedio
      FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id JOIN students st ON st.id = e.student_id
      JOIN groups g ON g.id = e.group_id WHERE (? IS NULL OR e.group_id = ?)
      GROUP BY st.id, st.student_number, Alumno, g.name HAVING AVG(gr.final_score) >= 9
      ORDER BY Promedio DESC`,
    headers: ["Matricula", "Alumno", "Grupo", "Promedio"]
  }
} as const;

reportsRouter.get("/data/:type", requirePermission("reports.view"), async (req, res) => {
  const definition = reportDefinitions[req.params.type as keyof typeof reportDefinitions];
  if (!definition) throw new ApiError(404, "El reporte solicitado no existe.");
  const groupId = req.query.groupId ? Number(req.query.groupId) : null;
  const records = all<any>(definition.query, groupId, groupId)
    .map(row => typeof row.Programa === "string" ? { ...row, Programa: displayProgramName(row.Programa) } : row);
  if (req.query.format === "xlsx") return sendWorkbook(res, `${req.params.type}.xlsx`, "Reporte", records);
  const doc = createPdf(res, `${req.params.type}.pdf`, { layout: "landscape" });
  doc.fillColor("#102a43").font("Helvetica-Bold").fontSize(18).text(definition.title);
  doc.moveDown(0.3).fillColor("#627d98").font("Helvetica").fontSize(9).text(`Generado: ${new Date().toLocaleString("es-MX")}`);
  doc.moveDown();
  pdfTable(doc, [...definition.headers], records.map((row) => definition.headers.map((header) => row[header])));
  doc.end();
});
