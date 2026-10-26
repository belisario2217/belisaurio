import { get } from "../db.js";

export type EvaluationEligibility = {
  eligible: boolean;
  registrationPaid: boolean;
  reasons: string[];
};

export function evaluationEligibility(_assignmentId: number, enrollmentId: number): EvaluationEligibility {
  const registration = get<{ paid: number }>(
    `SELECT COALESCE((SELECT CASE WHEN srs.status = 'paid' THEN 1 ELSE 0 END
       FROM student_registration_status srs JOIN enrollments e ON e.id = srs.enrollment_id
       JOIN curricular_periods cp ON cp.id = e.curricular_period_id
       WHERE srs.enrollment_id = ? AND srs.period_number = cp.sequence LIMIT 1), CASE WHEN EXISTS (
       SELECT 1 FROM student_payments sp
       JOIN enrollments e ON e.id = sp.enrollment_id
       JOIN curricular_periods cp ON cp.id = e.curricular_period_id
       WHERE sp.enrollment_id = ?
       AND (sp.concept_type IN ('enrollment', 'reenrollment') OR LOWER(sp.concept) LIKE '%inscrip%')
       AND sp.registration_period_number = cp.sequence
     ) THEN 1 ELSE 0 END) AS paid`,
    enrollmentId,
    enrollmentId
  );
  const registrationPaid = Boolean(registration?.paid);
  const reasons: string[] = [];
  if (!registrationPaid) reasons.push("No se encontró el pago de inscripción o reinscripción del periodo.");

  return {
    eligible: registrationPaid,
    registrationPaid,
    reasons
  };
}
