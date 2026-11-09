import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import request from "supertest";
import ExcelJS from "exceljs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifop-attendance-lists-"));
process.env.DATABASE_PATH = path.join(directory, "school.db");
process.env.JWT_SECRET = "synthetic-attendance-lists-test";
const { app } = await import("./app.js");
const { all, db, get, run } = await import("./db.js");
const { loadUser, signToken } = await import("./auth.js");
const { attendanceListData } = await import("./services/attendance-lists.js");
const admin = get<{ id: number }>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!.id;
const auth = `Bearer ${signToken(loadUser(admin)!)}`;
const insert = (sql: string, ...args: (number | string | null)[]) => Number(run(sql, ...args).lastInsertRowid);
let sequence = 0;
function fixture() {
  const n = ++sequence;
  const program = insert("INSERT INTO programs(code,name,duration_periods) VALUES(?, 'Licenciatura en Enfermería IFOP',6)", `LIST-${n}`);
  const plan = insert("INSERT INTO academic_plans(program_id,code,name,version) VALUES(?,?,?,'2026')", program, `LIST-PLAN-${n}`, `Plan ${n}`);
  const old = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2025-08-01','2026-01-31')", `Anterior ${n}`);
  const cycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2026-08-10','2027-01-23')", `Ciclo actual ${n}`);
  const period = insert("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Primer parcial',1,'2026-08-10','2026-10-01')", cycle);
  const partial2 = insert("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Segundo parcial',2,'2026-10-02','2027-01-23')", cycle);
  const oldPeriod = insert("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Anterior',1,'2025-08-01','2026-01-31')", old);
  const shift = get<{ id: number }>("SELECT id FROM shifts LIMIT 1")!.id;
  const cp = get<{ id: number }>("SELECT id FROM curricular_periods WHERE sequence=3")!.id;
  const group = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", `LIST-G${n}`, program, shift, old, cycle, plan, cp);
  const otherGroup = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", `LIST-OTHER${n}`, program, shift, old, cycle, plan, cp);
  const subject = (label: string, semester: number, type = 'mandatory') => {
    const id = insert("INSERT INTO subjects(code,name,program_id,credits) VALUES(?,?,?,5)", `LIST${n}-${label}`, label, program);
    run("INSERT INTO plan_subjects(plan_id,subject_id,subject_type,credits,recommended_period) VALUES(?,?,?,5,?)", plan, id, type, semester);
    return id;
  };
  const a = subject(`Cuidados integrales ${n}`, 3), b = subject(`Optativa clínica ${n}`, 3, 'elective');
  const future = subject(`Materia futura ${n}`, 4), previous = subject(`Materia anterior ${n}`, 1);
  const teacher = get<{ id: number }>("SELECT id FROM teachers LIMIT 1")!.id;
  const scale = get<{ id: number }>("SELECT id FROM grading_scales LIMIT 1")!.id;
  const assign = (subjectId: number, periodId: number) => insert("INSERT INTO subject_assignments(group_id,subject_id,teacher_id,period_id,grading_scale_id) VALUES(?,?,?,?,?)", group, subjectId, teacher, periodId, scale);
  assign(a, period); assign(a, partial2); assign(future, oldPeriod);
  const student = (last: string, semester = 3, targetGroup = group, active = 1) => {
    const id = insert("INSERT INTO students(student_number,first_name,last_name,status_id,is_active,email) VALUES(?, 'Alumno',?,(SELECT id FROM student_statuses LIMIT 1),?, 'private@example.invalid')", `LIST-${n}-${last}`, last, active);
    const enrollment = insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,(SELECT id FROM curricular_periods WHERE sequence=?))", id, program, shift, targetGroup, old, plan, semester);
    return { id, enrollment };
  };
  const zeta = student('Zeta'), alpha = student('Álvarez'), fallback = student('Morales');
  const second = student('Segundo', 2), outsider = student('Otrogrupo', 3, otherGroup), inactive = student('Inactivo', 3, group, 0);
  const loaded = (st: { id: number; enrollment: number }, subjectId: number, semester = 3, schoolCycle = cycle) => run(
    "INSERT INTO student_subjects(student_id,enrollment_id,plan_id,subject_id,school_cycle_id,semester_number,status) VALUES(?,?,?,?,?,?,'pending')",
    st.id, st.enrollment, plan, subjectId, schoolCycle, semester);
  loaded(zeta, a); loaded(zeta, b); loaded(alpha, a); loaded(alpha, previous, 3, old);
  loaded(alpha, future, 4); loaded(second, a); loaded(outsider, a); loaded(inactive, a);
  return { group, otherGroup, a, b, future, previous, zeta, alpha, fallback, second, outsider, inactive, student, loaded, cycle, n };
}
function binary(res: any, callback: any) { const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk)); res.on("end", () => callback(null, Buffer.concat(chunks))); }
const download = (url: string) => request(app).get(`/api${url}`).set("Authorization", auth).buffer(true).parse(binary);
afterAll(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("Printable attendance lists", () => {
  it("filters active students by group, curricular semester and subject in the current calendar cycle", async () => {
    const f = fixture();
    const before = get<{ n: number }>("SELECT COUNT(*) AS n FROM student_subjects")!.n;
    const general = attendanceListData(f.group, 3);
    expect(general.students.map(st => st.id)).toEqual([f.alpha.id, f.fallback.id, f.zeta.id]);
    expect(general.options).toMatchObject({ studentCount: 3, group: { cycle: `Ciclo actual ${f.n}`, semester: 3, program: 'Licenciatura en Enfermería' } });
    expect(general.options.subjects.map(s => s.id)).toEqual(expect.arrayContaining([f.a, f.b]));
    expect(general.options.subjects.map(s => s.id)).not.toEqual(expect.arrayContaining([f.future, f.previous]));
    expect(general.options.subjects.find(s => s.id === f.a)?.studentCount).toBe(3);
    const filtered = await request(app).get(`/api/group-management/${f.group}/attendance-list?semester=3&subjectId=${f.b}`).set("Authorization", auth).expect(200);
    expect(filtered.body.studentCount).toBe(1);
    expect(attendanceListData(f.group, 3, f.b).students.map(st => st.id)).toEqual([f.zeta.id]);
    expect(attendanceListData(f.group, 2).students.map(st => st.id)).toEqual([f.second.id]);
    expect(attendanceListData(f.group, 4).students).toEqual([]);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM student_subjects")!.n).toBe(before);
  });
  it("uses mandatory plan subjects only when no current load or assignment exists", () => {
    const f = fixture();
    run("UPDATE subject_assignments SET is_active=0 WHERE group_id=?", f.group);
    const data = attendanceListData(f.group, 3);
    expect(data.options.subjects.find(s => s.id === f.a)?.studentCount).toBe(3);
    expect(data.options.subjects.find(s => s.id === f.b)?.studentCount).toBe(1);
    expect(data.options.subjects.some(s => s.id === f.future || s.id === f.previous)).toBe(false);
  });
  it("exports a branded editable workbook with exactly the selected students and blank attendance cells", async () => {
    const f = fixture();
    const response = await download(`/group-management/${f.group}/attendance-list.xlsx?semester=3&subjectId=${f.b}`).expect(200);
    expect(response.headers['content-disposition']).toContain('.xlsx');
    const book = new ExcelJS.Workbook(); await book.xlsx.load(response.body);
    const sheet = book.getWorksheet(1)!;
    expect(sheet.getCell('C11').value).toBe('Alumno Zeta');
    expect(sheet.getCell('D11').value).toBe('');
    expect(sheet.getCell('S11').value).toBe('');
    expect(sheet.getCell('C12').value).toBeNull();
    expect(sheet.getCell('A7').text).toContain(`Optativa clínica ${f.n}`);
    expect(sheet.getCell('A6').text).toContain(`Ciclo actual ${f.n}`);
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', printTitlesRow: '1:10', fitToWidth: 1 });
    expect(sheet.getImages().length).toBeGreaterThan(0);
    expect(sheet.headerFooter.oddFooter).toContain('Campus Frontera');
  });
  it("repeats the letterhead and roster headings on PDF pages without cutting long names", async () => {
    const f = fixture();
    for (let i = 0; i < 40; i++) f.student(`Apellido ${String(i).padStart(2, '0')} de un alumno con nombre extenso`);
    const response = await download(`/group-management/${f.group}/attendance-list.pdf?semester=3`).expect(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    const worker = new Worker(new URL('./services/pdf-reader-worker.mjs', import.meta.url), { workerData: response.body, execArgv: [] });
    try {
      const result: any = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      expect(result.error).toBeUndefined(); expect(result.pages.length).toBeGreaterThan(1);
      const texts = result.pages.map((page: any) => page.matrix.flat().join(' ').replace(/\s+/g, ' '));
      for (const text of texts) for (const value of ['Universidad IFOP', 'Campus Frontera', 'LISTA DE ASISTENCIA', 'NOMBRE DEL ALUMNO', `Ciclo actual ${f.n}`]) expect(text).toContain(value);
      const text = texts.join(' ');
      expect(text).toContain('Apellido 39 de un alumno con nombre extenso');
      expect(text).not.toContain('Alumno Inactivo'); expect(text).not.toContain('Alumno Otrogrupo'); expect(text).not.toContain('Alumno Segundo');
      expect(text).not.toContain('private@example.invalid');
    } finally { await worker.terminate(); }
  });
  it("requires staff export permissions and rejects invalid or empty filters while leaving retired attendance disabled", async () => {
    const f = fixture();
    for (const url of [`/group-management/${f.group}/attendance-list?semester=3`, `/group-management/${f.group}/attendance-list.pdf?semester=3`, `/group-management/${f.group}/attendance-list.xlsx?semester=3`]) {
      await request(app).get(`/api${url}`).expect(401);
      const uid = insert("INSERT INTO users(full_name,email,password_hash,role_id) VALUES('Consulta',?,'unused',(SELECT id FROM roles WHERE name='Consulta'))", `list-user-${sequence}-${url.includes('xlsx') ? 'xlsx' : url.includes('pdf') ? 'pdf' : 'json'}@example.invalid`);
      await request(app).get(`/api${url}`).set("Authorization", `Bearer ${signToken(loadUser(uid)!)}`).expect(403);
    }
    for (const query of ['semester=invalid', 'semester=0', 'semester=99', `semester=3&subjectId=${f.future}`, `semester=3&subjectId=${f.previous}`]) {
      await download(`/group-management/${f.group}/attendance-list.pdf?${query}`).expect(400);
    }
    await download(`/group-management/${f.group}/attendance-list.pdf?semester=4`).expect(409);
    await download('/group-management/999999/attendance-list.pdf?semester=3').expect(404);
    await request(app).get('/api/attendance').set('Authorization', auth).expect(410);
    expect(all('PRAGMA foreign_key_check')).toHaveLength(0);
  });
});
