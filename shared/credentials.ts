export type CredentialTemplate = {
  version: number;
  size: "reference" | "standard";
  primaryColor: string;
  lightColor: string;
  accentColor: string;
  sideLabel: string;
  title: string;
  institution: string;
  campus: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  directorName: string;
  directorTitle: string;
  backText: string;
  signatureFile: string | null;
};

export const defaultCredentialTemplate: CredentialTemplate = {
  version: 1, size: "reference", primaryColor: "#203166", lightColor: "#A8C1F3", accentColor: "#7F9BDA",
  sideLabel: "IFOP FRONTERA", title: "E-CREDENCIAL", institution: "Universidad IFOP", campus: "Campus Frontera",
  website: "colotek.com.mx/ifop-frontera", phone: "993-262-3746", email: "ifopfrontera@gmail.com",
  address: "Cjon. Manuel Díaz 48, Col. Centro, Frontera, Tab.", directorName: "BELISARIO JIMENEZ MENDEZ",
  directorTitle: "CONTROL ESCOLAR\nFRONTERA",
  backText: "Esta credencial acredita a su titular como estudiante de la Universidad IFOP, Campus Frontera. Su uso es para fines académicos y administrativos. La escuela no se hace responsable de su mal uso. Es personal, única e intransferible.",
  signatureFile: null
};

export type CredentialStudent = {
  id: number; name: string; number: string; program: string; group: string; cycle: string;
  active: boolean; enrolled: boolean; logoPath: string | null;
  cycleId: number | null; cycleStart: string | null; cycleEnd: string | null;
};
export type CredentialFraming = { cropX: number; cropY: number; zoom: number };
export type CredentialValidity = { cycleId: number; cycle: string; cycleStart: string; cycleEnd: string; validFrom: string; validUntil: string; maxMonths: 6 };
export type CredentialPhoto = { width: number; height: number; sha256: string };
export type CredentialSnapshot = {
  student: CredentialStudent; template: CredentialTemplate; framing: CredentialFraming; photo: CredentialPhoto;
  issuedAt: string; folio: string; validity: CredentialValidity | null;
};
export type CredentialStatus = "missing_photo" | "draft" | "active" | "revoked" | "expired" | "needs_review" | "inactive";
export type CredentialPhotoSubmission = {
  id: string; status: "pending" | "approved" | "rejected" | "superseded";
  submittedAt: string; reviewedAt: string | null; reviewNote: string | null;
  photo: CredentialPhoto; framing: CredentialFraming;
  processing: { adjusted: boolean; borderCoverage: number; note: string };
};
export type CredentialState = {
  student: CredentialStudent; template: CredentialTemplate; revision: number; framing: CredentialFraming;
  photo: CredentialPhoto | null; status: CredentialStatus; canDownload: boolean;
  validity: CredentialValidity | null;
  submission: CredentialPhotoSubmission | null;
  issue: { id: string; folio: string; issuedAt: string; verificationUrl: string; snapshot: CredentialSnapshot; qr: { size: number; data: number[] } } | null;
};
export type CredentialVerification = {
  status: CredentialStatus; message: string; document: CredentialSnapshot; verificationUrl: string;
  photoUrl: string | null;
};
export const credentialStatusLabels: Record<CredentialStatus, string> = {
  missing_photo: "Sin fotografía", draft: "Pendiente de activación", active: "Activada", revoked: "Desactivada",
  expired: "Vencida", needs_review: "Requiere actualización", inactive: "Alumno sin inscripción activa"
};
export function credentialDimensions(size: CredentialTemplate["size"]) {
  return size === "standard" ? { width: 54, height: 85.6 } : { width: 50, height: 75 };
}
