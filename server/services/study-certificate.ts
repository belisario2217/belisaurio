import type { Response } from "express";
import { get } from "../db.js";
import { getAcademicRecord } from "./academic-record.js";
import { getCycleCalendar } from "./academic-calendar.js";
import { createPdf } from "./files.js";
import { documentBranding } from "./document-branding.js";
import { issueDocument, type IssuedDocument } from "./document-verification.js";
import { drawDocumentValidation, ensureDocumentSpace, printedSubjects, publicAcademicStudent } from "./academic-documents.js";

type CertificateSettings = {
  institution_name: string; director_name: string | null;
};

export type StudyCertificateData = ReturnType<typeof getStudyCertificateData>;

function normalizedFilenamePart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function studyCertificateFilename(studentName: string) {
  return `CE-${normalizedFilenamePart(studentName)}-CONSTANCIA.pdf`;
}

const monthsUpper = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const monthsLower = monthsUpper.map((month) => month.toLocaleLowerCase("es-MX"));

function longDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day} de ${monthsUpper[month - 1][0]}${monthsLower[month - 1].slice(1)} del ${year}`;
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

export function getStudyCertificateData(studentId: number) {
  const record = getAcademicRecord(studentId, "report_card");
  const settings = get<CertificateSettings>("SELECT institution_name, director_name FROM institution_settings WHERE id = 1")!;
  return { settings, student: record.student, calendar: getCycleCalendar(record.student.cycle_id), currentSubjects: record.subjects };
}

export function certificateStudentTerm(curp: string | null) {
  if (!curp || !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp.trim().toUpperCase())) return "la persona estudiante";
  return curp.trim().toUpperCase()[10] === "M" ? "la alumna" : "el alumno";
}

export function drawStudyCertificate(doc: PDFKit.PDFDocument, data: StudyCertificateData, issued: IssuedDocument) {
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const primary = documentBranding().color;
  const heading = () => {
    doc.font("Helvetica-Bold").fontSize(18).fillColor(primary).text("CONSTANCIA DE ESTUDIOS", left, doc.y, { width });
    doc.moveDown(.25).font("Helvetica").fontSize(8).fillColor("#607086")
      .text(`CONTROL ESCOLAR · ${data.settings.institution_name.toUpperCase()} · CAMPUS FRONTERA`, left, doc.y, { width });
    doc.fontSize(7).text(`Folio institucional: ${issued.folio}`, left, doc.y, { width, align: "right" });
    doc.moveDown(.5);
  };
  heading();
  doc.on("pageAdded", heading);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#24364A").text("A QUIEN CORRESPONDA:", left, doc.y, { width });
  doc.moveDown(.7).font("Helvetica").fontSize(9.5)
    .text(`La que suscribe, responsable de Control Escolar de ${data.settings.institution_name}, hace constar que ${certificateStudentTerm(data.student.curp)}:`, left, doc.y, { width, align: "justify", lineGap: 2 });
  doc.moveDown(.55).font("Helvetica-Bold").fontSize(14).fillColor(primary)
    .text(data.student.student_name.toUpperCase(), left, doc.y, { width, align: "center" });
  doc.moveDown(.6);
  const period = semesterLabel(data.student.curricular_period_number, data.student.curricular_period_name).toLocaleLowerCase("es-MX");
  const term = certificateStudentTerm(data.student.curp);
  const registered = term === "el alumno" ? "inscrito" : term === "la alumna" ? "inscrita" : "con inscripción activa";
  const startTime = displayTime(data.student.shift_start_time), endTime = displayTime(data.student.shift_end_time);
  const schedule = startTime && endTime ? `, de ${startTime} a ${endTime}` : "";
  const paragraph = `Se encuentra actualmente ${registered} en esta institución, en el ${period} del programa ${certificateProgramName(data.student.program_name)}, en la modalidad ${modalityLabel(data.student.modality)}, con RVOE ${data.student.rvoe?.trim() || "NO REGISTRADO"}, matrícula ${data.student.student_number} y grupo ${data.student.group_name}, en convenio educativo con la institución denominada “Centro Universitario Tecnológico de Enfermería” (UNITEN), CCT 18PSU0074C. Su horario corresponde a ${attendanceDays(data.student.modality)}${schedule}.`;
  doc.font("Helvetica").fontSize(9.5).fillColor("#24364A").text(paragraph, left, doc.y, { width, align: "justify", lineGap: 2 });
  doc.moveDown(.75);
  const calendarLines = [
    `Ciclo escolar activo: ${data.student.cycle_name}`,
    `Periodo de actividades: del ${longDate(data.calendar.activity_start)} al ${longDate(data.calendar.activity_end)}.`,
    ...data.calendar.vacations.map(vacation => `Vacaciones: del ${longDate(vacation.start_date)} al ${longDate(vacation.end_date)}.`)
  ];
  if (!data.calendar.vacations.length) calendarLines.push("Sin periodos vacacionales registrados para este ciclo.");
  const calendarText = calendarLines.join("\n");
  const boxHeight = doc.fontSize(9).heightOfString(calendarText, { width: width - 24, lineGap: 3 }) + 20;
  ensureDocumentSpace(doc, boxHeight + 18);
  const calendarY = doc.y;
  doc.rect(left, calendarY, width, boxHeight).fill("#F3F6FA");
  doc.rect(left, calendarY, 3, boxHeight).fill(primary);
  doc.font("Helvetica").fontSize(9).fillColor("#24364A").text(calendarText, left + 12, calendarY + 10, { width: width - 24, lineGap: 3 });
  doc.x = left; doc.y = calendarY + boxHeight + 14;
  const tableHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, 22).fill(primary);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF").text(`ASIGNATURAS DEL ${semesterLabel(data.student.curricular_period_number)}`, left + 8, y + 7, { width: width - 16 });
    doc.x = left; doc.y = y + 22;
  };
  if (data.currentSubjects.length) {
    ensureDocumentSpace(doc, 60); tableHeader();
    for (const [index, subject] of data.currentSubjects.entries()) {
      doc.font("Helvetica").fontSize(8.5);
      const text = repairAcademicAccents(subject.subject_name);
      const height = Math.max(21, doc.heightOfString(text, { width: width - 120 }) + 10);
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) { doc.addPage(); tableHeader(); }
      const y = doc.y;
      doc.rect(left, y, width, height).fill(index % 2 ? "#F3F6FA" : "#FFFFFF");
      doc.font("Helvetica").fontSize(8.5).fillColor("#24364A").text(text, left + 8, y + 5, { width: width - 120 });
      doc.fontSize(7.5).fillColor("#607086").text(subject.subject_type === "elective" ? "OPTATIVA" : "OBLIGATORIA", left + width - 104, y + 6, { width: 96, align: "center" });
      doc.x = left; doc.y = y + height;
    }
  }
  ensureDocumentSpace(doc, 40);
  doc.moveDown(.65).font("Helvetica").fontSize(9).fillColor("#24364A")
    .text("A petición de la parte interesada, se expide la presente en Frontera, Centla, Tabasco, para los fines que estime convenientes.", left, doc.y, { width, align: "justify" });
  drawDocumentValidation(doc, issued);
  doc.removeListener("pageAdded", heading);
}

export async function sendStudyCertificate(res: Response, studentId: number, issuedBy: number) {
  const data = getStudyCertificateData(studentId);
  const issued = await issueDocument("study_certificate", studentId, issuedBy, publicAcademicStudent(data.student), {
    subjects: printedSubjects(data.currentSubjects),
    calendar: { start: data.calendar.activity_start, end: data.calendar.activity_end, vacations: data.calendar.vacations },
    notes: [`RVOE: ${data.student.rvoe?.trim() || "NO REGISTRADO"}`, `Modalidad: ${modalityLabel(data.student.modality)}`]
  });
  const doc = createPdf(res, studyCertificateFilename(data.student.student_name));
  doc.info.Title = `Constancia de estudios - ${data.student.student_name}`;
  drawStudyCertificate(doc, data, issued);
  doc.end();
}
