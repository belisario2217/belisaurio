import { credentialDimensions, type CredentialSnapshot } from "./credentials.js";
import { displayProgramName } from "./program-name.js";

type Measure = (text: string, size: number, bold: boolean) => number;
export type TextFit = { lines: string[]; size: number; lineHeight: number };
export function fitCredentialText(text: string, width: number, height: number, maxSize: number, measure: Measure, bold = false): TextFit {
  const wrap = (size: number) => text.normalize("NFC").split(/\r?\n/).flatMap(paragraph => {
    const lines: string[] = []; let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (measure(line ? `${line} ${word}` : word, size, bold) <= width) { line = line ? `${line} ${word}` : word; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const letter of Array.from(word)) {
        if (line && measure(line + letter, size, bold) > width) { lines.push(line); line = ""; }
        line += letter;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  });
  for (let size = maxSize; size >= 2; size -= .5) {
    const lines = wrap(size), lineHeight = size * 1.14;
    if (lines.length * lineHeight <= height) return { lines, size, lineHeight };
  }
  const lines = wrap(2), size = Math.min(2, height / (lines.length * 1.14));
  return { lines, size, lineHeight: size * 1.14 };
}
function escapeXml(value: string) { return value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!)); }
export type CredentialArtworkAssets = { logo?: string | null; photo?: string | null; signature?: string | null; qr?: { size: number; data: ArrayLike<number> } | null };

/** Geometry shared by SVG previews and native PDF image placement. */
export function credentialImageLayout(snapshot: Pick<CredentialSnapshot,"photo" | "framing">) {
  const logoSize = 84, imageSize = logoSize / .95, offset = (imageSize - logoSize) / 2;
  const scale = Math.max(420 / snapshot.photo.width, 420 / snapshot.photo.height) * snapshot.framing.zoom;
  const width = snapshot.photo.width * scale, height = snapshot.photo.height * scale;
  return {
    logo: { frame: { x: 580, y: 48, width: logoSize, height: logoSize }, image: { x: 580 - offset, y: 48 - offset, width: imageSize, height: imageSize } },
    photo: { frame: { x: 622, y: 472, radius: 210 }, image: { x: 412 - (width - 420) * snapshot.framing.cropX, y: 262 - (height - 420) * snapshot.framing.cropY, width, height } },
    signature: { x: 390, y: 470, width: 470, height: 195 }
  };
}
const draftMark = (color: string) => `<g transform="translate(620 745) rotate(-24)"><rect x="-355" y="-45" width="710" height="90" fill="#FFFFFF" opacity=".92"/><text text-anchor="middle" y="14" font-family="Helvetica" font-weight="bold" font-size="32" fill="${color}">VISTA PREVIA · SIN ACTIVAR</text></g>`;
export function credentialDraftSvg(snapshot: CredentialSnapshot) {
  const size = credentialDimensions(snapshot.template.size);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${size.height / size.width * 1000}">${draftMark(snapshot.template.primaryColor)}</svg>`;
}

/** Shared vector artwork for the live preview and the PDF, with bounded text boxes. */
export function credentialSvg(snapshot: CredentialSnapshot, side: "front" | "back", assets: CredentialArtworkAssets, measure: Measure, draft = false, includeImages = true) {
  const { template: t, student, validity } = snapshot;
  const dimensions = credentialDimensions(t.size), height = dimensions.height / dimensions.width * 1000;
  const primary = t.primaryColor, light = t.lightColor, accent = t.accentColor;
  const boxes = credentialImageLayout(snapshot);
  const parts: string[] = [];
  const text = (value: string, x: number, y: number, width: number, boxHeight: number, size: number, color: string, bold = false, align: "center" | "left" = "center") => {
    const fit = fitCredentialText(value, width, boxHeight, size, measure, bold);
    const start = y + (boxHeight - fit.lines.length * fit.lineHeight) / 2 + fit.size;
    parts.push(`<text font-family="Helvetica" font-weight="${bold ? "bold" : "normal"}" font-size="${fit.size}" fill="${color}" text-anchor="${align === "center" ? "middle" : "start"}">${fit.lines.map((line, index) => `<tspan x="${align === "center" ? x + width / 2 : x}" y="${start + index * fit.lineHeight}">${escapeXml(line)}</tspan>`).join("")}</text>`);
  };
  const image = (href: string, x: number, y: number, width: number, imageHeight: number, extra = "") => { if (includeImages) parts.push(`<image href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" ${extra}/>`); };
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 ${height}" role="img" aria-label="${side === "front" ? "Frente" : "Reverso"} de la credencial de ${escapeXml(student.name)}">`);
  parts.push(`<rect width="1000" height="${height}" fill="${side === "front" ? primary : light}"/><rect width="245" height="${height}" fill="${side === "front" ? light : primary}"/>`);
  for (let x = 7; x < 245; x += 15) for (let y = 7; y < height; y += 15) parts.push(`<circle cx="${x}" cy="${y}" r="1.65" fill="${side === "front" ? primary : light}" opacity="${.12 + .2 * (1 - x / 245)}"/>`);
  const sideText = side === "front" ? t.sideLabel : t.title;
  let sideSize = 112;
  while (sideSize > 2 && measure(sideText, sideSize, true) > height - 480) sideSize -= .5;
  parts.push(`<g transform="translate(163 ${height - 85}) rotate(-90)"><text font-family="Helvetica" font-size="${sideSize}" font-weight="bold" fill="${side === "front" ? primary : light}">${escapeXml(sideText)}</text></g>`);
  if (side === "front") {
    let titleSize = 31;
    while (titleSize > 2 && measure(t.title, titleSize, true) > 255) titleSize -= .5;
    parts.push(`<text transform="translate(72 285) rotate(-90)" font-family="Helvetica" font-weight="bold" font-size="${titleSize}" fill="${primary}">${escapeXml(t.title)}</text>`);
  }
  parts.push(`<circle cx="622" cy="90" r="65" fill="#FFFFFF"/>`);
  // An 84 × 84 square, including its corners, fits inside the circular seal with padding.
  if (assets.logo) {
    // Hide the source image's outer black rule in the credential without altering the logo file.
    const { frame, image: position } = boxes.logo, clipId = `credential-logo-${side}`;
    parts.push(`<defs><clipPath id="${clipId}"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath></defs>`);
    image(assets.logo, position.x, position.y, position.width, position.height, `clip-path="url(#${clipId})"`);
  } else text(t.institution, 580, 48, 84, 84, 23, primary, true);
  if (side === "front") {
    text(`ESTUDIANTE · ${t.campus.toLocaleUpperCase("es-MX")}`, 300, 183, 645, 35, 21, light, true);
    for (const [ring, radius] of [[0, 243], [1, 275]] as const) for (let i = 0; i < 42; i++) {
      const angle = i / 42 * Math.PI * 2;
      parts.push(`<circle cx="${622 + Math.cos(angle) * radius}" cy="${472 + Math.sin(angle) * radius}" r="${ring ? 5 : 11}" fill="${accent}" opacity="${ring ? .4 : .6}"/>`);
    }
    parts.push(`<defs><clipPath id="portrait"><circle cx="622" cy="472" r="210"/></clipPath></defs><circle cx="622" cy="472" r="221" fill="${accent}"/><circle cx="622" cy="472" r="210" fill="#FFFFFF"/>`);
    if (assets.photo) {
      const position = boxes.photo.image;
      if (includeImages) parts.push(`<image href="${escapeXml(assets.photo)}" x="${position.x}" y="${position.y}" width="${position.width}" height="${position.height}" preserveAspectRatio="none" clip-path="url(#portrait)"/>`);
    } else {
      parts.push(`<circle cx="622" cy="420" r="62" fill="${light}"/><path d="M505 638 Q505 505 622 505 Q739 505 739 638" fill="${light}"/>`);
      text("FOTOGRAFÍA", 462, 650, 320, 30, 22, primary);
    }
    text(student.name.toLocaleUpperCase("es-MX"), 285, 767, 675, 100, 44, "#FFFFFF", true);
    text(displayProgramName(student.program).toLocaleUpperCase("es-MX"), 290, 876, 665, 74, 31, light, true);
    text(student.number, 300, 958, 645, 48, 34, "#FFFFFF", true);
    const qrSize = 350, qrX = 447, qrY = height - 475;
    parts.push(`<rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" rx="16" fill="#FFFFFF"/>`);
    if (assets.qr && !draft) {
      const module = qrSize / (assets.qr.size + 8);
      for (let row = 0; row < assets.qr.size; row++) for (let col = 0; col < assets.qr.size; col++) if (assets.qr.data[row * assets.qr.size + col]) {
        parts.push(`<rect x="${qrX + (col + 4) * module}" y="${qrY + (row + 4) * module}" width="${module + .015}" height="${module + .015}" fill="#000000"/>`);
      }
    } else text("QR DE VALIDACIÓN\nSE HABILITA AL ACTIVAR", qrX + 28, qrY + 90, qrSize - 56, 170, 26, primary, true);
    text(validity ? `VIGENCIA: ${validity.validUntil.split("-").reverse().join("/")}` : "CICLO POR CONFIGURAR", 290, height - 112, 665, 30, 23, light, true);
    text(t.website, 280, height - 62, 685, 32, 24, "#FFFFFF");
  } else {
    text(t.campus, 335, 165, 580, 27, 20, primary, true);
    text(t.backText, 335, 193, 580, 270, 31, primary, false, "left");
    if (assets.signature) image(assets.signature, boxes.signature.x, boxes.signature.y, boxes.signature.width, boxes.signature.height);
    else text("FIRMA Y SELLO", 390, 545, 470, 50, 23, primary);
    parts.push(`<line x1="390" y1="700" x2="860" y2="700" stroke="${accent}" stroke-width="3"/>`);
    text(t.directorName, 315, 715, 615, 75, 32, primary, true);
    text(t.directorTitle, 315, 805, 615, 110, 36, primary, true);
    text([t.phone, t.email, t.address].filter(Boolean).join("\n"), 330, height - 505, 585, 240, 31, primary);
    text(t.website, 310, height - 255, 625, 45, 28, primary, true);
    text(`CICLO: ${validity?.cycle || student.cycle || "POR CONFIGURAR"}`, 310, height - 198, 625, 35, 21, primary, true);
    text(snapshot.folio, 310, height - 150, 625, 38, 19, primary);
    const issued = snapshot.issuedAt ? new Date(snapshot.issuedAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" }) : "POR ACTIVAR";
    text(`EMISIÓN: ${issued}`, 310, height - 96, 625, 28, 21, primary);
  }
  if (draft) parts.push(draftMark(primary));
  parts.push("</svg>");
  return parts.join("");
}
