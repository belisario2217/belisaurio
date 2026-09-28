import { get } from "../db.js";
import { studentAttendanceMonths } from "./daily-attendance.js";

export type EvaluationEligibility = {
  eligible: boolean;
  attendanceRecorded: boolean;
  attendancePercentage: number;
  attendedClasses: number;
  scheduledClasses: number;
  registrationPaid: boolean;
  reasons: string[];
};

export function evaluationEligibility(_assignmentId: number, enrollmentId: number): EvaluationEligibility {
  const months = studentAttendanceMonths(enrollmentId);
  const scheduledClasses = months.reduce((sum, row) => sum + row.scheduled_days, 0);
  const attendedClasses = months.reduce((sum, row) => sum + row.attended_days, 0);
  const attendancePercentage = scheduledClasses > 0
    ? Number((attendedClasses / scheduledClasses * 100).toFixed(1))
    : 0;

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
  const attendanceRecorded = scheduledClasses > 0;
  const reasons: string[] = [];
  if (!attendanceRecorded) reasons.push("No hay asistencia diaria confirmada del alumno.");
  else if (attendancePercentage < 80) reasons.push(`Asistencia insuficiente: ${attendancePercentage}% (mínimo 80%).`);
  if (!registrationPaid) reasons.push("No se encontró el pago de inscripción o reinscripción del periodo.");

  return {
    eligible: attendanceRecorded && attendancePercentage >= 80 && registrationPaid,
    attendanceRecorded,
    attendancePercentage,
    attendedClasses,
    scheduledClasses,
    registrationPaid,
    reasons
  };
}
