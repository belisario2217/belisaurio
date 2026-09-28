import { all } from "../db.js";

export function studentAttendanceMonths(enrollmentId: number) {
  return all<{ month: string; scheduled_days: number; attended_days: number; percentage: number }>(
    `SELECT substr(ar.attendance_date, 1, 7) AS month, COUNT(*) AS scheduled_days,
     SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS attended_days,
     ROUND(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS percentage
     FROM daily_attendance_records ar
     JOIN attendance_days d ON d.group_id = ar.group_id AND d.attendance_date = ar.attendance_date
     JOIN groups g ON g.id = ar.group_id
     JOIN enrollments e ON e.id = ? AND e.student_id = ar.student_id AND e.cycle_id = g.cycle_id
     WHERE d.status = 'confirmed'
     GROUP BY substr(ar.attendance_date, 1, 7) ORDER BY month DESC`, enrollmentId
  );
}
