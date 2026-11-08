import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "../utils.js";
import sharp from "sharp";
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, ImageRun,
  Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType
} from "docx";
import { documentBranding } from "./document-branding.js";
import { issuedDisplayDate, type IssuedDocument } from "./document-verification.js";
import { certificateClosing, certificateParagraph, certificateStudentTerm, type StudyCertificateData } from "./study-certificate.js";

export async function createStudyCertificateWord(data: StudyCertificateData, issued: IssuedDocument) {
  const brand = documentBranding(), primary = brand.color.slice(1), draft = data.draft;
  const text = (value: string, bold = false, color = "24364A", size = 20) => new TextRun({ text: value, bold, color, size });
  const p = (value: string, options: { bold?: boolean; center?: boolean; size?: number; color?: string } = {}) => new Paragraph({
    children: [text(value, options.bold, options.color, options.size)],
    alignment: options.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 260 }
  });
  const cell = (children: Paragraph[], shade?: string) => new TableCell({ children,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    shading: shade ? { fill: shade } : undefined
  });
  const borders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } };
  const header: Paragraph[] = [];
  if (brand.logo) {
    // Word may embed only institutional assets or files in the configured uploads directory.
    const logoPath = path.resolve(brand.logo);
    const allowedRoots = [fileURLToPath(new URL("../../public/assets/", import.meta.url)),
      path.resolve(process.env.UPLOADS_PATH || fileURLToPath(new URL("../../uploads/", import.meta.url)))];
    if (!allowedRoots.some(root => {
      const relative = path.relative(root, logoPath);
      return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    })) throw new ApiError(409, "Vuelve a cargar el logo institucional desde Configuración para descargar la constancia en Word.");
    const logo = await sharp(logoPath).resize(128, 128, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const metadata = await sharp(logo).metadata();
    header.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: logo,
      transformation: { width: (metadata.width || 128) / 2, height: (metadata.height || 128) / 2 },
      altText: { title: "Logo institucional", description: brand.name, name: "Logo" }
    })] }));
  }
  header.push(p(brand.name, { bold: true, center: true, size: 28, color: primary }),
    p(brand.campus, { center: true, size: 20, color: primary }),
    p([brand.address, brand.contact].filter(Boolean).join(" · "), { center: true, size: 15 }));
  const body: (Paragraph | Table)[] = [
    p("CONSTANCIA DE ESTUDIOS", { bold: true, size: 32, color: primary }),
    p(`CONTROL ESCOLAR · ${data.settings.institution_name.toUpperCase()} · CAMPUS FRONTERA`, { size: 15 }),
    p(`Folio institucional: ${issued.folio}`, { size: 15 }),
    p("A QUIEN CORRESPONDA:", { bold: true }),
    p(`El que suscribe, responsable de Control Escolar de ${data.settings.institution_name}, hace constar que ${certificateStudentTerm(data.student.curp)}:`),
    p(data.student.student_name.toUpperCase(), { bold: true, center: true, size: 27, color: primary }),
    p(certificateParagraph(data)),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders,
      rows: [new TableRow({ children: [cell([
        p(`Ciclo escolar activo: ${draft.cycleName}`),
        p(`Periodo de actividades: del ${date(draft.startDate)} al ${date(draft.endDate)}.`),
        ...draft.vacations.map(v => p(`Vacaciones: del ${date(v.start_date)} al ${date(v.end_date)}.`)),
        ...(!draft.vacations.length ? [p("Sin periodos vacacionales registrados para este ciclo.")] : [])
      ], "F3F6FA")] })] }), new Paragraph({})
  ];
  if (draft.subjects.length) body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
    borders, columnWidths: [7400, 1960], rows: [
      new TableRow({ tableHeader: true, children: [new TableCell({ columnSpan: 2, shading: { fill: primary },
        children: [p(draft.subjectsTitle, { bold: true, color: "FFFFFF", size: 18 })] })] }),
      ...draft.subjects.map((subject, i) => new TableRow({ cantSplit: true, children: [
        cell([p(subject.name, { size: 18 })], i % 2 ? "F3F6FA" : "FFFFFF"),
        cell([p(subject.type === "elective" ? "OPTATIVA" : "OBLIGATORIA", { size: 16 })], i % 2 ? "F3F6FA" : "FFFFFF")
      ] }))
    ] }));
  body.push(new Paragraph({}), p(certificateClosing(data)),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders,
      rows: [new TableRow({ cantSplit: true, children: [
        cell([new Paragraph({ children: [new ExternalHyperlink({ link: issued.verificationUrl,
          children: [new ImageRun({ type: "png", data: issued.qrPng, transformation: { width: 90, height: 90 },
            altText: { title: "QR de validación", description: issued.verificationUrl, name: "QR" }
          })] })] })]),
        cell([p("_______________________________", { center: true }),
          p(issued.snapshot.institution.directorName, { center: true }),
          p("CONTROL ESCOLAR · FIRMA Y SELLO", { center: true, bold: true, size: 16 })])
      ] }), new TableRow({ children: [new TableCell({ columnSpan: 2, children: [
        p(`Folio: ${issued.folio} · Emisión: ${issuedDisplayDate(issued.issuedAt)}`, { center: true, size: 14 }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new ExternalHyperlink({ link: issued.verificationUrl,
          children: [new TextRun({ text: "Validar documento en la plataforma", style: "Hyperlink", size: 16 })] })] }),
        p("El QR permite cotejar la versión emitida. Las modificaciones posteriores en Word no actualizan el registro de validación.", { size: 14 })
      ] })] })] }));
  const doc = new Document({ creator: brand.name, title: `Constancia de estudios - ${data.student.student_name}`,
    description: `Folio ${issued.folio}`, styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 2850, bottom: 1250, left: 900, right: 900, header: 360, footer: 360 } } },
      headers: { default: new Header({ children: header }) },
      footers: { default: new Footer({ children: [p(brand.footer, { size: 14, center: true }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [text(`${brand.campus} · Página `, false, "607086", 14),
          new TextRun({ children: [PageNumber.CURRENT], size: 14 })] })] }) }, children: body }]
  });
  return Packer.toBuffer(doc);
}
function date(value: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}
