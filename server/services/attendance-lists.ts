import type { Response } from "express";
import { all, get } from "../db.js";
import { ApiError } from "../utils.js";
import { createPdf } from "./files.js";
import { documentBranding, workbookLetterhead } from "./document-branding.js";
import { displayProgramName } from "../../shared/program-name.js";
import type { AttendanceListOptions } from "../../shared/attendance-list.js";

type Group = { id: number; name: string; program: string; shift: string; cycle_id: number; cycle: string; semester: number | null; plan_id: number | null };
type Student = { id: number; enrollment_id: number; student_number: string; full_name: string; plan_id: number | null };
type Membership = { student_id: number; subject_id: number; name: string; code: string };

/** A printable roster is read-only: it never recreates attendance or changes academic load. */
export function attendanceListData(groupId: number, semester: number, subjectId?: number) {
  const group = get<Group>(`SELECT g.id, g.name, p.name AS program, sh.name AS shift, g.plan_id,
    sc.id AS cycle_id, sc.name AS cycle, cp.sequence AS semester
    FROM groups g JOIN programs p ON p.id=g.program_id JOIN shifts sh ON sh.id=g.shift_id
    JOIN institution_settings i ON i.id=1
    JOIN school_cycles sc ON sc.id=COALESCE(g.active_cycle_id,i.active_cycle_id,g.cycle_id)
    LEFT JOIN curricular_periods cp ON cp.id=g.curricular_period_id
    WHERE g.id=? AND g.is_active=1`, groupId);
  if (!group) throw new ApiError(404, "El grupo no existe o está inactivo.");
  const period = get<{ name: string }>("SELECT name FROM curricular_periods WHERE sequence=? AND is_active=1", semester);
  if (!period) throw new ApiError(400, "Selecciona un semestre válido.");
  const students = all<Student>(`SELECT st.id, e.id AS enrollment_id, st.student_number,
    TRIM(st.first_name || ' ' || st.last_name || ' ' || COALESCE(st.second_last_name,'')) AS full_name,
    COALESCE(e.plan_id,g.plan_id) AS plan_id
    FROM enrollments e JOIN students st ON st.id=e.student_id AND st.is_active=1
    JOIN groups g ON g.id=e.group_id
    LEFT JOIN curricular_periods cp ON cp.id=COALESCE(e.curricular_period_id,g.curricular_period_id)
    WHERE e.group_id=? AND e.is_active=1 AND cp.sequence=?
      AND e.id=(SELECT MAX(latest.id) FROM enrollments latest WHERE latest.student_id=st.id AND latest.is_active=1)
    ORDER BY spanish_sort(st.last_name),spanish_sort(COALESCE(st.second_last_name,'')),spanish_sort(st.first_name),st.id`, groupId, semester);
  // Restrict every source to the current roster, selected semester and active calendar cycle.
  const memberships = all<Membership>(`WITH roster AS (
      SELECT e.id, e.student_id, COALESCE(e.plan_id,g.plan_id) AS plan_id
      FROM enrollments e JOIN students st ON st.id=e.student_id AND st.is_active=1
      JOIN groups g ON g.id=e.group_id
      LEFT JOIN curricular_periods cp ON cp.id=COALESCE(e.curricular_period_id,g.curricular_period_id)
      WHERE e.group_id=? AND e.is_active=1 AND cp.sequence=?
        AND e.id=(SELECT MAX(latest.id) FROM enrollments latest WHERE latest.student_id=st.id AND latest.is_active=1)
    ), loaded AS (
      SELECT r.student_id,ss.subject_id FROM roster r JOIN student_subjects ss
        ON ss.enrollment_id=r.id AND ss.student_id=r.student_id
      WHERE ss.semester_number=? AND COALESCE(ss.school_cycle_id,?)=?
    ), assigned AS (
      SELECT r.student_id,a.subject_id FROM roster r
      JOIN subject_assignments a ON a.group_id=? AND a.is_active=1
      JOIN academic_periods ap ON ap.id=a.period_id AND ap.cycle_id=?
      LEFT JOIN plan_subjects ps ON ps.plan_id=r.plan_id AND ps.subject_id=a.subject_id
      WHERE COALESCE(ps.recommended_period,?)=?
    ), membership AS (
      SELECT * FROM loaded UNION SELECT * FROM assigned
      UNION SELECT r.student_id,ps.subject_id FROM roster r
      JOIN plan_subjects ps ON ps.plan_id=r.plan_id AND ps.recommended_period=? AND ps.subject_type='mandatory'
      WHERE NOT EXISTS(SELECT 1 FROM loaded l WHERE l.student_id=r.student_id)
        AND NOT EXISTS(SELECT 1 FROM assigned a WHERE a.student_id=r.student_id)
    ) SELECT DISTINCT m.student_id,m.subject_id,s.name,s.code FROM membership m JOIN subjects s ON s.id=m.subject_id
      ORDER BY spanish_sort(s.name),s.id`, groupId, semester, semester, group.cycle_id, group.cycle_id,
    groupId, group.cycle_id, group.semester, semester, semester);
  const subjectMap = new Map<number, { id: number; name: string; code: string; studentCount: number }>();
  for (const row of memberships) {
    const subject = subjectMap.get(row.subject_id) ?? { id: row.subject_id, name: row.name, code: row.code, studentCount: 0 };
    subject.studentCount += 1;
    subjectMap.set(row.subject_id, subject);
  }
  const subject = subjectId === undefined ? null : subjectMap.get(subjectId);
  if (subjectId !== undefined && !subject) throw new ApiError(400, "La materia no corresponde al grupo y semestre seleccionados.");
  const members = subject ? new Set(memberships.filter(m => m.subject_id === subject.id).map(m => m.student_id)) : null;
  const roster = members ? students.filter(student => members.has(student.id)) : students;
  const options: AttendanceListOptions = { group: { id: group.id, name: group.name, program: displayProgramName(group.program), cycle: group.cycle,
    semester, semesterName: period.name }, subjects: [...subjectMap.values()], studentCount: roster.length };
  const teachers = subject ? all<{ name: string }>(`SELECT DISTINCT t.full_name AS name FROM subject_assignments a
    JOIN academic_periods ap ON ap.id=a.period_id JOIN teachers t ON t.id=a.teacher_id
    WHERE a.group_id=? AND a.subject_id=? AND a.is_active=1 AND ap.cycle_id=? ORDER BY t.full_name`, groupId, subject.id, group.cycle_id).map(t => t.name) : [];
  return { options, students: roster, subject, teachers, shift: group.shift };
}

type ListData = ReturnType<typeof attendanceListData>;
const sessions = 16;

export function sendAttendanceListPdf(res: Response, data: ListData) {
  if (!data.students.length) throw new ApiError(409, "No hay alumnos activos que coincidan con los filtros seleccionados.");
  const doc = createPdf(res, `lista-asistencia-grupo-${data.options.group.id}.pdf`, { layout: "landscape" });
  res.setHeader("Content-Disposition", `attachment; filename="lista-asistencia-grupo-${data.options.group.id}.pdf"`);
  const left = doc.page.margins.left, width = doc.page.width - left - doc.page.margins.right, primary = documentBranding().color;
  const columns = [26, 100, width - 126 - sessions * 21, ...Array<number>(sessions).fill(21)];
  const header = () => {
    const g = data.options.group;
    doc.font("Helvetica-Bold").fontSize(16).fillColor(primary).text("LISTA DE ASISTENCIA", left, doc.y, { width });
    doc.moveDown(.3).font("Helvetica").fontSize(9).fillColor("#24364A")
      .text(`Grupo: ${g.name} · ${g.semesterName} · Ciclo: ${g.cycle}`, left, doc.y, { width });
    doc.text(`${g.program} · Turno: ${data.shift}`, left, doc.y, { width });
    doc.text(`Materia: ${data.subject ? `${data.subject.code} · ${data.subject.name}` : "Lista general del grupo"}`, left, doc.y, { width });
    doc.text(`Docente: ${data.teachers.join(" / ") || "________________________________"}`, left, doc.y, { width });
    doc.moveDown(.3).fontSize(8).text(`Periodo / mes: ____________________________     Alumnos: ${data.students.length}     Fechas: anotar día y mes en cada columna.`, left, doc.y, { width });
    doc.moveDown(.5);
    drawRow(["N.º", "MATRÍCULA", "NOMBRE DEL ALUMNO", ...Array.from({ length: sessions }, (_, i) => `${i + 1}\n__/__`)], 30, true);
  };
  const drawRow = (cells: string[], height: number, heading = false) => {
    const y = doc.y; let x = left;
    for (const [i, cell] of cells.entries()) {
      doc.rect(x, y, columns[i], height).fillAndStroke(heading ? primary : "#FFFFFF", "#D6DFEB");
      const padding = i >= 3 ? 2 : 3;
      doc.font(heading ? "Helvetica-Bold" : "Helvetica").fontSize(heading ? 6.5 : 8)
        .fillColor(heading ? "#FFFFFF" : "#24364A").text(cell, x + padding, y + 6, { width: columns[i] - padding * 2, align: i === 2 ? "left" : "center" });
      x += columns[i];
    }
    doc.x = left; doc.y = y + height;
  };
  header(); doc.on("pageAdded", header);
  for (const [index, student] of data.students.entries()) {
    doc.font("Helvetica").fontSize(8);
    const height = Math.max(27, doc.heightOfString(student.full_name, { width: columns[2] - 6 }) + 12,
      doc.heightOfString(student.student_number, { width: columns[1] - 6 }) + 12);
    if (doc.y + height + 36 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    drawRow([String(index + 1), student.student_number, student.full_name, ...Array<string>(sessions).fill("")], height);
  }
  doc.moveDown(.5).font("Helvetica").fontSize(7.5).fillColor("#607086").text("A = asistencia · F = falta · J = justificada     |     Nombre y firma del docente: __________________________________", left, doc.y, { width });
  doc.removeListener("pageAdded", header); doc.end();
}

export async function sendAttendanceListWorkbook(res: Response, data: ListData) {
  if (!data.students.length) throw new ApiError(409, "No hay alumnos activos que coincidan con los filtros seleccionados.");
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook(), brand = documentBranding();
  workbook.creator = brand.name;
  const sheet = workbook.addWorksheet("Lista de asistencia", { views: [{ state: "frozen", ySplit: 10, xSplit: 3, showGridLines: false }] });
  workbookLetterhead(workbook, sheet, "Lista de asistencia", sessions + 3);
  const group = data.options.group;
  const metadata = [`Grupo: ${group.name} · ${group.semesterName} · Ciclo: ${group.cycle} · ${data.shift}`,
    `${group.program} · Materia: ${data.subject?.name || "Lista general del grupo"}`,
    `Docente: ${data.teachers.join(" / ") || "________________________"} · Periodo / mes: ________________________`];
  metadata.forEach((text, i) => { sheet.mergeCells(6 + i, 1, 6 + i, sessions + 3); sheet.getCell(6 + i, 1).value = text;
    sheet.getCell(6 + i, 1).alignment = { wrapText: true, vertical: "middle" }; sheet.getRow(6 + i).height = 30; });
  sheet.getColumn(1).width = 5; sheet.getColumn(2).width = 20; sheet.getColumn(3).width = 42;
  for (let i = 4; i <= sessions + 3; i++) sheet.getColumn(i).width = 6;
  sheet.getRow(9).values = ["N.º", "Matrícula", "Nombre del alumno", ...Array.from({ length: sessions }, (_, i) => String(i + 1))];
  sheet.getRow(10).values = ["", "", "Día / mes", ...Array<string>(sessions).fill("__/__")];
  for (const n of [9, 10]) { sheet.getRow(n).height = 24; sheet.getRow(n).eachCell(cell => {
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + brand.color.slice(1) } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }); }
  data.students.forEach((student, i) => {
    const row = sheet.getRow(11 + i); row.values = [i + 1, student.student_number, student.full_name, ...Array<string>(sessions).fill("")];
    row.height = Math.max(28, Math.ceil(student.full_name.length / 35) * 14);
    row.eachCell(cell => { cell.font = { name: "Arial", size: 10 }; cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFD6DFEB" } }, bottom: { style: "thin", color: { argb: "FFD6DFEB" } },
        left: { style: "thin", color: { argb: "FFD6DFEB" } }, right: { style: "thin", color: { argb: "FFD6DFEB" } } }; });
  });
  const legend = data.students.length + 12; sheet.mergeCells(legend, 1, legend, sessions + 3);
  sheet.getCell(legend, 1).value = "A = asistencia · F = falta · J = justificada · Nombre y firma del docente: __________________________";
  sheet.pageSetup = { ...sheet.pageSetup, orientation: "landscape", printTitlesRow: "1:10", printArea: `A1:S${legend}`, fitToWidth: 1, fitToHeight: 0 };
  const buffer = await workbook.xlsx.writeBuffer();
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="lista-asistencia-grupo-${group.id}.xlsx"`).send(Buffer.from(buffer));
}
