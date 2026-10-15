import { Router } from "express";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { all, get, run, transaction } from "../db.js";
import {
  deriveMatriculationCode,
  normalizeAcademicLabel,
  normalizeMatriculationCode
} from "../services/student-identity.js";
import { ApiError, asId, asNumber, cleanText, optionalText } from "../utils.js";
import { inferCertificateAuthority, type CertificateAuthority } from "../../shared/plan-certification.js";

export const plansRouter = Router();

type NormalizedSubject = {
  subjectCode: string;
  subjectName: string;
  subjectType: "mandatory" | "elective";
  credits: number;
  recommendedPeriod: number;
  hoursPerWeek: number;
};

function certificateAuthority(value: unknown, fallback: CertificateAuthority): CertificateAuthority {
  if (value === undefined) return fallback;
  if (value !== "ifop" && value !== "uniten") throw new ApiError(400, "Selecciona IFOP con RVOE propio o UNITEN con convenio de colaboración.");
  return value;
}

function planSelect(where = "1 = 1") {
  return `SELECT ap.*, p.name AS program_name, l.name AS level_name,
    COUNT(ps.id) AS subject_count, COALESCE(SUM(ps.credits), 0) AS total_credits,
    COALESCE(SUM(CASE WHEN ps.subject_type = 'mandatory' THEN ps.credits ELSE 0 END), 0) AS mandatory_credits,
    COALESCE(SUM(CASE WHEN ps.subject_type = 'elective' THEN ps.credits ELSE 0 END), 0) AS elective_credits
    FROM academic_plans ap
    JOIN programs p ON p.id = ap.program_id
    LEFT JOIN academic_levels l ON l.id = p.level_id
    LEFT JOIN plan_subjects ps ON ps.plan_id = ap.id
    WHERE ${where}
    GROUP BY ap.id`;
}

function assertUniquePlan(programId: number, code: string, name: string, version: string, excludedId?: number) {
  const program = get<{ id: number; name: string }>("SELECT id, name FROM programs WHERE id = ?", programId);
  if (!program) throw new ApiError(400, "El programa seleccionado no existe.");

  const normalizedProgram = normalizeAcademicLabel(program.name);
  const normalizedName = normalizeAcademicLabel(name);
  const normalizedVersion = normalizeAcademicLabel(version);
  const existing = all<{
    id: number;
    code: string;
    name: string;
    version: string;
    program_id: number;
    program_name: string;
  }>(`SELECT ap.id, ap.code, ap.name, ap.version, ap.program_id, p.name AS program_name
      FROM academic_plans ap JOIN programs p ON p.id = ap.program_id`);

  const duplicate = existing.find((plan) => plan.id !== excludedId && (
    plan.code.trim().toUpperCase() === code
    || (
      normalizeAcademicLabel(plan.name) === normalizedName
      && normalizeAcademicLabel(plan.version) === normalizedVersion
      && (plan.program_id === programId || normalizeAcademicLabel(plan.program_name) === normalizedProgram)
    )
  ));
  if (duplicate) {
    throw new ApiError(409, `Ya existe el plan académico "${duplicate.name}" para este programa y versión. Edítalo en lugar de volver a crearlo.`);
  }
}

plansRouter.get("/", requirePermission("catalogs.view"), (_req, res) => {
  res.json(all(`${planSelect()} ORDER BY ap.is_active DESC, ap.id DESC`));
});

plansRouter.get("/:id", requirePermission("catalogs.view"), (req, res) => {
  const id = asId(req.params.id, "Plan académico");
  const plan = get(`${planSelect("ap.id = ?")}`, id);
  if (!plan) throw new ApiError(404, "No se encontró el plan académico.");
  const subjects = all(
    `SELECT ps.id, ps.subject_id, s.code, s.name, ps.subject_type, ps.credits,
     ps.recommended_period, s.hours_per_week
     FROM plan_subjects ps JOIN subjects s ON s.id = ps.subject_id
     WHERE ps.plan_id = ? ORDER BY ps.recommended_period, s.name`,
    id
  );
  res.json({ plan, subjects });
});

plansRouter.post("/", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const programId = asId(req.body.programId, "Programa");
  const code = cleanText(req.body.code, 60).toUpperCase();
  const matriculationCode = normalizeMatriculationCode(req.body.matriculationCode) || deriveMatriculationCode(code);
  const name = cleanText(req.body.name, 180);
  const version = cleanText(req.body.version, 60);
  const rvoe = optionalText(req.body.rvoe, 80);
  const tuitionAmount = Math.max(0, asNumber(req.body.tuitionAmount || 0, "Colegiatura"));
  const subjects = Array.isArray(req.body.subjects) ? req.body.subjects : [];
  if (!code || !matriculationCode || !name || !version) throw new ApiError(400, "Clave, código para matrícula, nombre y versión son obligatorios.");
  if (!subjects.length) throw new ApiError(400, "Agrega al menos una asignatura al plan.");
  assertUniquePlan(programId, code, name, version);
  const program = get<{name:string;code:string}>("SELECT name,code FROM programs WHERE id=?", programId)!;
  const authority = certificateAuthority(req.body.certificateAuthority, inferCertificateAuthority(name, code, program.name, program.code));

  const normalized: NormalizedSubject[] = subjects.map((item: any, index: number) => {
    const subjectCode = cleanText(item.code, 60).toUpperCase();
    const subjectName = cleanText(item.name, 180);
    const subjectType = item.subjectType === "elective" ? "elective" : "mandatory";
    const credits = asNumber(item.credits, `Créditos de la asignatura ${index + 1}`);
    const recommendedPeriod = Math.max(1, Math.trunc(asNumber(item.recommendedPeriod || 1, "Semestre sugerido")));
    const hoursPerWeek = Math.max(0, Math.trunc(Number(item.hoursPerWeek || 0)));
    if (!subjectCode || !subjectName || credits <= 0) {
      throw new ApiError(400, `Completa clave, nombre y créditos de la asignatura ${index + 1}.`);
    }
    return { subjectCode, subjectName, subjectType, credits, recommendedPeriod, hoursPerWeek };
  });
  if (new Set(normalized.map((item) => item.subjectCode)).size !== normalized.length) {
    throw new ApiError(400, "No repitas claves de asignatura dentro del plan.");
  }

  const planId = transaction(() => {
    const inserted = run(
      `INSERT INTO academic_plans(program_id, code, matriculation_code, name, version, rvoe, description, tuition_amount, certificate_authority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      programId,
      code,
      matriculationCode,
      name,
      version,
      rvoe,
      optionalText(req.body.description, 1000),
      tuitionAmount,
      authority
    );
    const id = Number(inserted.lastInsertRowid);
    normalized.forEach((item) => {
      run(
        `INSERT OR IGNORE INTO subjects(code, name, program_id, credits, hours_per_week)
         VALUES (?, ?, ?, ?, ?)`,
        item.subjectCode,
        item.subjectName,
        programId,
        item.credits,
        item.hoursPerWeek
      );
      const subject = get<{ id: number }>(
        "SELECT id FROM subjects WHERE code = ? AND program_id = ?",
        item.subjectCode,
        programId
      )!;
      run(
        `INSERT INTO plan_subjects(plan_id, subject_id, subject_type, credits, recommended_period)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        subject.id,
        item.subjectType,
        item.credits,
        item.recommendedPeriod
      );
    });
    if (req.body.assignExisting !== false) {
      run("UPDATE enrollments SET plan_id = ? WHERE program_id = ? AND is_active = 1", id, programId);
    }
    return id;
  });
  logActivity(req, "create", "academic_plans", planId, { code, matriculationCode, rvoe, certificateAuthority: authority, subjectCount: normalized.length, tuitionAmount });
  res.status(201).json(get(`${planSelect("ap.id = ?")}`, planId));
});

plansRouter.put("/:id", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Plan académico");
  const current = get<{certificate_authority:CertificateAuthority}>("SELECT certificate_authority FROM academic_plans WHERE id = ?", id);
  if (!current) throw new ApiError(404, "No se encontró el plan académico.");
  const authority = certificateAuthority(req.body.certificateAuthority, current.certificate_authority);
  const programId = asId(req.body.programId, "Programa");
  const code = cleanText(req.body.code, 60).toUpperCase();
  const matriculationCode = normalizeMatriculationCode(req.body.matriculationCode) || deriveMatriculationCode(code);
  const name = cleanText(req.body.name, 180);
  const version = cleanText(req.body.version, 60);
  const rvoe = optionalText(req.body.rvoe, 80);
  const tuitionAmount = Math.max(0, asNumber(req.body.tuitionAmount || 0, "Colegiatura"));
  const subjects = Array.isArray(req.body.subjects) ? req.body.subjects : [];
  if (!code || !matriculationCode || !name || !version) throw new ApiError(400, "Clave, código para matrícula, nombre y versión son obligatorios.");
  if (!subjects.length) throw new ApiError(400, "Agrega al menos una asignatura al plan.");
  assertUniquePlan(programId, code, name, version, id);
  const normalized: NormalizedSubject[] = subjects.map((item: any, index: number) => {
    const subjectCode = cleanText(item.code, 60).toUpperCase();
    const subjectName = cleanText(item.name, 180);
    const subjectType = item.subjectType === "elective" ? "elective" : "mandatory";
    const credits = asNumber(item.credits, `Créditos de la asignatura ${index + 1}`);
    const recommendedPeriod = Math.max(1, Math.trunc(asNumber(item.recommendedPeriod || 1, "Semestre sugerido")));
    const hoursPerWeek = Math.max(0, Math.trunc(Number(item.hoursPerWeek || 0)));
    if (!subjectCode || !subjectName || credits <= 0) {
      throw new ApiError(400, `Completa clave, nombre y créditos de la asignatura ${index + 1}.`);
    }
    return { subjectCode, subjectName, subjectType, credits, recommendedPeriod, hoursPerWeek };
  });
  if (new Set(normalized.map((item) => item.subjectCode)).size !== normalized.length) {
    throw new ApiError(400, "No repitas claves de asignatura dentro del plan.");
  }

  transaction(() => {
    run(
      `UPDATE academic_plans SET program_id = ?, code = ?, matriculation_code = ?, name = ?, version = ?, rvoe = ?, description = ?, tuition_amount = ?, certificate_authority = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      programId,
      code,
      matriculationCode,
      name,
      version,
      rvoe,
      optionalText(req.body.description, 1000),
      tuitionAmount,
      authority,
      id
    );
    run("DELETE FROM plan_subjects WHERE plan_id = ?", id);
    normalized.forEach((item) => {
      run(
        `INSERT OR IGNORE INTO subjects(code, name, program_id, credits, hours_per_week)
         VALUES (?, ?, ?, ?, ?)`,
        item.subjectCode,
        item.subjectName,
        programId,
        item.credits,
        item.hoursPerWeek
      );
      const subject = get<{ id: number }>(
        "SELECT id FROM subjects WHERE code = ? AND program_id = ?",
        item.subjectCode,
        programId
      )!;
      run(
        "UPDATE subjects SET name = ?, credits = ?, hours_per_week = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        item.subjectName,
        item.credits,
        item.hoursPerWeek,
        subject.id
      );
      run(
        `INSERT INTO plan_subjects(plan_id, subject_id, subject_type, credits, recommended_period)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        subject.id,
        item.subjectType,
        item.credits,
        item.recommendedPeriod
      );
    });
    if (req.body.assignExisting === true) {
      run("UPDATE enrollments SET plan_id = ? WHERE program_id = ? AND is_active = 1", id, programId);
    }
  });
  const updated = get(`${planSelect("ap.id = ?")}`, id);
  logActivity(req, "update", "academic_plans", id, { code, matriculationCode, rvoe, certificateAuthority: authority, subjectCount: normalized.length, tuitionAmount });
  res.json(updated);
});

plansRouter.post("/:id/toggle", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Plan académico");
  run(
    `UPDATE academic_plans SET is_active = CASE is_active WHEN 1 THEN 0 ELSE 1 END,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    id
  );
  const plan = get(`${planSelect("ap.id = ?")}`, id);
  if (!plan) throw new ApiError(404, "No se encontró el plan académico.");
  logActivity(req, "toggle", "academic_plans", id, plan);
  res.json(plan);
});

plansRouter.delete("/:id/permanent", requirePermission("catalogs.manage"), (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Plan académico");
  const plan = get("SELECT * FROM academic_plans WHERE id = ?", id);
  if (!plan) throw new ApiError(404, "El plan académico ya no existe.");
  transaction(() => {
    run("UPDATE enrollments SET plan_id = NULL WHERE plan_id = ?", id);
    run("DELETE FROM academic_plans WHERE id = ?", id);
  });
  logActivity(req, "permanent-delete", "academic_plans", id, plan);
  res.status(204).end();
});
