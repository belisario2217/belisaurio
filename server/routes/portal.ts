import { Router } from "express";
import { requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get } from "../db.js";
import { buildBilling } from "../services/billing.js";
import { ApiError } from "../utils.js";
import { promotionEligibility } from "../services/promotion-eligibility.js";
import { syncAcademicSubjectStatuses } from "../services/academic-calendar.js";
import { createPdf } from "../services/files.js";
import { getAcademicStudent, type AcademicSubject } from "../services/academic-record.js";
import { drawAcademicDocument, printedSubjects, publicAcademicStudent } from "../services/academic-documents.js";
import { issueDocument } from "../services/document-verification.js";

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
  school_cycle_id: number | null;
  enrollment_id?: number | null;
  assignment_id: number | null;
  evaluation_mode: string | null;
  teacher_name: string | null;
  partial_1: number | null;
  partial_2: number | null;
  partial_3: number | null;
  final_score: number | null;
  status: "pending" | "in_progress" | "passed" | "failed";
  comments: string | null;
};

function scoreOrNull(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function summarizeSubject(subject: any, gradeRows: any[]): PortalSubject {
  let rows = gradeRows.filter((grade) => grade.subject_id === subject.subject_id
    && (subject.school_cycle_id == null || grade.cycle_id === subject.school_cycle_id));
  if (subject.school_cycle_id == null && rows.length) rows = rows.filter(row => row.cycle_id === rows.at(-1)!.cycle_id);
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
  const incomplete = !!partialMode && [partial_1, partial_2, partial_3].some(score => score == null);
  const final_score = incomplete ? null : scoreOrNull(partialMode?.final_score) ?? scoreOrNull(subject.explicit_score) ?? (completedScores.length
    ? Number((completedScores.reduce((sum, score) => sum + score, 0) / completedScores.length).toFixed(1))
    : null);
  const passingScore = Math.max(...rows.map((grade) => Number(grade.passing_score ?? 0)), 0);
  const status = incomplete
    ? "in_progress"
    : final_score != null ? final_score >= passingScore ? "passed" : "failed"
    : subject.explicit_status === "completed" ? "passed"
    : subject.explicit_status === "in_progress" ? "in_progress" : "pending";
  const comments = [...new Set(rows.map((grade) => grade.comments).filter(Boolean))].join(" | ") || null;
  return {
    ...subject,
    course_cycle_name: subject.course_cycle_name ?? latest?.grade_cycle_name ?? null,
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

export function studentPortalData(studentId: number) {
  syncAcademicSubjectStatuses(studentId);

  const enrollment = get<any>(
    `SELECT e.id AS enrollment_id, e.program_id, COALESCE(e.plan_id,g.plan_id) AS plan_id, e.group_id, e.enrolled_at,
     COALESCE(e.tuition_start_date, ec.start_date) AS billing_start_date, e.tuition_due_day,
     p.duration_periods, pl.tuition_amount, st.id AS student_id, st.student_number,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     st.email, p.name AS program_name, g.name AS group_name, sh.name AS shift_name,
     sc.name AS cycle_name, sc.id AS active_cycle_id, ap.name AS current_period, ap.sequence AS current_period_number, pl.name AS plan_name, pl.code AS plan_code,
     pl.version AS plan_version, l.name AS level_name
     FROM enrollments e
     JOIN students st ON st.id = e.student_id
     JOIN programs p ON p.id = e.program_id
     LEFT JOIN academic_levels l ON l.id = p.level_id
     JOIN groups g ON g.id = e.group_id
     JOIN shifts sh ON sh.id = e.shift_id
     JOIN institution_settings i ON i.id = 1
     JOIN school_cycles ec ON ec.id = e.cycle_id
     JOIN school_cycles sc ON sc.id = COALESCE(g.active_cycle_id,i.active_cycle_id,e.cycle_id)
     LEFT JOIN curricular_periods ap ON ap.id = COALESCE(e.curricular_period_id,g.curricular_period_id)
     LEFT JOIN academic_plans pl ON pl.id = COALESCE(e.plan_id,g.plan_id)
     WHERE e.student_id = ? AND e.is_active = 1
     ORDER BY e.id DESC LIMIT 1`,
    studentId
  );
  if (!enrollment) throw new ApiError(404, "No se encontró una inscripción activa para este alumno.");

  const gradeRows = all<any>(
    `SELECT s.id AS subject_id, s.code, s.name, COALESCE(NULLIF(s.credits, 0), 1) AS subject_credits,
     a.id AS assignment_id, a.group_id AS assignment_group_id, a.evaluation_mode, ap.sequence AS period_sequence, ap.cycle_id, sc.name AS grade_cycle_name,
     t.full_name AS teacher_name, gr.partial_1, gr.partial_2, gr.partial_3,
     gr.final_score, gr.status, gr.comments, gs.passing_score
     FROM subject_assignments a
     JOIN subjects s ON s.id = a.subject_id
     JOIN academic_periods ap ON ap.id = a.period_id
     JOIN school_cycles sc ON sc.id = ap.cycle_id
     JOIN grading_scales gs ON gs.id = a.grading_scale_id
     LEFT JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN grades gr ON gr.assignment_id = a.id AND gr.enrollment_id IN (
       SELECT id FROM enrollments WHERE student_id = ? AND program_id = ?
         AND (plan_id = ? OR plan_id IS NULL)
     )
     WHERE (a.group_id = ? AND a.is_active = 1 OR gr.id IS NOT NULL) AND s.is_active = 1
       AND sc.start_date <= (SELECT start_date FROM school_cycles WHERE id = ?)
     ORDER BY s.name, sc.start_date, ap.sequence, a.id`,
    enrollment.student_id, enrollment.program_id, enrollment.plan_id,
    enrollment.group_id, enrollment.active_cycle_id
  );
  const explicitSubjects = all<any>(
    `SELECT ss.id AS student_subject_id, NULL AS plan_subject_id, ss.subject_id, s.code, s.name,
     ss.subject_type, ss.credits, ss.semester_number AS recommended_period, ss.school_cycle_id, ss.enrollment_id,
     ss.status AS explicit_status, ss.final_score AS explicit_score, ss.notes AS explicit_notes,
     sc.name AS course_cycle_name
     FROM student_subjects ss
     JOIN subjects s ON s.id = ss.subject_id
     LEFT JOIN school_cycles sc ON sc.id = ss.school_cycle_id
     WHERE ss.student_id = ? AND s.is_active = 1
       AND (ss.plan_id = ? OR (ss.plan_id IS NULL AND (ss.enrollment_id IS NULL
         OR ss.enrollment_id IN (SELECT id FROM enrollments WHERE student_id = ? AND program_id = ?))))
       AND (sc.start_date IS NULL OR sc.start_date <= (SELECT start_date FROM school_cycles WHERE id = ?))
     ORDER BY ss.semester_number, s.name, ss.id`,
    enrollment.student_id, enrollment.plan_id, enrollment.student_id, enrollment.program_id, enrollment.active_cycle_id
  );
  const planSubjects = enrollment.plan_id ? all<any>(
    `SELECT ps.id AS plan_subject_id, s.id AS subject_id, s.code, s.name,
     ps.subject_type, ps.credits, ps.recommended_period,
     NULL AS explicit_status, NULL AS explicit_score, NULL AS course_cycle_name, NULL AS school_cycle_id
     FROM plan_subjects ps
     JOIN subjects s ON s.id = ps.subject_id
     WHERE ps.plan_id = ?
     AND NOT EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = ? AND ss.subject_id = ps.subject_id)
     ORDER BY ps.recommended_period, s.name`,
    enrollment.plan_id,
    enrollment.student_id
  ) : [];
  const baseSubjects = planSubjects.length ? planSubjects : gradeRows.filter((grade) => grade.cycle_id === enrollment.active_cycle_id && grade.assignment_group_id === enrollment.group_id && !explicitSubjects.some((subject) => subject.subject_id === grade.subject_id)).map((grade) => ({
    plan_subject_id: null,
    subject_id: grade.subject_id,
    code: grade.code,
    name: grade.name,
    subject_type: "mandatory",
    credits: grade.subject_credits,
    recommended_period: enrollment.current_period_number,
    explicit_status: null,
    explicit_score: null,
    course_cycle_name: null, school_cycle_id: grade.cycle_id
  })).filter((subject, index, list) => list.findIndex((item) => item.subject_id === subject.subject_id) === index);
  const gradeOnlySubjects = gradeRows
    .filter((grade) => grade.cycle_id === enrollment.active_cycle_id && grade.assignment_group_id === enrollment.group_id && !baseSubjects.some((subject) => subject.subject_id === grade.subject_id) && !explicitSubjects.some((subject) => subject.subject_id === grade.subject_id))
    .map((grade) => ({
      plan_subject_id: null,
      subject_id: grade.subject_id,
      code: grade.code,
      name: grade.name,
      subject_type: "mandatory",
      credits: grade.subject_credits,
      recommended_period: enrollment.current_period_number,
      explicit_status: null,
      explicit_score: null,
      course_cycle_name: null, school_cycle_id: grade.cycle_id
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
    .filter((subject) => subject.status === "passed" && subject.recommended_period <= enrollment.current_period_number)
    .reduce((sum, subject) => sum + Number(subject.credits), 0);
  const graded = subjects.filter((subject) => subject.final_score != null && subject.recommended_period <= enrollment.current_period_number);
  const average = graded.length
    ? graded.reduce((sum, subject) => sum + Number(subject.final_score), 0) / graded.length
    : null;

  const activeSubjects = [...new Map(subjects.filter(subject => {
      if (subject.recommended_period !== enrollment.current_period_number) return false;
      if (subject.enrollment_id != null && subject.enrollment_id !== enrollment.enrollment_id) return false;
      const assigned = gradeRows.some(row => row.subject_id === subject.subject_id && row.cycle_id === enrollment.active_cycle_id);
      if (subject.school_cycle_id != null && subject.school_cycle_id !== enrollment.active_cycle_id) return assigned;
      const captured = [subject.partial_1, subject.partial_2, subject.partial_3, subject.final_score].some(score => score != null);
      if (subject.explicit_status === "pending" && !captured) return false;
      return subject.explicit_status === "in_progress" || subject.explicit_status === "completed" || captured || assigned;
    }).map(subject => {
      // Old captures used the enrollment's formation cycle. An assignment in the
      // active cycle establishes a new attempt; its previous final never leaks in.
      const base = subject.school_cycle_id != null && subject.school_cycle_id !== enrollment.active_cycle_id
        ? { ...subject, school_cycle_id: enrollment.active_cycle_id, explicit_score: null, explicit_status: null }
        : subject;
      const active = summarizeSubject(base, gradeRows.filter(row => row.cycle_id === enrollment.active_cycle_id));
      return [subject.subject_id, { ...active, course_cycle_name: enrollment.cycle_name,
        status: active.status === "pending" ? "in_progress" as const : active.status }] as const;
    })).values()];
  // The transcript includes loaded coursework from every semester reached.
  // Current-cycle attempts take precedence over stale curricular snapshots.
  const gradeSubjects = [...new Map([
    ...subjects.filter(subject => subject.recommended_period <= enrollment.current_period_number
      && (subject.explicit_status === "completed" || subject.final_score != null
        || subject.partial_1 != null || subject.partial_2 != null || subject.partial_3 != null)),
    ...activeSubjects
  ].map(subject => [`${subject.recommended_period}:${subject.subject_id}`, subject])).values()]
    .sort((a, b) => a.recommended_period - b.recommended_period || a.name.localeCompare(b.name, "es-MX"));

  return {
    student: enrollment,
    progress: {
      totalCredits,
      earnedCredits,
      pendingCredits: Math.max(0, totalCredits - earnedCredits),
      percentage: totalCredits ? Number((earnedCredits / totalCredits * 100).toFixed(1)) : 0,
      average: average == null ? null : Number(average.toFixed(1)),
      completedSubjects: subjects.filter((subject) => subject.status === "passed" && subject.recommended_period <= enrollment.current_period_number).length,
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
    messages,
    subjects,
    activeSubjects,
    gradeSubjects
  };
}
export function activeStudentPortalData(studentId: number) {
  const { activeSubjects, ...data } = studentPortalData(studentId);
  return { ...data, subjects: activeSubjects };
}
function portalStudent(req: AuthenticatedRequest) {
  if (!req.user?.studentId) throw new ApiError(403, "Esta cuenta todavía no está vinculada con un alumno.");
  return req.user.studentId;
}
portalRouter.get("/", requirePermission("portal.view"), (req: AuthenticatedRequest, res) => {
  res.set("Cache-Control", "private, no-store").json(activeStudentPortalData(portalStudent(req)));
});

portalRouter.get("/report-card.pdf", requirePermission("portal.view"), async (req: AuthenticatedRequest, res) => {
  const studentId = portalStudent(req), data = activeStudentPortalData(studentId), student = getAcademicStudent(studentId);
  const subjects: AcademicSubject[] = data.subjects.map(subject => ({
    subject_id: subject.subject_id, subject_code: subject.code, subject_name: subject.name,
    semester_number: subject.recommended_period, subject_type: subject.subject_type, credits: subject.credits,
    cycle_id: student.cycle_id, cycle_name: student.cycle_name,
    partial_1: subject.partial_1, partial_2: subject.partial_2, partial_3: subject.partial_3,
    final_score: subject.final_score, status: subject.status, comments: subject.comments
  }));
  const finals = subjects.filter(subject => subject.final_score != null);
  const average = finals.length ? Number((finals.reduce((sum, subject) => sum + subject.final_score!, 0) / finals.length).toFixed(1)) : null;
  const issued = await issueDocument("report_card", studentId, req.user!.id, publicAcademicStudent(student), {
    purpose: "student_copy", subjects: printedSubjects(subjects), average,
    notes: ["Documento informativo. No tiene valor para trámites."]
  });
  res.set("Cache-Control", "private, no-store");
  const doc = createPdf(res, `boleta-del-alumno-${student.student_number.replace(/[^A-Za-z0-9_-]/g, "")}.pdf`);
  drawAcademicDocument(doc, { student, subjects, average }, issued);
  doc.end();
});
