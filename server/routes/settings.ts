import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import multer from "multer";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, databasePath, db, get, restorePath, run, transaction } from "../db.js";
import { ApiError, asId, cleanText, optionalText } from "../utils.js";
import { getCycleCalendar, syncAcademicSubjectStatuses, validCalendarDate, validateCycleCalendar } from "../services/academic-calendar.js";
import { normalizePublicAppUrl } from "../services/document-verification.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const uploadsDir = process.env.UPLOADS_PATH
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.join(projectRoot, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"].includes(file.mimetype);
    if (allowed) callback(null, true);
    else callback(new ApiError(400, "El logo debe ser PNG, JPG o WebP."));
  }
});
const databaseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

export const settingsRouter = Router();

settingsRouter.get("/", requirePermission("dashboard.view"), (_req, res) => {
  res.json({
    settings: get(
      `SELECT i.*, c.name AS active_cycle_name, s.name AS default_scale_name
       FROM institution_settings i LEFT JOIN school_cycles c ON c.id = i.active_cycle_id
       LEFT JOIN grading_scales s ON s.id = i.default_scale_id WHERE i.id = 1`
    ),
    cycles: all("SELECT id, name, start_date, end_date FROM school_cycles WHERE is_active = 1 ORDER BY start_date DESC"),
    cycleCalendars: all<{id:number}>("SELECT id FROM school_cycles WHERE is_active = 1 ORDER BY start_date DESC").map(cycle => getCycleCalendar(cycle.id)),
    scales: all("SELECT id, name FROM grading_scales WHERE is_active = 1 ORDER BY name"),
    calendarEvents: all(
      `SELECT ace.*, sc.name AS cycle_name FROM academic_calendar_events ace
       LEFT JOIN school_cycles sc ON sc.id = ace.school_cycle_id
       WHERE ace.is_active = 1 ORDER BY ace.start_date, ace.id`
    )
  });
});

settingsRouter.put("/cycles/:id/calendar", requirePermission("settings.manage"), (req: AuthenticatedRequest, res) => {
  const cycleId = asId(req.params.id, "Ciclo escolar");
  getCycleCalendar(cycleId);
  const calendar = validateCycleCalendar(req.body.startDate, req.body.endDate, req.body.vacations ?? []);
  transaction(() => {
    run("UPDATE school_cycles SET start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", calendar.start, calendar.end, cycleId);
    for (const [type, title, date] of [["class_start", "Inicio de actividades del ciclo", calendar.start], ["cycle_end", "Fin de actividades del ciclo", calendar.end]]) {
      run("DELETE FROM academic_calendar_events WHERE school_cycle_id = ? AND event_type = ?", cycleId, type);
      run(`INSERT INTO academic_calendar_events(school_cycle_id, event_type, title, start_date, end_date, auto_start_subjects, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, cycleId, type, title, date, date, type === "class_start" ? 1 : 0, req.user!.id, req.user!.id);
    }
    run("DELETE FROM academic_calendar_events WHERE school_cycle_id = ? AND event_type = 'vacation'", cycleId);
    for (const vacation of calendar.vacations) {
      run(`INSERT INTO academic_calendar_events(school_cycle_id, event_type, title, start_date, end_date, created_by, updated_by)
        VALUES (?, 'vacation', 'Periodo vacacional', ?, ?, ?, ?)`, cycleId, vacation.start_date, vacation.end_date, req.user!.id, req.user!.id);
    }
  });
  syncAcademicSubjectStatuses();
  logActivity(req, "update-cycle-calendar", "school_cycles", cycleId, calendar);
  res.json(getCycleCalendar(cycleId));
});

function calendarEventBody(body: any, existingId: number | null = null) {
  const eventType = cleanText(body.eventType, 30);
  const allowed = ["class_start", "evaluation", "enrollment", "reenrollment", "vacation", "resumption", "cycle_end", "other"];
  if (!allowed.includes(eventType)) throw new ApiError(400, "Selecciona un tipo de fecha válido.");
  const title = cleanText(body.title, 160);
  const startDate = cleanText(body.startDate, 10);
  const endDate = cleanText(body.endDate || body.startDate, 10);
  if (!title || !validCalendarDate(startDate) || !validCalendarDate(endDate) || endDate < startDate) {
    throw new ApiError(400, "Captura un título y un rango de fechas válido.");
  }
  const cycleId = body.cycleId ? asId(body.cycleId, "Ciclo escolar") : null;
  if (["class_start", "cycle_end", "vacation"].includes(eventType) && !cycleId) {
    throw new ApiError(400, "Vincula el inicio, fin y vacaciones a un ciclo escolar específico.");
  }
  if (cycleId) {
    const cycle = getCycleCalendar(cycleId);
    const vacations = all<{start_date:string;end_date:string}>(
      `SELECT start_date, end_date FROM academic_calendar_events WHERE school_cycle_id = ?
       AND event_type = 'vacation' AND is_active = 1 AND (? IS NULL OR id <> ?)`, cycleId, existingId, existingId
    );
    validateCycleCalendar(eventType === "class_start" ? startDate : cycle.activity_start,
      eventType === "cycle_end" ? endDate : cycle.activity_end,
      eventType === "vacation" ? [...vacations, { start_date: startDate, end_date: endDate }]
        : ["class_start", "cycle_end"].includes(eventType) ? vacations : []);
  }
  return {
    cycleId,
    eventType,
    title,
    startDate,
    endDate,
    description: optionalText(body.description, 500),
    autoStartSubjects: body.autoStartSubjects ? 1 : 0
  };
}

function updateCycleBoundary(event: ReturnType<typeof calendarEventBody>) {
  if (event.cycleId && event.eventType === "class_start") run("UPDATE school_cycles SET start_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", event.startDate, event.cycleId);
  if (event.cycleId && event.eventType === "cycle_end") run("UPDATE school_cycles SET end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", event.endDate, event.cycleId);
}

settingsRouter.post("/calendar-events", requirePermission("settings.manage"), (req: AuthenticatedRequest, res) => {
  const event = calendarEventBody(req.body);
  const inserted = run(
    `INSERT INTO academic_calendar_events(school_cycle_id, event_type, title, start_date, end_date,
     description, auto_start_subjects, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    event.cycleId, event.eventType, event.title, event.startDate, event.endDate,
    event.description, event.autoStartSubjects, req.user!.id, req.user!.id
  );
  const id = Number(inserted.lastInsertRowid);
  updateCycleBoundary(event);
  syncAcademicSubjectStatuses();
  logActivity(req, "create-academic-calendar-event", "academic_calendar_events", id, event);
  res.status(201).json(get("SELECT * FROM academic_calendar_events WHERE id = ?", id));
});

settingsRouter.patch("/calendar-events/:id", requirePermission("settings.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Fecha académica");
  if (!get("SELECT id FROM academic_calendar_events WHERE id = ?", id)) throw new ApiError(404, "La fecha académica no existe.");
  const event = calendarEventBody(req.body, id);
  run(
    `UPDATE academic_calendar_events SET school_cycle_id = ?, event_type = ?, title = ?, start_date = ?,
     end_date = ?, description = ?, auto_start_subjects = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    event.cycleId, event.eventType, event.title, event.startDate, event.endDate,
    event.description, event.autoStartSubjects, req.user!.id, id
  );
  updateCycleBoundary(event);
  syncAcademicSubjectStatuses();
  logActivity(req, "update-academic-calendar-event", "academic_calendar_events", id, event);
  res.json(get("SELECT * FROM academic_calendar_events WHERE id = ?", id));
});

settingsRouter.delete("/calendar-events/:id", requirePermission("settings.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Fecha académica");
  const event = get("SELECT * FROM academic_calendar_events WHERE id = ?", id);
  if (!event) throw new ApiError(404, "La fecha académica no existe.");
  run("DELETE FROM academic_calendar_events WHERE id = ?", id);
  logActivity(req, "delete-academic-calendar-event", "academic_calendar_events", id, event);
  res.status(204).end();
});

settingsRouter.patch("/", requirePermission("settings.manage"), (req: AuthenticatedRequest, res) => {
  const body = req.body;
  const name = cleanText(body.institutionName, 200);
  if (!name) throw new ApiError(400, "El nombre de la institución es obligatorio.");
  const publicUrl = body.publicAppUrl === undefined ? undefined : normalizePublicAppUrl(body.publicAppUrl);
  if (body.activeCycleId && !get("SELECT id FROM school_cycles WHERE id = ? AND is_active = 1", asId(body.activeCycleId, "Ciclo escolar"))) {
    throw new ApiError(400, "Selecciona un ciclo escolar activo.");
  }
  run(
    `UPDATE institution_settings SET institution_name = ?, address = ?, phone = ?, email = ?,
     director_name = ?, active_cycle_id = ?, default_scale_id = ?, footer_text = ?,
     primary_color = ?, secondary_color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    name,
    optionalText(body.address, 300),
    optionalText(body.phone, 50),
    optionalText(body.email, 180),
    optionalText(body.directorName, 180),
    body.activeCycleId ? Number(body.activeCycleId) : null,
    body.defaultScaleId ? Number(body.defaultScaleId) : null,
    optionalText(body.footerText, 500),
    cleanText(body.primaryColor, 20) || "#102a43",
    cleanText(body.secondaryColor, 20) || "#f97360"
  );
  if (publicUrl !== undefined) run("UPDATE institution_settings SET public_app_url = ? WHERE id = 1", publicUrl);
  logActivity(req, "update", "institution_settings", 1, body);
  res.json(get("SELECT * FROM institution_settings WHERE id = 1"));
});

settingsRouter.post("/logo", requirePermission("settings.manage"), upload.single("logo"), (req: AuthenticatedRequest, res) => {
  if (!req.file) throw new ApiError(400, "Selecciona un logo.");
  const extension = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
  const filename = `institution-logo-${Date.now()}.${extension}`;
  fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
  const logoPath = `/uploads/${filename}`;
  run("UPDATE institution_settings SET logo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1", logoPath);
  logActivity(req, "upload-logo", "institution_settings", 1, { logoPath });
  res.json({ logoPath });
});

settingsRouter.post(
  "/restore-database",
  requirePermission("settings.manage"),
  databaseUpload.single("database"),
  (req: AuthenticatedRequest, res) => {
    if (req.user?.roleName !== "Administrador") {
      throw new ApiError(403, "Solo un administrador puede restaurar la base de datos.");
    }
    if (!req.file) throw new ApiError(400, "Selecciona un archivo SQLite.");
    if (!req.file.buffer.subarray(0, 16).toString("utf8").startsWith("SQLite format 3")) {
      throw new ApiError(400, "El archivo seleccionado no es una base SQLite valida.");
    }

    const validationPath = `${databasePath}.validation-${Date.now()}`;
    try {
      fs.writeFileSync(validationPath, req.file.buffer, { flag: "wx" });
      const candidate = new DatabaseSync(validationPath, { readOnly: true });
      try {
        const check = candidate.prepare("PRAGMA quick_check").get() as Record<string, string>;
        if (!Object.values(check).includes("ok")) {
          throw new ApiError(400, "La base SQLite esta danada.");
        }
        const requiredTables = [
          "users", "students", "enrollments", "grades", "student_payments",
          "academic_plans", "plan_subjects", "subjects", "groups", "shifts",
          "school_cycles", "academic_periods", "programs"
        ];
        const tables = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
        const available = new Set(tables.map((table) => table.name));
        if (requiredTables.some((table) => !available.has(table))) {
          throw new ApiError(400, "La base no corresponde a Universidad IFOP.");
        }
        const count = (table: string) => Number((candidate.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
        const summary = {
          students: count("students"),
          enrollments: count("enrollments"),
          grades: count("grades"),
          payments: count("student_payments"),
          users: count("users"),
          plans: count("academic_plans"),
          planSubjects: count("plan_subjects"),
          subjects: count("subjects"),
          groups: count("groups"),
          shifts: count("shifts"),
          cycles: count("school_cycles"),
          periods: count("academic_periods"),
          curricularPeriods: available.has("curricular_periods") ? count("curricular_periods") : 0,
          programs: count("programs")
        };
        candidate.close();
        if (fs.existsSync(restorePath)) fs.rmSync(restorePath);
        fs.renameSync(validationPath, restorePath);
        logActivity(req, "stage-database-restore", "database", undefined, summary);
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        res.json({ message: "Respaldo validado. Ejecuta un despliegue manual en Render para aplicarlo.", summary });
      } catch (error) {
        try { candidate.close(); } catch { /* Already closed. */ }
        throw error;
      }
    } finally {
      if (fs.existsSync(validationPath)) fs.rmSync(validationPath);
    }
  }
);

settingsRouter.get("/database-backup", requirePermission("settings.manage"), (req: AuthenticatedRequest, res) => {
  if (req.user?.roleName !== "Administrador") {
    throw new ApiError(403, "Solo un administrador puede descargar la base de datos.");
  }
  if (!fs.existsSync(databasePath)) throw new ApiError(404, "No se encontro la base de datos.");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const date = new Date().toISOString().slice(0, 10);
  logActivity(req, "download-database-backup", "database", undefined, { databasePath });
  res.download(databasePath, `universidad-ifop-respaldo-${date}.db`);
});

settingsRouter.get("/audit", requirePermission("audit.view"), (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(all(
    `SELECT l.*, u.full_name AS user_name FROM activity_logs l
     LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT ?`,
    limit
  ));
});
