import type { AuthUser } from "../auth.js";
import { get } from "../db.js";
import { ApiError } from "../utils.js";

export function isTeacherUser(user: AuthUser | undefined) {
  return user?.roleName === "Docente";
}

export function teacherIdForUser(user: AuthUser | undefined) {
  if (!isTeacherUser(user)) return null;
  const teacher = get<{ id: number }>(
    "SELECT t.id FROM users u JOIN teachers t ON t.id=u.teacher_id WHERE u.id=? AND t.is_active=1", user!.id
  );
  if (!teacher) {
    throw new ApiError(403, "Tu usuario docente no está vinculado con el catálogo de docentes. Pide a administración vincular tu usuario con tu matrícula docente.");
  }
  return teacher.id;
}

export function assertTeacherAssignment(user: AuthUser | undefined, assignmentId: number) {
  const teacherId = teacherIdForUser(user);
  if (teacherId == null) return;
  const assignment = get<{ id: number }>(
    "SELECT id FROM subject_assignments WHERE id = ? AND teacher_id = ? AND is_active = 1",
    assignmentId,
    teacherId
  );
  if (!assignment) throw new ApiError(403, "Solo puedes consultar o modificar los grupos y materias que tienes asignados.");
}
