import { Router } from "express";
import crypto from "node:crypto";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import { buildBilling, type BillingSource } from "../services/billing.js";
import { createPdf, parseWorkbook, pdfTable, sendWorkbook, type TabularRow } from "../services/files.js";
import {
  sendAccountStatementPdf,
  sendAccountStatementWorkbook,
  physicalFolio,
  type StatementInstitutionSettings
} from "../services/account-statement.js";
import { ApiError, asId, asNumber, cleanText, optionalText, sendCsv } from "../utils.js";
import { normalizePhysicalFolio, comparePhysicalFolios } from "../services/physical-folio.js";
import { promotionEligibility } from "../services/promotion-eligibility.js";
import multer from "multer";
import { issueDocument } from "../services/document-verification.js";
import { sendFolioReport } from "../services/folio-report.js";

export const paymentsRouter = Router();

type StudentAccount = BillingSource & {
  student_number: string;
  student_name: string;
  email: string | null;
  program_name: string;
  group_name: string;
  shift_name: string;
  cycle_name: string;
  current_period: string | null;
  currentPeriodNumber: number | null;
  plan_name: string | null;
  plan_code: string | null;
  level_name: string | null;
  billingStartDate: string | null;
  tuitionDueDay: number | null;
};

type PaymentImportRow = {
  row: number;
  studentId: number;
  studentNumber: string;
  studentName: string;
  folio: string;
  originalFolio: string;
  amount: number;
  paidAt: string;
  paymentMethod: string | null;
  concept: string;
  conceptType: "tuition" | "enrollment" | "reenrollment" | "other";
  coveredMonth: string | null;
  registrationPeriodNumber: number | null;
  notes: string | null;
  existingPaymentId: number | null;
};

type PaymentPreview = {
  createdAt: number;
  valid: PaymentImportRow[];
  errors: Array<{ row: number; message: string }>;
};

const paymentPreviews = new Map<string, PaymentPreview>();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) callback(null, true);
    else callback(new ApiError(400, "Usa un archivo Excel o CSV."));
  }
});

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeKey(input: string) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function value(row: TabularRow, ...aliases: string[]) {
  const values = new Map(Object.entries(row).map(([key, item]) => [normalizeKey(key), item]));
  for (const alias of aliases) {
    const found = values.get(normalizeKey(alias));
    if (found !== undefined) return cleanText(found, 500);
  }
  return "";
}

function receiptKey(value: unknown) {
  const text = cleanText(value, 80);
  return text.replace(/^0+/, "") || text;
}

function parseAmount(value: unknown) {
  const text = cleanText(value, 40).replace(/\$/g, "").replace(/,/g, "").trim();
  if (/^=\s*\d+(?:\.\d+)?(?:\s*[+*]\s*\d+(?:\.\d+)?)+\s*$/.test(text)) {
    let total: number | null = null;
    let operator = "+";
    for (const token of text.slice(1).match(/\d+(?:\.\d+)?|[+*]/g) ?? []) {
      if (token === "+" || token === "*") {
        operator = token;
        continue;
      }
      const number = Number(token);
      if (total === null) total = number;
      else if (operator === "+") total += number;
      else total *= number;
    }
    return total ?? NaN;
  }
  return Number(text);
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function validDate(value: unknown, field: string) {
  const corrections: Record<string, string> = {
    "16/05726": "16/05/2026",
    "01/06726": "01/06/2026",
    "01/03726": "01/03/2026",
    "04//04/26": "04/04/2026"
  };
  const text = corrections[cleanText(value, 40)] ?? cleanText(value, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00`).getTime())) {
    return text;
  }
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    if (year < 2020) year += 10;
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    const normalized = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!Number.isNaN(new Date(`${normalized}T00:00:00`).getTime())) return normalized;
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 30_000 && serial < 80_000) {
      const date = new Date(Date.UTC(1899, 11, 30 + Math.trunc(serial)));
      return date.toISOString().slice(0, 10);
    }
  }
  throw new ApiError(400, `${field} no es una fecha valida.`);
}

function uniqueImportFolio(studentNumber: string, originalFolio: string, paidAt: string, row: number) {
  return `PAG-${studentNumber}-${originalFolio || paidAt.replaceAll("-", "")}-${row}`;
}

function existingPaymentForImport(item: PaymentImportRow) {
  const byGeneratedFolio = get<{ id: number }>("SELECT id FROM student_payments WHERE folio = ? AND payment_kind='receipt'", item.folio);
  if (byGeneratedFolio) return byGeneratedFolio.id;
  const originalKey = receiptKey(item.originalFolio);
  if (originalKey) {
    const byOriginalReceipt = all<{ id: number; notes: string | null }>(
      "SELECT id, notes FROM student_payments WHERE student_id = ? AND amount = ? AND payment_kind='receipt'",
      item.studentId,
      item.amount
    ).find((payment) => receiptKey(payment.notes) === originalKey);
    if (byOriginalReceipt) return byOriginalReceipt.id;
  }
  const bySamePayment = get<{ id: number }>(
    `SELECT id FROM student_payments
     WHERE payment_kind='receipt' AND student_id = ? AND paid_at = ? AND amount = ? AND UPPER(TRIM(concept)) = UPPER(TRIM(?))
     ORDER BY id LIMIT 1`,
    item.studentId,
    item.paidAt,
    item.amount,
    item.concept
  );
  return bySamePayment?.id ?? null;
}

function validMonth(value: unknown) {
  const text = cleanText(value || currentMonth(), 7);
  if (!/^\d{4}-\d{2}$/.test(text)) throw new ApiError(400, "El mes debe tener formato AAAA-MM.");
  return text;
}

function tuitionConcept(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthName = new Intl.DateTimeFormat("es-MX", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  return `Colegiatura ${monthName} ${year}`;
}

function addBillingMonths(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "El mes debe tener formato AAAA-MM.");
  date.setMonth(date.getMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function semesterMonths(startMonth: string, totalMonths: unknown) {
  const count = Math.min(12, Math.max(1, Math.trunc(Number(totalMonths ?? 6))));
  return Array.from({ length: count }, (_, index) => addBillingMonths(startMonth, index));
}

function conceptTypeFromText(value: unknown): "tuition" | "enrollment" | "reenrollment" | "other" {
  const text = normalizeKey(cleanText(value, 120));
  if (text.includes("colegiatura")) return "tuition";
  if (text.includes("reinscripcion")) return "reenrollment";
  if (text.includes("inscripcion")) return "enrollment";
  return "other";
}

function validCoveredMonth(value: unknown) {
  const text = cleanText(value, 7);
  if (!text) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new ApiError(400, "El mes de colegiatura debe tener formato AAAA-MM.");
  return text;
}

function validDueDay(value: unknown) {
  const day = Math.trunc(asNumber(value, "Dia de cargo"));
  if (day < 1 || day > 31) throw new ApiError(400, "El dia de cargo debe estar entre 1 y 31.");
  return day;
}

function getStudentAccount(studentId: number) {
  return get<StudentAccount>(
    `SELECT e.id AS enrollmentId, e.student_id AS studentId, e.plan_id AS planId,
     p.duration_periods AS durationPeriods, ap.tuition_amount AS tuitionAmount,
     e.enrolled_at AS enrolledAt, COALESCE(e.tuition_start_date, sc.start_date) AS billingStartDate,
     e.tuition_due_day AS tuitionDueDay, st.student_number,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     st.email, p.name AS program_name, g.name AS group_name, sh.name AS shift_name,
     sc.name AS cycle_name, period.name AS current_period, period.sequence AS currentPeriodNumber, ap.name AS plan_name,
     ap.code AS plan_code, l.name AS level_name
     FROM enrollments e
     JOIN students st ON st.id = e.student_id
     JOIN programs p ON p.id = e.program_id
     LEFT JOIN academic_levels l ON l.id = p.level_id
     JOIN groups g ON g.id = e.group_id
     JOIN shifts sh ON sh.id = e.shift_id
     JOIN school_cycles sc ON sc.id = e.cycle_id
     LEFT JOIN curricular_periods period ON period.id = COALESCE(e.curricular_period_id, g.curricular_period_id)
     LEFT JOIN academic_plans ap ON ap.id = e.plan_id
     WHERE e.student_id = ? AND e.is_active = 1
     ORDER BY e.id DESC LIMIT 1`,
    studentId
  );
}

function academicProgress(account: StudentAccount) {
  const planSubjects = account.planId ? all<any>(
    `SELECT ps.subject_id, ps.credits FROM plan_subjects ps WHERE ps.plan_id = ?`,
    account.planId
  ) : [];
  const explicitRows = all<any>(
    `SELECT ss.subject_id, ss.credits, ss.status, ss.final_score
     FROM student_subjects ss
     WHERE ss.student_id = ?`,
    account.studentId
  );
  const gradeRows = all<any>(
    `SELECT s.id AS subject_id, COALESCE(NULLIF(s.credits, 0), 1) AS subject_credits,
     gr.final_score, gr.status, gs.passing_score
     FROM grades gr
     JOIN subject_assignments a ON a.id = gr.assignment_id
     JOIN subjects s ON s.id = a.subject_id
     JOIN grading_scales gs ON gs.id = a.grading_scale_id
     WHERE gr.enrollment_id = ?`,
    account.enrollmentId ?? 0
  );
  const subjects = planSubjects.length ? planSubjects : gradeRows
    .filter((grade, index, list) => list.findIndex((item) => item.subject_id === grade.subject_id) === index)
    .map((grade) => ({ subject_id: grade.subject_id, credits: grade.subject_credits }));
  const totalCredits = subjects.reduce((sum, subject) => sum + Number(subject.credits), 0);
  const passedSubjects = subjects.filter((subject) => {
    const explicit = explicitRows.find((row) => row.subject_id === subject.subject_id);
    if (explicit?.status === "completed" && explicit.final_score != null) return true;
    return gradeRows.some((grade) =>
      grade.subject_id === subject.subject_id &&
      grade.final_score != null &&
      (grade.status === "passed" || Number(grade.final_score) >= Number(grade.passing_score ?? 0))
    );
  });
  const earnedCredits = passedSubjects.reduce((sum, subject) => sum + Number(subject.credits), 0);
  const scored = [
    ...explicitRows.filter((row) => row.final_score != null),
    ...gradeRows.filter((grade) => grade.final_score != null && !explicitRows.some((row) => row.subject_id === grade.subject_id))
  ];
  const average = scored.length
    ? scored.reduce((sum, grade) => sum + Number(grade.final_score), 0) / scored.length
    : null;
  return {
    totalCredits,
    earnedCredits,
    percentage: totalCredits ? Number((earnedCredits / totalCredits * 100).toFixed(1)) : 0,
    average: average == null ? null : Number(average.toFixed(1))
  };
}

function fullAccount(studentId: number, throughMonth?: string) {
  const account = getStudentAccount(studentId);
  if (!account) throw new ApiError(404, "No se encontro una inscripcion activa para este alumno.");
  const billing = buildBilling(account);
  const manualRegistration = get<{ status: string; paid_at: string | null; physical_folio: string | null; period_number: number }>(
    "SELECT status, paid_at, physical_folio, period_number FROM student_registration_status WHERE enrollment_id = ? AND period_number = ?",
    account.enrollmentId ?? -1,
    account.currentPeriodNumber ?? -1
  );
  const paymentRegistration = get<{ paid: number; paid_at: string | null; concept: string | null; registration_period_number: number | null }>(
    `SELECT 1 AS paid, paid_at, concept, registration_period_number FROM student_payments
     WHERE enrollment_id = ?
     AND (concept_type IN ('enrollment', 'reenrollment') OR LOWER(concept) LIKE '%inscrip%')
     AND registration_period_number = ?
     ORDER BY paid_at DESC, id DESC LIMIT 1`,
    account.enrollmentId ?? -1,
    account.currentPeriodNumber ?? -1
  );
  const registration = manualRegistration
    ? { paid: manualRegistration.status === "paid" ? 1 : 0, paid_at: manualRegistration.paid_at, concept: "Registro administrativo", registration_period_number: manualRegistration.period_number }
    : paymentRegistration;
  if (throughMonth) {
    const lastDay = `${throughMonth}-31`;
    billing.payments = billing.payments.filter((payment) => payment.paid_at <= lastDay);
    billing.summary.paidAmount = Number(billing.payments.reduce((sum, payment) => sum + Number(payment.amount), 0).toFixed(2));
  }
  return {
    student: account,
    progress: academicProgress(account),
    billing,
    registration: registration ?? { paid: 0, paid_at: null, concept: null },
    promotion: promotionEligibility(account.enrollmentId ?? -1),
    throughMonth: throughMonth ?? null
  };
}

function registrationPeriodFromConcept(value: unknown) {
  const text = normalizeKey(cleanText(value, 160));
  const words = ["primer", "segundo", "tercer", "cuarto", "quinto", "sexto", "septimo", "octavo", "noveno", "decimo"];
  const wordIndex = words.findIndex((word) => text.includes(`${word}semestre`));
  if (wordIndex >= 0) return wordIndex + 1;
  const numeric = text.match(/semestre(\d{1,2})/) ?? text.match(/(\d{1,2})semestre/);
  const number = numeric ? Number(numeric[1]) : 0;
  return number >= 1 && number <= 20 ? number : null;
}

function statementSettings() {
  return get<StatementInstitutionSettings>(
    `SELECT institution_name, logo_path, director_name, footer_text, primary_color, secondary_color
     FROM institution_settings WHERE id = 1`
  ) ?? {
    institution_name: "INSTITUTO DE FORMACIÓN PROFESIONAL S.C.",
    logo_path: "/assets/campus-frontera.jpg",
    director_name: "RESPONSABLE DE CONTROL ESCOLAR",
    footer_text: "Documento emitido por Control Escolar.",
    primary_color: "#17324D",
    secondary_color: "#0F766E"
  };
}

function normalizedPaymentBody(body: any) {
  const folio = cleanText(body.folio, 80).toUpperCase();
  const amount = asNumber(body.amount, "Monto");
  if (!folio) throw new ApiError(400, "El folio es obligatorio.");
  if (amount <= 0) throw new ApiError(400, "El monto debe ser mayor a cero.");
  const concept = cleanText(body.concept || "Colegiatura", 120) || "Colegiatura";
  const requestedConceptType = cleanText(body.conceptType, 30).toLowerCase();
  const conceptType = (["tuition", "enrollment", "reenrollment", "other"] as const).includes(requestedConceptType as any)
    ? requestedConceptType as "tuition" | "enrollment" | "reenrollment" | "other"
    : conceptTypeFromText(concept);
  let registrationPeriodNumber: number | null = null;
  if (conceptType === "enrollment" || conceptType === "reenrollment") {
    const input = body.registrationPeriodNumber;
    if (input !== "" && input != null) {
      const number = Number(input);
      if (!Number.isInteger(number) || number < 1 || number > 20) throw new ApiError(400, "El semestre de inscripción debe estar entre 1 y 20.");
      registrationPeriodNumber = number;
    } else registrationPeriodNumber = registrationPeriodFromConcept(concept) ?? (conceptType === "enrollment" ? 1 : null);
  }
  const coveredMonth = conceptType === "tuition" ? validCoveredMonth(body.coveredMonth) : null;
  const coveredThroughMonth = conceptType === "tuition" ? validCoveredMonth(body.coveredThroughMonth) : null;
  if (coveredThroughMonth && (!coveredMonth || coveredThroughMonth < coveredMonth)) throw new ApiError(400, "El último mes cubierto debe ser igual o posterior al primero.");
  if (coveredMonth && coveredThroughMonth && monthDistance(coveredMonth, coveredThroughMonth) > 119) throw new ApiError(400, "Selecciona como máximo 120 meses de cobertura por recibo.");
  return {
    folio,
    amount,
    paidAt: validDate(body.paidAt, "Fecha de pago"),
    paymentMethod: optionalText(body.paymentMethod, 80),
    concept,
    conceptType,
    coveredMonth,
    coveredThroughMonth,
    registrationPeriodNumber,
    notes: normalizePhysicalFolio(body.notes)
  };
}

function monthDistance(first: string, last: string) {
  return (Number(last.slice(0,4))-Number(first.slice(0,4)))*12 + Number(last.slice(5))-Number(first.slice(5));
}
function syncTuitionChargePayment(args: {
  studentId: number;
  enrollmentId: number | null;
  paymentId: number;
  amount: number;
  coveredMonth: string | null;
  coveredThroughMonth?: string | null;
  paidAt: string;
  notes: string | null;
  userId: number;
}) {
  if (!args.coveredMonth) return;
  const count = args.coveredThroughMonth ? monthDistance(args.coveredMonth,args.coveredThroughMonth)+1 : 1;
  if (Math.round(args.amount*100) < count) throw new ApiError(400, "El importe no alcanza para distribuir al menos un centavo por mes cubierto.");
  for (let index=0;index<count;index++) {
    const month = addBillingMonths(args.coveredMonth,index);
    const dueDate = `${month}-10`;
    const cents = Math.round(args.amount*100), allocated = (Math.floor(cents/count)+(index<cents%count?1:0))/100;
    run(
      `INSERT INTO student_tuition_charges(student_id, enrollment_id, billing_month, due_date, amount, status,
       payment_id, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)
       ON CONFLICT(student_id, billing_month) DO UPDATE SET enrollment_id = excluded.enrollment_id,
       due_date = COALESCE(student_tuition_charges.due_date, excluded.due_date), amount = excluded.amount,
       status = 'paid', payment_id = excluded.payment_id, notes = excluded.notes, updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
      args.studentId,
      args.enrollmentId,
      month,
      dueDate,
      allocated,
      args.paymentId,
      args.notes,
      args.userId,
      args.userId
    );
  }
}

function unlinkTuitionChargePayment(paymentId: number) {
  run(
    `UPDATE student_tuition_charges SET status = 'pending', payment_id = NULL,
     updated_at = CURRENT_TIMESTAMP WHERE payment_id = ?`,
    paymentId
  );
}

/** Remove the receipt and its financial links together, keeping any other real payments. */
function deletePaymentRecord(id: number, req: AuthenticatedRequest) {
  return transaction(() => {
    const payment = get<{student_id:number;folio:string;amount:number;notes:string|null}>("SELECT * FROM student_payments WHERE id = ?", id);
    if (!payment) throw new ApiError(404, "El pago ya no existe.");
    const charges = all<{student_id:number;billing_month:string}>(
      "SELECT student_id,billing_month FROM student_tuition_charges WHERE payment_id = ?", id);
    const registrations = all("SELECT * FROM student_registration_status WHERE payment_id = ?", id);
    unlinkTuitionChargePayment(id);
    // ON DELETE SET NULL alone leaves a paid manual receipt that reappears in Folios.
    run("DELETE FROM student_registration_status WHERE payment_id = ?", id);
    run("DELETE FROM student_payments WHERE id = ?", id);
    for (const charge of charges) {
      const remaining = get<{id:number;enrollment_id:number|null;amount:number;paid_at:string;notes:string|null;covered_month:string;covered_through_month:string|null}>(
        `SELECT id,enrollment_id,amount,paid_at,notes,covered_month,covered_through_month FROM student_payments
         WHERE student_id = ? AND covered_month <= ? AND COALESCE(covered_through_month,covered_month) >= ?
           AND concept_type = 'tuition' AND payment_kind = 'receipt'
         ORDER BY paid_at DESC,id DESC LIMIT 1`, charge.student_id, charge.billing_month, charge.billing_month);
      const totalMonths = remaining ? monthDistance(remaining.covered_month,remaining.covered_through_month||remaining.covered_month)+1 : 1;
      const cents = Math.round((remaining?.amount||0)*100);
      const allocated = (Math.floor(cents/totalMonths)+(remaining&&monthDistance(remaining.covered_month,charge.billing_month)<cents%totalMonths?1:0))/100;
      if (remaining) syncTuitionChargePayment({ studentId: charge.student_id, enrollmentId: remaining.enrollment_id,
        paymentId: remaining.id, amount: allocated, coveredMonth: charge.billing_month,
        paidAt: remaining.paid_at, notes: remaining.notes, userId: req.user!.id });
      else run("UPDATE student_tuition_charges SET notes = NULL,updated_by = ? WHERE student_id = ? AND billing_month = ?",
        req.user!.id, charge.student_id, charge.billing_month);
    }
    logActivity(req, "delete", "student_payments", id, { ...payment, registrations });
    return payment.student_id;
  });
}

function reportRows(month: string, groupId?: number) {
  const params: Array<string | number> = [month];
  const clauses = ["sp.payment_kind = 'receipt'", "substr(sp.paid_at, 1, 7) = ?"];
  if (groupId) {
    clauses.push("e.group_id = ?");
    params.push(groupId);
  }
  return all<any>(
    `SELECT COALESCE(sp.notes, '') AS folio, sp.paid_at, sp.amount, sp.payment_method, sp.concept,
     st.student_number,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     p.name AS program_name, g.name AS group_name, ap.name AS plan_name
     FROM student_payments sp
     JOIN students st ON st.id = sp.student_id
     LEFT JOIN enrollments e ON e.id = sp.enrollment_id
     LEFT JOIN programs p ON p.id = e.program_id
     LEFT JOIN groups g ON g.id = e.group_id
     LEFT JOIN academic_plans ap ON ap.id = sp.plan_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY sp.paid_at, sp.folio`,
    ...params
  );
}

type RegisteredPhysicalFolio = {
  id: number; physical_folio: string; paid_at: string; concept: string;
  amount: number; payment_method: string | null; internal_folio: string | null;
  student_id: number; student_number: string; student_name: string;
  group_name: string | null; source: string; covered_months?: string;
};
function registeredPhysicalFolios(from?:unknown) {
  // Listado consolidado: los registros manuales con pago asociado ya están en student_payments.
  const recorded = all<RegisteredPhysicalFolio>(`
    SELECT sp.id,sp.notes AS physical_folio,sp.paid_at,sp.concept,sp.amount,sp.payment_method,
      sp.folio AS internal_folio,st.id AS student_id,st.student_number,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name,'')) AS student_name,
      g.name AS group_name,'payment' AS source
    FROM student_payments sp
    JOIN students st ON st.id=sp.student_id
    LEFT JOIN enrollments e ON e.id=sp.enrollment_id
    LEFT JOIN groups g ON g.id=e.group_id
    WHERE sp.payment_kind='receipt' AND sp.notes IS NOT NULL AND TRIM(sp.notes)<>''
    UNION ALL
    SELECT -srs.id AS id,srs.physical_folio,srs.paid_at,
      CASE WHEN srs.period_number=1 THEN 'Inscripción manual'
        ELSE 'Reinscripción manual' END AS concept,srs.amount,
      'Registro manual en Alumnos' AS payment_method,NULL AS internal_folio,
      st.id AS student_id,st.student_number,
      TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name,'')) AS student_name,
      g.name AS group_name,'registration' AS source
    FROM student_registration_status srs
    JOIN enrollments e ON e.id=srs.enrollment_id
    JOIN students st ON st.id=e.student_id
    LEFT JOIN groups g ON g.id=e.group_id
    WHERE srs.status='paid' AND srs.payment_id IS NULL
      AND srs.physical_folio IS NOT NULL AND TRIM(srs.physical_folio)<>''
  `);
  const first = from ? normalizePhysicalFolio(from) : null;
  return recorded.filter(row => /^\d+$/.test(String(row.physical_folio ?? "")) && /[1-9]/.test(row.physical_folio))
    .map(row => ({...row,physical_folio:normalizePhysicalFolio(row.physical_folio),covered_months:row.source==="payment"?all<{billing_month:string}>(
      "SELECT billing_month FROM student_tuition_charges WHERE payment_id=? ORDER BY billing_month",row.id).map(item=>item.billing_month).join(", "):""}))
    .filter(row => !first || comparePhysicalFolios(row.physical_folio,first)>=0)
    .sort((a,b)=>comparePhysicalFolios(a.physical_folio,b.physical_folio) || a.paid_at.localeCompare(b.paid_at) || a.id-b.id);
}
paymentsRouter.get("/folios", requirePermission("payments.view"), (req, res) => {
  const folios = registeredPhysicalFolios(req.query.from);
  const excludedCoverageCount=get<{total:number}>("SELECT COUNT(*) AS total FROM student_payments WHERE payment_kind='coverage'")!.total;
  res.json({total:folios.length,folios,excludedCoverageCount});
});
paymentsRouter.get("/folios/export", requirePermission("payments.export"), (req, res) => {
  const folios=registeredPhysicalFolios(req.query.from);
  if(req.query.format==="pdf") return sendFolioReport(res,folios,req.query.from?normalizePhysicalFolio(req.query.from):null);
  const rows=folios.map(row => ({
    "Folio físico":row.physical_folio,"Fecha":row.paid_at,"Matrícula":row.student_number,
    "Alumno":row.student_name,"Grupo":row.group_name??"","Concepto":row.concept,
    "Método":row.payment_method??"","Monto":row.amount,"Folio interno":row.internal_folio??"","Meses cubiertos":row.covered_months??""
  }));
  const headers=Object.keys(rows[0]??{"Folio físico":"","Fecha":"","Matrícula":"","Alumno":"","Grupo":"","Concepto":"","Método":"","Monto":"","Folio interno":""});
  sendCsv(res,"folios-de-pago.csv",headers,rows.map(row=>headers.map(header=>row[header as keyof typeof row])));
});
paymentsRouter.delete("/folios/:source/:id", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Registro de folio");
  if (req.params.source === "payment") {
    deletePaymentRecord(id, req);
  } else if (req.params.source === "registration") {
    transaction(() => {
      const registration = get<{payment_id:number|null;status:string}>("SELECT * FROM student_registration_status WHERE id = ?", id);
      if (!registration) throw new ApiError(404, "El registro de folio ya no existe.");
      if (registration.payment_id || registration.status !== "paid") throw new ApiError(409, "El registro cambió. Actualiza los folios antes de eliminarlo.");
      run("DELETE FROM student_registration_status WHERE id = ?", id);
      logActivity(req, "delete", "student_registration_status", id, registration);
    });
  } else {
    throw new ApiError(400, "El tipo de registro de folio no es válido.");
  }
  res.status(204).end();
});

paymentsRouter.get("/students", requirePermission("payments.view"), (req, res) => {
  const search = cleanText(req.query.search, 120);
  const groupId = req.query.groupId ? asId(req.query.groupId, "Grupo") : null;
  const like = `%${search}%`;
  res.json({
    records: all(
      `SELECT st.id, st.student_number,
       TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS name,
       p.name AS program_name, g.name AS group_name, sh.name AS shift_name,
       ap.name AS plan_name, ap.tuition_amount
       FROM students st
       JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
       JOIN programs p ON p.id = e.program_id
       JOIN groups g ON g.id = e.group_id
       JOIN shifts sh ON sh.id = e.shift_id
       LEFT JOIN academic_plans ap ON ap.id = e.plan_id
       WHERE st.is_active = 1 AND (? IS NULL OR e.group_id = ?) AND (? = '' OR st.student_number LIKE ? OR
         TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) LIKE ?)
       ORDER BY spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name) LIMIT 20`,
      groupId,
      groupId,
      search,
      like,
      like
    )
  });
});

paymentsRouter.get("/template/import.xlsx", requirePermission("payments.manage"), (_req, res) => {
  return sendWorkbook(res, "plantilla-pagos.xlsx", "Pagos", [{
    Matricula: "0825AMRLEESC",
    "Numero de folio fisico": "0001",
    Fecha: "2026-07-08",
    "Mes colegiatura": "2026-07",
    Monto: 1500,
    Metodo: "Transferencia",
    Concepto: "Colegiatura"
  }, {
    Matricula: "0825AMRLEESC",
    "Numero de folio fisico": "0002",
    Fecha: "2026-08-08",
    "Mes colegiatura": "2026-08",
    Monto: 1500,
    Metodo: "Efectivo",
    Concepto: "Colegiatura"
  }]);
});

paymentsRouter.post("/import/preview", requirePermission("payments.manage"), upload.single("file"), (req: AuthenticatedRequest, res) => {
  if (!req.file) throw new ApiError(400, "Selecciona un archivo.");
  const rows = parseWorkbook(req.file.buffer);
  if (!rows.length) throw new ApiError(400, "El archivo no contiene filas.");
  if (rows.length > 3000) throw new ApiError(400, "El archivo excede el limite de 3,000 filas.");
  const valid: PaymentImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  rows.forEach((source, index) => {
    const rowNumber = index + 2;
    const studentNumber = value(source, "Matricula", "MatrÃ­cula");
    const physicalFolioInput = value(source, "Numero de folio fisico", "Número de folio físico", "Folio fisico", "Folio", "Recibo", "Referencia");
    const paidAtInput = value(source, "Fecha de pago", "Fecha");
    const amountInput = value(source, "Monto", "Importe");
    if (!studentNumber || !physicalFolioInput || !paidAtInput || amountInput === "") {
      errors.push({ row: rowNumber, message: "Faltan matrícula, número de folio físico, fecha o monto." });
      return;
    }
    let originalFolio = "";
    try {
      originalFolio = normalizePhysicalFolio(physicalFolioInput);
    } catch {
      errors.push({ row: rowNumber, message: "El número de folio físico debe contener dígitos y ser mayor que cero." });
      return;
    }
    const amount = parseAmount(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ row: rowNumber, message: "El monto debe ser numerico y mayor a cero." });
      return;
    }
    let paidAt = "";
    try {
      paidAt = validDate(paidAtInput, "Fecha de pago");
    } catch {
      errors.push({ row: rowNumber, message: "La fecha debe estar en formato AAAA-MM-DD." });
      return;
    }
    const account = get<StudentAccount>(
      `SELECT e.id AS enrollmentId, e.student_id AS studentId, e.plan_id AS planId,
       p.duration_periods AS durationPeriods, ap.tuition_amount AS tuitionAmount,
       e.enrolled_at AS enrolledAt, COALESCE(e.tuition_start_date, sc.start_date) AS billingStartDate,
       e.tuition_due_day AS tuitionDueDay, st.student_number,
       TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
       st.email, p.name AS program_name, g.name AS group_name, sh.name AS shift_name,
       sc.name AS cycle_name, period.name AS current_period, ap.name AS plan_name,
       ap.code AS plan_code, l.name AS level_name
       FROM students st
       JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
       JOIN programs p ON p.id = e.program_id
       LEFT JOIN academic_levels l ON l.id = p.level_id
       JOIN groups g ON g.id = e.group_id
       JOIN shifts sh ON sh.id = e.shift_id
       JOIN school_cycles sc ON sc.id = e.cycle_id
       LEFT JOIN curricular_periods period ON period.id = e.curricular_period_id
       LEFT JOIN academic_plans ap ON ap.id = e.plan_id
       WHERE st.student_number = ? AND st.is_active = 1
       ORDER BY e.id DESC LIMIT 1`,
      studentNumber
    );
    if (!account) {
      errors.push({ row: rowNumber, message: "No se encontro alumno activo con esa matricula." });
      return;
    }
    const folio = uniqueImportFolio(studentNumber, originalFolio, paidAt, rowNumber);
    const paymentMethod = optionalText(value(source, "Metodo", "MÃ©todo", "Método", "Forma de pago"), 80);
    const concept = cleanText(value(source, "Concepto") || "Colegiatura", 120) || "Colegiatura";
    const conceptType = conceptTypeFromText(concept);
    const monthInput = value(source, "Mes", "Mes colegiatura", "Colegiatura mes");
    // Spreadsheet readers may format a YYYY-MM CSV cell as a first-of-month date.
    const coveredMonth = conceptType === "tuition" ? validCoveredMonth(monthInput && !/^\d{4}-\d{2}$/.test(monthInput)
      ? validDate(monthInput,"Mes de colegiatura").slice(0,7) : monthInput) : null;
    const registrationPeriodInput = value(source, "Semestre inscripción", "Semestre reinscripción", "Semestre", "Periodo inscripción");
    const registrationPeriodNumber = conceptType === "enrollment" || conceptType === "reenrollment"
      ? Number(registrationPeriodInput || registrationPeriodFromConcept(concept) || (conceptType === "enrollment" ? 1 : 0)) || null
      : null;
    const notes = originalFolio;
    const draft: PaymentImportRow = {
      row: rowNumber,
      studentId: account.studentId,
      studentNumber,
      studentName: account.student_name,
      folio,
      originalFolio,
      amount,
      paidAt,
      paymentMethod,
      concept,
      conceptType,
      coveredMonth,
      registrationPeriodNumber,
      notes,
      existingPaymentId: null
    };
    draft.existingPaymentId = existingPaymentForImport(draft);
    valid.push(draft);
  });
  const previewId = crypto.randomUUID();
  paymentPreviews.set(previewId, { createdAt: Date.now(), valid, errors });
  logActivity(req, "preview-import", "student_payments", previewId, { total: rows.length, valid: valid.length, errors: errors.length });
  res.json({
    previewId,
    summary: { total: rows.length, valid: valid.length, errors: errors.length, existing: valid.filter((row) => row.existingPaymentId).length },
    rows: valid.slice(0, 150),
    errors: errors.slice(0, 150)
  });
});

paymentsRouter.post("/import/apply", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const previewId = String(req.body.previewId ?? "");
  const preview = paymentPreviews.get(previewId);
  if (!preview || Date.now() - preview.createdAt > 15 * 60 * 1000) throw new ApiError(400, "La vista previa expiro. Carga el archivo de nuevo.");
  const updateExisting = req.body.existingMode === "update";
  let created = 0;
  let updated = 0;
  let ignored = 0;
  transaction(() => {
    preview.valid.forEach((item) => {
      const account = getStudentAccount(item.studentId);
      if (!account) {
        ignored++;
        return;
      }
      const existingPaymentId = item.existingPaymentId ?? existingPaymentForImport(item);
      if (existingPaymentId) {
        if (!updateExisting) {
          ignored++;
          return;
        }
        const previousRange = get<{covered_month:string|null;covered_through_month:string|null}>("SELECT covered_month,covered_through_month FROM student_payments WHERE id=?",existingPaymentId);
        const through = item.conceptType === "tuition" && previousRange?.covered_month === item.coveredMonth ? previousRange.covered_through_month : null;
        run(
          `UPDATE student_payments SET student_id = ?, enrollment_id = ?, plan_id = ?, folio = ?, amount = ?, paid_at = ?,
           payment_method = ?, concept = ?, concept_type = ?, covered_month = ?, registration_period_number = ?, notes = ?, updated_by = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          item.studentId,
          account.enrollmentId,
          account.planId,
          item.folio,
          item.amount,
          item.paidAt,
          item.paymentMethod,
          item.concept,
          item.conceptType,
          item.coveredMonth,
          item.registrationPeriodNumber,
          item.notes,
          req.user!.id,
          existingPaymentId
        );
        run("UPDATE student_payments SET covered_through_month=? WHERE id=?",through,existingPaymentId);
        unlinkTuitionChargePayment(existingPaymentId);
        if (item.conceptType === "tuition") {
          syncTuitionChargePayment({
            studentId: item.studentId,
            enrollmentId: account.enrollmentId,
            paymentId: existingPaymentId,
            amount: item.amount,
            coveredMonth: item.coveredMonth,
            coveredThroughMonth: through,
            paidAt: item.paidAt,
            notes: item.notes,
            userId: req.user!.id
          });
        } else {
          unlinkTuitionChargePayment(existingPaymentId);
        }
        updated++;
        return;
      }
      const inserted = run(
        `INSERT INTO student_payments(student_id, enrollment_id, plan_id, folio, amount, paid_at,
         payment_method, concept, concept_type, covered_month, registration_period_number, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.studentId,
        account.enrollmentId,
        account.planId,
        item.folio,
        item.amount,
        item.paidAt,
        item.paymentMethod,
        item.concept,
        item.conceptType,
        item.coveredMonth,
        item.registrationPeriodNumber,
        item.notes,
        req.user!.id,
        req.user!.id
      );
      if (item.conceptType === "tuition") {
        syncTuitionChargePayment({
          studentId: item.studentId,
          enrollmentId: account.enrollmentId,
          paymentId: Number(inserted.lastInsertRowid),
          amount: item.amount,
          coveredMonth: item.coveredMonth,
          paidAt: item.paidAt,
          notes: item.notes,
          userId: req.user!.id
        });
      }
      created++;
    });
  });
  paymentPreviews.delete(previewId);
  logActivity(req, "apply-import", "student_payments", previewId, { created, updated, ignored });
  res.json({ created, updated, ignored, errors: preview.errors.length });
});

paymentsRouter.post("/billing-config/group", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const groupId = asId(req.body.groupId, "Grupo");
  const startDate = validDate(req.body.startDate, "Inicio de cobro");
  const dueDay = validDueDay(req.body.dueDay);
  const result = run(
    `UPDATE enrollments SET tuition_start_date = ?, tuition_due_day = ?
     WHERE group_id = ? AND is_active = 1`,
    startDate,
    dueDay,
    groupId
  );
  logActivity(req, "update-group-billing-config", "enrollments", groupId, { startDate, dueDay, count: Number(result.changes) });
  res.json({ count: Number(result.changes), startDate, dueDay });
});

paymentsRouter.patch("/student/:id/billing-config", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const studentId = asId(req.params.id, "Alumno");
  const startDate = validDate(req.body.startDate, "Inicio de cobro");
  const dueDay = validDueDay(req.body.dueDay);
  run(
    `UPDATE enrollments SET tuition_start_date = ?, tuition_due_day = ?
     WHERE student_id = ? AND is_active = 1`,
    startDate,
    dueDay,
    studentId
  );
  logActivity(req, "update-student-billing-config", "enrollments", studentId, { startDate, dueDay });
  res.json(fullAccount(studentId));
});

paymentsRouter.get("/tuition-grid", requirePermission("tuition.manage"), (req, res) => {
  const groupId = req.query.groupId ? asId(req.query.groupId, "Grupo") : null;
  const startMonth = validMonth(req.query.startMonth || req.query.month || currentMonth());
  const months = semesterMonths(startMonth, req.query.months);
  const students = all<any>(
    `SELECT st.id AS studentId, st.student_number, TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     e.id AS enrollmentId, g.name AS group_name, COALESCE(ap.tuition_amount, 0) AS tuition_amount
     FROM students st
     JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
     JOIN groups g ON g.id = e.group_id
     LEFT JOIN academic_plans ap ON ap.id = e.plan_id
     WHERE st.is_active = 1 AND (? IS NULL OR e.group_id = ?)
     ORDER BY g.name, spanish_sort(st.last_name), spanish_sort(COALESCE(st.second_last_name, '')), spanish_sort(st.first_name)`,
    groupId,
    groupId
  );
  const placeholders = months.map(() => "?").join(", ");
  const charges = all<any>(
    `SELECT id, student_id, billing_month, amount, status, payment_id, notes
     FROM student_tuition_charges WHERE billing_month IN (${placeholders})`,
    ...months
  );
  res.json({
    startMonth,
    months,
    records: students.map((student) => {
      return {
        ...student,
        months: months.map((month) => {
          const charge = charges.find((item) => item.student_id === student.studentId && item.billing_month === month);
          return {
            month,
            chargeId: charge?.id ?? null,
            amount: Number(charge?.amount ?? student.tuition_amount ?? 0),
            paid: charge?.status === "paid",
            status: charge?.status ?? "pending",
            notes: charge?.notes ?? ""
          };
        })
      };
    })
  });
});

paymentsRouter.patch("/tuition-grid", requirePermission("tuition.manage"), (req: AuthenticatedRequest, res) => {
  const startMonth = validMonth(req.body.startMonth || req.body.month || currentMonth());
  const months = Array.isArray(req.body.months)
    ? req.body.months.map((item: unknown) => validMonth(item))
    : semesterMonths(startMonth, req.body.monthsCount);
  const rows: Array<{
    studentId: unknown;
    months?: Array<{ month: unknown; amount?: unknown; paid?: unknown; notes?: unknown }>;
  }> = Array.isArray(req.body.rows) ? req.body.rows : [];
  let updated = 0;
  transaction(() => {
    rows.forEach((row) => {
      const studentId = asId(row.studentId, "Alumno");
      const account = getStudentAccount(studentId);
      if (!account) return;
      const rowMonths = Array.isArray(row.months) ? row.months : [];
      months.forEach((month: string) => {
        const cell = rowMonths.find((item) => validMonth(item.month) === month);
        if (!cell) return;
        const amount = Number(cell.amount ?? account.tuitionAmount ?? 0);
        if (!Number.isFinite(amount) || amount < 0) throw new ApiError(400, "El monto de colegiatura no es valido.");
        const paid = Boolean(cell.paid);
        const existing = get<{payment_id:number|null;payment_kind:string|null}>(
          `SELECT tc.payment_id,sp.payment_kind FROM student_tuition_charges tc
           LEFT JOIN student_payments sp ON sp.id=tc.payment_id
           WHERE tc.student_id=? AND tc.billing_month=?`,studentId,month);
        if (!paid && existing?.payment_kind === "receipt") throw new ApiError(409,
          "Este mes está cubierto por un ingreso registrado. Corrige el recibo en Folios o Cobros; la tabla no elimina ingresos de caja.");
        const paymentId = paid ? existing?.payment_id ?? null : null;
        run(
          `INSERT INTO student_tuition_charges(student_id, enrollment_id, billing_month, due_date, amount, status,
           payment_id, notes, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_id, billing_month) DO UPDATE SET enrollment_id = excluded.enrollment_id,
           due_date = excluded.due_date, amount = excluded.amount, status = excluded.status,
           payment_id = excluded.payment_id, notes = excluded.notes, updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
          studentId,
          account.enrollmentId,
          month,
          `${month}-10`,
          amount,
          paid ? "paid" : "pending",
          paymentId,
          optionalText(cell.notes, 800),
          req.user!.id,
          req.user!.id
        );
        updated++;
      });
    });
  });
  logActivity(req, "update-tuition-grid", "student_tuition_charges", startMonth, { updated, months });
  res.json({ startMonth, months, updated });
});

paymentsRouter.get("/overview", requirePermission("payments.view"), (req, res) => {
  const month = validMonth(req.query.month);
  const groupId = req.query.groupId ? asId(req.query.groupId, "Grupo") : undefined;
  const records = reportRows(month, groupId);
  const groups = records.reduce<Record<string, { groupName: string; count: number; amount: number }>>((map, row) => {
    const key = row.group_name ?? "Sin grupo";
    map[key] ??= { groupName: key, count: 0, amount: 0 };
    map[key].count += 1;
    map[key].amount += Number(row.amount);
    return map;
  }, {});
  res.json({
    month,
    summary: {
      count: records.length,
      amount: Number(records.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2))
    },
    groups: Object.values(groups).map((group) => ({ ...group, amount: Number(group.amount.toFixed(2)) }))
  });
});

paymentsRouter.get("/student/:id", requirePermission("payments.view"), (req, res) => {
  const throughMonth = req.query.throughMonth ? validMonth(req.query.throughMonth) : undefined;
  res.json(fullAccount(asId(req.params.id, "Alumno"), throughMonth));
});

paymentsRouter.get("/student/:id/statement", requirePermission("payments.export"), async (req: AuthenticatedRequest, res) => {
  const throughMonth = req.query.throughMonth ? validMonth(req.query.throughMonth) : undefined;
  const studentId = asId(req.params.id, "Alumno");
  const data = fullAccount(studentId, throughMonth);
  const format = cleanText(req.query.format || "pdf", 10).toLowerCase();
  if (!["pdf", "xlsx"].includes(format)) throw new ApiError(400, "El formato del estado de cuenta debe ser PDF o XLSX.");
  const settings = statementSettings();
  const cycle = get<{name:string}>(`SELECT sc.name FROM enrollments e JOIN groups g ON g.id = e.group_id
    JOIN institution_settings i ON i.id = 1 JOIN school_cycles sc ON sc.id = COALESCE(g.active_cycle_id, i.active_cycle_id, e.cycle_id)
    WHERE e.student_id = ? AND e.is_active = 1 ORDER BY e.id DESC LIMIT 1`, studentId);
  if (cycle) data.student.cycle_name = cycle.name;
  const issued = await issueDocument("account_statement", studentId, req.user!.id, {
    name: data.student.student_name, number: data.student.student_number, program: data.student.program_name,
    group: data.student.group_name, shift: data.student.shift_name, semester: data.student.currentPeriodNumber,
    semesterName: data.student.current_period || "Sin semestre registrado", cycle: data.student.cycle_name
  }, { totalPaid: data.billing.summary.paidAmount, payments: data.billing.payments.map(payment => ({
    date: payment.paid_at, concept: payment.concept, amount: payment.amount,
    folio: physicalFolio(payment.notes)
  })) });
  if (format === "xlsx") return sendAccountStatementWorkbook(res, data, settings, issued);
  return sendAccountStatementPdf(res, data, settings, issued);
});

paymentsRouter.get("/report", requirePermission("payments.export"), (req, res) => {
  const month = validMonth(req.query.month);
  const groupId = req.query.groupId ? asId(req.query.groupId, "Grupo") : undefined;
  const records = reportRows(month, groupId).map((row) => ({
    Folio: row.folio,
    Fecha: row.paid_at,
    Matricula: row.student_number,
    Alumno: row.student_name,
    Grupo: row.group_name ?? "",
    Plan: row.plan_name ?? "",
    Concepto: row.concept,
    Metodo: row.payment_method ?? "",
    Monto: row.amount
  }));
  const format = cleanText(req.query.format || "pdf", 10);
  if (format === "xlsx") return sendWorkbook(res, `estado-de-cuenta-${month}.xlsx`, "Estado de cuenta", records);
  if (format === "csv") return sendCsv(res, `estado-de-cuenta-${month}.csv`, Object.keys(records[0] ?? {}), records.map((row) => Object.values(row)));
  const doc = createPdf(res, `estado-de-cuenta-${month}.pdf`, { layout: "landscape" });
  const total = records.reduce((sum, row) => sum + Number(row.Monto), 0);
  doc.fillColor("#102a43").font("Helvetica-Bold").fontSize(19).text("Estado de cuenta");
  doc.moveDown(0.2).fillColor("#627d98").font("Helvetica").fontSize(9)
    .text(`Periodo mensual: ${month}  |  Cobros: ${records.length}  |  Total: ${money(total)}`);
  doc.moveDown();
  pdfTable(doc, ["Folio", "Fecha", "Matricula", "Alumno", "Grupo", "Monto"], records.map((row) => [
    row.Folio, row.Fecha, row.Matricula, row.Alumno, row.Grupo, money(row.Monto)
  ]), [92, 72, 92, 210, 82, 82]);
  doc.end();
});

paymentsRouter.post("/", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const studentId = asId(req.body.studentId, "Alumno");
  const account = getStudentAccount(studentId);
  if (!account) throw new ApiError(404, "No se encontro una inscripcion activa para este alumno.");
  const body = normalizedPaymentBody(req.body);
  if (body.conceptType === "reenrollment") {
    const promotion = promotionEligibility(account.enrollmentId ?? -1);
    if (body.registrationPeriodNumber !== promotion.targetPeriodNumber) {
      throw new ApiError(400, `La reinscripción debe corresponder al semestre destino ${promotion.targetPeriodNumber}.`);
    }
    if (promotion.overdueMonths > 2 || !promotion.recentTwoPaymentsCovered) {
      throw new ApiError(409, "La cuenta no cumple las validaciones automáticas para registrar la reinscripción. Usa Gestión de alumnos si necesitas autorizarla manualmente.");
    }
  }
  const id = transaction(() => {
    const inserted = run(
      `INSERT INTO student_payments(student_id, enrollment_id, plan_id, folio, amount, paid_at,
       payment_method, concept, concept_type, covered_month, registration_period_number, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      studentId,
      account.enrollmentId,
      account.planId,
      body.folio,
      body.amount,
      body.paidAt,
      body.paymentMethod,
      body.concept,
      body.conceptType,
      body.coveredMonth,
      body.registrationPeriodNumber,
      body.notes,
      req.user!.id,
      req.user!.id
    );
    if (body.conceptType === "tuition") {
      syncTuitionChargePayment({
        studentId,
        enrollmentId: account.enrollmentId,
        paymentId: Number(inserted.lastInsertRowid),
        amount: body.amount,
        coveredMonth: body.coveredMonth,
        coveredThroughMonth: body.coveredThroughMonth,
        paidAt: body.paidAt,
        notes: body.notes,
        userId: req.user!.id
      });
    }
    run("UPDATE student_payments SET covered_through_month=? WHERE id=?",body.coveredThroughMonth,Number(inserted.lastInsertRowid));
    return Number(inserted.lastInsertRowid);
  });
  logActivity(req, "create", "student_payments", id, { studentId, folio: body.folio, amount: body.amount });
  res.status(201).json(fullAccount(studentId));
});

paymentsRouter.patch("/:id", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Pago");
  const current = get<{ student_id: number }>("SELECT student_id FROM student_payments WHERE id = ?", id);
  if (!current) throw new ApiError(404, "No se encontro el pago.");
  const body = normalizedPaymentBody(req.body);
  transaction(() => {
  run(
    `UPDATE student_payments SET folio = ?, amount = ?, paid_at = ?, payment_method = ?,
     concept = ?, concept_type = ?, covered_month = ?, registration_period_number = ?, notes = ?, updated_by = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    body.folio,
    body.amount,
    body.paidAt,
    body.paymentMethod,
    body.concept,
    body.conceptType,
    body.coveredMonth,
    body.registrationPeriodNumber,
    body.notes,
    req.user!.id,
    id
  );
  run("UPDATE student_payments SET covered_through_month=? WHERE id=?",body.coveredThroughMonth,id);
  unlinkTuitionChargePayment(id);
  if (body.conceptType === "tuition") {
    const account = getStudentAccount(current.student_id);
    syncTuitionChargePayment({
      studentId: current.student_id,
      enrollmentId: account?.enrollmentId ?? null,
      paymentId: id,
      amount: body.amount,
      coveredMonth: body.coveredMonth,
        coveredThroughMonth: body.coveredThroughMonth,
      paidAt: body.paidAt,
      notes: body.notes,
      userId: req.user!.id
    });
  }
  });
  logActivity(req, "update", "student_payments", id, { folio: body.folio, amount: body.amount });
  res.json(fullAccount(current.student_id));
});

paymentsRouter.delete("/:id", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Pago");
  deletePaymentRecord(id, req);
  res.status(204).end();
});
