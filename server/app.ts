import "dotenv/config";
import { serveFrontend } from "./services/frontend-static.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "./db.js";
import { authenticate } from "./auth.js";
import { ApiError } from "./utils.js";
import { authRouter } from "./routes/auth.js";
import { catalogsRouter } from "./routes/catalogs.js";
import { studentsRouter } from "./routes/students.js";
import { gradesRouter } from "./routes/grades.js";
import { analyticsRouter } from "./routes/analytics.js";
import { usersRouter } from "./routes/users.js";
import { settingsRouter } from "./routes/settings.js";
import { reportsRouter } from "./routes/reports.js";
import { plansRouter } from "./routes/plans.js";
import { portalRouter } from "./routes/portal.js";
import { paymentsRouter } from "./routes/payments.js";
import { messagesRouter } from "./routes/messages.js";
import { groupManagementRouter } from "./routes/group-management.js";
import { payrollRouter } from "./routes/payroll.js";
import { improvementsRouter } from "./routes/improvements.js";
import { importAssistantRouter } from "./routes/import-assistant.js";
import { documentVerificationRouter } from "./routes/document-verification.js";
import { credentialPublicRouter, credentialsRouter, portalCredentialRouter } from "./routes/credentials.js";
import { ensureAllStudentAccounts } from "./services/student-account.js";
import { defaultInstitutionLogoUrl, institutionLogoPublicUrl } from "./services/institution-logo.js";

ensureAllStudentAccounts();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadsDir = process.env.UPLOADS_PATH
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.join(root, "uploads");
export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: { directives: { imgSrc: ["'self'","data:","blob:"], mediaSrc: ["'self'","blob:"] } }
}));
app.use(cors({ origin: process.env.APP_ORIGIN ?? "http://localhost:4173" }));
app.use(express.json({ limit: "1mb" }));
app.use("/assets", express.static(path.join(root, "public", "assets")));
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "Universidad IFOP API" }));
app.get("/api/branding", (_req, res) => {
  const settings = get<{ institution_name: string; logo_path: string | null; active_cycle_name: string | null }>(
    "SELECT i.institution_name, i.logo_path, sc.name AS active_cycle_name FROM institution_settings i LEFT JOIN school_cycles sc ON sc.id=i.active_cycle_id WHERE i.id=1"
  );
  res.json({
    institution_name: settings?.institution_name || "Universidad IFOP",
    logo_path: institutionLogoPublicUrl(settings?.logo_path ?? defaultInstitutionLogoUrl),
    active_cycle_name: settings?.active_cycle_name ?? null
  });
});
app.use("/api/auth", authRouter);
app.use("/api/documents", documentVerificationRouter);
app.use("/api/credentials", credentialPublicRouter);
app.use("/api/credentials", authenticate, credentialsRouter);
app.use("/api/catalogs", authenticate, catalogsRouter);
app.use("/api/students", authenticate, studentsRouter);
app.use("/api/grades", authenticate, gradesRouter);
app.use("/api/analytics", authenticate, analyticsRouter);
app.use("/api/users", authenticate, usersRouter);
app.use("/api/settings", authenticate, settingsRouter);
app.use("/api/reports", authenticate, reportsRouter);
app.use("/api/plans", authenticate, plansRouter);
app.use("/api/portal", authenticate, portalRouter);
app.use("/api/portal", authenticate, portalCredentialRouter);
app.use("/api/payments", authenticate, paymentsRouter);
app.use("/api/messages", authenticate, messagesRouter);
app.use("/api/group-management", authenticate, groupManagementRouter);
app.use("/api/attendance", authenticate, (_req, res) => res.status(410).json({ message: "La función de asistencia fue retirada del sistema." }));
app.use("/api/payroll", authenticate, payrollRouter);
app.use("/api/improvements", authenticate, improvementsRouter);
app.use("/api/import-assistant", authenticate, importAssistantRouter);

if (process.env.NODE_ENV === "production") {
  serveFrontend(app, path.join(root, "dist"));
}

app.use((_req, res) => res.status(404).json({ message: "Ruta no encontrada." }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof ApiError ? error.status : error.code === "SQLITE_CONSTRAINT_UNIQUE" ? 409 : 500;
  const message = error instanceof ApiError
    ? error.message
    : status === 409
      ? "Ya existe un registro con esos datos."
      : "Ocurrió un error inesperado.";
  if (status >= 500) console.error(error);
  res.status(status).json({ message, details: error instanceof ApiError ? error.details : undefined });
});
