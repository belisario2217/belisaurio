import type { Response } from "express";
import PDFDocument from "pdfkit";
import { all, get } from "../db.js";
import { ApiError } from "../utils.js";
import { institutionLogoFile } from "./institution-logo.js";

const contentLeft = 48;
const contentWidth = 516;
const contentBottom = 690;
const footerTop = 718;

type CertificateStudent = {
  id: number;
  enrollment_id: number;
  student_number: string;
  student_name: string;
  curp: string | null;
  program_name: string;
  group_name: string;
  modality: string;
  cycle_id: number;
  cycle_name: string;
  cycle_start_date: string;
  cycle_end_date: string;
  curricular_period_name: string | null;
  curricular_period_number: number | null;
  plan_id: number | null;
  plan_name: string | null;
  rvoe: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
};

type CertificateSubject = {
  subject_name: string;
  semester_number: number | null;
  subject_type: "mandatory" | "elective";
  final_score: number | null;
};

type CertificateSettings = {
  institution_name: string;
  logo_path: string | null;
  address: string | null;
  director_name: string | null;
  footer_text: string | null;
};

type CertificateCalendar = {
  activity_start: string;
  activity_end: string;
  vacation_start: string | null;
  vacation_end: string | null;
};

export type StudyCertificateData = {
  settings: CertificateSettings;
  student: CertificateStudent;
  calendar: CertificateCalendar;
  currentSubjects: CertificateSubject[];
  completedSubjects: CertificateSubject[];
  average: number | null;
};

function normalizedFilenamePart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function studyCertificateFilename(studentName: string) {
  return `CE-${normalizedFilenamePart(studentName)}-CONSTANCIA.pdf`;
}

const monthsUpper = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const monthsLower = monthsUpper.map((month) => month.toLocaleLowerCase("es-MX"));

function spanishDate(date = new Date()) {
  return `${date.getDate()} DE ${monthsUpper[date.getMonth()]} DEL ${date.getFullYear()}`;
}

function longDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day} de ${monthsUpper[month - 1][0]}${monthsLower[month - 1].slice(1)} del ${year}`;
}

function yearInSpanish(year: number) {
  const known: Record<number, string> = {
    2025: "dos mil veinticinco",
    2026: "dos mil veintiséis",
    2027: "dos mil veintisiete",
    2028: "dos mil veintiocho",
    2029: "dos mil veintinueve",
    2030: "dos mil treinta"
  };
  return known[year] ?? String(year);
}

function issuanceDate(date = new Date()) {
  return `${date.getDate()} de ${monthsLower[date.getMonth()]} de ${yearInSpanish(date.getFullYear())}`;
}

function integerInSpanish(value: number) {
  const words: Record<number, string> = { 0: "cero", 1: "uno", 2: "dos", 3: "tres", 4: "cuatro", 5: "cinco", 6: "seis", 7: "siete", 8: "ocho", 9: "nueve", 10: "diez" };
  return words[value] ?? String(value);
}

export function scoreInSpanish(score: number) {
  const rounded = Number(score.toFixed(1));
  if (Number.isInteger(rounded)) return integerInSpanish(rounded);
  const [whole, decimal] = rounded.toFixed(1).split(".").map(Number);
  return `${integerInSpanish(whole)} punto ${integerInSpanish(decimal)}`;
}

function displayScore(score: number | null) {
  if (score == null) return "-";
  const rounded = Number(score.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function modalityLabel(value: string) {
  const labels: Record<string, string> = { escolarizado: "escolarizada", semiescolarizado: "semiescolarizada", complementario: "complementaria", en_linea: "en línea" };
  return labels[value] ?? value;
}

function attendanceDays(value: string) {
  const labels: Record<string, string> = { escolarizado: "Lunes a Jueves", semiescolarizado: "Sábados", complementario: "Domingos" };
  return labels[value] ?? "los días establecidos por la institución";
}

function displayTime(value: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? "pm" : "am";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

const semesterNames = ["PRIMER", "SEGUNDO", "TERCER", "CUARTO", "QUINTO", "SEXTO", "SÉPTIMO", "OCTAVO", "NOVENO", "DÉCIMO"];

function semesterLabel(number: number | null, configuredName?: string | null) {
  if (number && semesterNames[number - 1]) return `${semesterNames[number - 1]} SEMESTRE`;
  if (configuredName?.trim()) return configuredName.trim().toUpperCase();
  return number ? `SEMESTRE ${number}` : "SEMESTRE NO REGISTRADO";
}

export function certificateProgramName(value: string) {
  return repairAcademicAccents(value).replace(/(?:\s+(?:IFOP|UNITEN))+\s*$/i, "").trim();
}

const academicAccentRepairs: Array<[RegExp, string]> = [
  [/ALIMENTACI\?N/gi, "Ó"],
  [/ANATOM\?A/gi, "Í"],
  [/ANTROPOLOG\?A/gi, "Í"],
  [/BIOESTAD\?STICA/gi, "Í"],
  [/BIOQU\?MICA/gi, "Í"],
  [/BIO\?TICA/gi, "É"],
  [/COMUNICACI\?N/gi, "Ó"],
  [/EPIDEMIOLOG\?A/gi, "Í"],
  [/ENFERMER\?A/gi, "Í"],
  [/FARMACOLOG\?A/gi, "Í"],
  [/FISIOLOG\?A/gi, "Í"],
  [/INFORM\?TICA/gi, "Á"],
  [/INGL\?S/gi, "É"],
  [/LEGISLACI\?N/gi, "Ó"],
  [/MATEM\?TICA/gi, "Á"],
  [/M\?DIC[AO]/gi, "É"],
  [/MICROBIOLOG\?A/gi, "Í"],
  [/NUTRICI\?N/gi, "Ó"],
  [/PATOLOG\?A/gi, "Í"],
  [/PARASITOLOG\?A/gi, "Í"],
  [/PSICOLOG\?A/gi, "Í"],
  [/P\?BLIC[AO]/gi, "Ú"],
  [/QUIR\?RGIC[AO]/gi, "Ú"],
  [/T\?CNIC[AO]/gi, "É"],
  [/TEOR\?A/gi, "Í"],
  [/TERAP\?UTICA/gi, "É"],
  [/TERMINOLOG\?A/gi, "Í"]
];

export function repairAcademicAccents(value: string) {
  return academicAccentRepairs.reduce(
    (text, [pattern, accent]) => text.replace(pattern, (match) => match.replace("?", match === match.toUpperCase() ? accent : accent.toLowerCase())),
    value
  );
}

function certificateCalendar(student: CertificateStudent): CertificateCalendar {
  const events = all<{ event_type: string; start_date: string; end_date: string }>(
    `SELECT event_type, start_date, end_date FROM academic_calendar_events
     WHERE is_active = 1 AND (school_cycle_id = ? OR school_cycle_id IS NULL)
     ORDER BY start_date, id`,
    student.cycle_id
  );
  const classStart = events.find((event) => event.event_type === "class_start");
  const cycleEnd = events.find((event) => event.event_type === "cycle_end");
  const vacation = events.find((event) => event.event_type === "vacation");
  return {
    activity_start: classStart?.start_date ?? student.cycle_start_date,
    activity_end: cycleEnd?.end_date ?? student.cycle_end_date,
    vacation_start: vacation?.start_date ?? null,
    vacation_end: vacation?.end_date ?? null
  };
}

function currentSubjects(student: CertificateStudent) {
  const records = all<CertificateSubject>(
    `SELECT DISTINCT s.name AS subject_name, ss.semester_number, ss.subject_type, NULL AS final_score
     FROM student_subjects ss JOIN subjects s ON s.id = ss.subject_id
     WHERE ss.student_id = ? AND ss.enrollment_id = ?
       AND ss.status IN ('pending', 'in_progress') AND ss.final_score IS NULL
       AND (? IS NULL OR ss.semester_number = ?)
       AND NOT EXISTS (
         SELECT 1 FROM grades gr JOIN subject_assignments a ON a.id = gr.assignment_id
         WHERE gr.enrollment_id = ss.enrollment_id AND a.subject_id = ss.subject_id AND gr.final_score IS NOT NULL
       )
     ORDER BY s.name`,
    student.id, student.enrollment_id, student.curricular_period_number, student.curricular_period_number
  );
  if (records.length || !student.plan_id || !student.curricular_period_number) return records;
  return all<CertificateSubject>(
    `SELECT s.name AS subject_name, ps.recommended_period AS semester_number, ps.subject_type, NULL AS final_score
     FROM plan_subjects ps JOIN subjects s ON s.id = ps.subject_id
     WHERE ps.plan_id = ? AND ps.recommended_period = ?
       AND NOT EXISTS (
         SELECT 1 FROM student_subjects ss
         WHERE ss.student_id = ? AND ss.subject_id = ps.subject_id
           AND (ss.status = 'completed' OR ss.final_score IS NOT NULL)
       )
       AND NOT EXISTS (
         SELECT 1 FROM grades gr JOIN subject_assignments a ON a.id = gr.assignment_id
         WHERE gr.enrollment_id = ? AND a.subject_id = ps.subject_id AND gr.final_score IS NOT NULL
       )
     ORDER BY s.name`,
    student.plan_id, student.curricular_period_number, student.id, student.enrollment_id
  );
}

function completedSubjects(student: CertificateStudent) {
  return all<CertificateSubject>(
    `WITH grade_summary AS (
       SELECT a.subject_id, ROUND(AVG(gr.final_score), 1) AS final_score
       FROM grades gr JOIN subject_assignments a ON a.id = gr.assignment_id
       WHERE gr.enrollment_id = ? AND gr.final_score IS NOT NULL GROUP BY a.subject_id
     ), curricular AS (
       SELECT ss.subject_id, s.name AS subject_name, ss.semester_number, ss.subject_type,
        COALESCE(ss.final_score, gs.final_score) AS final_score
       FROM student_subjects ss JOIN subjects s ON s.id = ss.subject_id
       LEFT JOIN grade_summary gs ON gs.subject_id = ss.subject_id
       WHERE ss.student_id = ?
        AND (ss.status = 'completed' OR ss.final_score IS NOT NULL OR gs.final_score IS NOT NULL)
     ), grade_only AS (
       SELECT s.id AS subject_id, s.name AS subject_name, COALESCE(ps.recommended_period, 1) AS semester_number,
        COALESCE(ps.subject_type, 'mandatory') AS subject_type, gs.final_score
       FROM grade_summary gs JOIN subjects s ON s.id = gs.subject_id
       LEFT JOIN plan_subjects ps ON ps.plan_id = ? AND ps.subject_id = gs.subject_id
       WHERE NOT EXISTS (SELECT 1 FROM student_subjects ss WHERE ss.student_id = ? AND ss.subject_id = gs.subject_id)
     )
     SELECT subject_name, semester_number, subject_type, final_score
     FROM (
       SELECT subject_name, semester_number, subject_type, final_score FROM curricular
       UNION ALL
       SELECT subject_name, semester_number, subject_type, final_score FROM grade_only
     )
     ORDER BY COALESCE(semester_number, 999), subject_name`,
    student.enrollment_id, student.id, student.plan_id, student.id
  );
}

export function getStudyCertificateData(studentId: number): StudyCertificateData {
  const settings = get<CertificateSettings>("SELECT * FROM institution_settings WHERE id = 1");
  const student = get<CertificateStudent>(
    `SELECT st.id, e.id AS enrollment_id, st.student_number, st.curp,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name,
     p.name AS program_name, g.name AS group_name, COALESCE(g.study_modality, 'escolarizado') AS modality,
     sc.id AS cycle_id, sc.name AS cycle_name, sc.start_date AS cycle_start_date, sc.end_date AS cycle_end_date,
     cp.name AS curricular_period_name, cp.sequence AS curricular_period_number,
     COALESCE(e.plan_id, ap.id) AS plan_id, ap.name AS plan_name, ap.rvoe,
     sh.start_time AS shift_start_time, sh.end_time AS shift_end_time
     FROM students st
     JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
     JOIN programs p ON p.id = e.program_id
     JOIN groups g ON g.id = e.group_id
     JOIN school_cycles sc ON sc.id = e.cycle_id
     LEFT JOIN curricular_periods cp ON cp.id = e.curricular_period_id
     LEFT JOIN academic_plans ap ON ap.id = COALESCE(e.plan_id, (
       SELECT fallback.id FROM academic_plans fallback
       WHERE fallback.program_id = e.program_id AND fallback.is_active = 1
       ORDER BY fallback.id DESC LIMIT 1
     ))
     LEFT JOIN shifts sh ON sh.id = e.shift_id
     WHERE st.id = ? AND st.is_active = 1
     ORDER BY e.id DESC LIMIT 1`, studentId
  );
  if (!settings) throw new ApiError(500, "No existe la configuración institucional.");
  if (!student) throw new ApiError(404, "No se encontró una inscripción activa para el alumno.");

  const current = currentSubjects(student);
  const completed = completedSubjects(student);
  const scored = completed.filter((subject) => subject.final_score != null);
  const average = scored.length ? Number((scored.reduce((sum, subject) => sum + Number(subject.final_score), 0) / scored.length).toFixed(1)) : null;
  return { settings, student, calendar: certificateCalendar(student), currentSubjects: current, completedSubjects: completed, average };
}

export function certificateStudentTerm(curp: string | null) {
  if (!curp || !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp.trim().toUpperCase())) return "la persona estudiante";
  return curp.trim().toUpperCase()[10] === "M" ? "la alumna" : "el alumno";
}

function drawFirstPageHeader(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  const logo = institutionLogoFile(data.settings.logo_path);
  if (logo) doc.image(logo, 272, 18, { fit: [68, 68], align: "center", valign: "center" });
  doc.fillColor("#050505").font("Helvetica-Bold").fontSize(19)
    .text(data.settings.institution_name.toUpperCase(), 72, 92, { width: 468, align: "center" });
  doc.fontSize(12).text("CAMPUS FRONTERA", 72, 119, { width: 468, align: "center" });
  doc.fontSize(10.5).text("CONTROL ESCOLAR IFOP", 304, 153, { width: 258, align: "right" });
  doc.text("ASUNTO: CONSTANCIA DE ESTUDIOS", 270, 168, { width: 292, align: "right" });
  doc.text(`FRONTERA, CENTLA, TABASCO A; ${spanishDate()}`, 210, 183, { width: 352, align: "right" });
  doc.fontSize(11).text("A quien corresponda:", contentLeft, 216, { width: contentWidth });
  doc.font("Helvetica").text(`La que suscribe, responsable de Control Escolar de ${data.settings.institution_name}, hace constar que ${certificateStudentTerm(data.student.curp)}:`, contentLeft, 252, { width: contentWidth, align: "justify", lineGap: 2 });
  doc.font("Helvetica-Bold").fontSize(15).text(data.student.student_name.toUpperCase(), contentLeft, 305, { width: contentWidth, align: "center" });
  doc.y = 344;
}

function drawContinuationHeader(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  const logo = institutionLogoFile(data.settings.logo_path);
  if (logo) doc.image(logo, 281, 18, { fit: [50, 50], align: "center", valign: "center" });
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(15)
    .text(data.settings.institution_name.toUpperCase(), contentLeft, 70, { width: contentWidth, align: "center" });
  doc.fontSize(10).text("CAMPUS FRONTERA", contentLeft, 88, { width: contentWidth, align: "center" });
  doc.moveTo(contentLeft, 101).lineTo(564, 98).lineWidth(0.8).strokeColor("#333333").stroke();
  doc.fontSize(8.5).text(`${data.student.student_name.toUpperCase()} · ${data.student.student_number}`, contentLeft, 106, { width: contentWidth, align: "center" });
  doc.y = 130;
}

function ensurePage(doc: PDFKit.PDFDocument, data: StudyCertificateData, requiredHeight: number, continuation: () => void) {
  if (doc.y + requiredHeight <= contentBottom) return;
  doc.addPage();
  drawContinuationHeader(doc, data);
  continuation();
}

function drawCurrentTableHeader(doc: PDFKit.PDFDocument, title: string) {
  const widths = [386, 130];
  const titleY = doc.y;
  doc.rect(contentLeft, titleY, contentWidth, 20).lineWidth(0.8).strokeColor("#222222").stroke();
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(9.5).text(title, contentLeft + 4, titleY + 4, { width: contentWidth - 8, align: "center" });
  const headerY = titleY + 20;
  ["ASIGNATURA", "TIPO"].forEach((header, index) => {
    const x = contentLeft + widths.slice(0, index).reduce((sum, width) => sum + width, 0);
    doc.rect(x, headerY, widths[index], 20).lineWidth(0.8).strokeColor("#222222").stroke();
    doc.font("Helvetica-Bold").fontSize(9).text(header, x + 4, headerY + 4, { width: widths[index] - 8, align: "center" });
  });
  doc.y = headerY + 20;
}

function drawCurrentSubjects(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  const title = semesterLabel(data.student.curricular_period_number, data.student.curricular_period_name);
  drawCurrentTableHeader(doc, title);
  const records = data.currentSubjects.length ? data.currentSubjects : [{ subject_name: "Sin asignaturas vigentes registradas", semester_number: data.student.curricular_period_number, subject_type: "mandatory" as const, final_score: null }];
  const widths = [386, 130];
  records.forEach((subject) => {
    const rowHeight = Math.max(20, doc.heightOfString(subject.subject_name.toUpperCase(), { width: widths[0] - 10 }) + 8);
    ensurePage(doc, data, rowHeight, () => drawCurrentTableHeader(doc, `${title} (CONTINUACIÓN)`));
    const y = doc.y;
    const cells = [repairAcademicAccents(subject.subject_name).toUpperCase(), subject.subject_type === "elective" ? "OPTATIVA" : "OBLIGATORIA"];
    cells.forEach((cell, index) => {
      const x = contentLeft + widths.slice(0, index).reduce((sum, width) => sum + width, 0);
      doc.rect(x, y, widths[index], rowHeight).lineWidth(0.7).strokeColor("#222222").stroke();
      doc.fillColor("#111111").font("Helvetica").fontSize(8.8).text(cell, x + 5, y + 5, { width: widths[index] - 10, height: rowHeight - 7, align: index === 0 ? "left" : "center", ellipsis: true });
    });
    doc.y = y + rowHeight;
  });
}

function drawEnrollmentAndCurrentSubjects(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  const period = semesterLabel(data.student.curricular_period_number, data.student.curricular_period_name).toLocaleLowerCase("es-MX");
  const rvoe = data.student.rvoe?.trim() || "NO REGISTRADO";
  const programName = certificateProgramName(data.student.program_name);
  const startTime = displayTime(data.student.shift_start_time);
  const endTime = displayTime(data.student.shift_end_time);
  const schedule = startTime && endTime ? `, de ${startTime} a ${endTime}` : "";
  const vacation = data.calendar.vacation_start && data.calendar.vacation_end
    ? `, y un periodo vacacional del ${longDate(data.calendar.vacation_start)} al ${longDate(data.calendar.vacation_end)}`
    : "";
  doc.fillColor("#111111").font("Helvetica").fontSize(10.5).text(
    `Se encuentra actualmente ${certificateStudentTerm(data.student.curp) === "el alumno" ? "inscrito" : certificateStudentTerm(data.student.curp) === "la alumna" ? "inscrita" : "con inscripción activa"} en esta institución, en el ${period} del programa: ${programName}, en la modalidad ${modalityLabel(data.student.modality)} con RVOE: ${rvoe}, matrícula: ${data.student.student_number}, en convenio educativo con la institución denominada “Centro Universitario Tecnológico de Enfermería” (UNITEN) CCT 18PSU0074C, cumpliendo un horario de ${attendanceDays(data.student.modality)}${schedule}, con periodo de actividades del ${longDate(data.calendar.activity_start)} al ${longDate(data.calendar.activity_end)}${vacation}.`,
    contentLeft, doc.y, { width: contentWidth, align: "justify", lineGap: 2 }
  );
  doc.moveDown(0.45).text("Se detallan a continuación las asignaturas inscritas:", { width: contentWidth });
  doc.moveDown(0.55);
  drawCurrentSubjects(doc, data);
}

function drawCompletedTableHeader(doc: PDFKit.PDFDocument, title: string) {
  const widths = [396, 120];
  const titleY = doc.y;
  doc.rect(contentLeft, titleY, contentWidth, 19).lineWidth(0.8).strokeColor("#222222").stroke();
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(9.5).text(title, contentLeft + 4, titleY + 3.5, { width: contentWidth - 8, align: "center" });
  const headerY = titleY + 19;
  ["ASIGNATURA", "CALIFICACIÓN"].forEach((header, index) => {
    const x = contentLeft + widths.slice(0, index).reduce((sum, width) => sum + width, 0);
    doc.rect(x, headerY, widths[index], 19).lineWidth(0.8).strokeColor("#222222").stroke();
    doc.font("Helvetica-Bold").fontSize(9).text(header, x + 4, headerY + 3.5, { width: widths[index] - 8, align: "center" });
  });
  doc.y = headerY + 19;
}

function drawCompletedSubjects(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  doc.fillColor("#111111").font("Helvetica").fontSize(11)
    .text("Las asignaturas aprobadas en el último ciclo son las siguientes:", contentLeft, doc.y, { width: contentWidth });
  doc.moveDown(0.8);
  if (!data.completedSubjects.length) {
    doc.text("No existen asignaturas aprobadas con calificación final registrada.", { width: contentWidth });
    return;
  }
  const groups = new Map<number | null, CertificateSubject[]>();
  data.completedSubjects.forEach((subject) => {
    const key = subject.semester_number ?? null;
    groups.set(key, [...(groups.get(key) ?? []), subject]);
  });
  const widths = [396, 120];
  [...groups.entries()].forEach(([semester, subjects], groupIndex) => {
    const title = semesterLabel(semester);
    ensurePage(doc, data, 70, () => undefined);
    drawCompletedTableHeader(doc, title);
    subjects.forEach((subject) => {
      const rowHeight = Math.max(18, doc.heightOfString(subject.subject_name.toUpperCase(), { width: widths[0] - 10 }) + 7);
      ensurePage(doc, data, rowHeight, () => drawCompletedTableHeader(doc, `${title} (CONTINUACIÓN)`));
      const y = doc.y;
      const cells = [repairAcademicAccents(subject.subject_name).toUpperCase(), displayScore(subject.final_score)];
      cells.forEach((cell, index) => {
        const x = contentLeft + widths.slice(0, index).reduce((sum, width) => sum + width, 0);
        doc.rect(x, y, widths[index], rowHeight).lineWidth(0.7).strokeColor("#222222").stroke();
        doc.fillColor("#111111").font("Helvetica").fontSize(8.6).text(cell, x + 5, y + 4.5, { width: widths[index] - 10, height: rowHeight - 6, align: index === 0 ? "left" : "center", ellipsis: true });
      });
      doc.y = y + rowHeight;
    });
    if (groupIndex < groups.size - 1) doc.moveDown(0.75);
  });
}

function drawClosingAndSignature(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  ensurePage(doc, data, 140, () => undefined);
  const averageText = data.average == null ? "sin promedio general disponible" : `${displayScore(data.average)} (${scoreInSpanish(data.average)})`;
  doc.moveDown(0.85).fillColor("#111111").font("Helvetica").fontSize(10.5)
    .text(`Actualmente ${certificateStudentTerm(data.student.curp) === "el alumno" ? "el estudiante" : certificateStudentTerm(data.student.curp) === "la alumna" ? "la estudiante" : "la persona estudiante"} tiene un promedio general de ${averageText}.`, contentLeft, doc.y, { width: contentWidth });
  doc.moveDown(0.35).text(`A petición de la parte interesada se expide la presente en la ciudad de Frontera, Centla, Tabasco, a ${issuanceDate()}.`, { width: contentWidth, align: "justify", lineGap: 2 });
  const signatureY = Math.max(doc.y + 55, 600);
  doc.moveTo(188, signatureY).lineTo(424, signatureY).lineWidth(0.8).strokeColor("#111111").stroke();
  doc.fillColor("#111111").font("Helvetica").fontSize(10.5).text(data.settings.director_name || "Responsable de Control Escolar", 158, signatureY + 8, { width: 296, align: "center" });
  doc.font("Helvetica-Bold").text("Control Escolar", 158, signatureY + 24, { width: 296, align: "center" });
}

function drawFooters(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.fillColor("#B8B8B8").font("Helvetica").fontSize(7.5).text(data.settings.address || "Frontera, Centla, Tabasco", contentLeft, footerTop, { width: contentWidth, align: "center", lineBreak: false });
    doc.fontSize(8).text(data.settings.footer_text || "¡TU ESFUERZO DE HOY SERÁ EL ÉXITO DEL MAÑANA!", contentLeft, footerTop + 11, { width: contentWidth, align: "center", lineBreak: false });
    if (range.count > 1) doc.fontSize(7).text(`Página ${index - range.start + 1} de ${range.count}`, 500, footerTop + 20, { width: 64, align: "right", lineBreak: false });
  }
}

export function drawStudyCertificate(doc: PDFKit.PDFDocument, data: StudyCertificateData) {
  drawFirstPageHeader(doc, data);
  drawEnrollmentAndCurrentSubjects(doc, data);
  if (data.completedSubjects.length) {
    doc.addPage();
    drawContinuationHeader(doc, data);
  } else {
    ensurePage(doc, data, 205, () => undefined);
  }
  drawCompletedSubjects(doc, data);
  drawClosingAndSignature(doc, data);
  drawFooters(doc, data);
}

export function sendStudyCertificate(res: Response, studentId: number) {
  const data = getStudyCertificateData(studentId);
  const filename = studyCertificateFilename(data.student.student_name);
  const doc = new PDFDocument({ size: "LETTER", margin: 42, bufferPages: true, info: { Title: `Constancia de estudios - ${data.student.student_name}`, Author: data.settings.institution_name, Subject: "Constancia de estudios e historial académico" } });
  res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  doc.pipe(res);
  drawStudyCertificate(doc, data);
  doc.end();
}
