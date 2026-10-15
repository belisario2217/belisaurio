import path from "node:path";
import type { Response } from "express";
import ExcelJS from "exceljs";
import { createPdf } from "./files.js";
import { pdfInstitutionalVectors, workbookInstitutionLogo } from "./document-branding.js";
import { institutionLogoFile } from "./institution-logo.js";
import type { IssuedDocument } from "./document-verification.js";

const statementPlace = "Frontera, Centla, Tab.";
const timeZone = "America/Mexico_City";
const rowsPerPdfPage = 10;
const rowsOnWorkbookCover = 12;

export type StatementInstitutionSettings = {
  institution_name: string;
  logo_path: string | null;
  director_name: string | null;
  footer_text: string | null;
  primary_color: string | null;
  secondary_color: string | null;
};

type StatementPayment = {
  id: number;
  folio: string;
  amount: number;
  paid_at: string;
  payment_method: string | null;
  concept: string;
  covered_month: string | null;
  notes: string | null;
  updated_at: string;
};

export type StatementAccountData = {
  student: {
    student_number: string;
    student_name: string;
    program_name: string;
    group_name: string;
    shift_name: string;
    cycle_name: string;
    current_period: string | null;
    plan_name: string | null;
    level_name: string | null;
  };
  billing: {
    summary: {
      paidAmount: number;
      balance: number;
      tuitionAmount: number;
      expectedAmount: number;
    };
    payments: StatementPayment[];
  };
};

type IssuedParts = {
  display: string;
  year: string;
};

function normalizedHex(value: string | null | undefined, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value!.toUpperCase() : fallback;
}

function localIssuedParts(date: Date): IssuedParts {
  const entries = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const parts = Object.fromEntries(entries.map((entry) => [entry.type, entry.value]));
  return {
    display: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`,
    year: parts.year
  };
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function displayDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value ?? "";
}

function dateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function physicalFolio(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!/^\d{1,4}$/.test(text)) return "SIN FOLIO FÍSICO";
  const number = Number(text);
  return number >= 1 && number <= 1000 ? String(number).padStart(4, "0") : "SIN FOLIO FÍSICO";
}

type PdfCellOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  text?: unknown;
  fill?: string;
  color?: string;
  border?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  fontSize?: number;
};

function pdfCell(doc: PDFKit.PDFDocument, options: PdfCellOptions) {
  const border = options.border ?? "#CBD5E1";
  doc.save();
  if (options.fill) doc.rect(options.x, options.y, options.width, options.height).fillAndStroke(options.fill, border);
  else doc.rect(options.x, options.y, options.width, options.height).stroke(border);
  doc.fillColor(options.color ?? "#334155").font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.fontSize ?? 8);
  const text = String(options.text ?? "");
  const textHeight = doc.heightOfString(text, { width: options.width - 10 });
  doc.text(text, options.x + 5, options.y + Math.max(3, (options.height - textHeight) / 2), {
      width: options.width - 10,
      height: options.height - 6,
      align: options.align ?? "left",
      ellipsis: true
    });
  doc.restore();
}

function drawPdfHeader(
  doc: PDFKit.PDFDocument,
  data: StatementAccountData,
  settings: StatementInstitutionSettings,
  issued: IssuedParts,
  primary: string,
  pageNumber: number,
  pageCount: number
) {
  pdfInstitutionalVectors(doc, primary);
  const logo = institutionLogoFile(settings.logo_path);
  if (logo) doc.image(logo, 44, 30, { fit: [62, 62], align: "center", valign: "center" });
  doc
    .fillColor(primary)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(settings.institution_name || "INSTITUTO DE FORMACIÓN PROFESIONAL S.C.", 118, 34, {
      width: 446,
      height: 22,
      align: "center",
      ellipsis: true
    });
  doc.fontSize(11).text("CAMPUS FRONTERA", 118, 61, { width: 446, align: "center" });
  doc.fontSize(10).text("DEPARTAMENTO DE CONTROL ESCOLAR", 118, 81, { width: 446, align: "center" });
  if (pageCount > 1) {
    doc.fillColor("#64748B").font("Helvetica").fontSize(7).text(`Página ${pageNumber} de ${pageCount}`, 500, 18, { width: 64, align: "right" });
  }

  doc.roundedRect(36, 110, 540, 32, 3).fill(primary);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(15).text("ESTADO DE CUENTA DEL ALUMNO", 36, 119, {
    width: 540,
    align: "center"
  });

  const infoY = 154;
  const rowHeight = 21;
  const labelFill = "#EAF2F8";
  const label = (x: number, y: number, width: number, text: string) => pdfCell(doc, {
    x, y, width, height: rowHeight, text, fill: labelFill, color: primary, bold: true, align: "center", fontSize: 7.4
  });
  const value = (x: number, y: number, width: number, text: unknown, align: "left" | "center" = "left") => pdfCell(doc, {
    x, y, width, height: rowHeight, text, color: "#334155", align, fontSize: 8
  });

  label(36, infoY, 120, "MATRÍCULA");
  value(156, infoY, 150, data.student.student_number, "center");
  label(306, infoY, 110, "FECHA / HORA");
  value(416, infoY, 160, issued.display, "center");

  label(36, infoY + rowHeight, 120, "NOMBRE COMPLETO");
  value(156, infoY + rowHeight, 420, data.student.student_name);

  label(36, infoY + rowHeight * 2, 120, "PROGRAMA");
  value(156, infoY + rowHeight * 2, 150, data.student.program_name);
  label(306, infoY + rowHeight * 2, 110, "MODALIDAD / TURNO");
  value(416, infoY + rowHeight * 2, 160, data.student.shift_name);

  label(36, infoY + rowHeight * 3, 120, "SEMESTRE / PERIODO");
  value(156, infoY + rowHeight * 3, 150, data.student.current_period ?? "-");
  label(306, infoY + rowHeight * 3, 110, "CICLO ESCOLAR");
  value(416, infoY + rowHeight * 3, 160, data.student.cycle_name);

  label(36, infoY + rowHeight * 4, 120, "AÑO");
  value(156, infoY + rowHeight * 4, 150, issued.year, "center");
  label(306, infoY + rowHeight * 4, 110, "CAMPUS");
  value(416, infoY + rowHeight * 4, 160, "FRONTERA");

  pdfCell(doc, {
    x: 36, y: 270, width: 540, height: 32, text: `TOTAL PAGADO  ${money(data.billing.summary.paidAmount)}`,
    fill: "#EDF2F8", color: primary, border: "#D6DFEB", bold: true, align: "center", fontSize: 11
  });
}

function drawPdfMovements(
  doc: PDFKit.PDFDocument,
  data: StatementAccountData,
  settings: StatementInstitutionSettings,
  issued: IssuedParts,
  code: string,
  primary: string,
  payments: StatementPayment[],
  pageNumber: number,
  pageCount: number,
  official: IssuedDocument
) {
  drawPdfHeader(doc, data, settings, issued, primary, pageNumber, pageCount);
  const columns = [70, 220, 82, 98, 70];
  const headers = ["FECHA", "CONCEPTO DE PAGO", "IMPORTE", "FOLIO FÍSICO", "ESTADO"];
  let x = 36;
  for (let index = 0; index < headers.length; index += 1) {
    pdfCell(doc, {
      x, y: 314, width: columns[index], height: 24, text: headers[index], fill: primary,
      color: "#FFFFFF", border: "#D1FAE5", bold: true, align: "center", fontSize: 8
    });
    x += columns[index];
  }

  for (let row = 0; row < rowsPerPdfPage; row += 1) {
    const payment = payments[row];
    const values = payment
      ? [displayDate(payment.paid_at), payment.concept, money(payment.amount), physicalFolio(payment.notes), "PAGADO"]
      : ["", "", "", "", ""];
    x = 36;
    const y = 338 + row * 24;
    for (let index = 0; index < values.length; index += 1) {
      pdfCell(doc, {
        x,
        y,
        width: columns[index],
        height: 24,
        text: values[index],
        fill: row % 2 === 0 ? "#FFFFFF" : "#F8FAFC",
        color: index === 4 && payment ? "#166534" : "#334155",
        bold: index === 2 || index === 4,
        align: index === 1 ? "left" : index === 2 ? "right" : "center",
        fontSize: 7.5
      });
      x += columns[index];
    }
  }

  pdfCell(doc, {
    x: 36, y: 590, width: 430, height: 22, text: "TOTAL PAGADO", fill: "#F8FAFC",
    color: primary, bold: true, align: "right", fontSize: 8
  });
  pdfCell(doc, {
    x: 466, y: 590, width: 110, height: 22, text: money(data.billing.summary.paidAmount), fill: "#F8FAFC",
    color: primary, bold: true, align: "right", fontSize: 8
  });
  doc.moveTo(198, 660).lineTo(414, 660).strokeColor("#334155").lineWidth(0.7).stroke();
  doc.fillColor("#334155").font("Helvetica").fontSize(8).text(settings.director_name || "RESPONSABLE DE CONTROL ESCOLAR", 166, 668, {
    width: 280,
    align: "center",
    ellipsis: true
  });
  doc.fontSize(8).text("CONTROL ESCOLAR", 166, 686, { width: 280, align: "center" });
  doc.image(official.qrPng, 40, 622, { width: 74, height: 74 });
  doc.link(40, 622, 74, 74, official.verificationUrl);
  doc.fillColor(primary).font("Helvetica-Bold").fontSize(7).text(`FOLIO INSTITUCIONAL: ${official.folio}`, 36, 698, { width: 540, align: "center" });

  doc.rect(36, 712, 540, 18).fill("#F8FAFC");
  doc.fillColor("#64748B").font("Helvetica").fontSize(7.5).text(`${statementPlace} | Emitido: ${issued.display}`, 36, 717, {
    width: 540,
    align: "center"
  });
  doc.rect(36, 732, 540, 20).fill(primary);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.1).text(`CÓDIGO DE VERIFICACIÓN SHA-256: ${code}`, 40, 738, {
    width: 532,
    align: "center",
    ellipsis: true
  });
  doc.fillColor("#64748B").font("Helvetica-Oblique").fontSize(6.5).text(
    `${settings.footer_text || "Documento emitido por Control Escolar."} | Página ${pageNumber} de ${pageCount}`,
    36,
    758,
    { width: 540, height: 22, align: "center", ellipsis: true }
  );
}

export function sendAccountStatementPdf(
  res: Response,
  data: StatementAccountData,
  settings: StatementInstitutionSettings,
  official: IssuedDocument
) {
  const issued = localIssuedParts(new Date(official.issuedAt));
  const code = `EC-${official.fingerprint.toUpperCase()}`;
  const primary = normalizedHex(settings.primary_color, "#17324D");
  const doc = createPdf(res, `estado-de-cuenta-${data.student.student_number}.pdf`, { margins: { top: 36, bottom: 12, left: 36, right: 36 }, bufferPages: true }, false);
  doc.info.Author = settings.institution_name; doc.info.Title = "Estado de cuenta del alumno";
  const payments = data.billing.payments;
  const pageCount = Math.max(1, Math.ceil(payments.length / rowsPerPdfPage));
  for (let page = 0; page < pageCount; page += 1) {
    if (page > 0) doc.addPage({ size: "LETTER", margins: { top: 36, bottom: 12, left: 36, right: 36 } });
    drawPdfMovements(
      doc,
      data,
      settings,
      issued,
      code,
      primary,
      payments.slice(page * rowsPerPdfPage, (page + 1) * rowsPerPdfPage),
      page + 1,
      pageCount,
      official
    );
  }
  doc.end();
}

function argb(hex: string) {
  return `FF${hex.replace("#", "").toUpperCase()}`;
}

function thinBorder(color = "FFCBD5E1"): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } }
  };
}

function styleRange(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  style: Partial<ExcelJS.Style>
) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const cell = worksheet.getCell(row, column);
      if (style.font) cell.font = style.font;
      if (style.fill) cell.fill = style.fill;
      if (style.alignment) cell.alignment = style.alignment;
      if (style.border) cell.border = style.border;
      if (style.numFmt) cell.numFmt = style.numFmt;
    }
  }
}

function mergedValue(
  worksheet: ExcelJS.Worksheet,
  range: string,
  value: ExcelJS.CellValue,
  style?: Partial<ExcelJS.Style>
) {
  worksheet.mergeCells(range);
  const master = worksheet.getCell(range.split(":")[0]);
  master.value = value;
  if (style?.font) master.font = style.font;
  if (style?.fill) master.fill = style.fill;
  if (style?.alignment) master.alignment = style.alignment;
  if (style?.border) master.border = style.border;
  if (style?.numFmt) master.numFmt = style.numFmt;
}

function workbookLogo(workbook: ExcelJS.Workbook, settings: StatementInstitutionSettings) {
  const logo = institutionLogoFile(settings.logo_path);
  if (!logo) return null;
  const extension = path.extname(logo).toLowerCase() === ".png" ? "png" : "jpeg";
  return workbook.addImage({ filename: logo, extension });
}

function buildStatementCover(
  workbook: ExcelJS.Workbook,
  data: StatementAccountData,
  settings: StatementInstitutionSettings,
  issued: IssuedParts,
  code: string,
  official: IssuedDocument
) {
  const pageCount = Math.max(1, Math.ceil(data.billing.payments.length / rowsOnWorkbookCover));
  const lastPrintRow = pageCount * 36;
  const worksheet = workbook.addWorksheet("Estado de Cuenta", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 5 }],
    pageSetup: {
      paperSize: 1 as ExcelJS.PaperSize,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: `A1:H${lastPrintRow}`,
      horizontalCentered: true,
      verticalCentered: false,
      margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 }
    }
  });
  const primary = normalizedHex(settings.primary_color, "#17324D");
  const primaryArgb = argb(primary);
  const tealArgb = primaryArgb;
  const border = thinBorder();
  const navyFont: Partial<ExcelJS.Font> = { name: "Aptos", color: { argb: primaryArgb } };
  [12, 15, 15, 15, 14, 14, 15, 15].forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  const imageId = workbookLogo(workbook, settings);
  const qrImageId = workbook.addImage({ buffer: official.qrPng, extension: "png" });
  const labelFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF2F8" } };
  const labelStyle: Partial<ExcelJS.Style> = {
    fill: labelFill,
    font: { name: "Aptos", bold: true, size: 8, color: { argb: primaryArgb } },
    alignment: { horizontal: "center", vertical: "middle" },
    border
  };
  const valueStyle: Partial<ExcelJS.Style> = {
    font: { name: "Aptos", size: 9, color: { argb: "FF334155" } },
    alignment: { horizontal: "left", vertical: "middle" },
    border
  };

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const rowOffset = pageIndex * 36;
    const rowAt = (row: number) => rowOffset + row;
    const rangeAt = (fromColumn: string, toColumn: string, row: number) =>
      `${fromColumn}${rowAt(row)}:${toColumn}${rowAt(row)}`;
    const payments = data.billing.payments.slice(
      pageIndex * rowsOnWorkbookCover,
      (pageIndex + 1) * rowsOnWorkbookCover
    );
    for (let row = rowAt(1); row <= rowAt(36); row += 1) worksheet.getRow(row).height = 20;
    worksheet.getRow(rowAt(5)).height = 30;
    worksheet.getRow(rowAt(15)).height = 25;

    if (imageId != null) {
      worksheet.addImage(imageId, { tl: { col: 0.1, row: rowOffset + 0.1 }, ext: { width: 82, height: 82 } });
    }
    mergedValue(worksheet, rangeAt("C", "H", 1), settings.institution_name || "INSTITUTO DE FORMACIÓN PROFESIONAL S.C.", {
      font: { ...navyFont, bold: true, size: 15 },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    mergedValue(worksheet, rangeAt("C", "H", 2), "CAMPUS FRONTERA", {
      font: { ...navyFont, bold: true, size: 12 },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    mergedValue(worksheet, rangeAt("C", "H", 3), "DEPARTAMENTO DE CONTROL ESCOLAR", {
      font: { ...navyFont, bold: true, size: 11 },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    mergedValue(worksheet, rangeAt("A", "H", 5), "ESTADO DE CUENTA DEL ALUMNO", {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: primaryArgb } },
      font: { name: "Aptos", bold: true, size: 16, color: { argb: "FFFFFFFF" } },
      alignment: { horizontal: "center", vertical: "middle" }
    });

    const setInfo = (
      labelColumns: [string, string],
      label: string,
      valueColumns: [string, string],
      row: number,
      value: ExcelJS.CellValue,
      centered = false
    ) => {
      mergedValue(worksheet, rangeAt(labelColumns[0], labelColumns[1], row), label, labelStyle);
      mergedValue(worksheet, rangeAt(valueColumns[0], valueColumns[1], row), value, {
        ...valueStyle,
        alignment: { horizontal: centered ? "center" : "left", vertical: "middle" }
      });
    };
    setInfo(["A", "B"], "MATRÍCULA", ["C", "D"], 7, data.student.student_number, true);
    setInfo(["E", "F"], "FECHA / HORA", ["G", "H"], 7, issued.display, true);
    setInfo(["A", "B"], "NOMBRE COMPLETO", ["C", "H"], 8, data.student.student_name);
    setInfo(["A", "B"], "PROGRAMA", ["C", "D"], 9, data.student.program_name);
    setInfo(["E", "F"], "MODALIDAD / TURNO", ["G", "H"], 9, data.student.shift_name);
    setInfo(["A", "B"], "SEMESTRE / PERIODO", ["C", "D"], 10, data.student.current_period ?? "-");
    setInfo(["E", "F"], "CICLO ESCOLAR", ["G", "H"], 10, data.student.cycle_name);
    setInfo(["A", "B"], "AÑO", ["C", "D"], 11, issued.year, true);
    setInfo(["E", "F"], "CAMPUS", ["G", "H"], 11, "FRONTERA");

    mergedValue(worksheet, rangeAt("A", "D", 13), "TOTAL PAGADO");
    mergedValue(worksheet, rangeAt("E", "H", 13), Number(data.billing.summary.paidAmount));
    styleRange(worksheet, rowAt(13), 1, rowAt(13), 8, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } },
      font: { name: "Aptos", bold: true, size: 10, color: { argb: "FF166534" } },
      alignment: { horizontal: "center", vertical: "middle" },
      border: thinBorder(primaryArgb)
    });
    worksheet.getCell(rowAt(13), 5).numFmt = '"$"#,##0.00';

    const firstMovement = pageIndex * rowsOnWorkbookCover + 1;
    const lastMovement = Math.min(data.billing.payments.length, firstMovement + rowsOnWorkbookCover - 1);
    const pageSummary = data.billing.payments.length
      ? `MOVIMIENTOS ${firstMovement}–${lastMovement} DE ${data.billing.payments.length} | PÁGINA ${pageIndex + 1} DE ${pageCount}`
      : `SIN MOVIMIENTOS REGISTRADOS | PÁGINA ${pageIndex + 1} DE ${pageCount}`;
    mergedValue(worksheet, rangeAt("A", "H", 14), pageSummary, {
      font: { name: "Aptos", italic: true, size: 7, color: { argb: "FF64748B" } },
      alignment: { horizontal: "center", vertical: "middle" }
    });

    worksheet.mergeCells(rangeAt("B", "D", 15));
    worksheet.mergeCells(rangeAt("F", "G", 15));
    worksheet.getCell(rowAt(15), 1).value = "FECHA";
    worksheet.getCell(rowAt(15), 2).value = "CONCEPTO";
    worksheet.getCell(rowAt(15), 5).value = "MONTO";
    worksheet.getCell(rowAt(15), 6).value = "FOLIO";
    worksheet.getCell(rowAt(15), 8).value = "ESTADO";
    styleRange(worksheet, rowAt(15), 1, rowAt(15), 8, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: tealArgb } },
      font: { name: "Aptos", bold: true, size: 9, color: { argb: "FFFFFFFF" } },
      alignment: { horizontal: "center", vertical: "middle" },
      border
    });
    for (let index = 0; index < rowsOnWorkbookCover; index += 1) {
      const row = rowAt(16 + index);
      const payment = payments[index];
      worksheet.mergeCells(`B${row}:D${row}`);
      worksheet.mergeCells(`F${row}:G${row}`);
      worksheet.getCell(row, 1).value = payment ? dateValue(payment.paid_at) : null;
      worksheet.getCell(row, 2).value = payment?.concept ?? "";
      worksheet.getCell(row, 5).value = payment ? Number(payment.amount) : null;
      worksheet.getCell(row, 6).value = payment ? physicalFolio(payment.notes) : "";
      worksheet.getCell(row, 8).value = payment ? "PAGADO" : "";
      styleRange(worksheet, row, 1, row, 8, {
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" } },
        font: { name: "Aptos", size: 8, color: { argb: "FF334155" } },
        alignment: { horizontal: "left", vertical: "middle" },
        border
      });
      worksheet.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle" };
      worksheet.getCell(row, 1).numFmt = "dd/mm/yyyy";
      worksheet.getCell(row, 5).alignment = { horizontal: "right", vertical: "middle" };
      worksheet.getCell(row, 5).numFmt = '"$"#,##0.00';
      worksheet.getCell(row, 6).alignment = { horizontal: "center", vertical: "middle" };
      worksheet.getCell(row, 8).alignment = { horizontal: "center", vertical: "middle" };
      worksheet.getCell(row, 8).font = { name: "Aptos", size: 8, bold: Boolean(payment), color: { argb: "FF166534" } };
    }

    mergedValue(worksheet, rangeAt("A", "F", 28), "TOTAL PAGADO");
    mergedValue(worksheet, rangeAt("G", "H", 28), Number(data.billing.summary.paidAmount));
    styleRange(worksheet, rowAt(28), 1, rowAt(28), 8, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } },
      font: { name: "Aptos", bold: true, size: 9, color: { argb: primaryArgb } },
      alignment: { horizontal: "right", vertical: "middle" },
      border
    });
    worksheet.getCell(rowAt(28), 7).numFmt = '"$"#,##0.00';

    worksheet.mergeCells(rangeAt("C", "F", 31));
    styleRange(worksheet, rowAt(31), 3, rowAt(31), 6, { border: { bottom: { style: "thin", color: { argb: "FF334155" } } } });
    mergedValue(worksheet, rangeAt("C", "F", 32), settings.director_name || "RESPONSABLE DE CONTROL ESCOLAR", {
      font: { name: "Aptos", size: 9, color: { argb: "FF334155" } },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    mergedValue(worksheet, rangeAt("C", "F", 33), "CONTROL ESCOLAR", {
      font: { name: "Aptos", size: 9, color: { argb: "FF334155" } },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    worksheet.addImage(qrImageId, { tl: { col: 6.25, row: rowOffset + 28.1 }, ext: { width: 72, height: 72 } });
    mergedValue(worksheet, rangeAt("A", "B", 30), "VALIDACIÓN INSTITUCIONAL", {
      font: { name: "Aptos", size: 7, bold: true, color: { argb: primaryArgb } },
      alignment: { horizontal: "center", vertical: "middle", wrapText: true }
    });
    mergedValue(worksheet, rangeAt("A", "B", 31), { text: official.folio, hyperlink: official.verificationUrl }, {
      font: { name: "Aptos", size: 7, color: { argb: primaryArgb } },
      alignment: { horizontal: "center", vertical: "middle", wrapText: true }
    });
    mergedValue(worksheet, rangeAt("A", "H", 34), `${statementPlace} | Emitido: ${issued.display}`, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } },
      font: { name: "Aptos", size: 8, color: { argb: "FF64748B" } },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    mergedValue(worksheet, rangeAt("A", "H", 35), `CÓDIGO DE VERIFICACIÓN SHA-256: ${code}`, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: primaryArgb } },
      font: { name: "Consolas", bold: true, size: 8, color: { argb: "FFFFFFFF" } },
      alignment: { horizontal: "center", vertical: "middle" }
    });
    mergedValue(worksheet, rangeAt("A", "H", 36), settings.footer_text || "Documento emitido por Control Escolar.", {
      font: { name: "Aptos", italic: true, size: 7, color: { argb: "FF64748B" } },
      alignment: { horizontal: "center", vertical: "middle", wrapText: true }
    });
    if (pageIndex < pageCount - 1) worksheet.getRow(rowAt(36)).addPageBreak(1, 8);
  }
}

function buildMovementsSheet(
  workbook: ExcelJS.Workbook,
  data: StatementAccountData,
  settings: StatementInstitutionSettings,
  issued: IssuedParts,
  code: string
) {
  const endRow = Math.max(5, 4 + data.billing.payments.length);
  const worksheet = workbook.addWorksheet("Movimientos", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 4 }],
    pageSetup: {
      paperSize: 1 as ExcelJS.PaperSize,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printArea: `A1:H${endRow + 3}`,
      printTitlesRow: "1:4",
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
    }
  });
  const primary = normalizedHex(settings.primary_color, "#17324D");
  const primaryArgb = argb(primary);
  [14, 18, 28, 15, 18, 17, 20, 34].forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
  mergedValue(worksheet, "A1:H1", `${settings.institution_name || "Universidad IFOP"}\nCAMPUS FRONTERA\nDETALLE COMPLETO DE MOVIMIENTOS`, {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: primaryArgb } },
    font: { name: "Aptos", bold: true, size: 16, color: { argb: "FFFFFFFF" } },
    alignment: { horizontal: "center", vertical: "middle" }
  });
  worksheet.getRow(1).height = 80;
  worksheet.getCell("A1").alignment={horizontal:"center",vertical:"middle",wrapText:true};
  const movementsLogo=workbookInstitutionLogo(workbook);
  if(movementsLogo!==null)worksheet.addImage(movementsLogo,{tl:{col:.1,row:.1},ext:{width:64,height:64}});
  mergedValue(worksheet, "A2:H2", `${data.student.student_number} | ${data.student.student_name} | ${data.student.program_name}`, {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDF3F0" } },
    font: { name: "Aptos", italic: true, size: 9, color: { argb: "FF334155" } },
    alignment: { horizontal: "left", vertical: "middle" }
  });
  mergedValue(worksheet, "A3:H3", `${statementPlace} | Emitido: ${issued.display} | Código: ${code}`, {
    font: { name: "Consolas", size: 8, color: { argb: "FF64748B" } },
    alignment: { horizontal: "left", vertical: "middle" }
  });
  const headers = ["FECHA", "MATRÍCULA", "CONCEPTO", "MONTO", "FOLIO FÍSICO", "ESTADO", "MÉTODO", "MES CUBIERTO"];
  worksheet.getRow(4).values = headers;
  styleRange(worksheet, 4, 1, 4, 8, {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } },
    font: { name: "Aptos", bold: true, size: 9, color: { argb: "FFFFFFFF" } },
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: thinBorder()
  });
  worksheet.getRow(4).height = 28;
  data.billing.payments.forEach((payment, index) => {
    const row = 5 + index;
    worksheet.getRow(row).values = [
      dateValue(payment.paid_at),
      data.student.student_number,
      payment.concept,
      Number(payment.amount),
      physicalFolio(payment.notes),
      "PAGADO",
      payment.payment_method ?? "",
      payment.covered_month ?? ""
    ];
    styleRange(worksheet, row, 1, row, 8, {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" } },
      font: { name: "Aptos", size: 9, color: { argb: "FF334155" } },
      alignment: { vertical: "middle" },
      border: thinBorder("FFE2E8F0")
    });
    worksheet.getCell(row, 1).numFmt = "dd/mm/yyyy";
    worksheet.getCell(row, 4).numFmt = '"$"#,##0.00';
    worksheet.getCell(row, 4).alignment = { horizontal: "right", vertical: "middle" };
    worksheet.getCell(row, 6).font = { name: "Aptos", bold: true, size: 9, color: { argb: "FF166534" } };
    worksheet.getRow(row).height = 20;
  });
  worksheet.autoFilter = { from: "A4", to: `H${endRow}` };
  const summaryRow = endRow + 2;
  mergedValue(worksheet, `A${summaryRow}:G${summaryRow}`, "TOTAL PAGADO", {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } },
    font: { name: "Aptos", bold: true, size: 10, color: { argb: "FF166534" } },
    alignment: { horizontal: "right", vertical: "middle" },
    border: thinBorder()
  });
  worksheet.getCell(summaryRow, 8).value = Number(data.billing.summary.paidAmount);
  worksheet.getCell(summaryRow, 8).numFmt = '"$"#,##0.00';
  worksheet.getCell(summaryRow, 8).font = { name: "Aptos", bold: true, size: 10, color: { argb: "FF166534" } };
  worksheet.getCell(summaryRow, 8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
  worksheet.getCell(summaryRow, 8).border = thinBorder();
  worksheet.getCell(summaryRow, 8).alignment = { horizontal: "right", vertical: "middle" };
}

export async function sendAccountStatementWorkbook(
  res: Response,
  data: StatementAccountData,
  settings: StatementInstitutionSettings,
  official: IssuedDocument
) {
  const issued = localIssuedParts(new Date(official.issuedAt));
  const code = `EC-${official.fingerprint.toUpperCase()}`;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.institution_name || "Control Escolar";
  workbook.company = settings.institution_name || "Instituto de Formación Profesional S.C.";
  workbook.subject = `Estado de cuenta de ${data.student.student_name}`;
  workbook.title = `Estado de cuenta ${data.student.student_number}`;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  buildStatementCover(workbook, data, settings, issued, code, official);
  buildMovementsSheet(workbook, data, settings, issued, code);
  const buffer = await workbook.xlsx.writeBuffer();
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="estado-de-cuenta-${data.student.student_number}.xlsx"`)
    .send(Buffer.from(buffer));
}
