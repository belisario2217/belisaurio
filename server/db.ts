import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
export const databasePath = path.resolve(projectRoot, process.env.DATABASE_PATH ?? "data/school.db");
export const restorePath = `${databasePath}.restore`;

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

if (fs.existsSync(restorePath)) {
  if (fs.existsSync(databasePath)) {
    fs.copyFileSync(databasePath, `${databasePath}.before-restore`);
  }
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databasePath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }
  fs.renameSync(restorePath, databasePath);
}

export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
db.function("spanish_sort", { deterministic: true }, (value) => String(value ?? "").toLowerCase().replace(/ñ/g, "n~").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

export function all<T extends Row = Row>(sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T extends Row = Row>(sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SqlValue[]) {
  return db.prepare(sql).run(...params);
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function expandStudyModalities() {
  const table = get<{sql:string}>("SELECT sql FROM sqlite_master WHERE type='table' AND name='groups'")!;
  const previousSequence = get<{seq:number}>("SELECT seq FROM sqlite_sequence WHERE name='groups'")?.seq ?? 0;
  const columns = all<{name:string}>("PRAGMA table_info(groups)").map(c => '"'+c.name+'"').join(',');
  const objects = all<{sql:string}>("SELECT sql FROM sqlite_master WHERE tbl_name='groups' AND type IN ('index','trigger') AND sql IS NOT NULL");
  const sql = table.sql.replace(/^CREATE TABLE (?:"groups"|groups)/i, 'CREATE TABLE groups_with_online').replace("'semiescolarizado', 'complementario'", "'semiescolarizado', 'complementario', 'en_linea'");
  if (!sql.includes("'en_linea'")) throw new Error("No se pudo ampliar el catálogo de modalidades.");
  db.exec(sql);
  db.exec(`INSERT INTO groups_with_online (${columns}) SELECT ${columns} FROM groups`);
  db.exec("DROP TABLE groups; ALTER TABLE groups_with_online RENAME TO groups;");
  run("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='groups'", previousSequence);
  for (const item of objects) db.exec(item.sql);
  if (all("PRAGMA foreign_key_check").length) throw new Error("La migración de modalidades no conservó las referencias académicas.");
}

export function migrate() {
  const migrationsDir = path.join(here, "migrations");
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");

  for (const file of files) {
    const applied = get("SELECT id FROM schema_migrations WHERE name = ?", file);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const expandModalities = file === "029_online_study_modality.sql";
    if (expandModalities) db.exec("PRAGMA foreign_keys = OFF;");
    try {
      transaction(() => {
        if (expandModalities) expandStudyModalities();
        db.exec(sql);
        run("INSERT INTO schema_migrations(name) VALUES (?)", file);
      });
    } finally {
      if (expandModalities) db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

const permissions = [
  ["dashboard.view", "Ver panel", "dashboard"],
  ["students.view", "Consultar alumnos", "students"],
  ["students.manage", "Administrar alumnos", "students"],
  ["students.import", "Importar alumnos", "students"],
  ["students.export", "Exportar alumnos", "students"],
  ["catalogs.view", "Consultar catálogos", "catalogs"],
  ["catalogs.manage", "Administrar catálogos", "catalogs"],
  ["grades.view", "Consultar calificaciones", "grades"],
  ["grades.manage", "Capturar calificaciones", "grades"],
  ["grades.import", "Importar calificaciones", "grades"],
  ["grades.export", "Exportar calificaciones", "grades"],
  ["grades.close", "Cerrar captura", "grades"],
  ["reports.view", "Consultar reportes", "reports"],
  ["reports.generate", "Generar documentos", "reports"],
  ["analytics.view", "Consultar analíticas", "analytics"],
  ["users.manage", "Administrar usuarios", "security"],
  ["roles.manage", "Administrar roles", "security"],
  ["settings.manage", "Configurar institución", "settings"],
  ["audit.view", "Consultar auditoría", "security"],
  ["portal.view", "Consultar portal del alumno", "student_portal"]
] as const;

export function seed() {
  if (get("SELECT id FROM roles LIMIT 1")) return;

  transaction(() => {
    const roleNames = [
      ["Administrador", "Control total del sistema", 1],
      ["Coordinador académico", "Planeación, calificaciones y analíticas", 1],
      ["Docente", "Consulta y captura de sus grupos", 1],
      ["Control escolar", "Alumnos, reportes y boletas", 1],
      ["Consulta", "Acceso de solo lectura", 1]
    ] as const;
    roleNames.forEach(([name, description, system]) =>
      run("INSERT INTO roles(name, description, is_system) VALUES (?, ?, ?)", name, description, system)
    );

    permissions.forEach(([code, name, module]) =>
      run("INSERT INTO permissions(code, name, module) VALUES (?, ?, ?)", code, name, module)
    );

    const adminRole = get<{ id: number }>("SELECT id FROM roles WHERE name = 'Administrador'")!;
    run(
      "INSERT INTO role_permissions(role_id, permission_id) SELECT ?, id FROM permissions",
      adminRole.id
    );

    const permissionSets: Record<string, string[]> = {
      "Coordinador académico": permissions.map(([code]) => code).filter((code) => !["users.manage", "roles.manage"].includes(code)),
      Docente: ["dashboard.view", "students.view", "grades.view", "grades.manage", "reports.view", "analytics.view"],
      "Control escolar": ["dashboard.view", "students.view", "students.manage", "students.import", "students.export", "catalogs.view", "grades.view", "grades.export", "reports.view", "reports.generate", "analytics.view"],
      Consulta: ["dashboard.view", "students.view", "catalogs.view", "grades.view", "reports.view", "analytics.view"]
    };
    Object.entries(permissionSets).forEach(([roleName, codes]) => {
      const role = get<{ id: number }>("SELECT id FROM roles WHERE name = ?", roleName)!;
      codes.forEach((code) => {
        const permission = get<{ id: number }>("SELECT id FROM permissions WHERE code = ?", code)!;
        run("INSERT INTO role_permissions(role_id, permission_id) VALUES (?, ?)", role.id, permission.id);
      });
    });

    const passwordHash = bcrypt.hashSync("Admin123!", 12);
    run(
      "INSERT INTO users(full_name, email, password_hash, role_id) VALUES (?, ?, ?, ?)",
      "Administrador General",
      "admin@aulanova.edu.mx",
      passwordHash,
      adminRole.id
    );

    run("INSERT INTO academic_levels(name, description) VALUES ('Bachillerato', 'Educación media superior')");
    const level = get<{ id: number }>("SELECT id FROM academic_levels LIMIT 1")!;
    run("INSERT INTO programs(code, name, level_id, duration_periods) VALUES ('BACH-GEN', 'Bachillerato General', ?, 6)", level.id);
    const program = get<{ id: number }>("SELECT id FROM programs LIMIT 1")!;

    run("INSERT INTO shifts(name, start_time, end_time) VALUES ('Matutino', '07:00', '14:00')");
    run("INSERT INTO shifts(name, start_time, end_time) VALUES ('Vespertino', '14:00', '20:00')");
    const morning = get<{ id: number }>("SELECT id FROM shifts WHERE name = 'Matutino'")!;

    run("INSERT INTO school_cycles(name, start_date, end_date) VALUES ('2026B - 2027A', '2026-08-10', '2027-07-31')");
    const cycle = get<{ id: number }>("SELECT id FROM school_cycles LIMIT 1")!;
    run("INSERT INTO academic_periods(cycle_id, name, sequence, start_date, end_date) VALUES (?, 'Primer parcial', 1, '2026-08-10', '2026-10-16')", cycle.id);
    run("INSERT INTO academic_periods(cycle_id, name, sequence, start_date, end_date) VALUES (?, 'Segundo parcial', 2, '2026-10-19', '2026-12-18')", cycle.id);
    const period = get<{ id: number }>("SELECT id FROM academic_periods ORDER BY sequence LIMIT 1")!;
    const curricularPeriod = get<{ id: number }>("SELECT id FROM curricular_periods WHERE sequence = 1")!;

    run("INSERT INTO groups(name, program_id, shift_id, cycle_id, active_cycle_id, capacity) VALUES ('1A', ?, ?, ?, ?, 32)", program.id, morning.id, cycle.id, cycle.id);
    run("INSERT INTO groups(name, program_id, shift_id, cycle_id, active_cycle_id, capacity) VALUES ('1B', ?, ?, ?, ?, 32)", program.id, morning.id, cycle.id, cycle.id);
    const groupA = get<{ id: number }>("SELECT id FROM groups WHERE name = '1A'")!;

    run("INSERT INTO grading_scales(name, min_score, max_score, passing_score, decimals, is_default) VALUES ('Escala 0 a 10', 0, 10, 6, 1, 1)");
    const scale = get<{ id: number }>("SELECT id FROM grading_scales LIMIT 1")!;
    [["Activo", "#16866b", 0], ["Baja temporal", "#d97706", 0], ["Egresado", "#2563eb", 1], ["Baja definitiva", "#c2413b", 1]].forEach(([name, color, terminal]) =>
      run("INSERT INTO student_statuses(name, color, is_terminal) VALUES (?, ?, ?)", String(name), String(color), Number(terminal))
    );
    const activeStatus = get<{ id: number }>("SELECT id FROM student_statuses WHERE name = 'Activo'")!;

    [["MAT-101", "Matemáticas I", 5], ["COM-101", "Comunicación", 4], ["CIE-101", "Ciencias Experimentales", 5], ["HUM-101", "Humanidades", 3]].forEach(([code, name, hours]) =>
      run("INSERT INTO subjects(code, name, program_id, credits, hours_per_week) VALUES (?, ?, ?, ?, ?)", String(code), String(name), program.id, Number(hours), Number(hours))
    );

    run("INSERT INTO teachers(employee_number, full_name, email, specialty) VALUES ('DOC-001', 'Laura Méndez Ortega', 'laura.mendez@aulanova.edu.mx', 'Matemáticas')");
    run("INSERT INTO teachers(employee_number, full_name, email, specialty) VALUES ('DOC-002', 'Carlos Ruiz Salas', 'carlos.ruiz@aulanova.edu.mx', 'Comunicación')");
    const teacher = get<{ id: number }>("SELECT id FROM teachers WHERE employee_number = 'DOC-001'")!;

    [["Examen", 40], ["Tareas", 20], ["Proyecto", 25], ["Participación", 15]].forEach(([name, weight]) =>
      run("INSERT INTO evaluation_criteria(name, default_weight) VALUES (?, ?)", String(name), Number(weight))
    );

    const math = get<{ id: number }>("SELECT id FROM subjects WHERE code = 'MAT-101'")!;
    run("INSERT INTO subject_assignments(subject_id, group_id, teacher_id, period_id, grading_scale_id, evaluation_mode) VALUES (?, ?, ?, ?, ?, 'criteria')", math.id, groupA.id, teacher.id, period.id, scale.id);
    const assignment = get<{ id: number }>("SELECT id FROM subject_assignments LIMIT 1")!;
    all<{ id: number; default_weight: number }>("SELECT id, default_weight FROM evaluation_criteria").forEach((criterion) =>
      run("INSERT INTO assignment_criteria(assignment_id, criterion_id, weight) VALUES (?, ?, ?)", assignment.id, criterion.id, criterion.default_weight)
    );

    const sampleStudents = [
      ["AN26001", "Sofía", "Hernández", "Luna", "sofia.hernandez@example.com"],
      ["AN26002", "Diego", "Martínez", "Cruz", "diego.martinez@example.com"],
      ["AN26003", "Valentina", "García", "Reyes", "valentina.garcia@example.com"],
      ["AN26004", "Emiliano", "Sánchez", "Flores", "emiliano.sanchez@example.com"],
      ["AN26005", "Renata", "Torres", "Vega", "renata.torres@example.com"],
      ["AN26006", "Mateo", "Ramírez", "Díaz", "mateo.ramirez@example.com"]
    ];
    sampleStudents.forEach(([number, first, last, second, email], index) => {
      const student = run(
        "INSERT INTO students(student_number, first_name, last_name, second_last_name, email, status_id) VALUES (?, ?, ?, ?, ?, ?)",
        number, first, last, second, email, activeStatus.id
      );
      run(
        `INSERT INTO enrollments(student_id, program_id, shift_id, group_id, cycle_id, period_id, curricular_period_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        Number(student.lastInsertRowid), program.id, morning.id, groupA.id, cycle.id, period.id, curricularPeriod.id
      );
      const enrollment = get<{ id: number }>("SELECT id FROM enrollments WHERE student_id = ?", Number(student.lastInsertRowid))!;
      const score = [9.4, 7.8, 8.7, 5.6, 9.0, 6.4][index];
      const grade = run(
        "INSERT INTO grades(enrollment_id, assignment_id, final_score, status, comments, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        enrollment.id, assignment.id, score, score >= 6 ? "passed" : "failed", index === 3 ? "Requiere asesoría" : "", 1, 1
      );
      all<{ id: number; weight: number }>(
        "SELECT id, weight FROM assignment_criteria WHERE assignment_id = ?",
        assignment.id
      ).forEach((criterion) => {
        run(
          "INSERT INTO grade_components(grade_id, assignment_criterion_id, score, weighted_score) VALUES (?, ?, ?, ?)",
          Number(grade.lastInsertRowid),
          criterion.id,
          score,
          score * criterion.weight / 100
        );
      });
    });

    run(
      "INSERT INTO institution_settings(id, institution_name, logo_path, address, phone, email, director_name, active_cycle_id, default_scale_id, footer_text) VALUES (1, 'Universidad IFOP', '/assets/campus-frontera.jpg', 'Av. del Aprendizaje 120, Ciudad de México', '55 5555 0142', 'contacto@aulanova.edu.mx', 'Dra. Mariana Castillo', ?, ?, 'Documento académico emitido por Universidad IFOP')",
      cycle.id,
      scale.id
    );
    run("INSERT INTO report_templates(name, type, header_text, footer_text, is_default) VALUES ('Boleta institucional', 'report_card', 'Universidad IFOP', 'Formando conocimiento con propósito', 1)");
  });
}

migrate();
seed();

function ensureEnhancementData() {
  transaction(() => {
    [
      ["Licenciatura", "Educación superior de nivel licenciatura"],
      ["Maestría", "Estudios de posgrado de nivel maestría"],
      ["Especialidad", "Programa de especialización profesional"]
    ].forEach(([name, description]) =>
      run("INSERT OR IGNORE INTO academic_levels(name, description) VALUES (?, ?)", name, description)
    );

    [
      ["LIC-GEN", "Licenciatura", "Licenciatura", 8],
      ["MAE-GEN", "Maestría", "Maestría", 4],
      ["ESP-GEN", "Especialidad", "Especialidad", 2]
    ].forEach(([code, name, levelName, duration]) => {
      const level = get<{ id: number }>("SELECT id FROM academic_levels WHERE name = ?", String(levelName));
      if (level) {
        run(
          "INSERT OR IGNORE INTO programs(code, name, level_id, duration_periods, description) VALUES (?, ?, ?, ?, ?)",
          String(code), String(name), level.id, Number(duration), `Programa base de ${name}`
        );
      }
    });

    run(
      "INSERT OR IGNORE INTO permissions(code, name, module) VALUES ('portal.view', 'Consultar portal del alumno', 'student_portal')"
    );
    run(
      "INSERT OR IGNORE INTO roles(name, description, is_system) VALUES ('Alumno', 'Acceso personal a materias, calificaciones y avance curricular', 1)"
    );
    run(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
       WHERE r.name = 'Alumno' AND p.code = 'portal.view'`
    );
    run(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
       WHERE r.name = 'Administrador' AND p.code = 'portal.view'`
    );

    run(
      `UPDATE enrollments SET plan_id = (
         SELECT ap.id FROM academic_plans ap
         WHERE ap.program_id = enrollments.program_id AND ap.is_active = 1
         ORDER BY ap.id DESC LIMIT 1
       ) WHERE plan_id IS NULL`
    );
    run(
      `INSERT INTO student_subjects(student_id, enrollment_id, plan_id, subject_id, school_cycle_id,
       semester_number, subject_type, credits, status)
       SELECT DISTINCT e.student_id, e.id, e.plan_id, a.subject_id, e.cycle_id,
        COALESCE(ps.recommended_period, 1), COALESCE(ps.subject_type, 'mandatory'),
        COALESCE(ps.credits, NULLIF(s.credits, 0), 1), 'in_progress'
       FROM enrollments e
       JOIN students st ON st.id = e.student_id
       JOIN subject_assignments a ON a.group_id = e.group_id AND a.is_active = 1
       JOIN academic_periods period ON period.id = a.period_id AND period.cycle_id = e.cycle_id
       JOIN subjects s ON s.id = a.subject_id
       LEFT JOIN plan_subjects ps ON ps.plan_id = e.plan_id AND ps.subject_id = a.subject_id
       WHERE e.is_active = 1 AND st.is_active = 1
       ON CONFLICT(student_id, subject_id, school_cycle_id, semester_number)
       DO UPDATE SET enrollment_id = excluded.enrollment_id, plan_id = excluded.plan_id,
        subject_type = excluded.subject_type, credits = excluded.credits, updated_at = CURRENT_TIMESTAMP`
    );
    run(
      `UPDATE subject_assignments SET evaluation_mode = 'criteria'
       WHERE evaluation_mode = 'partials'
       AND EXISTS (SELECT 1 FROM assignment_criteria ac WHERE ac.assignment_id = subject_assignments.id)`
    );
    [
      ["payments.view", "Consultar cobros", "payments"],
      ["payments.manage", "Administrar cobros", "payments"],
      ["payments.export", "Exportar estados de cuenta", "payments"]
    ].forEach(([code, name, module]) =>
      run("INSERT OR IGNORE INTO permissions(code, name, module) VALUES (?, ?, ?)", code, name, module)
    );
    run(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
       WHERE r.name IN ('Administrador', 'Coordinador acadÃ©mico')
       AND p.code IN ('payments.view', 'payments.manage', 'payments.export')`
    );
    [
      ["attendance.view", "Consultar asistencia", "attendance"],
      ["attendance.manage", "Capturar y confirmar asistencia", "attendance"]
    ].forEach(([code, name, module]) =>
      run("INSERT OR IGNORE INTO permissions(code, name, module) VALUES (?, ?, ?)", code, name, module)
    );
    run(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
       WHERE r.name IN ('Administrador', 'Coordinador académico', 'Coordinador acadÃ©mico', 'Docente', 'Control escolar')
       AND p.code = 'attendance.view'`
    );
    run(
      `INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p
       WHERE r.name IN ('Administrador', 'Coordinador académico', 'Coordinador acadÃ©mico', 'Docente')
       AND p.code = 'attendance.manage'`
    );

    const certificateCycle = get<{ id: number }>("SELECT id FROM school_cycles WHERE name = '2026B - 2027A' ORDER BY id DESC LIMIT 1");
    if (certificateCycle) {
      [
        ["class_start", "Inicio de actividades del periodo", "2026-08-10", "2026-08-10", "Fecha inicial usada en constancias de estudios.", 1],
        ["vacation", "Periodo vacacional de invierno", "2026-12-18", "2027-01-04", "Periodo vacacional indicado en las constancias institucionales.", 0],
        ["cycle_end", "Fin de actividades del periodo", "2027-01-29", "2027-01-29", "Fecha final usada en constancias de estudios.", 0]
      ].forEach(([eventType, title, startDate, endDate, description, autoStartSubjects]) => {
        run(
          `INSERT INTO academic_calendar_events(school_cycle_id, event_type, title, start_date, end_date, description, auto_start_subjects)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM academic_calendar_events
             WHERE school_cycle_id = ? AND event_type = ? AND is_active = 1
           )`,
          certificateCycle.id, String(eventType), String(title), String(startDate), String(endDate), String(description), Number(autoStartSubjects),
          certificateCycle.id, String(eventType)
        );
      });
    }

    const student = get<{ id: number; full_name: string }>(
      `SELECT id, TRIM(first_name || ' ' || last_name || ' ' || COALESCE(second_last_name, '')) AS full_name
       FROM students st
       WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.student_id = st.id)
       ORDER BY id LIMIT 1`
    );
    const role = get<{ id: number }>("SELECT id FROM roles WHERE name = 'Alumno'");
    const studentAccount = get(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'Alumno' LIMIT 1`
    );
    if (student && role && !studentAccount && !get("SELECT id FROM users WHERE email = 'alumno@campusfrontera.edu.mx'")) {
      run(
        "INSERT INTO users(full_name, email, password_hash, role_id, student_id) VALUES (?, ?, ?, ?, ?)",
        student.full_name,
        "alumno@campusfrontera.edu.mx",
        bcrypt.hashSync("Alumno123!", 12),
        role.id,
        student.id
      );
    }
  });
}

ensureEnhancementData();

// Stable identities; existing passwords and role permissions remain intact.
transaction(() => {
  run("UPDATE teachers SET teacher_number=printf('DOC%05d',id) WHERE teacher_number IS NULL");
  const users = all<{id:number;email:string;full_name:string}>("SELECT u.id,u.email,u.full_name FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Docente' AND u.teacher_id IS NULL AND u.deleted_at IS NULL ORDER BY u.id");
  for (const user of users) {
    let matches=all<{id:number}>("SELECT id FROM teachers WHERE email=? COLLATE NOCASE AND is_active=1",user.email);
    if (!matches.length) matches=all<{id:number}>("SELECT id FROM teachers WHERE full_name=? COLLATE NOCASE AND is_active=1",user.full_name);
    if (matches.length===1&&!get("SELECT id FROM users WHERE teacher_id=? AND deleted_at IS NULL",matches[0].id)) run("UPDATE users SET teacher_id=? WHERE id=?",matches[0].id,user.id);
  }
});
