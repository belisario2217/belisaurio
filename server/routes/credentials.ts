import { Router, type Response } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import { requirePermission, logActivity, type AuthenticatedRequest } from "../auth.js";
import { ApiError, asId, cleanText } from "../utils.js";
import { get } from "../db.js";
import { activateCredential, approvedCredential, credentialFile, credentialImageData, credentialIssueByToken, credentialIssueStatus,
  credentialTemplate, deactivateCredential, getCredentialState, saveCredentialFraming, saveCredentialPhoto,
  saveCredentialSignature, saveCredentialTemplate, searchCredentialStudents, validateCredentialFraming, verifyCredential } from "../services/credentials.js";
import { buildCredentialPdf } from "../services/credential-pdf.js";
import type { CredentialSnapshot } from "../../shared/credentials.js";

export const credentialsRouter = Router();
export const credentialPublicRouter = Router();
export const portalCredentialRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
function imageUpload(field: string) {
  const receive = upload.single(field);
  return (req: any, res: any, next: any) => receive(req, res, (error: any) => {
    if (error) return next(new ApiError(400, error.code === "LIMIT_FILE_SIZE" ? "La imagen debe pesar como máximo 10 MB." : "Carga una sola imagen válida."));
    if (!req.file) return next(new ApiError(400, "Selecciona una imagen JPG, PNG o WebP."));
    next();
  });
}
function privateResponse(res: Response) { res.set({ "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, noarchive" }); }
function layout(value: unknown): "card" | "letter" {
  if (value === undefined || value === "card") return "card";
  if (value === "letter") return "letter";
  throw new ApiError(400, "Selecciona credencial o impresión en hoja carta.");
}
function sendApprovedPdf(res: Response, studentId: number, format: unknown) {
  const issue = approvedCredential(studentId), mode = layout(format), snapshot = JSON.parse(issue.snapshot_json) as CredentialSnapshot;
  privateResponse(res);
  const number = snapshot.student.number.normalize("NFD").replace(/[^a-z0-9-]/gi, "") || String(studentId);
  res.type("pdf").attachment(`credencial-${number}${mode === "letter" ? "-carta" : ""}.pdf`)
    .send(fs.readFileSync(credentialFile(mode === "letter" ? issue.print_file : issue.card_file)));
}
function portalStudent(req: AuthenticatedRequest) {
  if (!req.user?.studentId) throw new ApiError(403, "Tu cuenta debe estar vinculada a un alumno para consultar su credencial.");
  return req.user.studentId;
}
credentialsRouter.use(requirePermission("credentials.manage"));
credentialsRouter.get("/template", (_req, res) => res.json(credentialTemplate()));
credentialsRouter.patch("/template", (req: AuthenticatedRequest, res) => {
  const template = saveCredentialTemplate(req.body, req.user!.id);
  logActivity(req, "update-credential-template", "credential_settings", 1, { version: template.version }); res.json(template);
});
credentialsRouter.post("/template/signature", imageUpload("signature"), async (req: AuthenticatedRequest, res) => {
  const template = await saveCredentialSignature(req.file!.buffer, req.body.version, req.user!.id);
  logActivity(req, "update-credential-signature", "credential_settings", 1, { version: template.version }); res.json(template);
});
credentialsRouter.delete("/template/signature", (req: AuthenticatedRequest, res) => {
  const template = saveCredentialTemplate({ version: req.body.version }, req.user!.id, null);
  logActivity(req, "remove-credential-signature", "credential_settings", 1); res.json(template);
});
credentialsRouter.get("/template/signature", async (_req, res) => {
  const file = credentialTemplate().signatureFile;
  if (!file) throw new ApiError(404, "No hay firma digital configurada.");
  privateResponse(res); res.json({ dataUrl: await credentialImageData(file) });
});
credentialsRouter.get("/students", (req, res) => res.json(searchCredentialStudents(cleanText(req.query.search, 120), Math.min(100000, Math.max(1, Math.trunc(Number(req.query.page)) || 1)))));
credentialsRouter.get("/students/:id", (req, res) => { privateResponse(res); res.json(getCredentialState(asId(req.params.id, "Alumno"))); });
credentialsRouter.post("/students/:id/photo", imageUpload("photo"), async (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno"), state = await saveCredentialPhoto(id, req.file!.buffer, req.body.revision, req.user!.id);
  logActivity(req, "upload-credential-photo", "student_credentials", id, { width: state.photo?.width, height: state.photo?.height });
  privateResponse(res); res.json(state);
});
credentialsRouter.get("/students/:id/photo", async (req, res) => {
  const id = asId(req.params.id, "Alumno"); privateResponse(res);
  const file = get<{photo_file:string}>("SELECT photo_file FROM student_credentials WHERE student_id=?", id)?.photo_file;
  if (!file) throw new ApiError(404, "No hay fotografía de credencial.");
  res.json({ dataUrl: await credentialImageData(file) });
});
credentialsRouter.patch("/students/:id", (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno"), state = saveCredentialFraming(id, req.body, req.user!.id);
  logActivity(req, "update-credential-framing", "student_credentials", id); privateResponse(res); res.json(state);
});
credentialsRouter.post("/students/:id/activate", async (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno"), state = await activateCredential(id, req.body, req.user!.id);
  logActivity(req, "activate-credential", "student_credentials", id, { folio: state.issue?.folio }); privateResponse(res); res.json(state);
});
credentialsRouter.post("/students/:id/deactivate", (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno"), state = deactivateCredential(id, req.body.revision, req.user!.id);
  logActivity(req, "deactivate-credential", "student_credentials", id); privateResponse(res); res.json(state);
});
credentialsRouter.get("/students/:id/preview.pdf", async (req, res) => {
  const id = asId(req.params.id, "Alumno"), state = getCredentialState(id);
  const photo = get<{photo_file:string}>("SELECT photo_file FROM student_credentials WHERE student_id=?", id);
  const snapshot: CredentialSnapshot = { student: state.student, template: state.template,
    framing: validateCredentialFraming(req.query, state.framing), photo: state.photo || { width: 600, height: 600, sha256: "" }, issuedAt: "", folio: "BORRADOR · SIN ACTIVAR", validity: state.validity };
  const buffer = await buildCredentialPdf(snapshot, photo?.photo_file ?? null, null, layout(req.query.layout), true);
  privateResponse(res); res.type("pdf").setHeader("Content-Disposition", 'inline; filename="vista-previa-credencial.pdf"').send(buffer);
});
credentialsRouter.get("/students/:id/pdf", (req, res) => sendApprovedPdf(res, asId(req.params.id, "Alumno"), req.query.layout));

portalCredentialRouter.use(requirePermission("portal.view"));
portalCredentialRouter.get("/credential", (req: AuthenticatedRequest, res) => { privateResponse(res); res.json(getCredentialState(portalStudent(req))); });
portalCredentialRouter.get("/credential/photo", async (req: AuthenticatedRequest, res) => {
  const issue = approvedCredential(portalStudent(req)); privateResponse(res); res.json({ dataUrl: await credentialImageData(issue.photo_file) });
});
portalCredentialRouter.get("/credential/signature", async (req: AuthenticatedRequest, res) => {
  const issue = approvedCredential(portalStudent(req)), snapshot = JSON.parse(issue.snapshot_json) as CredentialSnapshot;
  if (!snapshot.template.signatureFile) throw new ApiError(404, "Sin firma digital.");
  privateResponse(res); res.json({ dataUrl: await credentialImageData(snapshot.template.signatureFile) });
});
portalCredentialRouter.get("/credential.pdf", (req: AuthenticatedRequest, res) => sendApprovedPdf(res, portalStudent(req), req.query.layout));

credentialPublicRouter.use("/verify", rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false,
  message: { message: "Se alcanzó el límite de consultas. Intenta de nuevo en unos minutos." } }));
credentialPublicRouter.get("/verify/:token", (req, res) => {
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, noarchive" }).json(verifyCredential(String(req.params.token)));
});
credentialPublicRouter.get("/verify/:token/photo", (req, res) => {
  const issue = credentialIssueByToken(String(req.params.token));
  if (credentialIssueStatus(issue) !== "active") throw new ApiError(403, "Esta credencial ya no está activa.");
  privateResponse(res); res.sendFile(credentialFile(issue.photo_file));
});
