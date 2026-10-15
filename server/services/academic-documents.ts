import type { AcademicRecord, AcademicStudent, AcademicSubject } from "./academic-record.js";
import { documentBranding } from "./document-branding.js";
import { issuedDisplayDate, type IssuedDocument } from "./document-verification.js";
import type { OfficialDocumentSnapshot, PrintedSubject } from "../../shared/official-document.js";

export function publicAcademicStudent(student: AcademicStudent): OfficialDocumentSnapshot["student"] {
  return {
    name: student.student_name, number: student.student_number, program: student.program_name,
    group: student.group_name, shift: student.shift_name, semester: student.curricular_period_number,
    semesterName: student.curricular_period_name || `Semestre ${student.curricular_period_number}`, cycle: student.cycle_name
  };
}

export const academicStatusLabels: Record<AcademicSubject["status"], string> = {
  pending: "Pendiente", in_progress: "En curso", completed: "Cursada", passed: "Aprobada", failed: "No aprobada"
};

export function printedSubjects(subjects: AcademicSubject[]): PrintedSubject[] {
  return subjects.map(subject => ({ code: subject.subject_code, name: subject.subject_name, semester: subject.semester_number,
    subjectType: subject.subject_type,
    cycle: subject.cycle_name, partial1: subject.partial_1, partial2: subject.partial_2, partial3: subject.partial_3,
    score: subject.final_score, status: academicStatusLabels[subject.status], credits: subject.credits }));
}

/** Metadata grows with long names instead of truncating names or overlapping columns. */
export function drawAcademicHeader(doc: PDFKit.PDFDocument, student: AcademicStudent, title: string, subtitle: string) {
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const primary = documentBranding().color;
  doc.x = left;
  doc.font("Helvetica-Bold").fontSize(19).fillColor(primary).text(title.toUpperCase(), left, doc.y, { width });
  doc.moveDown(.25).font("Helvetica").fontSize(9).fillColor("#607086").text(subtitle, left, doc.y, { width });
  doc.moveDown(.8);
  const fields = [
    ["ALUMNO", student.student_name, "MATRÍCULA", student.student_number],
    ["PROGRAMA ACADÉMICO", student.program_name, "GRUPO / TURNO", `${student.group_name} · ${student.shift_name}`],
    ["SEMESTRE ACTUAL", student.curricular_period_name || `Semestre ${student.curricular_period_number}`, "CICLO ESCOLAR ACTIVO", student.cycle_name]
  ];
  for (const [label, value, rightLabel, rightValue] of fields) {
    const y = doc.y, firstWidth = width * .64, secondWidth = width - firstWidth;
    doc.font("Helvetica").fontSize(9.5);
    const rowHeight = Math.max(40, Math.max(doc.heightOfString(value, { width: firstWidth - 24 }), doc.heightOfString(rightValue, { width: secondWidth - 24 })) + 25);
    doc.rect(left, y, width, rowHeight).fill("#F3F6FA");
    for (const [x, cellWidth, fieldLabel, fieldValue] of [[left, firstWidth, label, value], [left + firstWidth, secondWidth, rightLabel, rightValue]] as const) {
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#607086").text(fieldLabel, x + 12, y + 7, { width: cellWidth - 24 });
      doc.font("Helvetica").fontSize(9.5).fillColor("#24364A").text(fieldValue, x + 12, y + 19, { width: cellWidth - 24 });
    }
    doc.y = y + rowHeight + 2;
  }
  doc.x = left; doc.y += 15;
}

export function ensureDocumentSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.x = doc.page.margins.left;
}

export function drawDocumentValidation(doc: PDFKit.PDFDocument, issued: IssuedDocument, tutor = false) {
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const signatureX = left + 115, signatureWidth = tutor ? (width - 145) / 2 : width - 140;
  doc.font("Helvetica").fontSize(8);
  const nameHeight = doc.heightOfString(issued.snapshot.institution.directorName, { width: signatureWidth });
  const captionY = Math.max(72, 53 + nameHeight), metadataY = Math.max(92, captionY + 19), blockHeight = metadataY + 24;
  ensureDocumentSpace(doc, blockHeight + 12);
  const y = Math.max(doc.y + 12, doc.page.height - doc.page.margins.bottom - blockHeight);
  const primary = documentBranding().color;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(.6).strokeColor("#D6DFEB").stroke();
  doc.image(issued.qrPng, left, y + 7, { width: 82, height: 82 });
  doc.link(left, y + 7, 82, 82, issued.verificationUrl);
  doc.moveTo(signatureX, y + 42).lineTo(signatureX + signatureWidth, y + 42).strokeColor(primary).stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#24364A").text(issued.snapshot.institution.directorName, signatureX, y + 48, { width: signatureWidth, align: "center" });
  doc.font("Helvetica-Bold").fontSize(7).text("CONTROL ESCOLAR · FIRMA Y SELLO", signatureX, y + captionY, { width: signatureWidth, align: "center" });
  if (tutor) {
    const tutorX = signatureX + signatureWidth + 20;
    doc.moveTo(tutorX, y + 42).lineTo(tutorX + signatureWidth, y + 42).stroke();
    doc.font("Helvetica").fontSize(8).text("Firma del padre, madre o tutor", tutorX, y + 48, { width: signatureWidth, align: "center" });
  }
  doc.font("Helvetica").fontSize(7).fillColor("#607086").text(`Folio: ${issued.folio} · Emisión: ${issuedDisplayDate(issued.issuedAt)}`, left, y + metadataY, { width, align: "center" });
  doc.fontSize(6.7).text("Escanea el QR para validar la emisión y cotejar los datos con el registro institucional.", left, y + metadataY + 12, { width, align: "center" });
  doc.x = left; doc.y = y + blockHeight;
}

export function drawAcademicDocument(doc: PDFKit.PDFDocument, data: AcademicRecord, issued: IssuedDocument) {
  const history = issued.snapshot.type === "academic_history";
  const studentCopy = issued.snapshot.content.purpose === "student_copy";
  const subtitle = history ? `Avance acumulado hasta el semestre ${data.student.curricular_period_number}. No incluye asignaturas de semestres posteriores.`
    : studentCopy ? "Documento informativo. No tiene valor para trámites."
    : "Resultados exclusivos del semestre actual. Documento para firma y sello de Control Escolar.";
  const heading = () => {
    drawAcademicHeader(doc, data.student, issued.snapshot.title, subtitle);
    doc.font("Helvetica").fontSize(7).fillColor("#607086").text(`Folio institucional: ${issued.folio}`, { align: "right" });
    doc.moveDown(.7);
  };
  heading();
  doc.on("pageAdded", heading);
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right;
  const primary = documentBranding().color;
  const widths = history ? [62, 238, 45, 70, 113] : [62, 238, 42, 42, 42, 52, 50];
  const scaled = widths.map(value => value * width / 528);
  const headers = history ? ["CLAVE", "ASIGNATURA", "CRÉD.", "FINAL", "ESTADO"] : ["CLAVE", "ASIGNATURA", "P1", "P2", "P3", "FINAL", "ESTADO"];
  const score = (value: number | null) => value == null ? "—" : value.toFixed(1);
  let semester = 0;
  const tableHeader = (number: number, continuation = false) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(primary).text(`SEMESTRE ${number}${continuation ? " · CONTINUACIÓN" : ""}`, left, doc.y, { width });
    doc.y += 7;
    const y = doc.y;
    doc.rect(left, y, width, 25).fill(primary);
    let x = left;
    headers.forEach((header, index) => {
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7).text(header, x + 6, y + 9, { width: scaled[index] - 12, align: index < 2 ? "left" : "center" });
      x += scaled[index];
    });
    doc.y = y + 25; doc.x = left;
  };
  data.subjects.forEach((subject, index) => {
    if (subject.semester_number !== semester) {
      ensureDocumentSpace(doc, 95);
      semester = subject.semester_number;
      if (index) doc.y += 14;
      tableHeader(semester);
    }
    const values = history ? [subject.subject_code, subject.subject_name, String(subject.credits), score(subject.final_score), academicStatusLabels[subject.status]]
      : [subject.subject_code, subject.subject_name, score(subject.partial_1), score(subject.partial_2), score(subject.partial_3), score(subject.final_score), academicStatusLabels[subject.status]];
    doc.font("Helvetica").fontSize(8);
    const height = Math.max(29, ...values.map((value, column) => doc.heightOfString(value, { width: scaled[column] - 12 }) + 14));
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) { doc.addPage(); tableHeader(semester, true); }
    const y = doc.y;
    doc.rect(left, y, width, height).fill(index % 2 ? "#F3F6FA" : "#FFFFFF");
    doc.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(.4).strokeColor("#DDE4ED").stroke();
    let x = left;
    values.forEach((value, column) => {
      doc.fillColor(subject.status === "failed" && column === values.length - 1 ? "#A32836" : "#24364A")
        .font(column === (history ? 3 : 5) ? "Helvetica-Bold" : "Helvetica").fontSize(8)
        .text(value, x + 6, y + 7, { width: scaled[column] - 12, align: column < 2 ? "left" : "center" });
      x += scaled[column];
    });
    doc.x = left; doc.y = y + height;
  });
  if (!data.subjects.length) doc.font("Helvetica").fontSize(10).fillColor("#607086").text("No hay asignaturas registradas para el semestre actual.", left, doc.y, { width });
  ensureDocumentSpace(doc, 65);
  doc.y += 18;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(primary).text(`${history ? "Promedio acumulado" : "Promedio del semestre"}: ${data.average == null ? "Pendiente" : data.average.toFixed(1)}`, left, doc.y, { width, align: "right" });
  doc.moveDown(.45).font("Helvetica").fontSize(8).fillColor("#607086").text("El promedio considera únicamente calificaciones finales registradas. Los parciales incompletos no constituyen una calificación final.", left, doc.y, { width });
  if (studentCopy) {
    ensureDocumentSpace(doc, 112);
    const y = doc.y + 12;
    doc.image(issued.qrPng, left, y, { width: 82, height: 82 });
    doc.link(left, y, 82, 82, issued.verificationUrl);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(primary).text("VALIDACIÓN DE LA BOLETA DEL ALUMNO", left + 98, y + 5, { width: width - 98 });
    doc.font("Helvetica").fontSize(8).fillColor("#24364A")
      .text(`Folio: ${issued.folio}\nEmisión: ${issuedDisplayDate(issued.issuedAt)}\nEscanea el QR para cotejar las materias y calificaciones registradas al emitir esta boleta.`, { width: width - 98, lineGap: 3 });
    doc.font("Helvetica-Bold").fontSize(8).text("No tiene valor para trámites.", { width: width - 98 });
  } else drawDocumentValidation(doc, issued, !history);
  doc.removeListener("pageAdded", heading);
}
