import { Router } from "express";
import multer from "multer";
import type { AuthenticatedRequest } from "../auth.js";
import { all, run } from "../db.js";
import { ApiError, asId } from "../utils.js";
import { formatMemories, prepareLearningRows, readLearningFile, rememberFormat } from "../services/import-learning.js";

export const importAssistantRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
function context(req: AuthenticatedRequest) {
  const kind = String(req.query.kind ?? req.body?.kind ?? "students");
  if (!["students", "grades"].includes(kind) || !req.user?.permissions.includes(kind === "students" ? "students.import" : "grades.import")) {
    throw new ApiError(403, "No tienes permiso para esta carga.");
  }
  return kind as "students" | "grades";
}
importAssistantRouter.get("/context", (req: AuthenticatedRequest, res) => {
  const kind = context(req);
  const groups = kind === "students" ? all(`SELECT g.id,g.name AS group_name,p.name AS program,sh.name AS shift,sc.name AS cycle,pl.name AS plan,cp.name AS period,'Activo' AS status
    FROM groups g JOIN programs p ON p.id=g.program_id JOIN shifts sh ON sh.id=g.shift_id JOIN school_cycles sc ON sc.id=COALESCE(g.active_cycle_id,g.cycle_id)
    LEFT JOIN academic_plans pl ON pl.id=COALESCE(g.plan_id,(SELECT e.plan_id FROM enrollments e WHERE e.group_id=g.id AND e.is_active=1 AND e.plan_id IS NOT NULL ORDER BY e.id DESC LIMIT 1),(SELECT ap.id FROM academic_plans ap WHERE ap.program_id=g.program_id AND ap.is_active=1 ORDER BY ap.id DESC LIMIT 1)) LEFT JOIN curricular_periods cp ON cp.id=g.curricular_period_id
    WHERE g.is_active=1 ORDER BY spanish_sort(p.name),spanish_sort(g.name)`) : [];
  res.json({ groups, memories: formatMemories(req.user!.id) });
});
importAssistantRouter.post("/read", (req: AuthenticatedRequest, _res, next) => { context(req); next(); }, upload.single("file"), async (req: AuthenticatedRequest, res) => {
  const kind = context(req);
  if (!req.file) throw new ApiError(400, "Selecciona un archivo.");
  res.json(await readLearningFile(req.file.buffer, req.file.originalname, kind, req.user!.id));
});
importAssistantRouter.post("/prepare", (req: AuthenticatedRequest, res) => {
  const kind = context(req), body = req.body;
  const prepared = prepareLearningRows(body?.headers, body?.rows, body?.mapping, body?.settings, kind);
  if (body.remember === true) rememberFormat(req.user!.id, kind, body.headers, body.mapping, body.settings);
  res.json(prepared);
});
importAssistantRouter.delete("/memories/:id", (req: AuthenticatedRequest, res) => {
  context(req);
  run("DELETE FROM import_format_memory WHERE id=? AND user_id=?", asId(req.params.id, "Formato"), req.user!.id);
  res.json({ deleted: true });
});
