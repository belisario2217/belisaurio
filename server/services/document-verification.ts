import crypto from "node:crypto";
import QRCode from "qrcode";
import { get, run } from "../db.js";
import { ApiError } from "../utils.js";
import type { OfficialDocumentSnapshot, OfficialDocumentType, PublicDocumentVerification } from "../../shared/official-document.js";

const titles: Record<OfficialDocumentType, string> = {
  report_card: "Boleta de calificaciones", academic_history: "Historial académico",
  study_certificate: "Constancia de estudios", account_statement: "Estado de cuenta del alumno"
};
const prefixes: Record<OfficialDocumentType, string> = {
  report_card: "BO", academic_history: "HA", study_certificate: "CE", account_statement: "EC"
};

export function normalizePublicAppUrl(input: unknown) {
  if (input == null || input === "") return null;
  if (typeof input !== "string" || input.length > 500) throw new ApiError(400, "La URL pública de la plataforma no es válida.");
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ApiError(400, "Captura la URL completa de la plataforma, por ejemplo https://escuela.edu.mx."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new ApiError(400, "La URL pública debe ser el dominio de la plataforma, sin rutas, contraseñas ni parámetros.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new ApiError(400, "La plataforma pública debe usar HTTPS para validar sus documentos.");
  }
  return url.origin;
}

export function publicAppUrl() {
  const configured = get<{public_app_url:string|null}>("SELECT public_app_url FROM institution_settings WHERE id = 1")?.public_app_url;
  const value = configured || process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_ORIGIN;
  if (!value && process.env.NODE_ENV === "production") {
    throw new ApiError(409, "Configura la URL pública de la plataforma en Configuración para emitir documentos con QR verificable.");
  }
  return normalizePublicAppUrl(value || "http://localhost:4173")!;
}

export type IssuedDocument = {
  id: string; token: string; folio: string; issuedAt: string; verificationUrl: string; qrPng: Buffer;
  snapshot: OfficialDocumentSnapshot; fingerprint: string;
};

/** Store a deliberate public snapshot, not a live student record or its private fields. */
export async function issueDocument(type: OfficialDocumentType, studentId: number, issuedBy: number,
  student: OfficialDocumentSnapshot["student"], content: OfficialDocumentSnapshot["content"]): Promise<IssuedDocument> {
  const baseUrl = publicAppUrl();
  const settings = get<{institution_name:string;logo_path:string|null;director_name:string|null;address:string|null;footer_text:string|null}>(
    "SELECT institution_name, logo_path, director_name, address, footer_text FROM institution_settings WHERE id = 1"
  )!;
  const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString("hex"), issuedAt = new Date().toISOString();
  const localDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City" }).format(new Date(issuedAt)).replaceAll("-", "");
  const folio = `${prefixes[type]}-${localDay}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
  const verificationUrl = `${baseUrl}/verificar-documento/${token}`;
  const snapshot: OfficialDocumentSnapshot = {
    version: 1, folio, type, title: titles[type], issuedAt,
    institution: { name: settings.institution_name, campus: "Campus Frontera", logoPath: settings.logo_path,
      directorName: settings.director_name || "Responsable de Control Escolar", address: settings.address || "", footer: settings.footer_text || "" },
    student, content
  };
  const json = JSON.stringify(snapshot);
  const fingerprint = crypto.createHash("sha256").update(json).digest("hex");
  const qrPng = await QRCode.toBuffer(verificationUrl, { errorCorrectionLevel: "M", width: 360, margin: 4 });
  run(`INSERT INTO issued_documents(id, token, folio, document_type, student_id, issued_by, issued_at, snapshot_json, snapshot_hash, verification_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, token, folio, type, studentId, issuedBy, issuedAt, json, fingerprint, verificationUrl);
  return { id, token, folio, issuedAt, verificationUrl, qrPng, snapshot, fingerprint };
}

export function verifyDocument(token: string): PublicDocumentVerification {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new ApiError(404, "No se encontró un documento con ese código de validación.");
  const issued = get<{folio:string;snapshot_json:string;snapshot_hash:string;revoked_at:string|null}>(
    "SELECT folio, snapshot_json, snapshot_hash, revoked_at FROM issued_documents WHERE token = ?", token
  );
  if (!issued) throw new ApiError(404, "No se encontró un documento con ese código de validación.");
  const hash = crypto.createHash("sha256").update(issued.snapshot_json).digest("hex");
  if (hash !== issued.snapshot_hash) return { status: "invalid", folio: issued.folio, message: "No se pudo confirmar la integridad de este documento. Consulta a Control Escolar." };
  return {
    status: issued.revoked_at ? "revoked" : "valid", folio: issued.folio, revokedAt: issued.revoked_at, fingerprint: hash,
    message: issued.revoked_at ? "Este documento fue revocado por la institución y ya no es válido."
      : "Este documento es oficial y fue emitido por la institución para el alumno indicado.",
    document: JSON.parse(issued.snapshot_json) as OfficialDocumentSnapshot
  };
}

export function issuedDisplayDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
