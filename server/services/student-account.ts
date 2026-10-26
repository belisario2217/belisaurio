import bcrypt from "bcryptjs";
import { all, get, run, transaction } from "../db.js";
import { ApiError } from "../utils.js";

type StudentAccountInput = {
  studentId: number;
  studentNumber: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
};

type StudentAccountResult = {
  userId: number;
  email: string;
  temporaryPassword: string | null;
  created: boolean;
};

export function firstGivenName(firstName: unknown) {
  return String(firstName ?? "").trim().split(/\s+/)[0] ?? "";
}

export function defaultStudentPassword(firstName: unknown) {
  const first = firstGivenName(firstName).toLocaleLowerCase("es-MX");
  if (!first) throw new ApiError(400, "El primer nombre del alumno es obligatorio para generar su acceso.");
  return `1234${first}`;
}

export function studentInstitutionalEmail(studentNumber: unknown) {
  const number = String(studentNumber ?? "").trim().toLowerCase();
  if (!number) throw new ApiError(400, "La matrícula es obligatoria para generar el acceso del alumno.");
  return `${number}@alumnoifop.edu`;
}

function fullName(input: StudentAccountInput) {
  return [input.firstName, input.lastName, input.secondLastName].filter(Boolean).join(" ").trim();
}

export function provisionStudentAccount(input: StudentAccountInput): StudentAccountResult {
  const role = get<{ id: number }>("SELECT id FROM roles WHERE name = 'Alumno' AND is_active = 1");
  if (!role) throw new ApiError(500, "No se encontró el rol Alumno para crear el acceso.");

  const email = studentInstitutionalEmail(input.studentNumber);
  const existing = get<{
    id: number;
    password_must_change: number;
    temporary_password_name: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, password_must_change, temporary_password_name, deleted_at
     FROM users WHERE student_id = ? ORDER BY id LIMIT 1`,
    input.studentId
  );
  if (existing?.deleted_at) {
    return { userId: existing.id, email, temporaryPassword: null, created: false };
  }
  const emailOwner = get<{ id: number; student_id: number | null }>("SELECT id, student_id FROM users WHERE email = ?", email);
  if (emailOwner && emailOwner.student_id !== input.studentId) {
    throw new ApiError(409, `El correo institucional ${email} ya pertenece a otra cuenta.`);
  }

  run("UPDATE students SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND email IS NOT ?", email, input.studentId, email);
  if (existing) {
    run(
      `UPDATE users SET full_name = ?, email = ?, role_id = ?, is_active = 1,
       temporary_password_name = CASE
         WHEN password_must_change = 1 AND temporary_password_name IS NULL THEN ?
         ELSE temporary_password_name
       END,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?
       AND (full_name IS NOT ? OR email IS NOT ? OR role_id IS NOT ? OR is_active <> 1
         OR (password_must_change = 1 AND temporary_password_name IS NULL))`,
      fullName(input), email, role.id, firstGivenName(input.firstName).toLocaleLowerCase("es-MX"), existing.id,
      fullName(input), email, role.id
    );
    return { userId: existing.id, email, temporaryPassword: null, created: false };
  }

  const temporaryPassword = defaultStudentPassword(input.firstName);
  const inserted = run(
    `INSERT INTO users(full_name, email, password_hash, role_id, student_id, password_must_change, temporary_password_name)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    fullName(input),
    email,
    bcrypt.hashSync(temporaryPassword, 10),
    role.id,
    input.studentId,
    firstGivenName(input.firstName).toLocaleLowerCase("es-MX")
  );
  return { userId: Number(inserted.lastInsertRowid), email, temporaryPassword, created: true };
}

export function resetStudentPassword(userId: number) {
  const account = get<{
    id: number;
    email: string;
    student_id: number | null;
    first_name: string | null;
    student_number: string | null;
    student_active: number | null;
  }>(
    `SELECT u.id, u.email, u.student_id, st.first_name, st.student_number,
     st.is_active AS student_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN students st ON st.id = u.student_id
     WHERE u.id = ? AND r.name = 'Alumno'`,
    userId
  );
  if (!account || !account.student_id || !account.first_name || !account.student_number) {
    throw new ApiError(400, "Solo se puede restablecer automáticamente una cuenta vinculada a un alumno.");
  }
  if (!account.student_active) throw new ApiError(400, "Reactiva al alumno antes de restablecer su acceso.");
  const temporaryPassword = defaultStudentPassword(account.first_name);
  const email = studentInstitutionalEmail(account.student_number);
  run(
    `UPDATE users SET email = ?, password_hash = ?, password_must_change = 1, temporary_password_name = ?,
     is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    email,
    bcrypt.hashSync(temporaryPassword, 10),
    firstGivenName(account.first_name).toLocaleLowerCase("es-MX"),
    account.id
  );
  run("UPDATE students SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", email, account.student_id);
  return { userId: account.id, email, temporaryPassword };
}

export function studentCredentialStatus(userId: number) {
  const account = get<{
    id: number;
    email: string;
    student_id: number | null;
    student_number: string | null;
    student_name: string | null;
    first_name: string | null;
    password_must_change: number;
    temporary_password_name: string | null;
  }>(
    `SELECT u.id, u.email, u.student_id, u.password_must_change, u.temporary_password_name,
     st.student_number, st.first_name,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN students st ON st.id = u.student_id
     WHERE u.id = ? AND r.name = 'Alumno'`,
    userId
  );
  if (!account || !account.student_id || !account.student_number || !account.student_name) {
    throw new ApiError(400, "Solo se pueden consultar credenciales de cuentas vinculadas a alumnos.");
  }

  let temporaryName = account.temporary_password_name;
  if (account.password_must_change && !temporaryName && account.first_name) {
    temporaryName = firstGivenName(account.first_name).toLocaleLowerCase("es-MX");
    run("UPDATE users SET temporary_password_name = ? WHERE id = ?", temporaryName, account.id);
  }
  return {
    userId: account.id,
    studentId: account.student_id,
    studentNumber: account.student_number,
    studentName: account.student_name,
    email: account.email,
    passwordStatus: account.password_must_change ? "temporary" as const : "personalized" as const,
    temporaryPassword: account.password_must_change && temporaryName ? `1234${temporaryName}` : null
  };
}

export function ensureAllStudentAccounts() {
  const students = all<{
    id: number;
    student_number: string;
    first_name: string;
    last_name: string;
    second_last_name: string | null;
  }>(
    `SELECT id, student_number, first_name, last_name, second_last_name
     FROM students WHERE is_active = 1 ORDER BY id`
  );
  let created = 0;
  let linked = 0;
  let failed = 0;
  students.forEach((student) => {
    try {
      const result = transaction(() => provisionStudentAccount({
        studentId: student.id,
        studentNumber: student.student_number,
        firstName: student.first_name,
        lastName: student.last_name,
        secondLastName: student.second_last_name
      }));
      if (result.created) created += 1;
      else linked += 1;
    } catch (error) {
      failed += 1;
      console.warn(`No se pudo vincular la cuenta del alumno ${student.student_number}:`, error);
    }
  });
  return { created, linked, failed };
}
