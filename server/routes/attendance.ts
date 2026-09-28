import { Router } from "express";
import { logActivity, requirePermission, type AuthenticatedRequest, type AuthUser } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { studentAttendanceMonths } from "../services/daily-attendance.js";
import { teacherIdForUser } from "../services/teacher-scope.js";
import { ApiError, asId, optionalText } from "../utils.js";

export const attendanceRouter = Router();

function validDate(input: unknown) {
  const date = String(input ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "Selecciona una fecha válida.");
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new ApiError(400, "La fecha no existe en el calendario.");
  return date;
}

function groupDetails(id: number, user: AuthUser | undefined) {
  const group = get<any>(`SELECT g.id, g.name AS group_name, g.study_modality, p.name AS program_name,
    sc.name AS cycle_name FROM groups g JOIN programs p ON p.id = g.program_id
    JOIN school_cycles sc ON sc.id = g.cycle_id WHERE g.id = ? AND g.is_active = 1`, id);
  if (!group) throw new ApiError(404, "No se encontró el grupo activo.");
  const teacherId = teacherIdForUser(user);
  if (teacherId != null && !get("SELECT id FROM subject_assignments WHERE group_id = ? AND teacher_id = ? AND is_active = 1", id, teacherId)) {
    throw new ApiError(403, "Solo puedes pasar lista a los grupos que tienes asignados.");
  }
  return group;
}

function roster(groupId: number, date: string) {
  return all<any>(`SELECT e.id AS enrollment_id, st.id AS student_id, st.student_number,
    TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
    ar.status, ar.notes
    FROM enrollments e JOIN students st ON st.id = e.student_id
    LEFT JOIN daily_attendance_records ar ON ar.enrollment_id = e.id AND ar.group_id = ? AND ar.attendance_date = ?
    WHERE ar.student_id IS NOT NULL OR (e.group_id = ? AND e.is_active = 1 AND st.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM daily_attendance_records previous
        WHERE previous.student_id = st.id AND previous.group_id = ? AND previous.attendance_date = ?))
    ORDER BY st.last_name, st.second_last_name, st.first_name`, groupId, date, groupId, groupId, date);
}

attendanceRouter.get("/groups", requirePermission("attendance.view"), (req: AuthenticatedRequest, res) => {
  const teacherId = teacherIdForUser(req.user);
  res.json(all(`SELECT g.id, g.name AS group_name, g.study_modality, p.name AS program_name, sc.name AS cycle_name
    FROM groups g JOIN programs p ON p.id = g.program_id JOIN school_cycles sc ON sc.id = g.cycle_id
    WHERE g.is_active = 1 AND (? IS NULL OR EXISTS (
      SELECT 1 FROM subject_assignments a WHERE a.group_id = g.id AND a.teacher_id = ? AND a.is_active = 1
    )) ORDER BY sc.start_date DESC, g.name`, teacherId, teacherId));
});

attendanceRouter.get("/group/:id", requirePermission("attendance.view"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.params.id, "Grupo");
  const group = groupDetails(groupId, req.user);
  const date = validDate(req.query.date);
  const month = date.slice(0, 7);
  const day = get<any>("SELECT * FROM attendance_days WHERE group_id = ? AND attendance_date = ?", groupId, date)
    ?? { status: "draft", revision: 0, confirmed_at: null };
  const students = roster(groupId, date).map((student) => ({ ...student,
    summary: studentAttendanceMonths(student.enrollment_id, groupId).find((row) => row.month === month)
      ?? { scheduled_days: 0, attended_days: 0, percentage: 0 }
  }));
  const days = all("SELECT attendance_date, status FROM attendance_days WHERE group_id = ? AND substr(attendance_date, 1, 7) = ? ORDER BY attendance_date", groupId, month);
  const legacy = all(`SELECT am.month, am.status, s.name AS subject_name, st.student_number,
    TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
    am.scheduled_classes, ar.attended_classes
    FROM attendance_months am JOIN attendance_records ar ON ar.attendance_month_id = am.id
    JOIN subject_assignments a ON a.id = am.assignment_id JOIN subjects s ON s.id = a.subject_id
    JOIN enrollments e ON e.id = ar.enrollment_id JOIN students st ON st.id = e.student_id
    WHERE a.group_id = ? AND am.month = ? ORDER BY s.name, student_name`, groupId, month);
  const monthSettings = get("SELECT class_days, revision FROM group_month_class_days WHERE group_id = ? AND month = ?", groupId, month)
    ?? { class_days: null, revision: 0 };
  res.json({ group, date, day, days, students, legacy, monthSettings });
});

attendanceRouter.put("/group/:id/month", requirePermission("attendance.manage"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.params.id, "Grupo");
  groupDetails(groupId, req.user);
  const month = String(req.body.month ?? "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Selecciona un mes válido.");
  validDate(`${month}-01`);
  const daysInMonth = new Date(`${month}-01T12:00:00Z`);
  daysInMonth.setUTCMonth(daysInMonth.getUTCMonth() + 1, 0);
  const classDays = req.body.classDays;
  if (!Number.isInteger(classDays) || classDays < 0 || classDays > daysInMonth.getUTCDate()) {
    throw new ApiError(400, `Los días de clase deben ser un entero entre 0 y ${daysInMonth.getUTCDate()}.`);
  }
  transaction(() => {
    const previous = get<any>("SELECT * FROM group_month_class_days WHERE group_id = ? AND month = ?", groupId, month);
    if (req.body.revision !== (previous?.revision ?? 0)) throw new ApiError(409, "Otro usuario cambió los días de clase. Recarga la lista antes de guardar.");
    const confirmed = get<{ count: number }>("SELECT COUNT(*) AS count FROM attendance_days WHERE group_id = ? AND substr(attendance_date, 1, 7) = ? AND status = 'confirmed'", groupId, month)!;
    if (classDays < confirmed.count) throw new ApiError(400, `Ya hay ${confirmed.count} días confirmados. El total de clases no puede ser menor.`);
    run(`INSERT INTO group_month_class_days(group_id, month, class_days, updated_by) VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id, month) DO UPDATE SET class_days = excluded.class_days,
        revision = group_month_class_days.revision + 1, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    groupId, month, classDays, req.user!.id);
    logActivity(req, "set-month-class-days", "group_month_class_days", `${groupId}:${month}`, { previous: previous?.class_days ?? null, classDays });
  });
  res.json({ message: "Días de clase guardados. Porcentajes mensuales actualizados." });
});

attendanceRouter.put("/group/:id", requirePermission("attendance.manage"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.params.id, "Grupo");
  groupDetails(groupId, req.user);
  const date = validDate(req.body.date);
  const confirm = req.body.confirm === true;
  const revision = req.body.revision;
  if (!Number.isInteger(revision) || revision < 0) throw new ApiError(400, "Recarga la lista antes de guardar.");
  const records = Array.isArray(req.body.records) ? req.body.records : [];
  const result = transaction(() => {
    const current = get<any>("SELECT * FROM attendance_days WHERE group_id = ? AND attendance_date = ?", groupId, date);
    if ((current?.revision ?? 0) !== revision) throw new ApiError(409, "Otro usuario actualizó esta lista. Recarga la fecha para ver sus cambios antes de guardar.");
    if (confirm && current?.status !== "confirmed") {
      const settings = get<{ class_days: number }>("SELECT class_days FROM group_month_class_days WHERE group_id = ? AND month = ?", groupId, date.slice(0, 7));
      const confirmed = get<{ count: number }>("SELECT COUNT(*) AS count FROM attendance_days WHERE group_id = ? AND substr(attendance_date, 1, 7) = ? AND status = 'confirmed'", groupId, date.slice(0, 7))!;
      if (settings && confirmed.count >= settings.class_days) throw new ApiError(409, "Se alcanzó el total de días de clase del mes. Actualiza ese total antes de confirmar otro día.");
    }
    const students = roster(groupId, date);
    const validEnrollments = new Map(students.map((s) => [s.enrollment_id, s]));
    const submitted = new Set<number>();
    const markedStudents = new Set<number>();
    if (!students.length || !records.length) throw new ApiError(400, "El grupo no tiene alumnos para registrar en esta fecha.");
    for (const item of records) {
      const id = asId(item.enrollmentId, "Inscripción");
      const student = validEnrollments.get(id);
      if (!student || submitted.has(id) || markedStudents.has(student.student_id)) throw new ApiError(400, "La lista contiene alumnos ajenos al grupo o duplicados.");
      submitted.add(id);
      markedStudents.add(student.student_id);
      if (!["present", "absent", ""].includes(item.status) || (confirm && item.status === "")) throw new ApiError(400, "Marca presente o falta para todos los alumnos antes de confirmar el día.");
      const other = get<any>("SELECT group_id FROM daily_attendance_records WHERE student_id = ? AND attendance_date = ?", student.student_id, date);
      if (other && other.group_id !== groupId) throw new ApiError(409, `${student.student_name} ya tiene asistencia en otro grupo para esta fecha.`);
    }
    if (submitted.size !== students.length) throw new ApiError(400, "La lista cambió o está incompleta. Recarga e incluye a todos los alumnos.");
    run(`INSERT INTO attendance_days(group_id, attendance_date, status, revision, confirmed_at, confirmed_by, updated_by)
      VALUES (?, ?, ?, 1, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?)
      ON CONFLICT(group_id, attendance_date) DO UPDATE SET status = excluded.status, revision = attendance_days.revision + 1,
        confirmed_at = excluded.confirmed_at, confirmed_by = excluded.confirmed_by, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    groupId, date, confirm ? "confirmed" : "draft", confirm ? 1 : 0, confirm ? req.user!.id : null, req.user!.id);
    const previous = all("SELECT student_id, status, notes FROM daily_attendance_records WHERE group_id = ? AND attendance_date = ?", groupId, date);
    for (const item of records) {
      const student = validEnrollments.get(Number(item.enrollmentId))!;
      if (item.status === "") {
        run("DELETE FROM daily_attendance_records WHERE student_id = ? AND attendance_date = ? AND group_id = ?", student.student_id, date, groupId);
        continue;
      }
      run(`INSERT INTO daily_attendance_records(student_id, attendance_date, group_id, enrollment_id, status, notes, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, attendance_date) DO UPDATE SET status = excluded.status, notes = excluded.notes,
          updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
      student.student_id, date, groupId, student.enrollment_id, item.status, optionalText(item.notes, 500), req.user!.id);
    }
    logActivity(req, confirm ? "confirm-daily-attendance" : "save-daily-attendance", "attendance_days", `${groupId}:${date}`, { previous, records });
    return revision + 1;
  });
  res.json({ message: confirm ? "Asistencia del día confirmada para todas las materias." : "Borrador del día guardado.", revision: result });
});

attendanceRouter.put("/assignment/:id", requirePermission("attendance.manage"), (_req, _res) => {
  throw new ApiError(410, "La asistencia ahora se registra por grupo, alumno y fecha. Recarga la sección Asistencia.");
});
