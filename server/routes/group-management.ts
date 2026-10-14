import { Router } from "express";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { syncEnrollmentGroupSubjects } from "../services/group-subjects.js";
import { planMatchesProgram } from "../services/student-identity.js";
import { promotionEligibility } from "../services/promotion-eligibility.js";
import { ApiError, asId } from "../utils.js";

export const groupManagementRouter = Router();

type GroupContext = {
  id: number;
  program_id: number;
  program_name: string;
  shift_id: number;
  curricular_period_id: number | null;
};

type PlanContext = {
  id: number;
  program_id: number;
  name: string;
  program_name: string;
};

type Enrollment = {
  id: number;
  student_id: number;
  cycle_id: number;
  curricular_period_id: number | null;
};

function groupSelect(where = "1 = 1") {
  return `SELECT g.id, g.name, g.program_id, p.name AS program_name,
    g.shift_id, sh.name AS shift_name, g.study_modality, g.capacity, g.is_active,
    g.cycle_id AS formation_cycle_id, formation.name AS formation_cycle_name,
    g.active_cycle_id, active_cycle.name AS active_cycle_name,
    g.plan_id, plan.name AS plan_name, plan.version AS plan_version,
    g.curricular_period_id, group_period.name AS curricular_period_name, group_period.sequence AS curricular_period_number,
    COUNT(DISTINCT CASE WHEN e.is_active = 1 AND st.is_active = 1 THEN st.id END) AS student_count,
    COUNT(DISTINCT CASE WHEN e.is_active = 1 AND st.is_active = 1 AND (
      g.active_cycle_id IS NULL OR g.plan_id IS NULL
      OR e.cycle_id <> g.active_cycle_id
      OR COALESCE(e.plan_id, 0) <> g.plan_id
      OR COALESCE(e.curricular_period_id, 0) <> COALESCE(g.curricular_period_id, 0)
    ) THEN st.id END) AS mismatch_count
    FROM groups g
    JOIN programs p ON p.id = g.program_id
    JOIN shifts sh ON sh.id = g.shift_id
    JOIN school_cycles formation ON formation.id = g.cycle_id
    LEFT JOIN school_cycles active_cycle ON active_cycle.id = g.active_cycle_id
    LEFT JOIN academic_plans plan ON plan.id = g.plan_id
    LEFT JOIN curricular_periods group_period ON group_period.id = g.curricular_period_id
    LEFT JOIN enrollments e ON e.group_id = g.id
    LEFT JOIN students st ON st.id = e.student_id
    WHERE ${where}
    GROUP BY g.id`;
}

function groupRoster(groupId: number) {
  const students = all<any>(
    `SELECT st.id, st.student_number,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS full_name,
      st.email, st.phone, status.name AS status_name, status.color AS status_color,
      e.id AS enrollment_id, e.cycle_id, cycle.name AS cycle_name,
      e.plan_id, plan.name AS plan_name,
      e.curricular_period_id, curricular.name AS curricular_period_name,
      CASE WHEN g.active_cycle_id IS NOT NULL AND g.plan_id IS NOT NULL
        AND e.cycle_id = g.active_cycle_id AND COALESCE(e.plan_id, 0) = g.plan_id
        THEN 1 ELSE 0 END AS context_matches
     FROM enrollments e
     JOIN students st ON st.id = e.student_id
     JOIN student_statuses status ON status.id = st.status_id
     JOIN groups g ON g.id = e.group_id
     JOIN school_cycles cycle ON cycle.id = e.cycle_id
     LEFT JOIN academic_plans plan ON plan.id = e.plan_id
     LEFT JOIN curricular_periods curricular ON curricular.id = e.curricular_period_id
     WHERE e.group_id = ? AND e.is_active = 1 AND st.is_active = 1
     ORDER BY spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name)`,
    groupId
  );
  return students.map((student) => ({ ...student, promotion: promotionEligibility(student.enrollment_id) }));
}

groupManagementRouter.get("/", requirePermission("students.view"), (_req, res) => {
  res.json({
    groups: all(`${groupSelect()} ORDER BY g.is_active DESC, p.name, g.name`),
    cycles: all("SELECT id, name, start_date, end_date FROM school_cycles WHERE is_active = 1 ORDER BY start_date DESC, id DESC"),
    plans: all(
      `SELECT ap.id, ap.name, ap.version, ap.program_id, p.name AS program_name
       FROM academic_plans ap JOIN programs p ON p.id = ap.program_id
       WHERE ap.is_active = 1 ORDER BY p.name, ap.name, ap.version DESC`
    ),
    periods: all("SELECT id, name, sequence FROM curricular_periods WHERE is_active = 1 ORDER BY sequence")
  });
});

groupManagementRouter.get("/:id", requirePermission("students.view"), (req, res) => {
  const id = asId(req.params.id, "Grupo");
  const group = get(`${groupSelect("g.id = ?")}`, id);
  if (!group) throw new ApiError(404, "No se encontró el grupo.");
  res.json({ group, students: groupRoster(id) });
});

groupManagementRouter.post("/enrollments/:id/promote", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const enrollmentId = asId(req.params.id, "Inscripción");
  const enrollment = get<{ id: number; group_id: number }>(
    "SELECT id, group_id FROM enrollments WHERE id = ? AND is_active = 1",
    enrollmentId
  );
  if (!enrollment) throw new ApiError(404, "No se encontró la inscripción activa del alumno.");
  const eligibility = promotionEligibility(enrollmentId);
  const forced = req.body?.force === true;
  if (!eligibility.eligible && !forced) {
    throw new ApiError(409, `El alumno no puede ser promovido. ${eligibility.reasons.join(" ")}`);
  }
  const targetPeriod = get<{ id: number; name: string }>(
    "SELECT id, name FROM curricular_periods WHERE sequence = ? AND is_active = 1",
    eligibility.targetPeriodNumber
  );
  if (!targetPeriod) throw new ApiError(400, "No existe el semestre destino en el catálogo.");
  run(
    "UPDATE enrollments SET curricular_period_id = ? WHERE id = ?",
    targetPeriod.id,
    enrollmentId
  );
  syncEnrollmentGroupSubjects(enrollmentId);
  logActivity(req, forced ? "force-promote-student-period" : "promote-student-period", "enrollments", enrollmentId, {
    from: eligibility.currentPeriodNumber,
    to: eligibility.targetPeriodNumber,
    overdueMonths: eligibility.overdueMonths,
    overdueAmount: eligibility.overdueAmount,
    forced
  });
  res.json({
    message: forced ? `Alumno promovido manualmente a ${targetPeriod.name}.` : `Alumno promovido a ${targetPeriod.name}.`,
    students: groupRoster(enrollment.group_id)
  });
});

groupManagementRouter.patch("/:id/context", requirePermission("students.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Grupo");
  const activeCycleId = asId(req.body.activeCycleId, "Ciclo activo");
  const planId = asId(req.body.planId, "Plan académico");
  const syncStudents = req.body.syncStudents !== false;
  const group = get<GroupContext>(
    `SELECT g.id, g.program_id, p.name AS program_name, g.shift_id, g.curricular_period_id
     FROM groups g JOIN programs p ON p.id = g.program_id
     WHERE g.id = ? AND g.is_active = 1`,
    id
  );
  if (!group) throw new ApiError(404, "El grupo no existe o está inactivo.");
  const curricularPeriodId = req.body.curricularPeriodId
    ? asId(req.body.curricularPeriodId, "Semestre del grupo")
    : group.curricular_period_id ?? get<{ id: number }>("SELECT id FROM curricular_periods WHERE is_active = 1 ORDER BY sequence LIMIT 1")?.id;
  if (!curricularPeriodId) throw new ApiError(400, "Selecciona el semestre actual del grupo.");
  if (!get("SELECT id FROM school_cycles WHERE id = ? AND is_active = 1", activeCycleId)) {
    throw new ApiError(400, "El ciclo escolar seleccionado no existe o está inactivo.");
  }
  const plan = get<PlanContext>(
    `SELECT ap.id, ap.program_id, ap.name, p.name AS program_name
     FROM academic_plans ap JOIN programs p ON p.id = ap.program_id
     WHERE ap.id = ? AND ap.is_active = 1`,
    planId
  );
  if (!plan) throw new ApiError(400, "El plan académico seleccionado no existe o está inactivo.");
  if (!planMatchesProgram(plan, { id: group.program_id, name: group.program_name })) {
    throw new ApiError(400, "El plan académico no corresponde al programa del grupo.");
  }
  const curricularPeriod = get<{ id: number; sequence: number }>(
    "SELECT id, sequence FROM curricular_periods WHERE id = ? AND is_active = 1",
    curricularPeriodId
  );
  if (!curricularPeriod) throw new ApiError(400, "El semestre seleccionado no existe o está inactivo.");

  const updatedStudents = transaction(() => {
    run(
      `UPDATE groups SET active_cycle_id = ?, plan_id = ?, curricular_period_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      activeCycleId,
      planId,
      curricularPeriodId,
      id
    );
    if (!syncStudents) return 0;

    const enrollments = all<Enrollment>(
      `SELECT e.id, e.student_id, e.cycle_id, e.curricular_period_id
       FROM enrollments e JOIN students st ON st.id = e.student_id
       WHERE e.group_id = ? AND e.is_active = 1 AND st.is_active = 1
       ORDER BY e.id DESC`,
      id
    );
    const handledStudents = new Set<number>();
    let updated = 0;
    for (const enrollment of enrollments) {
      if (handledStudents.has(enrollment.student_id)) continue;
      handledStudents.add(enrollment.student_id);
      const targetEnrollment = get<{ id: number }>(
        "SELECT id FROM enrollments WHERE student_id = ? AND cycle_id = ? ORDER BY id DESC LIMIT 1",
        enrollment.student_id,
        activeCycleId
      );
      let enrollmentId = enrollment.id;
      const evaluationPeriodId = get<{ id: number }>(
        `SELECT id FROM academic_periods
         WHERE cycle_id = ? AND is_active = 1 ORDER BY sequence, id LIMIT 1`,
        activeCycleId
      )?.id ?? null;

      if (targetEnrollment && targetEnrollment.id !== enrollment.id) {
        enrollmentId = targetEnrollment.id;
        run("UPDATE enrollments SET is_active = 0 WHERE student_id = ? AND id <> ? AND is_active = 1", enrollment.student_id, enrollmentId);
        run(
          `UPDATE enrollments SET program_id = ?, shift_id = ?, group_id = ?, cycle_id = ?,
           period_id = COALESCE(period_id, ?), curricular_period_id = ?,
           plan_id = ?, is_active = 1 WHERE id = ?`,
          group.program_id,
          group.shift_id,
          id,
          activeCycleId,
          evaluationPeriodId,
          curricularPeriodId,
          planId,
          enrollmentId
        );
      } else {
        run("UPDATE enrollments SET is_active = 0 WHERE student_id = ? AND id <> ? AND is_active = 1", enrollment.student_id, enrollment.id);
        run(
          `UPDATE enrollments SET program_id = ?, shift_id = ?, group_id = ?, cycle_id = ?,
           period_id = ?, curricular_period_id = ?, plan_id = ?, is_active = 1 WHERE id = ?`,
          group.program_id,
          group.shift_id,
          id,
          activeCycleId,
          enrollment.cycle_id === activeCycleId ? get<{ period_id: number | null }>("SELECT period_id FROM enrollments WHERE id = ?", enrollment.id)?.period_id ?? evaluationPeriodId : evaluationPeriodId,
          curricularPeriodId,
          planId,
          enrollment.id
        );
      }
      syncEnrollmentGroupSubjects(enrollmentId);
      updated += 1;
    }
    return updated;
  });

  logActivity(req, "update-academic-context", "groups", id, { activeCycleId, planId, curricularPeriodId, syncStudents, updatedStudents });
  res.json({
    group: get(`${groupSelect("g.id = ?")}`, id),
    students: groupRoster(id),
    updatedStudents
  });
});
