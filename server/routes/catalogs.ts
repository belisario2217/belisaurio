import { Router } from "express";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { ApiError, asId, booleanInt, cleanText, optionalText } from "../utils.js";
import { getCycleCalendar, validateCycleCalendar } from "../services/academic-calendar.js";

type FieldDefinition = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "color" | "boolean" | "select";
  required?: boolean;
  reference?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
};

type CatalogDefinition = {
  table: string;
  label: string;
  singular: string;
  fields: FieldDefinition[];
  listSql?: string;
};

const definitions: Record<string, CatalogDefinition> = {
  levels: {
    table: "academic_levels",
    label: "Niveles académicos",
    singular: "Nivel académico",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "description", label: "Descripción" }
    ]
  },
  programs: {
    table: "programs",
    label: "Programas de estudio",
    singular: "Programa",
    fields: [
      { name: "code", label: "Clave", required: true },
      { name: "name", label: "Nombre", required: true },
      { name: "level_id", label: "Nivel", type: "number", reference: "levels", required: true },
      { name: "duration_periods", label: "Semestres del plan", type: "number" },
      { name: "description", label: "Descripción" }
    ],
    listSql: "SELECT p.*, l.name AS level_name FROM programs p LEFT JOIN academic_levels l ON l.id = p.level_id"
  },
  shifts: {
    table: "shifts",
    label: "Turnos",
    singular: "Turno",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "start_time", label: "Hora inicial", type: "time" },
      { name: "end_time", label: "Hora final", type: "time" }
    ]
  },
  cycles: {
    table: "school_cycles",
    label: "Ciclos escolares",
    singular: "Ciclo escolar",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "start_date", label: "Inicio de actividades del ciclo", type: "date", required: true },
      { name: "end_date", label: "Fecha final", type: "date", required: true }
    ]
  },
  periods: {
    table: "academic_periods",
    label: "Periodos de evaluación (parciales)",
    singular: "Periodo de evaluación",
    fields: [
      { name: "cycle_id", label: "Ciclo", type: "number", reference: "cycles", required: true },
      { name: "name", label: "Nombre", required: true },
      { name: "sequence", label: "Orden", type: "number", required: true },
      { name: "start_date", label: "Fecha inicial", type: "date", required: true },
      { name: "end_date", label: "Fecha final", type: "date", required: true },
      { name: "grade_entry_open", label: "Captura abierta", type: "boolean" }
    ],
    listSql: "SELECT p.*, c.name AS cycle_name FROM academic_periods p JOIN school_cycles c ON c.id = p.cycle_id"
  },
  semesters: {
    table: "curricular_periods",
    label: "Periodos del plan de estudios",
    singular: "Periodo del plan",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "sequence", label: "Avance semestral", type: "number", required: true }
    ]
  },
  groups: {
    table: "groups",
    label: "Grupos",
    singular: "Grupo",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "program_id", label: "Programa", type: "number", reference: "programs", required: true },
      { name: "shift_id", label: "Turno", type: "number", reference: "shifts", required: true },
      { name: "cycle_id", label: "Ciclo de formación del grupo", type: "number", reference: "cycles", required: true },
      {
        name: "study_modality",
        label: "Modalidad de estudio",
        type: "select",
        required: true,
        defaultValue: "escolarizado",
        options: [
          { value: "escolarizado", label: "Escolarizado (ESC)" },
          { value: "semiescolarizado", label: "Semiescolarizado (SEM)" },
          { value: "complementario", label: "Complementario (COM)" },
          { value: "en_linea", label: "En Línea (LIN)" }
        ]
      },
      { name: "capacity", label: "Capacidad", type: "number" }
    ],
    listSql: `SELECT g.*, p.name AS program_name, s.name AS shift_name, c.name AS cycle_name
              FROM groups g JOIN programs p ON p.id = g.program_id
              JOIN shifts s ON s.id = g.shift_id JOIN school_cycles c ON c.id = g.cycle_id`
  },
  subjects: {
    table: "subjects",
    label: "Materias",
    singular: "Materia",
    fields: [
      { name: "code", label: "Clave", required: true },
      { name: "name", label: "Nombre", required: true },
      { name: "program_id", label: "Programa", type: "number", reference: "programs", required: true },
      { name: "credits", label: "Créditos", type: "number" },
      { name: "hours_per_week", label: "Horas por semana", type: "number" }
    ],
    listSql: "SELECT s.*, p.name AS program_name FROM subjects s JOIN programs p ON p.id = s.program_id"
  },
  teachers: {
    table: "teachers",
    label: "Docentes",
    singular: "Docente",
    fields: [
      { name: "employee_number", label: "Número de empleado", required: true },
      { name: "full_name", label: "Nombre completo", required: true },
      { name: "email", label: "Correo" },
      { name: "phone", label: "Teléfono" },
      { name: "specialty", label: "Especialidad" }
    ]
  },
  criteria: {
    table: "evaluation_criteria",
    label: "Criterios de evaluación",
    singular: "Criterio",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "default_weight", label: "Ponderación sugerida", type: "number", required: true },
      { name: "description", label: "Descripción" }
    ]
  },
  scales: {
    table: "grading_scales",
    label: "Escalas de calificación",
    singular: "Escala",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "min_score", label: "Mínimo", type: "number", required: true },
      { name: "max_score", label: "Máximo", type: "number", required: true },
      { name: "passing_score", label: "Mínimo aprobatorio", type: "number", required: true },
      { name: "decimals", label: "Decimales", type: "number" },
      { name: "is_default", label: "Predeterminada", type: "boolean" }
    ]
  },
  statuses: {
    table: "student_statuses",
    label: "Estatus de alumno",
    singular: "Estatus",
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "color", label: "Color", type: "color" },
      { name: "is_terminal", label: "Estatus terminal", type: "boolean" }
    ]
  }
};

export const catalogsRouter = Router();

function definition(type: string | string[]) {
  type = String(type);
  const catalog = definitions[type];
  if (!catalog) throw new ApiError(404, "El catálogo solicitado no existe.");
  return catalog;
}

function deleteAssignmentData(where: string, id: number) {
  run(
    `DELETE FROM grade_history WHERE grade_id IN (
       SELECT gr.id FROM grades gr JOIN subject_assignments sa ON sa.id = gr.assignment_id WHERE ${where}
     )`,
    id
  );
  run(
    `DELETE FROM grade_components WHERE grade_id IN (
       SELECT gr.id FROM grades gr JOIN subject_assignments sa ON sa.id = gr.assignment_id WHERE ${where}
     )`,
    id
  );
  run(`DELETE FROM grades WHERE assignment_id IN (SELECT sa.id FROM subject_assignments sa WHERE ${where})`, id);
  run(`DELETE FROM assignment_criteria WHERE assignment_id IN (SELECT sa.id FROM subject_assignments sa WHERE ${where})`, id);
  run(`DELETE FROM subject_assignments WHERE id IN (SELECT sa.id FROM subject_assignments sa WHERE ${where})`, id);
}

function deleteEnrollmentData(where: string, id: number) {
  run(
    `DELETE FROM grade_history WHERE grade_id IN (
       SELECT gr.id FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id WHERE ${where}
     )`,
    id
  );
  run(
    `DELETE FROM grade_components WHERE grade_id IN (
       SELECT gr.id FROM grades gr JOIN enrollments e ON e.id = gr.enrollment_id WHERE ${where}
     )`,
    id
  );
  run(`DELETE FROM grades WHERE enrollment_id IN (SELECT e.id FROM enrollments e WHERE ${where})`, id);
  run(`DELETE FROM enrollments WHERE id IN (SELECT e.id FROM enrollments e WHERE ${where})`, id);
}

function deleteStudentsByStatus(statusId: number) {
  run(
    "UPDATE activity_logs SET user_id = NULL WHERE user_id IN (SELECT u.id FROM users u JOIN students st ON st.id = u.student_id WHERE st.status_id = ?)",
    statusId
  );
  run("DELETE FROM users WHERE student_id IN (SELECT id FROM students WHERE status_id = ?)", statusId);
  deleteEnrollmentData("e.student_id IN (SELECT id FROM students WHERE status_id = ?)", statusId);
  run("DELETE FROM students WHERE status_id = ?", statusId);
}

function forceDeleteCatalog(type: string, table: string, id: number) {
  switch (type) {
    case "levels":
      run("UPDATE programs SET level_id = NULL WHERE level_id = ?", id);
      break;
    case "programs":
      deleteAssignmentData("sa.group_id IN (SELECT id FROM groups WHERE program_id = ?)", id);
      deleteAssignmentData("sa.subject_id IN (SELECT id FROM subjects WHERE program_id = ?)", id);
      deleteEnrollmentData("e.program_id = ?", id);
      run("DELETE FROM groups WHERE program_id = ?", id);
      run("DELETE FROM academic_plans WHERE program_id = ?", id);
      run("DELETE FROM plan_subjects WHERE subject_id IN (SELECT id FROM subjects WHERE program_id = ?)", id);
      run("DELETE FROM subjects WHERE program_id = ?", id);
      break;
    case "shifts":
      deleteAssignmentData("sa.group_id IN (SELECT id FROM groups WHERE shift_id = ?)", id);
      deleteEnrollmentData("e.shift_id = ?", id);
      run("DELETE FROM groups WHERE shift_id = ?", id);
      break;
    case "cycles":
      deleteAssignmentData("sa.group_id IN (SELECT id FROM groups WHERE cycle_id = ?)", id);
      deleteAssignmentData("sa.period_id IN (SELECT id FROM academic_periods WHERE cycle_id = ?)", id);
      deleteEnrollmentData("e.cycle_id = ?", id);
      run("UPDATE institution_settings SET active_cycle_id = NULL WHERE active_cycle_id = ?", id);
      run("DELETE FROM groups WHERE cycle_id = ?", id);
      run("DELETE FROM academic_periods WHERE cycle_id = ?", id);
      break;
    case "periods":
      deleteAssignmentData("sa.period_id = ?", id);
      run("UPDATE enrollments SET period_id = NULL WHERE period_id = ?", id);
      break;
    case "semesters":
      run("UPDATE enrollments SET curricular_period_id = NULL WHERE curricular_period_id = ?", id);
      break;
    case "groups":
      deleteAssignmentData("sa.group_id = ?", id);
      deleteEnrollmentData("e.group_id = ?", id);
      break;
    case "subjects":
      deleteAssignmentData("sa.subject_id = ?", id);
      run("DELETE FROM plan_subjects WHERE subject_id = ?", id);
      break;
    case "teachers":
      deleteAssignmentData("sa.teacher_id = ?", id);
      break;
    case "criteria":
      run(
        `DELETE FROM grade_components WHERE assignment_criterion_id IN (
           SELECT id FROM assignment_criteria WHERE criterion_id = ?
         )`,
        id
      );
      run("DELETE FROM assignment_criteria WHERE criterion_id = ?", id);
      break;
    case "scales":
      deleteAssignmentData("sa.grading_scale_id = ?", id);
      run("UPDATE institution_settings SET default_scale_id = NULL WHERE default_scale_id = ?", id);
      break;
    case "statuses":
      deleteStudentsByStatus(id);
      break;
  }
  run(`DELETE FROM ${table} WHERE id = ?`, id);
}

catalogsRouter.get("/", requirePermission("catalogs.view"), (_req, res) => {
  res.json(Object.entries(definitions).map(([key, value]) => ({ key, label: value.label, singular: value.singular })));
});

catalogsRouter.get("/:type", requirePermission("catalogs.view"), (req, res) => {
  const catalog = definition(req.params.type);
  const sql = `SELECT * FROM (${catalog.listSql ?? `SELECT * FROM ${catalog.table}`}) AS catalog_records ORDER BY is_active DESC, spanish_sort(${catalog.table === 'teachers' ? 'full_name' : 'name'}), id`;
  res.json({ definition: { ...catalog, table: undefined, listSql: undefined }, records: all(sql) });
});

catalogsRouter.post("/:type", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const catalog = definition(req.params.type);
  const fields = catalog.fields.filter((field) => req.body[field.name] !== undefined);
  for (const field of catalog.fields.filter((item) => item.required)) {
    if (req.body[field.name] === undefined || req.body[field.name] === "") {
      throw new ApiError(400, `${field.label} es obligatorio.`);
    }
  }
  if (catalog.table === "school_cycles") validateCycleCalendar(req.body.start_date, req.body.end_date, []);
  const values = fields.map((field) => {
    if (field.type === "boolean") return booleanInt(req.body[field.name]);
    if (field.type === "number") return Number(req.body[field.name]);
    if (field.options && !field.options.some((option) => option.value === req.body[field.name])) {
      throw new ApiError(400, `${field.label} no es válida.`);
    }
    return optionalText(req.body[field.name], 500);
  });
  const result = run(
    `INSERT INTO ${catalog.table} (${fields.map((field) => field.name).join(", ")})
     VALUES (${fields.map(() => "?").join(", ")})`,
    ...values
  );
  if (catalog.table === "teachers") run("UPDATE teachers SET teacher_number=printf('DOC%05d',id) WHERE id=?", Number(result.lastInsertRowid));
  logActivity(req, "create", catalog.table, Number(result.lastInsertRowid), req.body);
  res.status(201).json(get(`SELECT * FROM ${catalog.table} WHERE id = ?`, Number(result.lastInsertRowid)));
});

catalogsRouter.patch("/:type/:id", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const catalog = definition(req.params.type);
  const id = asId(req.params.id, "Registro");
  if (catalog.table === "school_cycles" && (req.body.start_date !== undefined || req.body.end_date !== undefined)) {
    const calendar = getCycleCalendar(id);
    validateCycleCalendar(req.body.start_date ?? calendar.activity_start, req.body.end_date ?? calendar.activity_end, calendar.vacations);
  }
  const fields = catalog.fields.filter((field) => req.body[field.name] !== undefined);
  if (req.body.is_active !== undefined) fields.push({ name: "is_active", label: "Activo", type: "boolean" });
  if (!fields.length) throw new ApiError(400, "No hay cambios para guardar.");
  const values = fields.map((field) => {
    if (field.type === "boolean") return booleanInt(req.body[field.name]);
    if (field.type === "number") return Number(req.body[field.name]);
    if (field.options && !field.options.some((option) => option.value === req.body[field.name])) {
      throw new ApiError(400, `${field.label} no es válida.`);
    }
    return optionalText(req.body[field.name], 500);
  });
  run(
    `UPDATE ${catalog.table} SET ${fields.map((field) => `${field.name} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ...values,
    id
  );
  logActivity(req, "update", catalog.table, id, req.body);
  res.json(get(`SELECT * FROM ${catalog.table} WHERE id = ?`, id));
});

catalogsRouter.delete("/:type/:id", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const catalog = definition(req.params.type);
  const id = asId(req.params.id, "Registro");
  run(`UPDATE ${catalog.table} SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id);
  logActivity(req, "deactivate", catalog.table, id);
  res.status(204).end();
});

catalogsRouter.delete("/:type/:id/permanent", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const catalog = definition(req.params.type);
  const id = asId(req.params.id, "Registro");
  const force = String(req.query.force ?? "") === "true";
  const record = get(`SELECT * FROM ${catalog.table} WHERE id = ?`, id);
  if (!record) throw new ApiError(404, "El registro ya no existe.");
  try {
    transaction(() => {
      if (force) {
        forceDeleteCatalog(String(req.params.type), catalog.table, id);
      } else if (catalog.table === "subjects") {
        run(
          `DELETE FROM grade_history WHERE grade_id IN (
             SELECT gr.id FROM grades gr JOIN subject_assignments sa ON sa.id = gr.assignment_id WHERE sa.subject_id = ?
           )`,
          id
        );
        run(
          `DELETE FROM grade_components WHERE grade_id IN (
             SELECT gr.id FROM grades gr JOIN subject_assignments sa ON sa.id = gr.assignment_id WHERE sa.subject_id = ?
           )`,
          id
        );
        run("DELETE FROM grades WHERE assignment_id IN (SELECT id FROM subject_assignments WHERE subject_id = ?)", id);
        run("DELETE FROM assignment_criteria WHERE assignment_id IN (SELECT id FROM subject_assignments WHERE subject_id = ?)", id);
        run("DELETE FROM subject_assignments WHERE subject_id = ?", id);
        run("DELETE FROM plan_subjects WHERE subject_id = ?", id);
      }
      if (!force) run(`DELETE FROM ${catalog.table} WHERE id = ?`, id);
    });
  } catch (error: any) {
    if (String(error?.message).includes("FOREIGN KEY")) {
      throw new ApiError(409, "Este registro todavía está en uso. Elimina o reasigna primero los datos relacionados.");
    }
    throw error;
  }
  logActivity(req, force ? "force-delete" : "permanent-delete", catalog.table, id, record);
  res.status(204).end();
});
