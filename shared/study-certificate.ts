/** Values printed on one certificate; never updates the student's academic record. */
export type StudyCertificateDraft = {
  programName: string;
  rvoe: string;
  semesterName: string;
  modality: string;
  schedule: string;
  cycleName: string;
  startDate: string;
  endDate: string;
  vacations: { start_date: string; end_date: string }[];
  documentDate: string;
  place: string;
  subjectsTitle: string;
  subjects: { name: string; type: "mandatory" | "elective" }[];
};

export type StudyCertificatePreview = {
  student: { name: string; number: string };
  certification: { institution: string; cct: string; collaborationAgreement: boolean };
  draft: StudyCertificateDraft;
};
