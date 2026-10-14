import { get } from "../db.js";
import { ApiError } from "../utils.js";

export type StudyModality = "escolarizado" | "semiescolarizado" | "complementario" | "en_linea";

type IdentityInput = {
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  programId: number;
  shiftId: number;
  groupId: number;
  cycleId: number;
  planId: number;
};

type GroupContext = {
  program_id: number;
  shift_id: number;
  study_modality: StudyModality;
};

type PlanContext = {
  program_id: number;
  name: string;
  program_name: string;
  code: string;
  matriculation_code: string;
};

type ProgramContext = {
  id: number;
  name: string;
};

const modalityCodes: Record<StudyModality, string> = {
  escolarizado: "ESC",
  semiescolarizado: "SEM",
  complementario: "COM",
  en_linea: "LIN"
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function normalizeAcademicLabel(value: unknown) {
  return normalized(value).replace(/[^A-Z0-9]/g, "");
}

export function planMatchesProgram(
  plan: { program_id: number; name: string; program_name: string },
  program: { id: number; name: string }
) {
  const programName = normalizeAcademicLabel(program.name);
  return plan.program_id === program.id
    || normalizeAcademicLabel(plan.program_name) === programName
    || normalizeAcademicLabel(plan.name) === programName;
}

export function normalizeMatriculationCode(value: unknown) {
  return normalized(value).replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

export function deriveMatriculationCode(planCode: unknown) {
  const source = normalized(planCode).trim();
  const compact = normalizeMatriculationCode(source);
  if (!source.includes("-") && compact) return compact;

  const tokens = source.split(/[^A-Z0-9]+/).filter((token) => token && !/^\d+$/.test(token));
  const initials = tokens.slice(0, 4).map((token) => token[0]).join("");
  return (initials || compact).slice(0, 10);
}

export function studyModalityCode(modality: StudyModality) {
  return modalityCodes[modality];
}

function nameInitial(value: unknown, fallback = "") {
  return normalized(value).replace(/[^A-Z0-9]/g, "").charAt(0) || fallback;
}

function cyclePrefix(startDate: string) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  if (!match) throw new ApiError(400, "El ciclo escolar no tiene una fecha inicial valida.");
  return `${match[2]}${match[1].slice(-2)}`;
}

export function generateStudentIdentity(input: IdentityInput) {
  const group = get<GroupContext>(
    `SELECT program_id, shift_id, study_modality
     FROM groups WHERE id = ? AND is_active = 1`,
    input.groupId
  );
  if (!group) throw new ApiError(400, "El grupo seleccionado no existe o esta inactivo.");
  if (group.program_id !== input.programId || group.shift_id !== input.shiftId) {
    throw new ApiError(400, "El programa y turno deben corresponder al grupo seleccionado.");
  }

  const cycle = get<{ start_date: string }>(
    "SELECT start_date FROM school_cycles WHERE id = ? AND is_active = 1",
    input.cycleId
  );
  if (!cycle) throw new ApiError(400, "El ciclo escolar seleccionado no existe o esta inactivo.");

  const program = get<ProgramContext>(
    "SELECT id, name FROM programs WHERE id = ? AND is_active = 1",
    input.programId
  );
  if (!program) throw new ApiError(400, "El programa seleccionado no existe o esta inactivo.");

  const plan = get<PlanContext>(
    `SELECT ap.program_id, ap.name, p.name AS program_name, ap.code, ap.matriculation_code
     FROM academic_plans ap JOIN programs p ON p.id = ap.program_id
     WHERE ap.id = ? AND ap.is_active = 1`,
    input.planId
  );
  if (!plan) throw new ApiError(400, "El plan academico seleccionado no existe o esta inactivo.");
  if (!planMatchesProgram(plan, program)) {
    throw new ApiError(400, "El plan academico no corresponde al programa seleccionado.");
  }

  const planCode = normalizeMatriculationCode(plan.matriculation_code) || deriveMatriculationCode(plan.code);
  if (!planCode) throw new ApiError(400, "Configura el codigo para matricula del plan academico.");

  const initials = [
    nameInitial(input.lastName),
    nameInitial(input.secondLastName, "X"),
    nameInitial(input.firstName)
  ].join("");
  if (initials.length !== 3) {
    throw new ApiError(400, "Nombre y apellido paterno son obligatorios para generar la matricula.");
  }

  const studentNumber = `${cyclePrefix(cycle.start_date)}${initials}${planCode}${studyModalityCode(group.study_modality)}`;
  return {
    studentNumber,
    email: `${studentNumber.toLowerCase()}@alumnoifop.edu`,
    planId: input.planId,
    studyModality: group.study_modality,
    studyModalityCode: studyModalityCode(group.study_modality),
    planCode
  };
}
