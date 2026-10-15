import { all, get, run } from "../db.js";
import { ApiError } from "../utils.js";

export type CycleVacation = { start_date: string; end_date: string };
export type CycleCalendar = {
  cycle_id: number; cycle_name: string; activity_start: string; activity_end: string;
  vacations: CycleVacation[];
};

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getCycleCalendar(cycleId: number): CycleCalendar {
  const cycle = get<{id:number;name:string;start_date:string;end_date:string}>(
    "SELECT id, name, start_date, end_date FROM school_cycles WHERE id = ?", cycleId
  );
  if (!cycle) throw new ApiError(404, "No existe el ciclo escolar.");
  const vacations = all<CycleVacation>(
    `SELECT DISTINCT start_date, end_date FROM academic_calendar_events
     WHERE school_cycle_id = ? AND event_type = 'vacation' AND is_active = 1
       AND start_date >= ? AND end_date <= ? ORDER BY start_date, end_date`,
    cycleId, cycle.start_date, cycle.end_date
  );
  return { cycle_id: cycle.id, cycle_name: cycle.name, activity_start: cycle.start_date, activity_end: cycle.end_date, vacations };
}

export function validateCycleCalendar(start: unknown, end: unknown, input: unknown) {
  if (!validCalendarDate(start) || !validCalendarDate(end) || end < start) {
    throw new ApiError(400, "Captura fechas reales de inicio y fin del ciclo, en orden cronológico.");
  }
  if (!Array.isArray(input) || input.length > 12) throw new ApiError(400, "Captura hasta 12 periodos vacacionales.");
  const vacations: CycleVacation[] = input.map((vacation: any) => {
    if (!vacation || !validCalendarDate(vacation.start_date) || !validCalendarDate(vacation.end_date)
      || vacation.end_date < vacation.start_date || vacation.start_date < start || vacation.end_date > end) {
      throw new ApiError(400, "Las vacaciones deben tener fechas reales, en orden y dentro del ciclo escolar.");
    }
    return { start_date: vacation.start_date, end_date: vacation.end_date };
  }).sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (vacations.some((vacation, index) => index > 0 && vacation.start_date <= vacations[index - 1].end_date)) {
    throw new ApiError(400, "Los periodos vacacionales no pueden superponerse.");
  }
  return { start, end, vacations };
}

type PendingSubject = {
  id: number;
  cycle_id: number;
  cycle_start: string;
  cycle_end: string;
};

function localDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function academicStatusForCycle(cycleId: number): "pending" | "in_progress" {
  const today = localDate();
  const cycle = get<{ start_date: string; end_date: string }>(
    "SELECT start_date, end_date FROM school_cycles WHERE id = ?",
    cycleId
  );
  if (!cycle || today > cycle.end_date) return "pending";
  const configured = all<{ start_date: string }>(
    `SELECT start_date FROM academic_calendar_events
     WHERE (school_cycle_id = ? OR school_cycle_id IS NULL) AND is_active = 1 AND auto_start_subjects = 1
       AND start_date BETWEEN ? AND ? ORDER BY start_date`,
    cycleId, cycle.start_date, cycle.end_date
  );
  const started = configured.length
    ? configured.some((event) => event.start_date <= today)
    : cycle.start_date <= today;
  return started ? "in_progress" : "pending";
}

export function syncAcademicSubjectStatuses() {
  const today = localDate();
  const pending = all<PendingSubject>(
    `SELECT ss.id, sc.id AS cycle_id, sc.start_date AS cycle_start, sc.end_date AS cycle_end
     FROM student_subjects ss
     JOIN enrollments e ON e.id = ss.enrollment_id AND e.is_active = 1
     JOIN curricular_periods cp ON cp.id = e.curricular_period_id AND cp.sequence = ss.semester_number
     JOIN groups g ON g.id = e.group_id
     JOIN institution_settings i ON i.id = 1
     JOIN school_cycles sc ON sc.id = COALESCE(ss.school_cycle_id, g.active_cycle_id, i.active_cycle_id, e.cycle_id)
     JOIN students st ON st.id = ss.student_id AND st.is_active = 1
     WHERE ss.status = 'pending' AND ss.status_manual_override = 0`
  );
  const automaticEvents = all<{ school_cycle_id: number | null; start_date: string }>(
    `SELECT school_cycle_id, start_date FROM academic_calendar_events
     WHERE is_active = 1 AND auto_start_subjects = 1
     ORDER BY start_date`
  );
  const eligibleIds = pending.filter((subject) => {
    if (today > subject.cycle_end) return false;
    const configured = automaticEvents.filter((event) => (event.school_cycle_id == null || event.school_cycle_id === subject.cycle_id)
      && event.start_date >= subject.cycle_start && event.start_date <= subject.cycle_end);
    return configured.length
      ? configured.some((event) => event.start_date <= today)
      : subject.cycle_start <= today;
  }).map((subject) => subject.id);
  if (!eligibleIds.length) return 0;
  const result = run(
    `UPDATE student_subjects SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${eligibleIds.map(() => "?").join(",")}) AND status = 'pending' AND status_manual_override = 0`,
    ...eligibleIds
  );
  return Number(result.changes);
}
