import { Router } from "express";
import bcrypt from "bcryptjs";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { resetStudentPassword, studentCredentialStatus, studentInstitutionalEmail } from "../services/student-account.js";
import { ApiError, asId, cleanText, optionalText } from "../utils.js";

export const usersRouter = Router();

usersRouter.get("/", requirePermission("users.manage"), (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const term = search ? `%${search}%` : null;
  res.json(all(
    `SELECT u.id, u.full_name, u.email, u.role_id, r.name AS role_name, u.student_id,
     st.student_number, TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     u.is_active, u.password_must_change, u.last_login_at, u.created_at
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN students st ON st.id = u.student_id
     WHERE u.deleted_at IS NULL
       AND (? IS NULL OR u.full_name LIKE ? OR u.email LIKE ? OR r.name LIKE ?
            OR st.student_number LIKE ?
            OR TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) LIKE ?)
     ORDER BY u.full_name`,
    term, term, term, term, term, term
  ));
});

usersRouter.get("/student-options", requirePermission("users.manage"), (_req, res) => {
  res.json(all(
    `SELECT st.id, st.student_number,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) || ' · ' || st.student_number AS name
     FROM students st
     WHERE st.is_active = 1
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.student_id = st.id)
     ORDER BY st.last_name, st.first_name`
  ));
});

usersRouter.post("/", requirePermission("users.manage"), async (req: AuthenticatedRequest, res) => {
  const fullName = cleanText(req.body.fullName, 180);
  const email = cleanText(req.body.email, 180).toLowerCase();
  const password = String(req.body.password ?? "");
  if (!fullName || !email || password.length < 8) throw new ApiError(400, "Nombre, correo y contraseña de al menos 8 caracteres son obligatorios.");
  const roleId = asId(req.body.roleId, "Rol");
  const role = get<{ name: string }>("SELECT name FROM roles WHERE id = ?", roleId);
  if (!role) throw new ApiError(400, "El rol seleccionado no existe.");
  const studentId = role.name === "Alumno" ? asId(req.body.studentId, "Alumno vinculado") : null;
  if (studentId && get("SELECT id FROM users WHERE student_id = ?", studentId)) {
    throw new ApiError(409, "El alumno seleccionado ya tiene una cuenta vinculada.");
  }
  const result = run(
    "INSERT INTO users(full_name, email, password_hash, role_id, student_id) VALUES (?, ?, ?, ?, ?)",
    fullName,
    email,
    await bcrypt.hash(password, 12),
    roleId,
    studentId
  );
  logActivity(req, "create", "users", Number(result.lastInsertRowid), { email });
  res.status(201).json({ id: Number(result.lastInsertRowid), fullName, email });
});

usersRouter.patch("/:id", requirePermission("users.manage"), async (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Usuario");
  const current = get<{ id: number; role_id: number; student_id: number | null; is_active: number }>("SELECT id, role_id, student_id, is_active FROM users WHERE id = ? AND deleted_at IS NULL", id);
  if (!current) throw new ApiError(404, "No se encontró el usuario.");
  if (id === req.user!.id && req.body.isActive === false) throw new ApiError(400, "No puedes desactivar tu propia cuenta.");
  const passwordHash = req.body.password ? await bcrypt.hash(String(req.body.password), 12) : null;
  const linkedStudent = current.student_id
    ? get<{
        student_number: string;
        first_name: string;
        last_name: string;
        second_last_name: string | null;
      }>("SELECT student_number, first_name, last_name, second_last_name FROM students WHERE id = ?", current.student_id)
    : undefined;
  const roleId = linkedStudent ? current.role_id : req.body.roleId ? asId(req.body.roleId, "Rol") : current.role_id;
  const role = get<{ name: string }>("SELECT name FROM roles WHERE id = ?", roleId);
  if (!role) throw new ApiError(400, "El rol seleccionado no existe.");
  const studentId = linkedStudent ? current.student_id : role.name === "Alumno" ? asId(req.body.studentId ?? current.student_id, "Alumno vinculado") : null;
  const linkedName = linkedStudent
    ? [linkedStudent.first_name, linkedStudent.last_name, linkedStudent.second_last_name].filter(Boolean).join(" ")
    : null;
  const linkedEmail = linkedStudent ? studentInstitutionalEmail(linkedStudent.student_number) : null;
  run(
    `UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email),
     role_id = COALESCE(?, role_id), is_active = COALESCE(?, is_active),
     password_hash = COALESCE(?, password_hash),
     password_must_change = CASE WHEN ? IS NULL THEN password_must_change ELSE 0 END,
     temporary_password_name = CASE WHEN ? IS NULL THEN temporary_password_name ELSE NULL END,
     student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    linkedName ?? (req.body.fullName ? cleanText(req.body.fullName, 180) : null),
    linkedEmail ?? (req.body.email ? cleanText(req.body.email, 180).toLowerCase() : null),
    roleId,
    req.body.isActive === undefined ? null : req.body.isActive ? 1 : 0,
    passwordHash,
    passwordHash,
    passwordHash,
    studentId,
    id
  );
  logActivity(req, "update", "users", id, { ...req.body, password: req.body.password ? "[updated]" : undefined });
  res.json({ message: "Usuario actualizado." });
});

usersRouter.delete("/:id", requirePermission("users.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Usuario");
  if (id === req.user!.id) throw new ApiError(400, "No puedes eliminar tu propia cuenta de acceso.");

  const account = get<{
    id: number;
    full_name: string;
    email: string;
    role_name: string;
    student_id: number | null;
    is_active: number;
  }>(
    `SELECT u.id, u.full_name, u.email, r.name AS role_name, u.student_id, u.is_active
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? AND u.deleted_at IS NULL`,
    id
  );
  if (!account) throw new ApiError(404, "No se encontró el usuario.");

  if (account.role_name === "Administrador" && account.is_active) {
    const activeAdministrators = get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'Administrador' AND u.is_active = 1 AND u.deleted_at IS NULL`
    )?.total ?? 0;
    if (activeAdministrators <= 1) {
      throw new ApiError(400, "No se puede eliminar la única cuenta de administrador activa.");
    }
  }

  const removedEmail = `eliminado-${id}-${Date.now()}@acceso-inhabilitado.local`;
  run(
    `UPDATE users SET email = ?, is_active = 0,
     deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    removedEmail,
    id
  );
  logActivity(req, "delete-access", "users", id, {
    fullName: account.full_name,
    email: account.email,
    role: account.role_name,
    studentId: account.student_id
  });
  res.json({ message: "La cuenta de acceso fue eliminada." });
});

usersRouter.get("/:id/student-credentials", requirePermission("users.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Usuario");
  const credentials = studentCredentialStatus(id);
  logActivity(req, "view-student-credentials", "users", id, {
    studentNumber: credentials.studentNumber,
    passwordStatus: credentials.passwordStatus
  });
  res.json(credentials);
});

usersRouter.post("/:id/reset-student-password", requirePermission("users.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Usuario");
  const access = resetStudentPassword(id);
  logActivity(req, "reset-student-password", "users", id, { email: access.email });
  res.json({
    message: "Contraseña del alumno restablecida.",
    email: access.email,
    temporaryPassword: access.temporaryPassword
  });
});

usersRouter.get("/roles/list", requirePermission("users.manage"), (_req, res) => {
  res.json(all(
    `SELECT r.*, COUNT(rp.permission_id) AS permission_count
     FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
     GROUP BY r.id ORDER BY r.name`
  ));
});

usersRouter.get("/roles/:id", requirePermission("roles.manage"), (req, res) => {
  const id = asId(req.params.id, "Rol");
  const role = get("SELECT * FROM roles WHERE id = ?", id);
  if (!role) throw new ApiError(404, "No se encontró el rol.");
  const permissions = all(
    `SELECT p.*, CASE WHEN rp.role_id IS NULL THEN 0 ELSE 1 END AS enabled
     FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = ?
     ORDER BY p.module, p.name`,
    id
  );
  res.json({ role, permissions });
});

usersRouter.post("/roles", requirePermission("roles.manage"), (req: AuthenticatedRequest, res) => {
  const name = cleanText(req.body.name, 100);
  if (!name) throw new ApiError(400, "El nombre del rol es obligatorio.");
  const result = run("INSERT INTO roles(name, description) VALUES (?, ?)", name, optionalText(req.body.description, 300));
  logActivity(req, "create", "roles", Number(result.lastInsertRowid), { name });
  res.status(201).json({ id: Number(result.lastInsertRowid), name });
});

usersRouter.put("/roles/:id/permissions", requirePermission("roles.manage"), (req: AuthenticatedRequest, res) => {
  const roleId = asId(req.params.id, "Rol");
  const permissionIds = Array.isArray(req.body.permissionIds)
    ? req.body.permissionIds.map((item: unknown) => asId(item, "Permiso"))
    : [];
  transaction(() => {
    run("DELETE FROM role_permissions WHERE role_id = ?", roleId);
    permissionIds.forEach((permissionId: number) =>
      run("INSERT INTO role_permissions(role_id, permission_id) VALUES (?, ?)", roleId, permissionId)
    );
  });
  logActivity(req, "update-permissions", "roles", roleId, { permissionIds });
  res.json({ message: "Permisos actualizados." });
});
