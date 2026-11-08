import type { Response } from "express";
import { get } from "../db.js";
import { getAcademicRecord } from "./academic-record.js";
import { getCycleCalendar, validateCycleCalendar, validCalendarDate } from "./academic-calendar.js";
import { createPdf } from "./files.js";
import { documentBranding } from "./document-branding.js";
import { issueDocument, type IssuedDocument } from "./document-verification.js";
import { drawDocumentValidation, ensureDocumentSpace, publicAcademicStudent } from "./academic-documents.js";
import { ApiError } from "../utils.js";
import { inferCertificateAuthority, planCertification, type PlanCertification } from "../../shared/plan-certification.js";
import type { StudyCertificateDraft } from "../../shared/study-certificate.js";
import { displayProgramName } from "../../shared/program-name.js";

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
  return displayProgramName(repairAcademicAccents(value));
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
  if (!record.student.assigned_plan_id) {
    const choices = get<{count:number}>("SELECT COUNT(DISTINCT certificate_authority) AS count FROM academic_plans WHERE program_id=? AND is_active=1", record.student.program_id)!.count;
    if (choices > 1) throw new ApiError(409, "Asigna el plan IFOP o UNITEN al alumno o a su grupo antes de emitir la constancia; este programa tiene planes de ambas instituciones.");
  }
  const settings = get<CertificateSettings>("SELECT institution_name, director_name FROM institution_settings WHERE id = 1")!;
  const authority = record.student.certificate_authority || inferCertificateAuthority("", "", record.student.program_name);
  const { institution, cct, collaborationAgreement } = planCertification[authority];
  const certification: PlanCertification = { authority, institution, cct, collaborationAgreement, rvoe: record.student.rvoe?.trim() || null };
  const calendar = getCycleCalendar(record.student.cycle_id), student = record.student;
  const startTime = displayTime(student.shift_start_time), endTime = displayTime(student.shift_end_time);
  const draft: StudyCertificateDraft = {
    programName: certificateProgramName(student.program_name), rvoe: certification.rvoe || "NO REGISTRADO",
    semesterName: semesterLabel(student.curricular_period_number, student.curricular_period_name).toLocaleLowerCase("es-MX"),
    modality: modalityLabel(student.modality),
    schedule: attendanceDays(student.modality) + (startTime && endTime ? `, de ${startTime} a ${endTime}` : ""),
    cycleName: student.cycle_name, startDate: calendar.activity_start, endDate: calendar.activity_end,
    vacations: calendar.vacations,
    documentDate: new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City" }).format(new Date()),
    place: "Frontera, Centla, Tabasco",
    subjectsTitle: `ASIGNATURAS DEL ${semesterLabel(student.curricular_period_number)}`,
    subjects: record.subjects.map(subject => ({ name: repairAcademicAccents(subject.subject_name), type: subject.subject_type }))
  };
  return { settings, student, certification, calendar, currentSubjects: record.subjects, draft };
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
    .text(`El que suscribe, responsable de Control Escolar de ${data.settings.institution_name}, hace constar que ${certificateStudentTerm(data.student.curp)}:`, left, doc.y, { width, align: "justify", lineGap: 2 });
  doc.moveDown(.55).font("Helvetica-Bold").fontSize(14).fillColor(primary)
    .text(data.student.student_name.toUpperCase(), left, doc.y, { width, align: "center" });
  doc.moveDown(.6);
  const paragraph = certificateParagraph(data);
  doc.font("Helvetica").fontSize(9.5).fillColor("#24364A").text(paragraph, left, doc.y, { width, align: "justify", lineGap: 2 });
  doc.moveDown(.75);
  const calendarLines = [
    `Ciclo escolar activo: ${data.draft.cycleName}`,
    `Periodo de actividades: del ${longDate(data.draft.startDate)} al ${longDate(data.draft.endDate)}.`,
    ...data.draft.vacations.map(vacation => `Vacaciones: del ${longDate(vacation.start_date)} al ${longDate(vacation.end_date)}.`)
  ];
  if (!data.draft.vacations.length) calendarLines.push("Sin periodos vacacionales registrados para este ciclo.");
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
    doc.font("Helvetica-Bold").fontSize(8);
    const height = Math.max(22, doc.heightOfString(data.draft.subjectsTitle, { width: width - 16 }) + 14);
    doc.rect(left, y, width, height).fill(primary);
    doc.fillColor("#FFFFFF").text(data.draft.subjectsTitle, left + 8, y + 7, { width: width - 16 });
    doc.x = left; doc.y = y + height;
  };
  if (data.draft.subjects.length) {
    ensureDocumentSpace(doc, 60); tableHeader();
    for (const [index, subject] of data.draft.subjects.entries()) {
      doc.font("Helvetica").fontSize(8.5);
      const text = subject.name;
      const height = Math.max(21, doc.heightOfString(text, { width: width - 120 }) + 10);
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) { doc.addPage(); tableHeader(); }
      const y = doc.y;
      doc.rect(left, y, width, height).fill(index % 2 ? "#F3F6FA" : "#FFFFFF");
      doc.font("Helvetica").fontSize(8.5).fillColor("#24364A").text(text, left + 8, y + 5, { width: width - 120 });
      doc.fontSize(7.5).fillColor("#607086").text(subject.type === "elective" ? "OPTATIVA" : "OBLIGATORIA", left + width - 104, y + 6, { width: 96, align: "center" });
      doc.x = left; doc.y = y + height;
    }
  }
  ensureDocumentSpace(doc, 40);
  doc.moveDown(.65).font("Helvetica").fontSize(9).fillColor("#24364A")
    .text(certificateClosing(data), left, doc.y, { width, align: "justify" });
  drawDocumentValidation(doc, issued);
  doc.removeListener("pageAdded", heading);
}

/** Validate before issuing a folio; submitted fields apply only to this emission. */
export function applyCertificateDraft(data: StudyCertificateData, input?: unknown): StudyCertificateData {
  if (input === undefined) return data;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "Revisa los datos de la constancia.");
  const source = input as Record<string, unknown>;
  if (Object.keys(source).some(key => !Object.hasOwn(data.draft, key))) throw new ApiError(400, "La constancia contiene campos no permitidos.");
  const text = (key: keyof StudyCertificateDraft, max = 200) => {
    const value = source[key] === undefined ? data.draft[key] : source[key];
    if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
      throw new ApiError(400, `Revisa el campo ${key}: es obligatorio y admite hasta ${max} caracteres.`);
    }
    return value.trim();
  };
  const calendar = validateCycleCalendar(source.startDate ?? data.draft.startDate, source.endDate ?? data.draft.endDate, source.vacations ?? data.draft.vacations);
  const documentDate = source.documentDate ?? data.draft.documentDate;
  if (!validCalendarDate(documentDate)) throw new ApiError(400, "La fecha de la constancia debe ser una fecha real.");
  const subjects = source.subjects ?? data.draft.subjects;
  if (!Array.isArray(subjects) || subjects.length > 80) throw new ApiError(400, "El temario admite hasta 80 asignaturas.");
  const draft: StudyCertificateDraft = {
    programName: text("programName"), rvoe: text("rvoe", 100), semesterName: text("semesterName", 100),
    modality: text("modality", 100), schedule: text("schedule", 300), cycleName: text("cycleName", 100),
    startDate: calendar.start, endDate: calendar.end, vacations: calendar.vacations, documentDate,
    place: text("place"), subjectsTitle: text("subjectsTitle"),
    subjects: subjects.map(subject => {
      if (!subject || typeof subject.name !== "string" || !subject.name.trim() || subject.name.length > 200
        || /[\u0000-\u001F]/.test(subject.name) || !["mandatory", "elective"].includes(subject.type)) {
        throw new ApiError(400, "Cada asignatura requiere nombre (hasta 200 caracteres) y tipo válido.");
      }
      return { name: subject.name.trim(), type: subject.type };
    })
  };
  return { ...data, draft, certification: { ...data.certification, rvoe: draft.rvoe } };
}

export function certificateParagraph(data: StudyCertificateData) {
  const term = certificateStudentTerm(data.student.curp), draft = data.draft;
  const registered = term === "el alumno" ? "inscrito" : term === "la alumna" ? "inscrita" : "con inscripción activa";
  const recognition = data.certification.authority === "ifop"
    ? `con RVOE propio ${draft.rvoe}, CCT ${data.certification.cct}` : `con RVOE ${draft.rvoe}`;
  const agreement = data.certification.collaborationAgreement
    ? `, en convenio de colaboración con la institución denominada “Centro Universitario Tecnológico de Enfermería” (UNITEN), CCT ${data.certification.cct}` : "";
  return `Se encuentra actualmente ${registered} en esta institución, en el ${draft.semesterName} del programa ${draft.programName}, en la modalidad ${draft.modality}, ${recognition}, matrícula ${data.student.student_number} y grupo ${data.student.group_name}${agreement}. Su horario corresponde a ${draft.schedule}.`;
}

export function certificateClosing(data: StudyCertificateData) {
  return `A petición de la parte interesada, se expide la presente en ${data.draft.place}, a ${longDate(data.draft.documentDate)}, para los fines que estime convenientes.`;
}

export async function sendStudyCertificate(res: Response, studentId: number, issuedBy: number, input?: unknown, format: "pdf" | "docx" = "pdf") {
  const data = applyCertificateDraft(getStudyCertificateData(studentId), input), draft = data.draft;
  // Load Word support only on demand, keeping ordinary server startup lightweight.
  const word = format === "docx" ? await import("./study-certificate-word.js") : null;
  const issued = await issueDocument("study_certificate", studentId, issuedBy, {
    ...publicAcademicStudent(data.student), program: draft.programName, semesterName: draft.semesterName, cycle: draft.cycleName
  }, {
    certification: data.certification, certificate: draft,
    subjects: draft.subjects.map(subject => ({ code: "", name: subject.name, semester: data.student.curricular_period_number || 0,
      cycle: draft.cycleName, subjectType: subject.type, partial1: null, partial2: null, partial3: null, score: null, status: "En curso", credits: 0 })),
    calendar: { start: draft.startDate, end: draft.endDate, vacations: draft.vacations },
    notes: [`RVOE: ${draft.rvoe}`, `Modalidad: ${draft.modality}`]
  });
  if (word) {
    const buffer = await word.createStudyCertificateWord(data, issued);
    res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .setHeader("Content-Disposition", `attachment; filename="${studyCertificateFilename(data.student.student_name).replace(/\.pdf$/, ".docx")}"`)
      .send(buffer);
    return;
  }
  const doc = createPdf(res, studyCertificateFilename(data.student.student_name));
  doc.info.Title = `Constancia de estudios - ${data.student.student_name}`;
  drawStudyCertificate(doc, data, issued);
  doc.end();
}
