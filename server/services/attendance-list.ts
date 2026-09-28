import path from "node:path";
import type { Response } from "express";
import ExcelJS from "exceljs";
import { all, get } from "../db.js";
import { ApiError } from "../utils.js";
import { createPdf } from "./files.js";
import { institutionLogoFile } from "./institution-logo.js";

const studentsPerPage = 19;
const attendanceColumns = 19;
const campusName = "CAMPUS FRONTERA";
const institutionCct = "CCT 27MSU0108N";

export type AttendanceMode = "escolarizado" | "semiescolarizado" | "complementario";

type AttendanceSettings = {
  institution_name: string;
  logo_path: string | null;
  address: string | null;
  director_name: string | null;
};

type AttendanceContext = {
  group_id: number;
  group_name: string;
  program_name: string;
  duration_periods: number;
  shift_name: string;
  start_time: string | null;
  end_time: string | null;
  cycle_name: string;
  assignment_id: number | null;
  subject_name: string | null;
  teacher_name: string | null;
  period_name: string | null;
};

type AttendanceStudent = {
  student_number: string;
  student_name: string;
};

type AttendancePage = {
  context: AttendanceContext;
  students: AttendanceStudent[];
  studentOffset: number;
  pageNumber: number;
  pageCount: number;
};

const monthNames = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

export function normalizeAttendanceMode(value: unknown): AttendanceMode {
  return value === "semiescolarizado" || value === "complementario" ? value : "escolarizado";
}

function normalizedMonth(value: unknown) {
  const text = String(value ?? "");
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return text;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: unknown) {
  const month = normalizedMonth(value);
  const [year, monthNumber] = month.split("-").map(Number);
  return `${monthNames[monthNumber - 1]} ${year}`;
}

function dayLabels(mode: AttendanceMode) {
  if (mode === "semiescolarizado") return Array.from({ length: attendanceColumns }, () => "S");
  if (mode === "complementario") return Array.from({ length: attendanceColumns }, () => "D");
  const weekdays = ["L", "M", "M", "J", "V"];
  return Array.from({ length: attendanceColumns }, (_, index) => weekdays[index % weekdays.length]);
}

function attendanceSettings() {
  return get<AttendanceSettings>(
    "SELECT institution_name, logo_path, address, director_name FROM institution_settings WHERE id = 1"
  ) ?? {
    institution_name: "UNIVERSIDAD IFOP",
    logo_path: "/assets/campus-frontera.jpg",
    address: "Cjon. Manuel Díaz 404, Centro, 86750 Frontera, Tab.",
    director_name: "RESPONSABLE DE CONTROL ESCOLAR"
  };
}

function attendanceContexts(groupId: number | null) {
  const contexts = all<AttendanceContext>(
    `SELECT g.id AS group_id, g.name AS group_name, p.name AS program_name,
     p.duration_periods, sh.name AS shift_name, sh.start_time, sh.end_time,
     sc.name AS cycle_name, NULL AS assignment_id, 'TODAS LAS MATERIAS' AS subject_name,
     NULL AS teacher_name, NULL AS period_name
     FROM groups g
     JOIN programs p ON p.id = g.program_id
     JOIN shifts sh ON sh.id = g.shift_id
     JOIN school_cycles sc ON sc.id = g.cycle_id
     WHERE g.is_active = 1 AND (? IS NULL OR g.id = ?)
     ORDER BY g.name`,
    groupId,
    groupId
  );
  if (!contexts.length) throw new ApiError(404, "No se encontraron grupos activos para generar la lista.");
  return contexts;
}

function studentsForGroup(groupId: number) {
  return all<AttendanceStudent>(
    `SELECT st.student_number,
     TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name, '')) AS student_name
     FROM enrollments e JOIN students st ON st.id = e.student_id
     WHERE e.group_id = ? AND e.is_active = 1 AND st.is_active = 1
     ORDER BY st.last_name, st.second_last_name, st.first_name`,
    groupId
  );
}

function attendancePages(groupId: number | null) {
  return attendanceContexts(groupId).flatMap((context) => {
    const students = studentsForGroup(context.group_id);
    const pageCount = Math.max(1, Math.ceil(students.length / studentsPerPage));
    return Array.from({ length: pageCount }, (_, pageIndex): AttendancePage => ({
      context,
      students: students.slice(pageIndex * studentsPerPage, (pageIndex + 1) * studentsPerPage),
      studentOffset: pageIndex * studentsPerPage,
      pageNumber: pageIndex + 1,
      pageCount
    }));
  });
}

function schedule(context: AttendanceContext) {
  const times = context.start_time && context.end_time ? ` ${context.start_time}-${context.end_time}` : "";
  return `${context.shift_name}${times}`.trim();
}

function institutionHeading(settings: AttendanceSettings) {
  const name = (settings.institution_name || "UNIVERSIDAD IFOP").toUpperCase();
  return name.includes("CAMPUS FRONTERA") ? name : `${name} CAMPUS FRONTERA`;
}

function safeSheetName(page: AttendancePage, used: Set<string>) {
  const base = `${page.context.group_name}-${page.context.subject_name ?? "Lista"}`
    .replace(/[\\/*?:[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = page.pageCount > 1 ? `-${page.pageNumber}` : "";
  let candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}` || "Lista";
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const duplicateSuffix = `-${counter}`;
    candidate = `${base.slice(0, Math.max(1, 31 - duplicateSuffix.length))}${duplicateSuffix}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function thinBorder(color = "FF000000"): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: "thin", color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function styleRange(worksheet: ExcelJS.Worksheet, range: string, style: Partial<ExcelJS.Style>) {
  const [start, end = start] = range.split(":");
  const startCell = worksheet.getCell(start);
  const endCell = worksheet.getCell(end);
  for (let row = startCell.row; row <= endCell.row; row += 1) {
    for (let column = startCell.col; column <= endCell.col; column += 1) {
      const cell = worksheet.getCell(row, column);
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.border) cell.border = style.border;
      if (style.alignment) cell.alignment = style.alignment;
      if (style.numFmt) cell.numFmt = style.numFmt;
    }
  }
}

function mergedCell(
  worksheet: ExcelJS.Worksheet,
  range: string,
  value: ExcelJS.CellValue,
  style: Partial<ExcelJS.Style>
) {
  worksheet.mergeCells(range);
  worksheet.getCell(range.split(":")[0]).value = value;
  styleRange(worksheet, range, style);
}

function buildAttendanceSheet(
  workbook: ExcelJS.Workbook,
  page: AttendancePage,
  settings: AttendanceSettings,
  mode: AttendanceMode,
  month: string,
  imageId: number | null,
  usedNames: Set<string>
) {
  const worksheet = workbook.addWorksheet(safeSheetName(page, usedNames), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 1 as ExcelJS.PaperSize,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      printArea: "A1:X37",
      horizontalCentered: true,
      verticalCentered: true,
      margins: { left: 0.2, right: 0.2, top: 0.2, bottom: 0.2, header: 0.1, footer: 0.1 }
    }
  });
  worksheet.properties.defaultRowHeight = 18;
  worksheet.getColumn(1).width = 6;
  for (let column = 2; column <= 5; column += 1) worksheet.getColumn(column).width = 8;
  for (let column = 6; column <= 24; column += 1) worksheet.getColumn(column).width = 3.6;
  [8, 26, 18, 18, 22, 8, 20, 20, 20, 20, 22, 15, 19].forEach((height, index) => {
    worksheet.getRow(index + 1).height = height;
  });
  for (let row = 14; row <= 32; row += 1) worksheet.getRow(row).height = 20;
  [18, 18, 22, 18, 15].forEach((height, index) => { worksheet.getRow(33 + index).height = height; });

  const baseFont: Partial<ExcelJS.Font> = { name: "Arial", size: 9, color: { argb: "FF000000" } };
  const centered: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle", shrinkToFit: true };
  const bordered: Partial<ExcelJS.Style> = { font: baseFont, alignment: centered, border: thinBorder() };
  styleRange(worksheet, "A1:X37", { font: baseFont, alignment: { vertical: "middle" } });

  if (imageId != null) worksheet.addImage(imageId, { tl: { col: 0.65, row: 0.2 }, ext: { width: 62, height: 68 } });
  mergedCell(worksheet, "C2:R2", institutionHeading(settings), {
    font: { name: "Arial", bold: true, size: 16 }, alignment: centered
  });
  mergedCell(worksheet, "C3:R3", settings.address || "Cjon. Manuel Díaz 404, Centro, 86750 Frontera, Tab.", {
    font: { name: "Arial", size: 10 }, alignment: centered
  });
  mergedCell(worksheet, "C4:R4", institutionCct, { font: { name: "Arial", size: 10 }, alignment: centered });
  mergedCell(worksheet, "A5:X5", "LISTA DE ASISTENCIA", {
    font: { name: "Arial", bold: true, size: 12 }, alignment: centered,
    border: { bottom: { style: "thin", color: { argb: "FF000000" } } }
  });

  const setInfo = (labelRange: string, label: string, valueRange: string, value: string, bold = false) => {
    mergedCell(worksheet, labelRange, label, bordered);
    mergedCell(worksheet, valueRange, value, {
      ...bordered,
      font: { ...baseFont, size: 10, bold }
    });
  };
  setInfo("A7:C7", "NOMBRE DEL CURSO:", "D7:F7", page.context.program_name);
  setInfo("G7:I7", "ALCANCE:", "J7:O7", "TODAS LAS MATERIAS");
  setInfo("P7:T7", "SEMESTRE Y GRUPO:", "U7:X7", page.context.group_name, true);
  setInfo("A8:C8", "RESPONSABLE:", "D8:F8", "");
  setInfo("G8:I8", "DURACIÓN:", "J8:M8", `${page.context.duration_periods} SEMESTRES`, true);
  setInfo("N8:P8", "HORARIO:", "Q8:X8", schedule(page.context));
  setInfo("A9:C9", "PERIODO:", "D9:F9", page.context.period_name ?? page.context.cycle_name);
  setInfo("G9:I9", "PLANTEL:", "J9:X9", campusName);
  setInfo("A10:C10", "MES:", "D10:X10", month);

  mergedCell(worksheet, "A11:A13", "No.", { ...bordered, font: { ...baseFont, bold: true, size: 10 } });
  mergedCell(worksheet, "B11:E13", "NOMBRE DEL ALUMNO", { ...bordered, font: { ...baseFont, bold: true, size: 10 } });
  mergedCell(worksheet, "F11:X12", "ASISTENCIA", { ...bordered, font: { ...baseFont, bold: true, size: 10 } });
  dayLabels(mode).forEach((label, index) => {
    const cell = worksheet.getCell(13, 6 + index);
    cell.value = label;
    cell.font = { ...baseFont, bold: true, size: 10 };
    cell.alignment = centered;
    cell.border = thinBorder();
  });

  for (let index = 0; index < studentsPerPage; index += 1) {
    const row = 14 + index;
    const student = page.students[index];
    worksheet.getCell(row, 1).value = student ? page.studentOffset + index + 1 : null;
    worksheet.mergeCells(`B${row}:E${row}`);
    worksheet.getCell(row, 2).value = student?.student_name ?? null;
    styleRange(worksheet, `A${row}:X${row}`, {
      font: { ...baseFont, size: 9 },
      alignment: centered,
      border: thinBorder()
    });
    worksheet.getCell(row, 2).alignment = { horizontal: "left", vertical: "middle", shrinkToFit: true };
  }

  mergedCell(worksheet, "R33:V33", "TOTAL ASISTENCIAS:", bordered);
  mergedCell(worksheet, "W33:X33", null, bordered);
  mergedCell(worksheet, "R34:V34", "TOTAL INASISTENCIAS:", bordered);
  mergedCell(worksheet, "W34:X34", null, bordered);
  mergedCell(worksheet, "B35:H35", page.context.teacher_name ?? null, {
    font: { ...baseFont, bold: true, size: 9 }, alignment: centered,
    border: { bottom: { style: "thin", color: { argb: "FF000000" } } }
  });
  mergedCell(worksheet, "B36:H36", "DOCENTE", { font: { ...baseFont, size: 9 }, alignment: centered });
  mergedCell(worksheet, "J35:Q35", settings.director_name || "RESPONSABLE DE CONTROL ESCOLAR", {
    font: { ...baseFont, bold: true, size: 9 }, alignment: centered,
    border: { bottom: { style: "thin", color: { argb: "FF000000" } } }
  });
  mergedCell(worksheet, "J36:Q36", "NOMBRE Y FIRMA DEL COORDINADOR", { font: { ...baseFont, size: 9 }, alignment: centered });
  worksheet.getCell("R37").value = `Rev.1${page.pageCount > 1 ? ` - Página ${page.pageNumber}/${page.pageCount}` : ""}`;
  worksheet.getCell("R37").font = { ...baseFont, size: 8 };
  worksheet.headerFooter.oddFooter = `&L${page.context.group_name} - ${page.context.subject_name ?? "Lista de alumnos"}&R&P / &N`;
}

export async function sendAttendanceWorkbook(
  res: Response,
  groupId: number | null,
  modeInput: unknown,
  monthInput: unknown
) {
  const mode = normalizeAttendanceMode(modeInput);
  const month = monthLabel(monthInput);
  const settings = attendanceSettings();
  const pages = attendancePages(groupId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.institution_name || "Universidad IFOP";
  workbook.company = settings.institution_name || "Universidad IFOP";
  workbook.title = "Listas de asistencia";
  workbook.subject = `Listas de asistencia - ${mode}`;
  workbook.created = new Date();
  const logo = institutionLogoFile(settings.logo_path);
  const imageId = logo ? workbook.addImage({ filename: logo, extension: path.extname(logo).toLowerCase() === ".png" ? "png" : "jpeg" }) : null;
  const usedNames = new Set<string>();
  pages.forEach((page) => buildAttendanceSheet(workbook, page, settings, mode, month, imageId, usedNames));
  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = groupId ? `grupo-${pages[0].context.group_name}` : "todos-los-grupos";
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="lista-asistencia-${suffix}.xlsx"`)
    .send(Buffer.from(buffer));
}

function pdfCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: { bold?: boolean; size?: number; align?: "left" | "center" | "right" } = {}
) {
  doc.rect(x, y, width, height).strokeColor("#000000").lineWidth(0.45).stroke();
  doc.fillColor("#000000").font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size ?? 7);
  const textHeight = doc.heightOfString(text, { width: width - 4, lineBreak: false });
  doc.text(text, x + 2, y + Math.max(1, (height - textHeight) / 2), {
    width: width - 4,
    align: options.align ?? "center",
    lineBreak: false,
    ellipsis: true
  });
}

function drawAttendancePdfPage(
  doc: PDFKit.PDFDocument,
  page: AttendancePage,
  settings: AttendanceSettings,
  mode: AttendanceMode,
  month: string
) {
  const left = 20;
  const width = 752;
  const logo = institutionLogoFile(settings.logo_path);
  if (logo) doc.image(logo, left + 12, 10, { fit: [62, 68], align: "center", valign: "center" });
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(16).text(
    institutionHeading(settings),
    100, 20, { width: 640, align: "center", lineBreak: false, ellipsis: true }
  );
  doc.font("Helvetica").fontSize(9).text(settings.address || "Cjon. Manuel Díaz 404, Centro, 86750 Frontera, Tab.", 100, 43, { width: 640, align: "center" });
  doc.text(institutionCct, 100, 57, { width: 640, align: "center" });
  doc.font("Helvetica-Bold").fontSize(12).text("LISTA DE ASISTENCIA", left, 74, { width, align: "center" });
  doc.moveTo(left, 88).lineTo(left + width, 88).lineWidth(0.7).strokeColor("#000000").stroke();

  const fieldHeight = 15;
  const labelWidth = 92;
  const y1 = 94;
  pdfCell(doc, left, y1, labelWidth, fieldHeight, "NOMBRE DEL CURSO:", { size: 6.4 });
  pdfCell(doc, left + labelWidth, y1, 176, fieldHeight, page.context.program_name, { size: 7 });
  pdfCell(doc, left + 268, y1, 56, fieldHeight, "ALCANCE:", { size: 6.4 });
  pdfCell(doc, left + 324, y1, 226, fieldHeight, page.context.subject_name ?? "POR ASIGNAR", { size: 7 });
  pdfCell(doc, left + 550, y1, 94, fieldHeight, "SEMESTRE Y GRUPO:", { size: 6 });
  pdfCell(doc, left + 644, y1, 108, fieldHeight, page.context.group_name, { bold: true, size: 7 });

  const y2 = y1 + fieldHeight;
  pdfCell(doc, left, y2, labelWidth, fieldHeight, "RESPONSABLE:", { size: 6.2 });
  pdfCell(doc, left + labelWidth, y2, 176, fieldHeight, "", { size: 7 });
  pdfCell(doc, left + 268, y2, 56, fieldHeight, "DURACIÓN:", { size: 6.4 });
  pdfCell(doc, left + 324, y2, 112, fieldHeight, `${page.context.duration_periods} SEMESTRES`, { bold: true, size: 7 });
  pdfCell(doc, left + 436, y2, 70, fieldHeight, "HORARIO:", { size: 6.4 });
  pdfCell(doc, left + 506, y2, 246, fieldHeight, schedule(page.context), { size: 7 });

  const y3 = y2 + fieldHeight;
  pdfCell(doc, left, y3, labelWidth, fieldHeight, "PERIODO:", { size: 6.4 });
  pdfCell(doc, left + labelWidth, y3, 176, fieldHeight, page.context.period_name ?? page.context.cycle_name, { size: 7 });
  pdfCell(doc, left + 268, y3, 92, fieldHeight, "PLANTEL:", { size: 6.4 });
  pdfCell(doc, left + 360, y3, 392, fieldHeight, campusName, { size: 7 });

  const y4 = y3 + fieldHeight;
  pdfCell(doc, left, y4, labelWidth, fieldHeight, "MES:", { size: 6.4 });
  pdfCell(doc, left + labelWidth, y4, width - labelWidth, fieldHeight, month, { size: 7 });

  const tableY = y4 + fieldHeight;
  const numberWidth = 44;
  const studentWidth = 224;
  const attendanceWidth = width - numberWidth - studentWidth;
  const dayWidth = attendanceWidth / attendanceColumns;
  const topHeaderHeight = 28;
  const dayHeaderHeight = 18;
  const rowHeight = 14;
  pdfCell(doc, left, tableY, numberWidth, topHeaderHeight + dayHeaderHeight, "No.", { bold: true, size: 8 });
  pdfCell(doc, left + numberWidth, tableY, studentWidth, topHeaderHeight + dayHeaderHeight, "NOMBRE DEL ALUMNO", { bold: true, size: 8 });
  pdfCell(doc, left + numberWidth + studentWidth, tableY, attendanceWidth, topHeaderHeight, "ASISTENCIA", { bold: true, size: 8 });
  dayLabels(mode).forEach((label, index) => {
    pdfCell(doc, left + numberWidth + studentWidth + index * dayWidth, tableY + topHeaderHeight, dayWidth, dayHeaderHeight, label, { bold: true, size: 7 });
  });
  for (let index = 0; index < studentsPerPage; index += 1) {
    const student = page.students[index];
    const rowY = tableY + topHeaderHeight + dayHeaderHeight + index * rowHeight;
    pdfCell(doc, left, rowY, numberWidth, rowHeight, student ? String(page.studentOffset + index + 1) : "", { size: 6.5 });
    pdfCell(doc, left + numberWidth, rowY, studentWidth, rowHeight, student?.student_name ?? "", { size: 6.5, align: "left" });
    for (let column = 0; column < attendanceColumns; column += 1) {
      pdfCell(doc, left + numberWidth + studentWidth + column * dayWidth, rowY, dayWidth, rowHeight, "", { size: 6 });
    }
  }

  const tableBottom = tableY + topHeaderHeight + dayHeaderHeight + studentsPerPage * rowHeight;
  pdfCell(doc, left + 560, tableBottom + 2, 116, 15, "TOTAL ASISTENCIAS:", { size: 6.2, align: "left" });
  pdfCell(doc, left + 676, tableBottom + 2, 76, 15, "", { size: 6 });
  pdfCell(doc, left + 560, tableBottom + 17, 116, 15, "TOTAL INASISTENCIAS:", { size: 6.2, align: "left" });
  pdfCell(doc, left + 676, tableBottom + 17, 76, 15, "", { size: 6 });

  const signatureY = 545;
  doc.moveTo(84, signatureY).lineTo(300, signatureY).strokeColor("#000000").lineWidth(0.6).stroke();
  doc.moveTo(420, signatureY).lineTo(680, signatureY).stroke();
  doc.font("Helvetica-Bold").fontSize(7).text(page.context.teacher_name ?? "", 84, signatureY - 12, { width: 216, align: "center", ellipsis: true });
  doc.text(settings.director_name || "RESPONSABLE DE CONTROL ESCOLAR", 420, signatureY - 12, { width: 260, align: "center", ellipsis: true });
  doc.font("Helvetica").fontSize(7).text("DOCENTE", 84, signatureY + 4, { width: 216, align: "center" });
  doc.text("NOMBRE Y FIRMA DEL COORDINADOR", 420, signatureY + 4, { width: 260, align: "center" });
  doc.fontSize(6.5).text(`Rev.1${page.pageCount > 1 ? ` - Página ${page.pageNumber}/${page.pageCount}` : ""}`, 670, 572, { width: 100, align: "right", lineBreak: false });
}

export function sendAttendancePdf(
  res: Response,
  groupId: number | null,
  modeInput: unknown,
  monthInput: unknown
) {
  const mode = normalizeAttendanceMode(modeInput);
  const month = monthLabel(monthInput);
  const settings = attendanceSettings();
  const pages = attendancePages(groupId);
  const doc = createPdf(res, "lista-asistencia.pdf", { layout: "landscape", margin: 20 });
  pages.forEach((page, index) => {
    if (index > 0) doc.addPage({ size: "LETTER", layout: "landscape", margin: 20 });
    drawAttendancePdfPage(doc, page, settings, mode, month);
  });
  doc.end();
}
