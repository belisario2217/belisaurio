import { all } from "../db.js";

export function studentAttendanceMonths(enrollmentId: number, groupId: number | null = null) {
  return all<{ month: string; scheduled_days: number; attended_days: number; percentage: number }>(
    `WITH enrollment AS (SELECT * FROM enrollments WHERE id = ?),
     recorded AS (SELECT ar.group_id, substr(ar.attendance_date, 1, 7) AS month, COUNT(*) AS recorded_days,
     SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS attended_days
     FROM daily_attendance_records ar
     JOIN attendance_days d ON d.group_id = ar.group_id AND d.attendance_date = ar.attendance_date
     JOIN groups g ON g.id = ar.group_id
     JOIN enrollment e ON e.student_id = ar.student_id AND e.cycle_id = g.cycle_id
     WHERE d.status = 'confirmed' AND (? IS NULL OR ar.group_id = ?)
     GROUP BY ar.group_id, substr(ar.attendance_date, 1, 7)),
     months AS (SELECT group_id, month FROM recorded UNION
       SELECT c.group_id, c.month FROM group_month_class_days c JOIN enrollment e ON e.group_id = c.group_id
       WHERE ? IS NULL OR c.group_id = ?),
     totals AS (SELECT m.month,
       SUM(COALESCE(c.class_days, r.recorded_days, 0)) AS scheduled_days,
       SUM(COALESCE(r.attended_days, 0)) AS attended_days
       FROM months m LEFT JOIN recorded r ON r.group_id = m.group_id AND r.month = m.month
       LEFT JOIN group_month_class_days c ON c.group_id = m.group_id AND c.month = m.month
       GROUP BY m.month)
     SELECT *, CASE WHEN scheduled_days > 0 THEN ROUND(attended_days * 100.0 / scheduled_days, 1)
       ELSE 0 END AS percentage FROM totals ORDER BY month DESC`, enrollmentId, groupId, groupId, groupId, groupId
  );
}
