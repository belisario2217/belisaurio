import { Router } from "express";
import { requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get } from "../db.js";
import { buildBilling } from "../services/billing.js";
import { ApiError } from "../utils.js";
import { promotionEligibility } from "../services/promotion-eligibility.js";
import { syncAcademicSubjectStatuses } from "../services/academic-calendar.js";
import { studentAttendanceMonths } from "../services/daily-attendance.js";

export const portalRouter = Router();

type PortalSubject = {
  plan_subject_id: number | null;
  subject_id: number;
  code: string;
  name: string;
  subject_type: "mandatory" | "elective";
  credits: number;
  recommended_period: number;
  explicit_status: "pending" | "in_progress" | "completed" | null;
  explicit_score: number | null;
  course_cycle_name: string | null;
  assignment_id: number | null;
  evaluation_mode: string | null;
  teacher_name: string | null;
  partial_1: number | null;
  partial_2: number | null;
  partial_3: number | null;
  final_score: number | null;
  status: "pending" | "passed" | "failed";
  comments: string | null;
};

function scoreOrNull(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function summarizeSubject(subject: any, gradeRows: any[]): PortalSubject {
  const rows = gradeRows.filter((grade) => grade.subject_id === subject.subject_id);
  const latest = rows.at(-1);
  const partialMode = [...rows].reverse().find((grade) =>
    grade.evaluation_mode === "partials" &&
    (grade.partial_1 != null || grade.partial_2 != null || grade.partial_3 != null)
  );
  const bySequence = (sequence: number) => {
    const match = rows.filter((grade) => grade.period_sequence === sequence && grade.final_score != null).at(-1);
    return scoreOrNull(match?.final_score);
  };
  const partial_1 = partialMode ? scoreOrNull(partialMode.partial_1) : bySequence(1);
  const partial_2 = partialMode ? scoreOrNull(partialMode.partial_2) : bySequence(2);
  const partial_3 = partialMode ? scoreOrNull(partialMode.partial_3) : bySequence(3);
  const completedScores = rows
    .map((grade) => scoreOrNull(grade.final_score))
    .filter((score): score is number => score !== null);
  const final_score = scoreOrNull(partialMode?.final_score) ?? scoreOrNull(subject.explicit_score) ?? (completedScores.length
    ? Number((completedScores.reduce((sum, score) => sum + score, 0) / completedScores.length).toFixed(1))
    : null);
  const passingScore = Math.max(...rows.map((grade) => Number(grade.passing_score ?? 0)), 0);
  const status = partialMode && [partial_1, partial_2, partial_3].some((score) => score === null)
    ? "pending"
    : subject.explicit_status === "completed"
    ? "passed"
    : final_score == null
      ? "pending"
      : final_score >= passingScore
        ? "passed"
        : "failed";
  const comments = [...new Set(rows.map((grade) => grade.comments).filter(Boolean))].join(" | ") || null;
  return {
    ...subject,
    assignment_id: latest?.assignment_id ?? null,
    evaluation_mode: latest?.evaluation_mode ?? null,
    teacher_name: latest?.teacher_name ?? null,
    partial_1,
    partial_2,
    partial_3,
    final_score,
    status,
    comments
  };
}

portalRouter.get("/", requirePermission("portal.view"), (req: AuthenticatedRequest, res) => {
  syncAcademicSubjectStatuses();
  if (!req.user?.studentId) throw new ApiError(403, "Esta cuenta todavía no está vinculada con un alumno.");
  const enrollment = get<any>(
    `SELECT e.id AS enrollment_id, e.plan_id, e.group_id, e.enrolled_at,
     COALESCE(e.tuition_start_date, sc.start_date) AS billing_start_date, e.tuition_due_day,
     p.duration_periods, pl.tuition_amount, st.id AS student_id, st.student_number,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     st.email, p.name AS program_name, g.name AS group_name, sh.name AS shift_name,
     sc.name AS cycle_name, ap.name AS current_period, ap.sequence AS current_period_number, pl.name AS plan_name, pl.code AS plan_code,
     pl.version AS plan_version, l.name AS level_name
     FROM enrollments e
     JOIN students st ON st.id = e.student_id
     JOIN programs p ON p.id = e.program_id
     LEFT JOIN academic_levels l ON l.id = p.level_id
     JOIN groups g ON g.id = e.group_id
     JOIN shifts sh ON sh.id = e.shift_id
     JOIN school_cycles sc ON sc.id = e.cycle_id
     LEFT JOIN curricular_periods ap ON ap.id = e.curricular_period_id
     LEFT JOIN academic_plans pl ON pl.id = e.plan_id
     WHERE e.student_id = ? AND e.is_active = 1
     ORDER BY e.id DESC LIMIT 1`,
    req.user.studentId
  );
  if (!enrollment) throw new ApiError(404, "No se encontró una inscripción activa para este alumno.");

  const gradeRows = all<any>(
    `SELECT s.id AS subject_id, s.code, s.name, COALESCE(NULLIF(s.credits, 0), 1) AS subject_credits,
     a.id AS assignment_id, a.evaluation_mode, ap.sequence AS period_sequence,
     t.full_name AS teacher_name, gr.partial_1, gr.partial_2, gr.partial_3,
     gr.final_score, gr.status, gr.comments, gs.passing_score
     FROM subject_assignments a
     JOIN subjects s ON s.id = a.subject_id
     JOIN academic_periods ap ON ap.id = a.period_id
     JOIN grading_scales gs ON gs.id = a.grading_scale_id
     LEFT JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN grades gr ON gr.assignment_id = a.id AND gr.enrollment_id = ?
     WHERE a.group_id = ? AND a.is_active = 1
     ORDER BY s.name, ap.sequence, a.id`,
    enrollment.enrollment_id,
    enrollment.group_id
  );
  const explicitSubjects = all<any>(
    `SELECT ss.id AS student_subject_id, NULL AS plan_subject_id, ss.subject_id, s.code, s.name,
     ss.subject_type, ss.credits, ss.semester_number AS recommended_period,
     ss.status AS explicit_status, ss.final_score AS explicit_score, ss.notes AS explicit_notes,
     sc.name AS course_cycle_name
     FROM student_subjects ss
     JOIN subjects s ON s.id = ss.subject_id
     LEFT JOIN school_cycles sc ON sc.id = ss.school_cycle_id
     WHERE ss.student_id = ?
     ORDER BY ss.semester_number, s.name`,
    enrollment.student_id
  );
  const planSubjects = enrollment.plan_id ? all<any>(
    `SELECT ps.id AS plan_subject_id, s.id AS subject_id, s.code, s.name,
     ps.subject_type, ps.credits, ps.recommended_period,
     NULL AS explicit_status, NULL AS explicit_score, NULL AS course_cycle_name
     FROM plan_subjects ps
     JOIN subjects s ON s.id = ps.subject_id
     WHERE ps.plan_id = ?
     AND NOT EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = ? AND ss.subject_id = ps.subject_id)
     ORDER BY ps.recommended_period, s.name`,
    enrollment.plan_id,
    enrollment.student_id
  ) : [];
  const baseSubjects = planSubjects.length ? planSubjects : gradeRows.filter((grade) => !explicitSubjects.some((subject) => subject.subject_id === grade.subject_id)).map((grade) => ({
    plan_subject_id: null,
    subject_id: grade.subject_id,
    code: grade.code,
    name: grade.name,
    subject_type: "mandatory",
    credits: grade.subject_credits,
    recommended_period: grade.period_sequence,
    explicit_status: null,
    explicit_score: null,
    course_cycle_name: null
  })).filter((subject, index, list) => list.findIndex((item) => item.subject_id === subject.subject_id) === index);
  const gradeOnlySubjects = gradeRows
    .filter((grade) => !baseSubjects.some((subject) => subject.subject_id === grade.subject_id) && !explicitSubjects.some((subject) => subject.subject_id === grade.subject_id))
    .map((grade) => ({
      plan_subject_id: null,
      subject_id: grade.subject_id,
      code: grade.code,
      name: grade.name,
      subject_type: "mandatory",
      credits: grade.subject_credits,
      recommended_period: grade.period_sequence,
      explicit_status: null,
      explicit_score: null,
      course_cycle_name: null
    }));
  const subjects = [...explicitSubjects, ...baseSubjects, ...gradeOnlySubjects]
    .map((subject) => summarizeSubject(subject, gradeRows))
    .sort((left, right) => left.recommended_period - right.recommended_period || left.name.localeCompare(right.name));
  const messages = all<any>(
    `SELECT m.id, m.title, m.body, m.priority, m.created_at
     FROM portal_messages m
     WHERE m.is_active = 1
     AND (m.starts_at IS NULL OR m.starts_at <= date('now'))
     AND (m.ends_at IS NULL OR m.ends_at >= date('now'))
     AND (
       m.target_type = 'all'
       OR (m.target_type = 'student' AND m.target_id = ?)
       OR (m.target_type = 'group' AND m.target_id = ?)
     )
     ORDER BY CASE m.priority WHEN 'urgent' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, m.created_at DESC`,
    enrollment.student_id,
    enrollment.group_id
  );
  const attendance = studentAttendanceMonths(enrollment.enrollment_id);
  const manualRegistration = get<{ status: string; paid_at: string | null; period_number: number }>(
    "SELECT status, paid_at, period_number FROM student_registration_status WHERE enrollment_id = ? AND period_number = ?",
    enrollment.enrollment_id,
    enrollment.current_period_number ?? -1
  );
  const paymentRegistration = get<{ paid: number; paid_at: string | null; concept: string | null }>(
    `SELECT 1 AS paid, paid_at, concept FROM student_payments
     WHERE enrollment_id = ?
     AND (concept_type IN ('enrollment', 'reenrollment') OR LOWER(concept) LIKE '%inscrip%')
     AND registration_period_number = ?
     ORDER BY paid_at DESC, id DESC LIMIT 1`,
    enrollment.enrollment_id,
    enrollment.current_period_number ?? -1
  );
  const registration = manualRegistration
    ? { paid: manualRegistration.status === "paid" ? 1 : 0, paid_at: manualRegistration.paid_at, concept: "Registro administrativo" }
    : paymentRegistration;

  const totalCredits = subjects.reduce((sum, subject) => sum + Number(subject.credits), 0);
  const earnedCredits = subjects
    .filter((subject) => subject.status === "passed")
    .reduce((sum, subject) => sum + Number(subject.credits), 0);
  const graded = subjects.filter((subject) => subject.final_score != null);
  const average = graded.length
    ? graded.reduce((sum, subject) => sum + Number(subject.final_score), 0) / graded.length
    : null;

  res.json({
    student: enrollment,
    progress: {
      totalCredits,
      earnedCredits,
      pendingCredits: Math.max(0, totalCredits - earnedCredits),
      percentage: totalCredits ? Number((earnedCredits / totalCredits * 100).toFixed(1)) : 0,
      average: average == null ? null : Number(average.toFixed(1)),
      completedSubjects: subjects.filter((subject) => subject.status === "passed").length,
      totalSubjects: subjects.length
    },
    billing: buildBilling({
      studentId: enrollment.student_id,
      enrollmentId: enrollment.enrollment_id,
      planId: enrollment.plan_id,
      durationPeriods: enrollment.duration_periods,
      tuitionAmount: enrollment.tuition_amount,
      billingStartDate: enrollment.billing_start_date,
      tuitionDueDay: enrollment.tuition_due_day,
      enrolledAt: enrollment.enrolled_at
    }),
    registration: registration ?? { paid: 0, paid_at: null, concept: null },
    promotion: promotionEligibility(enrollment.enrollment_id),
    attendance,
    messages,
    subjects
  });
});
