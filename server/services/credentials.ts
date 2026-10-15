import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import QRCode from "qrcode";
import { all, databasePath, get, run, transaction } from "../db.js";
import { ApiError, cleanText } from "../utils.js";
import { publicAppUrl } from "./document-verification.js";
import { validCalendarDate } from "./academic-calendar.js";
import { defaultCredentialTemplate, type CredentialFraming, type CredentialPhotoSubmission, type CredentialSnapshot, type CredentialState, type CredentialStatus, type CredentialStudent, type CredentialTemplate, type CredentialValidity, type CredentialVerification } from "../../shared/credentials.js";
import { buildCredentialPdf, credentialPdfVersion } from "./credential-pdf.js";
import { prepareCredentialPhoto } from "./credential-photo-preparation.js";

const vault = path.join(path.dirname(databasePath), "credentials");
type Profile = { student_id: number; photo_file: string; photo_width: number; photo_height: number; photo_hash: string; crop_x: number; crop_y: number; zoom: number; valid_until: string | null; revision: number };
export type CredentialIssueRow = { id: string; token: string; folio: string; student_id: number | null; photo_file: string; card_file: string; print_file: string; snapshot_json: string; snapshot_hash: string; verification_url: string; issued_at: string; revoked_at: string | null; revocation_reason: string | null };
type PhotoSubmissionRow = {
  id: string; student_id: number; status: CredentialPhotoSubmission["status"];
  source_file: string; original_file: string; prepared_file: string; original_hash: string; prepared_hash: string;
  width: number; height: number; crop_x: number; crop_y: number; zoom: number; processing_json: string;
  submitted_at: string; reviewed_at: string | null; review_note: string | null;
  approved_variant: "original" | "prepared" | null;
};
const digest = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
export const credentialToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City" }).format(new Date());

export function credentialFile(filename: string) {
  if (!/^(photos|signatures|issues)\/[a-z0-9-]+\.(jpeg|jpg|png|webp|pdf)$/.test(filename)) throw new ApiError(400, "Archivo de credencial no válido.");
  return path.join(vault, filename);
}
function writeFile(filename: string, data: Buffer) {
  const target = credentialFile(filename); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: "wx", mode: 0o600 });
}
function removeFiles(filenames: string[]) { for (const file of filenames) fs.rmSync(credentialFile(file), { force: true }); }

export function credentialStudent(studentId: number): CredentialStudent {
  const row = get<{id:number;name:string;number:string;program:string;group_name:string;cycle:string;cycle_id:number|null;cycle_start:string|null;cycle_end:string|null;is_active:number;is_terminal:number;enrollment_id:number|null;logo_path:string|null}>(
    `SELECT st.id, TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name,'')) AS name,
      st.student_number AS number, COALESCE(p.name,'Sin programa registrado') AS program,
      COALESCE(g.name,'') AS group_name, COALESCE(sc.name,'') AS cycle, st.is_active, ss.is_terminal,
      e.id AS enrollment_id, i.logo_path, sc.id AS cycle_id, sc.start_date AS cycle_start, sc.end_date AS cycle_end
     FROM students st JOIN student_statuses ss ON ss.id=st.status_id
     LEFT JOIN enrollments e ON e.id=(SELECT candidate.id FROM enrollments candidate WHERE candidate.student_id=st.id AND candidate.is_active=1 ORDER BY candidate.id DESC LIMIT 1)
     LEFT JOIN programs p ON p.id=e.program_id LEFT JOIN groups g ON g.id=e.group_id
     JOIN institution_settings i ON i.id=1
     LEFT JOIN school_cycles sc ON sc.id=COALESCE(g.active_cycle_id,i.active_cycle_id,e.cycle_id)
     WHERE st.id=?`, studentId
  );
  if (!row) throw new ApiError(404, "No se encontró al alumno en el padrón.");
  return { id: row.id, name: row.name, number: row.number, program: row.program, group: row.group_name, cycle: row.cycle,
    cycleId: row.cycle_id, cycleStart: row.cycle_start, cycleEnd: row.cycle_end,
    active: !!row.is_active && !row.is_terminal, enrolled: row.enrollment_id != null, logoPath: row.logo_path };
}

/** Six calendar months, clamped to the last day when the destination month is shorter. */
export function sixMonthsAfter(value: string) {
  const date = new Date(`${value}T12:00:00Z`), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 6);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
export function credentialValidity(student: CredentialStudent): CredentialValidity | null {
  if (!student.cycleId || !student.cycleStart || !student.cycleEnd || !validCalendarDate(student.cycleStart) || !validCalendarDate(student.cycleEnd) || student.cycleEnd < student.cycleStart) return null;
  const today = credentialToday(), validFrom = today < student.cycleStart ? student.cycleStart : today;
  return { cycleId: student.cycleId, cycle: student.cycle, cycleStart: student.cycleStart, cycleEnd: student.cycleEnd,
    validFrom, validUntil: [student.cycleEnd, sixMonthsAfter(validFrom)].sort()[0], maxMonths: 6 };
}

export function credentialTemplate(): CredentialTemplate {
  const row = get<{version:number;template_json:string}>("SELECT version,template_json FROM credential_settings WHERE id=1");
  if (row) return { ...defaultCredentialTemplate, ...JSON.parse(row.template_json), version: row.version };
  const school = get<{institution_name:string}>("SELECT institution_name FROM institution_settings WHERE id=1");
  return { ...defaultCredentialTemplate, institution: school?.institution_name || defaultCredentialTemplate.institution };
}
export function validateCredentialTemplate(body: any, current = credentialTemplate()): CredentialTemplate {
  const result = { ...current };
  for (const key of ["primaryColor", "lightColor", "accentColor"] as const) if (body[key] !== undefined) {
    if (typeof body[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(body[key])) throw new ApiError(400, "Selecciona colores válidos para la credencial.");
    result[key] = body[key];
  }
  if (body.size !== undefined) {
    if (!["reference", "standard"].includes(body.size)) throw new ApiError(400, "El tamaño de credencial no es válido.");
    result.size = body.size;
  }
  const limits = { sideLabel: 45, title: 32, institution: 160, campus: 90, website: 160, phone: 50, email: 180,
    address: 240, directorName: 140, directorTitle: 120, backText: 650 } as const;
  for (const [key, limit] of Object.entries(limits) as Array<[keyof typeof limits, number]>) if (body[key] !== undefined) {
    if (typeof body[key] !== "string" || body[key].length > limit) throw new ApiError(400, `El campo ${key} excede la longitud permitida.`);
    result[key] = cleanText(body[key], limit);
  }
  if (!result.sideLabel || !result.title || !result.institution || !result.backText) throw new ApiError(400, "La institución, el título, la franja y el texto de reverso son obligatorios.");
  return result;
}
export function saveCredentialTemplate(body: any, userId: number, signatureFile?: string | null) {
  return transaction(() => {
    const current = credentialTemplate();
    if (Number(body.version) !== current.version) throw new ApiError(409, "El diseño cambió. Recarga antes de guardar.");
    const template = validateCredentialTemplate(body, current);
    if (signatureFile !== undefined) template.signatureFile = signatureFile;
    template.version = current.version + 1;
    run(`INSERT INTO credential_settings(id,version,template_json,updated_by) VALUES(1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version,template_json=excluded.template_json,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
      template.version, JSON.stringify(template), userId);
    return template;
  });
}

export async function inspectCredentialImage(buffer: Buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error("format");
    await image.stats(); // Decode the actual pixels; a file extension or image header is insufficient.
    const rotated = (metadata.orientation ?? 1) >= 5;
    return { extension: metadata.format!, width: rotated ? metadata.height : metadata.width,
      height: rotated ? metadata.width : metadata.height, hash: digest(buffer) };
  } catch { throw new ApiError(400, "Carga una fotografía válida JPG, PNG o WebP, de hasta 40 megapíxeles y sin animación."); }
}
export async function credentialImageData(filename: string) {
  const buffer = fs.readFileSync(credentialFile(filename));
  const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
  if (metadata.format === "jpeg" && (!metadata.orientation || metadata.orientation === 1)) return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  const normalized = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer();
  return `data:image/png;base64,${normalized.toString("base64")}`;
}
export async function saveCredentialSignature(buffer: Buffer, version: unknown, userId: number) {
  const image = await inspectCredentialImage(buffer), file = `signatures/${crypto.randomUUID()}.${image.extension}`;
  writeFile(file, buffer);
  try { return saveCredentialTemplate({ version }, userId, file); } catch (error) { removeFiles([file]); throw error; }
}
function profile(studentId: number) { return get<Profile>("SELECT * FROM student_credentials WHERE student_id=?", studentId); }
export function latestCredentialIssue(studentId: number) {
  return get<CredentialIssueRow>("SELECT * FROM credential_issues WHERE student_id=? ORDER BY issued_at DESC,rowid DESC LIMIT 1", studentId);
}
export function credentialIssueByToken(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new ApiError(404, "No se encontró la credencial.");
  const issue = get<CredentialIssueRow>("SELECT * FROM credential_issues WHERE token=?", token);
  if (!issue) throw new ApiError(404, "No se encontró la credencial.");
  return issue;
}
export function credentialIssueStatus(issue: CredentialIssueRow): CredentialStatus {
  if (issue.revoked_at) return "revoked";
  if (digest(issue.snapshot_json) !== issue.snapshot_hash) return "needs_review";
  const snapshot = JSON.parse(issue.snapshot_json) as CredentialSnapshot;
  if (!snapshot.validity) return "needs_review";
  if (snapshot.validity.validUntil < credentialToday()) return "expired";
  if (!issue.student_id) return "inactive";
  let student: CredentialStudent;
  try { student = credentialStudent(issue.student_id); } catch { return "inactive"; }
  if (!student.active || !student.enrolled) return "inactive";
  if ((["name", "number", "program", "cycleId", "cycleStart", "cycleEnd"] as const).some(key => student[key] !== snapshot.student[key])) return "needs_review";
  if (credentialToday() < snapshot.validity.validFrom) return "needs_review";
  if (![issue.photo_file, issue.card_file, issue.print_file].every(file => fs.existsSync(credentialFile(file)))) return "needs_review";
  return "active";
}
export function getCredentialState(studentId: number): CredentialState {
  const student = credentialStudent(studentId), template = credentialTemplate(), current = profile(studentId), issue = latestCredentialIssue(studentId);
  let status: CredentialStatus = !current ? "missing_photo" : issue ? credentialIssueStatus(issue) : "draft";
  if (issue?.revoked_at && ["photo_changed", "framing_changed"].includes(issue.revocation_reason || "")) status = "draft";
  if (!student.active || !student.enrolled) status = "inactive";
  if (current && !fs.existsSync(credentialFile(current.photo_file))) status = "missing_photo";
  const qr = issue ? QRCode.create(issue.verification_url, { errorCorrectionLevel: "M" }).modules : null;
  return {
    student, template, status, revision: current?.revision ?? 0, validity: credentialValidity(student),
    framing: { cropX: current?.crop_x ?? .5, cropY: current?.crop_y ?? .5, zoom: current?.zoom ?? 1 },
    photo: current ? { width: current.photo_width, height: current.photo_height, sha256: current.photo_hash } : null,
    submission: publicPhotoSubmission(latestPhotoSubmission(studentId)),
    canDownload: status === "active", issue: issue && qr ? { id: issue.id, folio: issue.folio, issuedAt: issue.issued_at,
      verificationUrl: issue.verification_url, snapshot: JSON.parse(issue.snapshot_json), qr: { size: qr.size, data: Array.from(qr.data) } } : null
  };
}
function revokeCurrent(studentId: number, reason: string) {
  run("UPDATE credential_issues SET revoked_at=?,revocation_reason=? WHERE student_id=? AND revoked_at IS NULL", new Date().toISOString(), reason, studentId);
}
export function validateCredentialFraming(body: any, current: CredentialFraming): CredentialFraming {
  const result = { ...current };
  for (const [key, min, max] of [["cropX", 0, 1], ["cropY", 0, 1], ["zoom", 1, 3]] as const) if (body[key] !== undefined) {
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < min || value > max) throw new ApiError(400, "El encuadre de la fotografía no es válido.");
    result[key] = value;
  }
  if (body.validUntil !== undefined) throw new ApiError(400, "La vigencia se calcula automáticamente a partir del ciclo escolar activo, con un máximo de seis meses.");
  return result;
}
function expectRevision(studentId: number, revision: unknown) {
  const current = profile(studentId);
  if (!Number.isInteger(Number(revision)) || Number(revision) !== (current?.revision ?? 0)) throw new ApiError(409, "La credencial cambió. Recarga sus datos antes de continuar.");
  return current;
}
export async function saveCredentialPhoto(studentId: number, buffer: Buffer, revision: unknown, userId: number) {
  credentialStudent(studentId); expectRevision(studentId, revision);
  const info = await inspectCredentialImage(buffer), file = `photos/${crypto.randomUUID()}.${info.extension}`;
  writeFile(file, buffer);
  try {
    transaction(() => {
      expectRevision(studentId, revision); revokeCurrent(studentId, "photo_changed");
      run(`INSERT INTO student_credentials(student_id,photo_file,photo_width,photo_height,photo_hash,updated_by)
        VALUES(?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET photo_file=excluded.photo_file,photo_width=excluded.photo_width,
        photo_height=excluded.photo_height,photo_hash=excluded.photo_hash,crop_x=0.5,crop_y=0.5,zoom=1,
        revision=student_credentials.revision+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
        studentId, file, info.width, info.height, info.hash, userId);
    });
  } catch (error) { removeFiles([file]); throw error; }
  return getCredentialState(studentId);
}
export function saveCredentialFraming(studentId: number, body: any, userId: number) {
  return transaction(() => {
    const current = expectRevision(studentId, body.revision);
    if (!current) throw new ApiError(409, "Primero carga la fotografía del alumno.");
    const framing = validateCredentialFraming(body, { cropX: current.crop_x, cropY: current.crop_y, zoom: current.zoom });
    if (framing.cropX !== current.crop_x || framing.cropY !== current.crop_y || framing.zoom !== current.zoom) {
      revokeCurrent(studentId, "framing_changed");
      run("UPDATE student_credentials SET crop_x=?,crop_y=?,zoom=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE student_id=?", framing.cropX, framing.cropY, framing.zoom, userId, studentId);
    }
    return getCredentialState(studentId);
  });
}
export function deactivateCredential(studentId: number, revision: unknown, userId: number) {
  transaction(() => { expectRevision(studentId, revision); revokeCurrent(studentId, "administrative");
    run("UPDATE student_credentials SET revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE student_id=?", userId, studentId); });
  return getCredentialState(studentId);
}

export async function activateCredential(studentId: number, body: any, userId: number,
  submission?: { row: PhotoSubmissionRow; variant: "original" | "prepared" }) {
  const state = getCredentialState(studentId), current = expectRevision(studentId, body.revision);
  const photoFile = submission ? submission.row[`${submission.variant}_file`] : current?.photo_file;
  const photo = submission ? { width: submission.row.width, height: submission.row.height, sha256: submission.row[`${submission.variant}_hash`] } : state.photo;
  if (!photoFile || !photo || !fs.existsSync(credentialFile(photoFile))) throw new ApiError(409, "Carga una fotografía antes de activar la credencial.");
  if (submission && digest(fs.readFileSync(credentialFile(photoFile))) !== photo.sha256) throw new ApiError(409, "No se pudo comprobar la foto enviada. Solicita una nueva fotografía.");
  if (!state.student.active || !state.student.enrolled) throw new ApiError(409, "El alumno debe tener una inscripción activa para recibir su credencial.");
  if (body.templateVersion !== undefined && Number(body.templateVersion) !== state.template.version) throw new ApiError(409, "El diseño institucional cambió. Recarga la página para revisar la versión actual antes de activar.");
  if (!state.validity) throw new ApiError(409, "Configura las fechas de inicio y término del ciclo escolar activo antes de activar la credencial.");
  if (credentialToday() < state.validity.cycleStart || credentialToday() > state.validity.cycleEnd) throw new ApiError(409, "La fecha actual debe estar dentro del ciclo escolar activo. Revisa su calendario.");
  const framing = validateCredentialFraming(body, submission ? { cropX: submission.row.crop_x, cropY: submission.row.crop_y, zoom: submission.row.zoom } : state.framing), id = crypto.randomUUID(), token = crypto.randomBytes(24).toString("hex");
  const issuedAt = new Date().toISOString(), folio = `CEST-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  const verificationUrl = `${publicAppUrl()}/verificar-credencial/${token}`;
  const snapshot: CredentialSnapshot = { student: state.student, template: state.template, framing, photo, issuedAt, folio, validity: state.validity };
  const card = await buildCredentialPdf(snapshot, photoFile, verificationUrl, "card");
  const print = await buildCredentialPdf(snapshot, photoFile, verificationUrl, "letter");
  const files = [`issues/${id}-card-v${credentialPdfVersion}.pdf`, `issues/${id}-print-v${credentialPdfVersion}.pdf`];
  try {
    writeFile(files[0], card); writeFile(files[1], print);
    transaction(() => {
      expectRevision(studentId, body.revision);
      if (submission && photoSubmission(studentId, submission.row.id).status !== "pending") throw new ApiError(409, "La foto cambió o ya fue revisada. Recarga antes de aprobar.");
      if (credentialTemplate().version !== state.template.version || JSON.stringify(credentialStudent(studentId)) !== JSON.stringify(state.student)) throw new ApiError(409, "Los datos del alumno o el diseño cambiaron. Recarga y vuelve a activar.");
      revokeCurrent(studentId, "reissued");
      const json = JSON.stringify(snapshot);
      run(`INSERT INTO credential_issues(id,token,folio,student_id,photo_file,card_file,print_file,snapshot_json,snapshot_hash,verification_url,issued_by,issued_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, token, folio, studentId, photoFile, files[0], files[1], json, digest(json), verificationUrl, userId, issuedAt);
      run(`INSERT INTO student_credentials(student_id,photo_file,photo_width,photo_height,photo_hash,crop_x,crop_y,zoom,valid_until,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET photo_file=excluded.photo_file,
        photo_width=excluded.photo_width,photo_height=excluded.photo_height,photo_hash=excluded.photo_hash,
        crop_x=excluded.crop_x,crop_y=excluded.crop_y,zoom=excluded.zoom,valid_until=excluded.valid_until,
        revision=student_credentials.revision+1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,
        studentId, photoFile, photo.width, photo.height, photo.sha256, framing.cropX, framing.cropY, framing.zoom, state.validity!.validUntil, userId);
      if (submission) run(`UPDATE credential_photo_submissions SET status='approved',reviewed_by=?,reviewed_at=?,
        issue_id=?,approved_variant=?,crop_x=?,crop_y=?,zoom=? WHERE id=?`, userId,issuedAt,id,submission.variant,framing.cropX,framing.cropY,framing.zoom,submission.row.id);
    });
  } catch (error) { removeFiles(files); throw error; }
  return getCredentialState(studentId);
}

export function approvedCredential(studentId: number) {
  const issue = latestCredentialIssue(studentId);
  if (!issue || credentialIssueStatus(issue) !== "active") throw new ApiError(403, "Tu credencial todavía no está disponible. Control Escolar debe cargar tu foto y activar una credencial vigente.");
  return issue;
}

const compatiblePdfRenders = new Map<string, Promise<Buffer>>();
/** Repair rendering of old approved PDFs without reissuing identity, QR or validity. */
export async function approvedCredentialPdf(issue: CredentialIssueRow, layout: "card" | "letter") {
  const archived = layout === "letter" ? issue.print_file : issue.card_file;
  if (archived.endsWith(`-v${credentialPdfVersion}.pdf`)) return fs.readFileSync(credentialFile(archived));
  const filename = `issues/${issue.id}-${layout === "letter" ? "print" : "card"}-v${credentialPdfVersion}.pdf`;
  const pending = compatiblePdfRenders.get(filename);
  if (pending) return pending;
  if (fs.existsSync(credentialFile(filename))) return fs.readFileSync(credentialFile(filename));
  const rendering = (async () => {
    const snapshot = JSON.parse(issue.snapshot_json) as CredentialSnapshot;
    const buffer = await buildCredentialPdf(snapshot, issue.photo_file, issue.verification_url, layout);
    const temporary = `issues/${issue.id}-${crypto.randomUUID()}-render.pdf`;
    try {
      writeFile(temporary, buffer);
      fs.renameSync(credentialFile(temporary), credentialFile(filename));
    } finally { removeFiles([temporary]); }
    return buffer;
  })();
  compatiblePdfRenders.set(filename, rendering);
  try { return await rendering; } finally { compatiblePdfRenders.delete(filename); }
}
export function credentialPhotoFile(studentId: number, approved = false) {
  const file = approved ? approvedCredential(studentId).photo_file : profile(studentId)?.photo_file;
  if (!file || !fs.existsSync(credentialFile(file))) throw new ApiError(404, "No hay fotografía cargada para la credencial.");
  return credentialFile(file);
}
export function verifyCredential(token: string): CredentialVerification {
  const issue = credentialIssueByToken(token), status = credentialIssueStatus(issue);
  if (digest(issue.snapshot_json) !== issue.snapshot_hash) throw new ApiError(409, "No se pudo confirmar la integridad de esta credencial.");
  const messages: Record<CredentialStatus, string> = {
    active: "Esta credencial estudiantil está activada por Control Escolar y corresponde a la persona indicada.",
    expired: "La vigencia de esta credencial terminó.", revoked: "Esta credencial fue desactivada y ya no es válida.",
    needs_review: "Esta credencial requiere actualización por Control Escolar.", inactive: "Esta credencial ya no corresponde a una inscripción activa.",
    draft: "Esta credencial está pendiente de activación.", missing_photo: "Esta credencial no tiene fotografía autorizada."
  };
  return { status, message: messages[status], document: JSON.parse(issue.snapshot_json), verificationUrl: issue.verification_url,
    photoUrl: status === "active" ? `/api/credentials/verify/${token}/photo` : null };
}

function latestPhotoSubmission(studentId: number) {
  return get<PhotoSubmissionRow>("SELECT * FROM credential_photo_submissions WHERE student_id=? ORDER BY submitted_at DESC,rowid DESC LIMIT 1", studentId);
}
function publicPhotoSubmission(row: PhotoSubmissionRow | undefined): CredentialPhotoSubmission | null {
  return row ? { id: row.id, status: row.status, submittedAt: row.submitted_at, reviewedAt: row.reviewed_at, reviewNote: row.review_note,
    photo: { width: row.width, height: row.height, sha256: row.approved_variant === "original" ? row.original_hash : row.prepared_hash },
    framing: { cropX: row.crop_x, cropY: row.crop_y, zoom: row.zoom }, processing: JSON.parse(row.processing_json) } : null;
}
function photoSubmission(studentId: number, id: string) {
  const row = get<PhotoSubmissionRow>("SELECT * FROM credential_photo_submissions WHERE id=? AND student_id=?",id,studentId);
  if (!row) throw new ApiError(404, "No se encontró la foto enviada por este alumno.");
  return row;
}
export async function photoSubmissionImage(studentId: number, id: string | undefined, variant: unknown) {
  if (variant !== undefined && variant !== "original" && variant !== "prepared") throw new ApiError(400, "Selecciona una versión válida de la fotografía.");
  const row = id ? photoSubmission(studentId,id) : latestPhotoSubmission(studentId);
  if (!row) throw new ApiError(404, "Aún no has enviado una fotografía.");
  return credentialImageData(variant === "original" || (variant === undefined && row.approved_variant === "original") ? row.original_file : row.prepared_file);
}
let photoProcessing: Promise<unknown> = Promise.resolve();
let queuedPhotos = 0;
export function submitCredentialPhoto(studentId: number, buffer: Buffer, body: any, userId: number): Promise<CredentialState> {
  if (queuedPhotos >= 4) return Promise.reject(new ApiError(503, "Se están preparando varias fotografías. Espera unos segundos y vuelve a enviar la tuya."));
  queuedPhotos++;
  const work = photoProcessing.then(async () => {
    const student = credentialStudent(studentId);
    if (!student.active || !student.enrolled) throw new ApiError(403, "Necesitas una inscripción activa para enviar tu fotografía.");
    if (body.requirementsAccepted !== "true" && body.requirementsAccepted !== true) throw new ApiError(400, "Confirma que la fotografía cumple con el fondo blanco, uniforme y rostro centrado.");
    const previous = () => latestPhotoSubmission(studentId)?.id || "";
    if (String(body.previousId || "") !== previous()) throw new ApiError(409, "Tu envío cambió. Actualiza la página antes de enviar otra foto.");
    const info = await inspectCredentialImage(buffer);
    if (info.width < 320 || info.height < 320) throw new ApiError(400, "Usa una foto de al menos 320 × 320 píxeles para que tu credencial sea legible.");
    const framing = validateCredentialFraming(body,{ cropX: .5, cropY: .5, zoom: 1 });
    const prepared = await prepareCredentialPhoto(buffer,body.improveBackground !== "false" && body.improveBackground !== false);
    const id = crypto.randomUUID(), sourceFile = `photos/${id}-source.${info.extension}`, originalFile = `photos/${id}-original.jpg`;
    const preparedFile = prepared.processing.adjusted ? `photos/${id}-prepared.jpg` : originalFile;
    const files = [sourceFile,originalFile,...(preparedFile === originalFile ? [] : [preparedFile])];
    try {
      writeFile(sourceFile,buffer); writeFile(originalFile,prepared.original);
      if (preparedFile !== originalFile) writeFile(preparedFile,prepared.prepared);
      transaction(() => {
        if (String(body.previousId || "") !== previous()) throw new ApiError(409, "Tu envío cambió. Revisa la última foto antes de reemplazarla.");
        const now = new Date().toISOString();
        run("UPDATE credential_photo_submissions SET status='superseded',reviewed_at=? WHERE student_id=? AND status='pending'",now,studentId);
        run(`INSERT INTO credential_photo_submissions(id,student_id,source_file,original_file,prepared_file,original_hash,prepared_hash,
          width,height,crop_x,crop_y,zoom,processing_json,submitted_by,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id,studentId,sourceFile,originalFile,preparedFile,digest(prepared.original),digest(prepared.prepared),info.width,info.height,
          framing.cropX,framing.cropY,framing.zoom,JSON.stringify(prepared.processing),userId,now);
      });
    } catch (error) { removeFiles(files); throw error; }
    return getCredentialState(studentId);
  });
  photoProcessing = work.catch(() => undefined);
  return work.finally(() => { queuedPhotos--; });
}
export function rejectCredentialPhoto(studentId: number, id: string, note: unknown, userId: number) {
  const reason = cleanText(note,500);
  if (reason.length < 5) throw new ApiError(400, "Indica al alumno qué debe corregir en su fotografía.");
  transaction(() => {
    if (photoSubmission(studentId,id).status !== "pending") throw new ApiError(409, "La foto ya fue revisada o reemplazada. Actualiza los datos.");
    run("UPDATE credential_photo_submissions SET status='rejected',reviewed_at=?,reviewed_by=?,review_note=? WHERE id=?",new Date().toISOString(),userId,reason,id);
  });
  return getCredentialState(studentId);
}
export function approveCredentialPhoto(studentId: number, id: string, body: any, userId: number) {
  if (body.requirementsAccepted !== true) throw new ApiError(400, "Confirma que revisaste el fondo blanco, el uniforme y el rostro centrado.");
  const row = photoSubmission(studentId,id);
  if (row.status !== "pending") throw new ApiError(409, "La foto ya fue revisada o reemplazada. Actualiza los datos.");
  if (body.variant !== "original" && body.variant !== "prepared") throw new ApiError(400, "Selecciona la foto original o la versión con fondo aclarado.");
  return activateCredential(studentId,body,userId,{row,variant:body.variant});
}

export function searchCredentialStudents(search: string, page: number, pendingOnly = false) {
  const term = `%${search}%`, limit = 30;
  const where = "(st.student_number LIKE ? OR spanish_sort(TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name,''))) LIKE spanish_sort(?))"
    + (pendingOnly ? " AND EXISTS(SELECT 1 FROM credential_photo_submissions ps WHERE ps.student_id=st.id AND ps.status='pending')" : "");
  const count = get<{total:number}>(`SELECT COUNT(*) AS total FROM students st WHERE ${where}`, term, term)!.total;
  const records = all(`SELECT st.id,st.student_number,TRIM(st.first_name||' '||st.last_name||' '||COALESCE(st.second_last_name,'')) AS name,st.is_active,
    CASE WHEN EXISTS(SELECT 1 FROM student_credentials c WHERE c.student_id=st.id) THEN 1 ELSE 0 END AS has_photo,
    CASE WHEN EXISTS(SELECT 1 FROM credential_photo_submissions ps WHERE ps.student_id=st.id AND ps.status='pending') THEN 1 ELSE 0 END AS pending_photo
    FROM students st WHERE ${where} ORDER BY st.is_active DESC,spanish_sort(st.last_name),spanish_sort(st.first_name),st.id LIMIT ? OFFSET ?`, term, term, limit, (page - 1) * limit);
  return { records, page, pages: Math.ceil(count / limit), total: count,
    pending_total: get<{total:number}>("SELECT COUNT(*) AS total FROM credential_photo_submissions WHERE status='pending'")!.total };
}
