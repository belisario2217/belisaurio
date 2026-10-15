export type CertificateAuthority = "ifop" | "uniten";

export const planCertification = {
  ifop: { label: "IFOP · RVOE propio", institution: "Universidad IFOP", cct: "27MSU0108N", collaborationAgreement: false },
  uniten: { label: "UNITEN · Convenio de colaboración", institution: "Centro Universitario Tecnológico de Enfermería (UNITEN)", cct: "18PSU0074C", collaborationAgreement: true }
} as const;

export type PlanCertification = {
  authority: CertificateAuthority; institution: string; cct: string; rvoe: string | null; collaborationAgreement: boolean;
};

/** Legacy inference only: an explicit plan name/code takes priority over its program. */
export function inferCertificateAuthority(planName: string, planCode: string, programName = "", programCode = ""): CertificateAuthority {
  for (const value of [planName, planCode, programName, programCode]) {
    if (/UNITEN/i.test(value)) return "uniten";
    if (/IFOP/i.test(value)) return "ifop";
  }
  return "ifop";
}
