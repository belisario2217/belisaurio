export type AttendanceListOptions = {
  group: { id: number; name: string; program: string; cycle: string; semester: number; semesterName: string };
  subjects: { id: number; name: string; code: string; studentCount: number }[];
  studentCount: number;
};
