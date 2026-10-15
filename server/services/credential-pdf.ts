import fs from "node:fs";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import sharp from "sharp";
import QRCode from "qrcode";
import { credentialDraftSvg, credentialImageLayout, credentialSvg } from "../../shared/credential-artwork.js";
import { credentialDimensions, type CredentialSnapshot } from "../../shared/credentials.js";
import { institutionLogoFile } from "./institution-logo.js";
import { credentialFile } from "./credentials.js";

export const credentialPdfVersion = 2;

async function originalImageData(file: string) {
  const buffer = fs.readFileSync(file), metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  if (["png", "jpeg"].includes(metadata.format || "") && (!metadata.orientation || metadata.orientation === 1)) {
    return `data:image/${metadata.format};base64,${buffer.toString("base64")}`;
  }
  return `data:image/png;base64,${(await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer()).toString("base64")}`;
}

export async function buildCredentialPdf(snapshot: CredentialSnapshot, photoFile: string | null, verificationUrl: string | null, layout: "card" | "letter", draft = false) {
  const logoFile = institutionLogoFile(snapshot.student.logoPath);
  const [photo, logo, signature] = await Promise.all([
    photoFile ? originalImageData(credentialFile(photoFile)) : null,
    logoFile ? originalImageData(logoFile) : null,
    snapshot.template.signatureFile ? originalImageData(credentialFile(snapshot.template.signatureFile)) : null
  ]);
  const qr = verificationUrl ? QRCode.create(verificationUrl, { errorCorrectionLevel: "M" }).modules : null;
  const dimensions = credentialDimensions(snapshot.template.size), mm = 72 / 25.4;
  const width = dimensions.width * mm, height = dimensions.height * mm;
  const doc = new PDFDocument({ autoFirstPage: false, compress: true, pdfVersion: "1.7", info: {
    Title: `${draft ? "Vista previa" : "Credencial estudiantil"} - ${snapshot.student.name}`,
    Author: snapshot.template.institution, Subject: "Credencial de estudiante · frente y reverso"
  } });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(Buffer.from(chunk))); doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
  });
  const measure = (text: string, size: number, bold: boolean) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).widthOfString(text);
  const boxes = credentialImageLayout(snapshot);
  const vector = (svg: string, x: number, y: number) => {
    // The upstream declaration expects a constructor; the actual API receives a PDFKit document.
    SVGtoPDF(doc as unknown as typeof PDFDocument, svg, x, y, { width, height, assumePt: true,
      fontCallback: (_family, bold) => bold ? "Helvetica-Bold" : "Helvetica" });
  };
  const draw = (side: "front" | "back", x: number, y: number) => {
    // SVG clip-paths become luminosity masks, which can hide images in Apple's PDF viewer.
    // Keep the vectors, but embed original image pixels with standard native PDF clipping.
    vector(credentialSvg(snapshot, side, { logo, photo, signature, qr: draft ? null : qr }, measure, false, false), x, y);
    doc.save().translate(x, y).scale(width / 1000);
    if (logo) {
      const { frame, image } = boxes.logo;
      doc.save().rect(frame.x, frame.y, frame.width, frame.height).clip();
      doc.image(logo, image.x, image.y, { fit: [image.width, image.height], align: "center", valign: "center" });
      doc.restore();
    }
    if (side === "front" && photo) {
      const { frame, image } = boxes.photo;
      doc.save().circle(frame.x, frame.y, frame.radius).clip();
      doc.image(photo, image.x, image.y, { width: image.width, height: image.height });
      doc.restore();
    }
    if (side === "back" && signature) {
      const box = boxes.signature;
      doc.image(signature, box.x, box.y, { fit: [box.width, box.height], align: "center", valign: "center" });
    }
    doc.restore();
    if (draft) vector(credentialDraftSvg(snapshot), x, y);
    if (verificationUrl && side === "front" && !draft) {
      const scale = width / 1000, viewHeight = dimensions.height / dimensions.width * 1000;
      doc.link(x + 447 * scale, y + (viewHeight - 475) * scale, 350 * scale, 350 * scale, verificationUrl);
    }
  };
  if (layout === "card") {
    for (const side of ["front", "back"] as const) { doc.addPage({ size: [width, height], margin: 0 }); draw(side, 0, 0); }
  } else {
    doc.addPage({ size: "LETTER", margin: 36 });
    doc.fillColor(snapshot.template.primaryColor).font("Helvetica-Bold").fontSize(17).text(snapshot.template.institution, 36, 38, { width: 540, align: "center" });
    doc.font("Helvetica").fontSize(10).text("CREDENCIAL DE ESTUDIANTE · FRENTE Y REVERSO", 36, 67, { width: 540, align: "center" });
    doc.fillColor("#52617A").fontSize(9).text("Imprime a tamaño real (100%), sin ajustar a la página. Recorta por las guías.", 36, 90, { width: 540, align: "center" });
    const gap = 32, left = (612 - width * 2 - gap) / 2, top = 150;
    for (const [index, side] of ["front", "back"].entries()) {
      const x = left + index * (width + gap);
      draw(side as "front" | "back", x, top);
      doc.save().lineWidth(.5).strokeColor("#8090A8");
      for (const [cx, cy, dx, dy] of [[x, top, -1, -1], [x + width, top, 1, -1], [x, top + height, -1, 1], [x + width, top + height, 1, 1]]) {
        doc.moveTo(cx + dx * 3, cy).lineTo(cx + dx * 10, cy).stroke();
        doc.moveTo(cx, cy + dy * 3).lineTo(cx, cy + dy * 10).stroke();
      }
      doc.restore();
      doc.fillColor("#52617A").font("Helvetica").fontSize(8).text(index ? "REVERSO" : "FRENTE", x, top + height + 18, { width, align: "center" });
    }
    const textY = top + height + 55;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#24364A").text(snapshot.student.name, 50, textY, { width: 512, align: "center" });
    doc.font("Helvetica").fontSize(9).text(`Matrícula: ${snapshot.student.number} · ${dimensions.width} × ${dimensions.height} mm`, 50, doc.y + 8, { width: 512, align: "center" });
    doc.fontSize(8).fillColor("#52617A").text(draft ? "VISTA PREVIA · Esta credencial todavía no está activada." : `Folio: ${snapshot.folio}`, 50, doc.y + 12, { width: 512, align: "center" });
  }
  doc.end();
  return completed;
}
