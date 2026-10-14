import { Router } from "express";
import multer from "multer";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { createPdf, parseWorkbook, pdfTable, sendWorkbook, type TabularRow } from "../services/files.js";
import { isoDate } from "../services/payroll.js";
import { syncEnrollmentGroupSubjects } from "../services/group-subjects.js";
import { provisionStudentAccount } from "../services/student-account.js";
import { generateStudentIdentity } from "../services/student-identity.js";
import { ApiError, asId, asNumber, cleanText, optionalText, sendCsv } from "../utils.js";

type StudentImportRow = {
  row: number;
  studentNumber: string;
  firstName: string;
  lastName: string;
  secondLastName: string;
  curp: string;
  birthDate: string;
  email: string;
  phone: string;
  programId: number;
  shiftId: number;
  groupId: number;
  cycleId: number;
  planId: number;
  curricularPeriodId: number;
  statusId: number;
  exists: boolean;
};

type Preview = {
  createdAt: number;
  fileName: string;
  valid: StudentImportRow[];
  errors: Array<{ row: number; message: string }>;
};

const previews = new Map<string, Preview>();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (allowed) callback(null, true);
    else callback(new ApiError(400, "Usa un archivo Excel o CSV."));
  }
});

export const studentsRouter = Router();

function normalizeKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function value(row: TabularRow, ...aliases: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, item]) => [normalizeKey(key), item]));
  for (const alias of aliases) {
    const found = normalized.get(normalizeKey(alias));
    if (found !== undefined) return cleanText(found, 250);
  }
  return "";
}

function validCurricularPeriod(input: unknown, programId: number) {
  const id = asId(input, "Periodo del plan");
  const period = get<{ id: number; sequence: number; duration_periods: number | null }>(
    `SELECT cp.id, cp.sequence, p.duration_periods
     FROM curricular_periods cp, programs p
     WHERE cp.id = ? AND cp.is_active = 1 AND p.id = ? AND p.is_active = 1`,
    id,
    programId
  );
  if (!period) throw new ApiError(400, "El periodo del plan seleccionado no existe o está inactivo.");
  if (period.duration_periods && period.sequence > period.duration_periods) {
    throw new ApiError(400, "El periodo seleccionado excede la duración del plan de estudios.");
  }
  return period.id;
}

function studentSelect(where = "1 = 1") {
  return `SELECT st.id, st.student_number, st.first_name, st.last_name, st.second_last_name,
    TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS full_name,
    st.curp, st.birth_date, st.email, st.phone, st.emergency_contact, st.address, st.notes,
    st.is_active, st.near_graduation, ss.id AS status_id, ss.name AS status_name, ss.color AS status_color,
    e.id AS enrollment_id, e.program_id, p.name AS program_name, e.shift_id, sh.name AS shift_name,
    e.group_id, g.name AS group_name, g.study_modality, e.cycle_id, sc.name AS cycle_name,
    e.period_id AS evaluation_period_id, e.curricular_period_id, cp.name AS curricular_period_name,
    cp.sequence AS curricular_period_number, e.financial_clearance_override, e.financial_override_note,
    e.plan_id, pl.name AS plan_name, pl.matriculation_code,
    CASE WHEN COALESCE((
      SELECT CASE WHEN srs.status = 'paid' THEN 1 ELSE 0 END
      FROM student_registration_status srs
      WHERE srs.enrollment_id = e.id AND srs.period_number = cp.sequence
      LIMIT 1
    ), CASE WHEN EXISTS (
      SELECT 1 FROM student_payments sp WHERE sp.enrollment_id = e.id
      AND (sp.concept_type IN ('enrollment', 'reenrollment') OR LOWER(sp.concept) LIKE '%inscrip%')
      AND sp.registration_period_number = (SELECT sequence FROM curricular_periods WHERE id = e.curricular_period_id)
    ) THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END AS registration_paid,
    (SELECT srs.physical_folio FROM student_registration_status srs WHERE srs.enrollment_id = e.id AND srs.period_number = cp.sequence) AS registration_folio,
    (SELECT srs.amount FROM student_registration_status srs WHERE srs.enrollment_id = e.id AND srs.period_number = cp.sequence) AS registration_amount,
    (SELECT srs.paid_at FROM student_registration_status srs WHERE srs.enrollment_id = e.id AND srs.period_number = cp.sequence) AS registration_paid_at
    FROM students st
    JOIN student_statuses ss ON ss.id = st.status_id
    LEFT JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
    LEFT JOIN programs p ON p.id = e.program_id
    LEFT JOIN shifts sh ON sh.id = e.shift_id
    LEFT JOIN groups g ON g.id = e.group_id
    LEFT JOIN school_cycles sc ON sc.id = e.cycle_id
    LEFT JOIN academic_plans pl ON pl.id = e.plan_id
    LEFT JOIN curricular_periods cp ON cp.id = e.curricular_period_id
    WHERE ${where}`;
}

studentsRouter.get("/", requirePermission("students.view"), (req, res) => {
  const search = cleanText(req.query.search, 100);
  const clauses = ["1 = 1"];
  const params: Array<string | number> = [];
  if (search) {
    clauses.push("(st.student_number LIKE ? OR st.first_name LIKE ? OR st.last_name LIKE ? OR st.second_last_name LIKE ?)");
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  const filters: Array<[string, unknown]> = [
    ["e.program_id", req.query.programId],
    ["e.shift_id", req.query.shiftId],
    ["e.group_id", req.query.groupId],
    ["e.cycle_id", req.query.cycleId],
    ["st.status_id", req.query.statusId]
  ];
  filters.forEach(([column, filterValue]) => {
    if (filterValue) {
      clauses.push(`${column} = ?`);
      params.push(Number(filterValue));
    }
  });
  if (req.query.nearGraduation === "true") clauses.push("st.near_graduation = 1");
  if (req.query.active === "true") clauses.push("st.is_active = 1");
  if (req.query.active === "false") clauses.push("st.is_active = 0");

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const where = clauses.join(" AND ");
  const total = get<{ count: number }>(
    `SELECT COUNT(DISTINCT st.id) AS count FROM students st
     LEFT JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1 WHERE ${where}`,
    ...params
  )?.count ?? 0;
  const records = all(
    `${studentSelect(where)} ORDER BY spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name), st.id LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize
  );
  res.json({ records, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
});

studentsRouter.get("/record/:id", requirePermission("students.view"), (req, res) => {
  const record = get(`${studentSelect("st.id = ?")}`, asId(req.params.id, "Alumno"));
  if (!record) throw new ApiError(404, "No se encontró el alumno.");
  res.json(record);
});

function physicalFolio(value: unknown) {
  const digits = cleanText(value, 4).replace(/\D/g, "");
  const number = Number(digits);
  if (!Number.isInteger(number) || number < 1 || number > 1000) {
    throw new ApiError(400, "El folio físico debe estar entre 0001 y 1000.");
  }
  return String(number).padStart(4, "0");
}

studentsRouter.post("/:id/registration-status", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const studentId = asId(req.params.id, "Alumno");
  const status = req.body.status === "paid" ? "paid" : req.body.status === "pending" ? "pending" : null;
  if (!status) throw new ApiError(400, "Selecciona si la inscripción está pagada o pendiente.");
  const periodNumber = Math.trunc(asNumber(req.body.periodNumber, "Semestre"));
  const enrollment = get<any>(
    `SELECT e.id, e.plan_id, e.group_id, p.duration_periods, st.student_number
     FROM enrollments e JOIN students st ON st.id = e.student_id JOIN programs p ON p.id = e.program_id
     WHERE e.student_id = ? AND e.is_active = 1 ORDER BY e.id DESC LIMIT 1`,
    studentId
  );
  if (!enrollment) throw new ApiError(404, "El alumno no tiene una inscripción activa.");
  if (periodNumber < 1 || periodNumber > Number(enrollment.duration_periods ?? 20)) {
    throw new ApiError(400, "El semestre no corresponde a la duración del programa.");
  }
  const curricularPeriod = get<{ id: number; name: string }>(
    "SELECT id, name FROM curricular_periods WHERE sequence = ? AND is_active = 1",
    periodNumber
  );
  if (!curricularPeriod) throw new ApiError(400, "El semestre seleccionado no existe en el catálogo.");
  const folio = status === "paid" ? physicalFolio(req.body.physicalFolio) : null;
  const amount = status === "paid" ? asNumber(req.body.amount, "Monto pagado") : null;
  const paidAt = status === "paid" ? cleanText(req.body.paidAt, 10) : null;
  if (status === "paid" && (Number(amount) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt!))) {
    throw new ApiError(400, "Captura un monto mayor a cero y una fecha de pago válida.");
  }

  transaction(() => {
    const previous = get<{ payment_id: number | null }>(
      "SELECT payment_id FROM student_registration_status WHERE enrollment_id = ? AND period_number = ?",
      enrollment.id,
      periodNumber
    );
    let paymentId = previous?.payment_id ?? null;
    if (status === "pending" && paymentId) {
      run("DELETE FROM student_payments WHERE id = ?", paymentId);
      paymentId = null;
    }
    if (status === "paid") {
      const conceptType = periodNumber === 1 ? "enrollment" : "reenrollment";
      const concept = periodNumber === 1 ? "Inscripción primer semestre" : `Reinscripción semestre ${periodNumber}`;
      if (paymentId) {
        run(
          `UPDATE student_payments SET plan_id = ?, amount = ?, paid_at = ?, concept = ?, concept_type = ?,
           registration_period_number = ?, notes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          enrollment.plan_id, amount!, paidAt!, concept, conceptType, periodNumber, folio!, req.user!.id, paymentId
        );
      } else {
        const inserted = run(
          `INSERT INTO student_payments(student_id, enrollment_id, plan_id, folio, amount, paid_at, payment_method,
           concept, concept_type, registration_period_number, notes, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 'Registro manual en Alumnos', ?, ?, ?, ?, ?, ?)`,
          studentId, enrollment.id, enrollment.plan_id,
          `ADM-REG-${enrollment.student_number}-${periodNumber}-${Date.now()}`,
          amount!, paidAt!, concept, conceptType, periodNumber, folio!, req.user!.id, req.user!.id
        );
        paymentId = Number(inserted.lastInsertRowid);
      }
    }
    run(
      `INSERT INTO student_registration_status(enrollment_id, period_number, status, physical_folio, amount, paid_at, payment_id, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(enrollment_id, period_number) DO UPDATE SET status = excluded.status,
       physical_folio = excluded.physical_folio, amount = excluded.amount, paid_at = excluded.paid_at,
       payment_id = excluded.payment_id, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      enrollment.id, periodNumber, status, folio, amount, paidAt, paymentId, req.user!.id
    );
    run("UPDATE enrollments SET curricular_period_id = ? WHERE id = ?", curricularPeriod.id, enrollment.id);
    syncEnrollmentGroupSubjects(enrollment.id);
  });
  logActivity(req, "manual-registration-status", "enrollments", enrollment.id, { studentId, status, periodNumber, folio, amount, paidAt });
  res.json(get(`${studentSelect("st.id = ?")}`, studentId));
});

studentsRouter.post("/:id/financial-clearance", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const studentId = asId(req.params.id, "Alumno");
  const cleared = Boolean(req.body.cleared);
  const note = optionalText(req.body.note, 300);
  const enrollment = get<{ id: number }>(
    "SELECT id FROM enrollments WHERE student_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1",
    studentId
  );
  if (!enrollment) throw new ApiError(404, "El alumno no tiene una inscripción activa.");
  run(
    `UPDATE enrollments SET financial_clearance_override = ?, financial_override_note = ?,
     financial_override_updated_at = CURRENT_TIMESTAMP, financial_override_updated_by = ? WHERE id = ?`,
    cleared ? 1 : 0, cleared ? note : null, req.user!.id, enrollment.id
  );
  logActivity(req, "financial-clearance-override", "enrollments", enrollment.id, { studentId, cleared, note });
  res.json(get(`${studentSelect("st.id = ?")}`, studentId));
});

studentsRouter.post("/", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const body = req.body;
  const required = ["firstName", "lastName", "statusId", "programId", "shiftId", "groupId", "cycleId", "planId"];
  const curricularPeriodInput = body.curricularPeriodId ?? body.periodId;
  if (required.some((field) => !body[field]) || !curricularPeriodInput) {
    throw new ApiError(400, "Completa los datos obligatorios del alumno, incluido el periodo del plan.");
  }
  const firstName = cleanText(body.firstName, 100);
  const lastName = cleanText(body.lastName, 100);
  const secondLastName = optionalText(body.secondLastName, 100);
  const programId = asId(body.programId, "Programa");
  const shiftId = asId(body.shiftId, "Turno");
  const groupId = asId(body.groupId, "Grupo");
  const cycleId = asId(body.cycleId, "Ciclo");
  const planId = asId(body.planId, "Plan académico");
  const curricularPeriodId = validCurricularPeriod(curricularPeriodInput, programId);
  const identity = generateStudentIdentity({
    firstName, lastName, secondLastName, programId, shiftId, groupId, cycleId, planId
  });
  if (get("SELECT id FROM students WHERE student_number = ?", identity.studentNumber)) {
    throw new ApiError(409, `La matrícula ${identity.studentNumber} ya existe. Verifica los nombres, el ciclo, el plan y la modalidad.`);
  }
  const created = transaction(() => {
    const student = run(
      `INSERT INTO students(student_number, first_name, last_name, second_last_name, curp, birth_date,
       email, phone, emergency_contact, address, notes, status_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      identity.studentNumber,
      firstName,
      lastName,
      secondLastName,
      optionalText(body.curp, 30),
      optionalText(body.birthDate, 20),
      identity.email,
      optionalText(body.phone, 40),
      optionalText(body.emergencyContact, 180),
      optionalText(body.address, 300),
      optionalText(body.notes, 1000),
      asId(body.statusId, "Estatus")
    );
    const studentId = Number(student.lastInsertRowid);
    const enrollment = run(
      `INSERT INTO enrollments(student_id, program_id, shift_id, group_id, cycle_id, curricular_period_id, plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      studentId,
      programId,
      shiftId,
      groupId,
      cycleId,
      curricularPeriodId,
      planId
    );
    syncEnrollmentGroupSubjects(Number(enrollment.lastInsertRowid));
    const access = provisionStudentAccount({
      studentId,
      studentNumber: identity.studentNumber,
      firstName,
      lastName,
      secondLastName
    });
    return { studentId, access };
  });
  logActivity(req, "create", "students", created.studentId, {
    studentNumber: identity.studentNumber,
    planId,
    curricularPeriodId,
    studyModality: identity.studyModality,
    accessCreated: created.access.created
  });
  res.status(201).json({
    ...get(`${studentSelect("st.id = ?")}`, created.studentId),
    access: {
      email: created.access.email,
      temporaryPassword: created.access.temporaryPassword
    }
  });
});

studentsRouter.patch("/:id", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno");
  if (!get("SELECT id FROM students WHERE id = ?", id)) throw new ApiError(404, "No se encontró el alumno.");
  const body = req.body;
  transaction(() => {
    run(
      `UPDATE students SET first_name = COALESCE(?, first_name),
       last_name = COALESCE(?, last_name), second_last_name = ?, curp = ?, birth_date = ?,
       phone = ?, emergency_contact = ?, address = ?, notes = ?, status_id = COALESCE(?, status_id),
       is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      body.firstName ? cleanText(body.firstName, 100) : null,
      body.lastName ? cleanText(body.lastName, 100) : null,
      optionalText(body.secondLastName, 100),
      optionalText(body.curp, 30),
      optionalText(body.birthDate, 20),
      optionalText(body.phone, 40),
      optionalText(body.emergencyContact, 180),
      optionalText(body.address, 300),
      optionalText(body.notes, 1000),
      body.statusId ? asId(body.statusId, "Estatus") : null,
      body.isActive === undefined ? null : body.isActive ? 1 : 0,
      id
    );
    if (body.programId && body.shiftId && body.groupId && body.cycleId) {
      const currentEnrollment = get<{ plan_id: number | null; curricular_period_id: number | null }>(
        "SELECT plan_id, curricular_period_id FROM enrollments WHERE student_id = ? AND is_active = 1",
        id
      );
      const planId = body.planId ? asId(body.planId, "Plan académico") : currentEnrollment?.plan_id;
      if (!planId) throw new ApiError(400, "Selecciona el plan académico del alumno.");
      const curricularPeriodInput = body.curricularPeriodId ?? body.periodId ?? currentEnrollment?.curricular_period_id;
      if (!curricularPeriodInput) throw new ApiError(400, "Selecciona el periodo del plan del alumno.");
      const curricularPeriodId = validCurricularPeriod(curricularPeriodInput, asId(body.programId, "Programa"));
      const currentStudent = get<{ first_name: string; last_name: string; second_last_name: string | null }>(
        "SELECT first_name, last_name, second_last_name FROM students WHERE id = ?",
        id
      )!;
      generateStudentIdentity({
        firstName: currentStudent.first_name,
        lastName: currentStudent.last_name,
        secondLastName: currentStudent.second_last_name,
        programId: asId(body.programId, "Programa"),
        shiftId: asId(body.shiftId, "Turno"),
        groupId: asId(body.groupId, "Grupo"),
        cycleId: asId(body.cycleId, "Ciclo"),
        planId
      });
      run("UPDATE enrollments SET is_active = 0 WHERE student_id = ? AND is_active = 1", id);
      run(
        `INSERT INTO enrollments(student_id, program_id, shift_id, group_id, cycle_id, curricular_period_id, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, cycle_id) DO UPDATE SET program_id = excluded.program_id,
         shift_id = excluded.shift_id, group_id = excluded.group_id,
         curricular_period_id = excluded.curricular_period_id,
         plan_id = excluded.plan_id, is_active = 1`,
        id, Number(body.programId), Number(body.shiftId), Number(body.groupId), Number(body.cycleId),
        curricularPeriodId, planId
      );
      const enrollment = get<{ id: number }>(
        "SELECT id FROM enrollments WHERE student_id = ? AND cycle_id = ? AND is_active = 1",
        id,
        Number(body.cycleId)
      );
      if (enrollment) syncEnrollmentGroupSubjects(enrollment.id);
    }
    const updatedStudent = get<{
      student_number: string;
      first_name: string;
      last_name: string;
      second_last_name: string | null;
    }>("SELECT student_number, first_name, last_name, second_last_name FROM students WHERE id = ?", id)!;
    provisionStudentAccount({
      studentId: id,
      studentNumber: updatedStudent.student_number,
      firstName: updatedStudent.first_name,
      lastName: updatedStudent.last_name,
      secondLastName: updatedStudent.second_last_name
    });
  });
  logActivity(req, "update", "students", id, body);
  res.json(get(`${studentSelect("st.id = ?")}`, id));
});

studentsRouter.post("/:id/toggle", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno");
  transaction(() => {
    run("UPDATE students SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
    const updated = get<{
      is_active: number;
      student_number: string;
      first_name: string;
      last_name: string;
      second_last_name: string | null;
    }>("SELECT is_active, student_number, first_name, last_name, second_last_name FROM students WHERE id = ?", id);
    if (!updated) throw new ApiError(404, "No se encontró el alumno.");
    if (updated.is_active) {
      provisionStudentAccount({
        studentId: id,
        studentNumber: updated.student_number,
        firstName: updated.first_name,
        lastName: updated.last_name,
        secondLastName: updated.second_last_name
      });
    } else {
      run("UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?", id);
    }
    return updated;
  });
  logActivity(req, "toggle-active", "students", id);
  res.json(get(`${studentSelect("st.id = ?")}`, id));
});

studentsRouter.delete("/:id/permanent", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno");
  const student = get("SELECT id, student_number, first_name, last_name FROM students WHERE id = ?", id);
  if (!student) throw new ApiError(404, "El alumno ya no existe.");
  transaction(() => {
    run("UPDATE activity_logs SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE student_id = ?)", id);
    run("DELETE FROM users WHERE student_id = ?", id);
    run(
      `DELETE FROM grade_history WHERE grade_id IN (
         SELECT gr.id FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id WHERE e.student_id = ?
       )`,
      id
    );
    run(
      `DELETE FROM grade_components WHERE grade_id IN (
         SELECT gr.id FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id WHERE e.student_id = ?
       )`,
      id
    );
    run("DELETE FROM grades WHERE enrollment_id IN (SELECT id FROM enrollments WHERE student_id = ?)", id);
    run("DELETE FROM enrollments WHERE student_id = ?", id);
    run("DELETE FROM students WHERE id = ?", id);
  });
  logActivity(req, "permanent-delete", "students", id, student);
  res.status(204).end();
});

studentsRouter.get("/template/import.xlsx", requirePermission("students.import"), (_req, res) => {
  return sendWorkbook(res, "plantilla-alumnos.xlsx", "Alumnos", [{
    "Nombre(s)": "Andrea",
    "Apellido paterno": "López",
    "Apellido materno": "Morales",
    "CURP": "",
    "Teléfono": "",
    "Programa": "Bachillerato General",
    "Plan académico": "Bachillerato General - Plan 2026",
    "Turno": "Matutino",
    "Grupo": "1A",
    "Ciclo escolar": "2026B - 2027A",
    "Periodo del plan": "PRIMER SEMESTRE",
    "Estatus": "Activo"
  }]);
});

studentsRouter.post("/import/preview", requirePermission("students.import"), upload.single("file"), (req: AuthenticatedRequest, res) => {
  if (!req.file) throw new ApiError(400, "Selecciona un archivo.");
  const rows = parseWorkbook(req.file.buffer);
  if (!rows.length) throw new ApiError(400, "El archivo no contiene filas.");
  if (rows.length > 2000) throw new ApiError(400, "El archivo excede el límite de 2,000 filas.");

  const valid: StudentImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const studentNumbers = new Set<string>();
  rows.forEach((source, index) => {
    const rowNumber = index + 2;
    const suppliedStudentNumber = value(source, "Matrícula", "Matricula", "student_number");
    const firstName = value(source, "Nombre(s)", "Nombre", "first_name");
    const lastName = value(source, "Apellido paterno", "last_name");
    const programName = value(source, "Programa", "Programa de estudios");
    const shiftName = value(source, "Turno");
    const groupName = value(source, "Grupo");
    const cycleName = value(source, "Ciclo escolar", "Ciclo");
    const curricularPeriodName = value(source, "Periodo del plan", "Semestre", "Periodo");
    const statusName = value(source, "Estatus", "Estatus de alumno") || "Activo";
    const missing = [
      [firstName, "nombre"], [lastName, "apellido paterno"],
      [programName, "programa"], [shiftName, "turno"], [groupName, "grupo"],
      [cycleName, "ciclo escolar"], [curricularPeriodName, "periodo del plan"]
    ].filter(([item]) => !item).map(([, label]) => label);
    if (missing.length) {
      errors.push({ row: rowNumber, message: `Faltan: ${missing.join(", ")}.` });
      return;
    }
    const program = get<{ id: number; duration_periods: number | null }>(
      "SELECT id, duration_periods FROM programs WHERE name = ? AND is_active = 1",
      programName
    );
    const shift = get<{ id: number }>("SELECT id FROM shifts WHERE name = ? AND is_active = 1", shiftName);
    const cycle = get<{ id: number }>("SELECT id FROM school_cycles WHERE name = ? AND is_active = 1", cycleName);
    const status = get<{ id: number }>("SELECT id FROM student_statuses WHERE name = ? AND is_active = 1", statusName);
    const planName = value(source, "Plan académico", "Plan academico", "Plan");
    const plan = program
      ? planName
        ? get<{ id: number }>(
            `SELECT id FROM academic_plans
             WHERE program_id = ? AND is_active = 1 AND (name = ? OR code = ? OR matriculation_code = ?)
             ORDER BY id DESC LIMIT 1`,
            program.id, planName, planName.toUpperCase(), planName.toUpperCase()
          )
        : get<{ id: number }>(
            "SELECT id FROM academic_plans WHERE program_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1",
            program.id
          )
      : undefined;
    const group = program && shift && cycle
      ? get<{ id: number }>("SELECT id FROM groups WHERE name = ? AND program_id = ? AND shift_id = ? AND COALESCE(active_cycle_id,cycle_id) = ? AND is_active = 1", groupName, program.id, shift.id, cycle.id)
      : undefined;
    const curricularPeriod = curricularPeriodName
      ? get<{ id: number; sequence: number }>(
          "SELECT id, sequence FROM curricular_periods WHERE name = ? COLLATE NOCASE AND is_active = 1",
          curricularPeriodName
        )
      : undefined;
    const invalid = [
      [program, `programa "${programName}"`], [shift, `turno "${shiftName}"`], [cycle, `ciclo "${cycleName}"`],
      [group, `grupo "${groupName}"`], [plan, planName ? `plan "${planName}"` : "plan académico activo"],
      [curricularPeriod, `periodo del plan "${curricularPeriodName}"`], [status, `estatus "${statusName}"`]
    ].filter(([item]) => !item).map(([, label]) => label);
    if (program?.duration_periods && curricularPeriod && curricularPeriod.sequence > program.duration_periods) {
      invalid.push(`periodo del plan "${curricularPeriodName}" fuera de la duración del programa`);
    }
    if (invalid.length) {
      errors.push({ row: rowNumber, message: `No existe o está inactivo: ${invalid.join(", ")}.` });
      return;
    }
    const secondLastName = value(source, "Apellido materno", "second_last_name");
    const birthDate=value(source,"Fecha de nacimiento","birth_date");
    if(birthDate) { try { isoDate(birthDate,"Fecha de nacimiento"); } catch(error) { errors.push({row:rowNumber,message:error instanceof Error?error.message:"Fecha inválida."});return; } }
    let identity: ReturnType<typeof generateStudentIdentity>;
    try {
      identity = generateStudentIdentity({
        firstName,
        lastName,
        secondLastName,
        programId: program!.id,
        shiftId: shift!.id,
        groupId: group!.id,
        cycleId: cycle!.id,
        planId: plan!.id
      });
    } catch (error) {
      errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "No fue posible generar la matrícula." });
      return;
    }
    const suppliedExisting = suppliedStudentNumber
      ? get<{ id: number; student_number: string }>("SELECT id, student_number FROM students WHERE student_number = ?", suppliedStudentNumber)
      : undefined;
    const studentNumber = suppliedExisting?.student_number ?? identity.studentNumber;
    if (studentNumbers.has(studentNumber)) {
      errors.push({ row: rowNumber, message: `La matrícula automática ${studentNumber} está repetida dentro del archivo.` });
      return;
    }
    studentNumbers.add(studentNumber);
    valid.push({
      row: rowNumber,
      studentNumber,
      firstName,
      lastName,
      secondLastName,
      curp: value(source, "CURP"),
      birthDate: value(source, "Fecha de nacimiento", "birth_date"),
      email: identity.email,
      phone: value(source, "Teléfono", "Telefono"),
      programId: program!.id,
      shiftId: shift!.id,
      groupId: group!.id,
      cycleId: cycle!.id,
      planId: plan!.id,
      curricularPeriodId: curricularPeriod!.id,
      statusId: status!.id,
      exists: Boolean(get("SELECT id FROM students WHERE student_number = ?", studentNumber))
    });
  });
  const previewId = crypto.randomUUID();
  previews.set(previewId, { createdAt: Date.now(), fileName: req.file.originalname, valid, errors });
  logActivity(req, "preview-import", "students", previewId, { rows: rows.length, valid: valid.length, errors: errors.length });
  res.json({
    previewId,
    summary: { total: rows.length, valid: valid.length, errors: errors.length, existing: valid.filter((row) => row.exists).length },
    rows: valid.slice(0, 100),
    errors: errors.slice(0, 100)
  });
});

studentsRouter.post("/import/apply", requirePermission("students.import"), (req: AuthenticatedRequest, res) => {
  const preview = previews.get(String(req.body.previewId));
  if (!preview || Date.now() - preview.createdAt > 15 * 60 * 1000) throw new ApiError(400, "La vista previa expiró. Carga el archivo de nuevo.");
  const updateExisting = req.body.existingMode === "update";
  let created = 0;
  let updated = 0;
  let ignored = 0;
  let accountsCreated = 0;
  transaction(() => {
    preview.valid.forEach((item) => {
      const existing = get<{ id: number }>("SELECT id FROM students WHERE student_number = ?", item.studentNumber);
      if (existing && !updateExisting) {
        const currentStudent = get<{
          student_number: string;
          first_name: string;
          last_name: string;
          second_last_name: string | null;
        }>("SELECT student_number, first_name, last_name, second_last_name FROM students WHERE id = ?", existing.id)!;
        const access = provisionStudentAccount({
          studentId: existing.id,
          studentNumber: currentStudent.student_number,
          firstName: currentStudent.first_name,
          lastName: currentStudent.last_name,
          secondLastName: currentStudent.second_last_name
        });
        if (access.created) accountsCreated += 1;
        ignored++;
        return;
      }
      let studentId = existing?.id;
      if (existing) {
        run(
          `UPDATE students SET first_name = ?, last_name = ?, second_last_name = ?, curp = COALESCE(?, curp),
           birth_date = COALESCE(?, birth_date), phone = ?, status_id = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          item.firstName, item.lastName, optionalText(item.secondLastName), optionalText(item.curp),
          optionalText(item.birthDate), optionalText(item.phone), item.statusId, existing.id
        );
        updated++;
      } else {
        const result = run(
          `INSERT INTO students(student_number, first_name, last_name, second_last_name, curp, birth_date, email, phone, status_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          item.studentNumber, item.firstName, item.lastName, optionalText(item.secondLastName), optionalText(item.curp),
          optionalText(item.birthDate), optionalText(item.email), optionalText(item.phone), item.statusId
        );
        studentId = Number(result.lastInsertRowid);
        created++;
      }
      run(
        `INSERT INTO enrollments(student_id, program_id, shift_id, group_id, cycle_id, curricular_period_id, plan_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, cycle_id) DO UPDATE SET program_id = excluded.program_id,
         shift_id = excluded.shift_id, group_id = excluded.group_id,
         curricular_period_id = excluded.curricular_period_id,
         plan_id = excluded.plan_id, is_active = 1`,
        studentId!, item.programId, item.shiftId, item.groupId, item.cycleId, item.curricularPeriodId, item.planId
      );
      const enrollment = get<{ id: number }>(
        "SELECT id FROM enrollments WHERE student_id = ? AND cycle_id = ? AND is_active = 1",
        studentId!,
        item.cycleId
      );
      if (enrollment) syncEnrollmentGroupSubjects(enrollment.id);
      const access = provisionStudentAccount({
        studentId: studentId!,
        studentNumber: item.studentNumber,
        firstName: item.firstName,
        lastName: item.lastName,
        secondLastName: item.secondLastName
      });
      if (access.created) accountsCreated += 1;
    });
  });
  previews.delete(String(req.body.previewId));
  logActivity(req, "apply-import", "students", String(req.body.previewId), { created, updated, ignored, accountsCreated });
  res.json({
    message: "Importación aplicada correctamente. Los accesos institucionales quedaron vinculados automáticamente.",
    created,
    updated,
    ignored,
    accountsCreated,
    errors: preview.errors.length
  });
});

studentsRouter.get("/export/file", requirePermission("students.export"), (req, res) => {
  const records = all<any>(`${studentSelect()} ORDER BY spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name)`);
  const rows = records.map((student) => ({
    Matrícula: student.student_number,
    Alumno: student.full_name,
    Programa: student.program_name,
    Turno: student.shift_name,
    Grupo: student.group_name,
    Ciclo: student.cycle_name,
    "Periodo del plan": student.curricular_period_name,
    Estatus: student.status_name,
    Correo: student.email ?? "",
    Teléfono: student.phone ?? ""
  }));
  const format = String(req.query.format ?? "xlsx");
  if (format === "csv") {
    const headers = Object.keys(rows[0] ?? {});
    return sendCsv(res, "alumnos.csv", headers, rows.map((row) => headers.map((header) => row[header as keyof typeof row])));
  }
  if (format === "pdf") {
    const doc = createPdf(res, "alumnos.pdf", { layout: "landscape" });
    doc.fillColor("#102a43").font("Helvetica-Bold").fontSize(18).text("Listado de alumnos");
    doc.moveDown(0.3).fillColor("#627d98").font("Helvetica").fontSize(9).text(`Generado: ${new Date().toLocaleString("es-MX")}`);
    doc.moveDown();
    pdfTable(doc, ["Matrícula", "Alumno", "Programa", "Turno", "Grupo", "Estatus"], rows.map((row) => [
      row.Matrícula, row.Alumno, row.Programa, row.Turno, row.Grupo, row.Estatus
    ]), [70, 170, 180, 70, 50, 90]);
    return doc.end();
  }
  return sendWorkbook(res, "alumnos.xlsx", "Alumnos", rows);
});
