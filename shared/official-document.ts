import type { PlanCertification } from "./plan-certification.js";

export type OfficialDocumentType = "report_card" | "academic_history" | "study_certificate" | "account_statement";

export type PrintedSubject = {
  code: string; name: string; semester: number; cycle: string | null;
  subjectType: "mandatory" | "elective";
  partial1: number | null; partial2: number | null; partial3: number | null;
  score: number | null; status: string; credits: number;
};

export type OfficialDocumentSnapshot = {
  version: 1;
  folio: string;
  type: OfficialDocumentType;
  title: string;
  issuedAt: string;
  institution: { name: string; campus: string; logoPath: string | null; directorName: string; address: string; footer: string };
  student: {
    name: string; number: string; program: string; group: string; shift: string;
    semester: number | null; semesterName: string; cycle: string;
  };
  content: {
    purpose?: "student_copy";
    certification?: PlanCertification;
    subjects?: PrintedSubject[];
    average?: number | null;
    calendar?: { start: string; end: string; vacations: { start_date: string; end_date: string }[] };
    payments?: { date: string; concept: string; amount: number; folio: string }[];
    totalPaid?: number;
    notes?: string[];
  };
};

export type PublicDocumentVerification = {
  status: "valid" | "revoked" | "invalid";
  message: string;
  folio: string;
  fingerprint?: string;
  revokedAt?: string | null;
  document?: OfficialDocumentSnapshot;
};
