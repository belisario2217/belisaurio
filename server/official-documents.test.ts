import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import request from "supertest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { QRCode } from "jsqr";
import { PNG } from "pngjs";

const decodeQR: (data: Uint8ClampedArray, width: number, height: number) => QRCode | null = createRequire(import.meta.url)("jsqr");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifop-documents-"));
process.env.DATABASE_PATH = path.join(directory, "school.db");
process.env.JWT_SECRET = "synthetic-official-documents-test";
const { app } = await import("./app.js");
const { all, db, get, run } = await import("./db.js");
const { loadUser, signToken } = await import("./auth.js");
const { getAcademicRecord } = await import("./services/academic-record.js");
const { getStudyCertificateData } = await import("./services/study-certificate.js");
const { publicAppUrl } = await import("./services/document-verification.js");
const admin = get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!.id;
const auth = `Bearer ${signToken(loadUser(admin)!)}`;
run("UPDATE institution_settings SET public_app_url = 'https://escuela.example.test' WHERE id = 1");
afterAll(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
function fixture(semester = 3) {
  const suffix = ++sequence;
  const insert = (sql: string, ...args: (string | number | null)[]) => Number(run(sql, ...args).lastInsertRowid);
  const program = insert("INSERT INTO programs(code,name,duration_periods) VALUES(?,?,6)", `DOC-${suffix}`, `Programa documental ${suffix}`);
  const plan = insert("INSERT INTO academic_plans(program_id,code,name,version,tuition_amount) VALUES(?,?,?,'2026',1200)", program, `DOC-PLAN-${suffix}`, `Plan de seis semestres ${suffix}`);
  const oldCycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2025-08-10','2026-01-23')", `Anterior ${suffix}`);
  const cycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2026-08-10','2027-01-23')", `2026B - 2027A prueba ${suffix}`);
  const shift = get<{id:number}>("SELECT id FROM shifts LIMIT 1")!.id;
  const curricular = get<{id:number}>("SELECT id FROM curricular_periods WHERE sequence = ?", semester)!.id;
  const group = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", `DOC-G${suffix}`, program, shift, oldCycle, cycle, plan, curricular);
  const student = insert("INSERT INTO students(student_number,first_name,last_name,status_id,email,phone) VALUES(?,?,?,(SELECT id FROM student_statuses LIMIT 1),?,?)", `DOC-${suffix}`, "María", `Alumno de prueba ${suffix}`, "private@example.invalid", "555-PRIVATE");
  const enrollment = insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", student, program, shift, group, oldCycle, plan, curricular);
  const period = insert("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Primer parcial',1,'2026-08-10','2026-10-20')", cycle);
  const oldPeriod = insert("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Primer parcial',1,'2025-08-10','2025-10-20')", oldCycle);
  const subjects = Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const id = insert("INSERT INTO subjects(code,name,program_id,credits) VALUES(?,?,?,5)", `DOC${suffix}-S${number}`, `Asignatura del semestre ${number} prueba ${suffix}`, program);
    run("INSERT INTO plan_subjects(plan_id,subject_id,subject_type,credits,recommended_period) VALUES(?,?,'mandatory',5,?)", plan, id, number);
    run(`INSERT INTO student_subjects(student_id,enrollment_id,plan_id,subject_id,school_cycle_id,semester_number,credits,status,final_score)
      VALUES(?,?,?,?,?,?,5,?,?)`, student, enrollment, plan, id, number < semester ? oldCycle : cycle, number,
      number < semester ? "completed" : number === semester ? "in_progress" : "pending", number < semester ? 7 + number : number > semester ? 10 : null);
    return id;
  });
  return { student, enrollment, program, plan, group, cycle, oldCycle, period, oldPeriod, subjects, semester };
}
function binary(response: any, callback: any) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("end", () => callback(null, Buffer.concat(chunks)));
}
const download = (url: string) => request(app).get(`/api${url}`).set("Authorization", auth).buffer(true).parse(binary);
async function pdfPages(buffer: Buffer): Promise<string[]> {
  const worker = new Worker(new URL("./services/pdf-reader-worker.mjs", import.meta.url), { workerData: buffer, execArgv: [] });
  try {
    const output: any = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    expect(output.error).toBeUndefined();
    return output.pages.map((page: any) => page.matrix.flat().join(" ").replace(/\s+/g, " "));
  } finally { await worker.terminate(); }
}
function lastIssued(student: number) {
  return get<{id:string;token:string;folio:string;verification_url:string;snapshot_json:string}>("SELECT * FROM issued_documents WHERE student_id = ? ORDER BY issued_at DESC, rowid DESC LIMIT 1", student)!;
}

describe("Official documents", () => {
  it("conserva los folios físicos en Cobros, incluso mayores de 1000 y 9999", async () => {
    const f = fixture();
    const folioRecords = ["10000", "0099", "1001", "0002", "9999", "0001"];
    const ids: number[] = [];
    for (const [index, physical] of folioRecords.entries()) {
      const result=await request(app).post("/api/payments").set("Authorization",auth).send({
        studentId:f.student,folio:`DOCUMENT-FOLIO-${index}-${f.student}`,
        amount:120+index,paidAt:"2026-10-17",concept:"Otros conceptos",
        paymentMethod:"Efectivo",notes:physical
      });
      expect(result.status).toBe(201);
      ids.push(result.body.billing.payments.find((p:any)=>p.folio===`DOCUMENT-FOLIO-${index}-${f.student}`).id);
    }
    const response=await request(app).get(`/api/payments/student/${f.student}`).set("Authorization",auth).expect(200);
    expect(response.body.billing.payments.filter((row:any)=>ids.includes(row.id)).map((row:any)=>row.notes).sort())
      .toEqual([...folioRecords].sort());
    await request(app).get("/api/payments/folios").set("Authorization",auth).expect(410);
    await request(app).get("/api/payments/folios/export").set("Authorization",auth).expect(410);
    await request(app).get("/api/payments/folios").expect(401);
  });

  it("carga todos los alumnos activos y grupos para documentos, sin límite de 100 registros", async () => {
    const sample=fixture();
    const status=get<{id:number}>("SELECT id FROM student_statuses LIMIT 1")!.id;
    try {
      for(let i=1;i<=108;i++) {
        run("INSERT INTO students(student_number,first_name,last_name,status_id,is_active) VALUES(?,?,?,?,?)",
          `DOC-SELECT-${i}`,"Estudiante",`Selector ${i}`,status,i===108?0:1);
      }
      const response=await request(app).get("/api/reports/document-options").set("Authorization",auth);
      expect(response.status).toBe(200);
      const students=response.body.students as Array<{id:number;name:string}>;
      expect(students.length).toBeGreaterThan(100);
      expect(students).toEqual(expect.arrayContaining([{id:sample.student,name:expect.stringContaining("DOC-") }]));
      expect(students.find(row=>row.name.startsWith("DOC-SELECT-1 - "))).toBeTruthy();
      expect(students.some(row=>row.name.startsWith("DOC-SELECT-108 - "))).toBe(false);
      expect(response.body.groups.some((group:{id:number})=>group.id===sample.group)).toBe(true);
      expect(response.body.cycles.some((cycle:{id:number})=>cycle.id===sample.cycle)).toBe(true);
      expect(response.body.groups.find((group:{id:number})=>group.id===sample.group)).toHaveProperty("active_cycle_id",sample.cycle);
      await request(app).get("/api/reports/document-options").expect(401);
    } finally {
      run("DELETE FROM students WHERE student_number LIKE 'DOC-SELECT-%'");
    }
  });

  it("uses only the academic degree in report cards, histories and their QR snapshots without renaming either plan", async () => {
    for (const suffix of ["IFOP", "UNITEN"]) {
      const f = fixture(), programName = `LICENCIATURA EN ENFERMERIA ${suffix}`;
      run("UPDATE programs SET name=? WHERE id=?", programName, f.program);
      const originalPlan = get("SELECT * FROM academic_plans WHERE id=?", f.plan);
      for (const document of ["report-card", "academic-history"]) {
        const response = await download(`/reports/${document}.pdf?studentId=${f.student}`);
        expect(response.status).toBe(200);
        const text = (await pdfPages(response.body)).join(" ");
        expect(text).toContain("Licenciatura en Enfermería");
        expect(text).not.toContain(programName);
        expect(text).not.toMatch(/Licenciatura en Enfermería (?:IFOP|UNITEN)/);
        const issued = lastIssued(f.student);
        const verified = await request(app).get(`/api/documents/verify/${issued.token}`).expect(200);
        expect(verified.body.document.student.program).toBe("Licenciatura en Enfermería");
        expect(JSON.parse(issued.snapshot_json).student.program).toBe("Licenciatura en Enfermería");
      }
      expect(get<{name:string}>("SELECT name FROM programs WHERE id=?", f.program)!.name).toBe(programName);
      expect(get("SELECT * FROM academic_plans WHERE id=?", f.plan)).toEqual(originalPlan);
      expect(getAcademicRecord(f.student, "report_card").student.program_name).toBe(programName);
    }
  });

  it("prints the clean degree in student exports without changing catalog or import names", async () => {
    const f = fixture(), programName = "Licenciatura en Enfermería IFOP";
    run("UPDATE programs SET name=? WHERE id=?", programName, f.program);
    const teacher = get<{id:number}>("SELECT id FROM teachers LIMIT 1")!.id;
    const scale = get<{id:number}>("SELECT id FROM grading_scales LIMIT 1")!.id;
    const assignment = Number(run("INSERT INTO subject_assignments(subject_id,group_id,teacher_id,period_id,grading_scale_id,evaluation_mode) VALUES(?,?,?,?,?,'partials')", f.subjects[2], f.group, teacher, f.period, scale).lastInsertRowid);
    run("INSERT INTO grades(enrollment_id,assignment_id,partial_1,status) VALUES(?,?,8,'pending')", f.enrollment, assignment);
    for (const url of [
      `/reports/student-list?groupId=${f.group}&format=xlsx`,
      `/reports/data/students?groupId=${f.group}&format=xlsx`,
      "/students/export/file?format=xlsx",
      `/grades/export/file?studentId=${f.student}&format=xlsx`
    ]) {
      const response = await download(url);
      expect(response.status).toBe(200);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(response.body);
      const cells: string[] = [];
      workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => cells.push(String(cell.value)))));
      expect(cells.join(" "), url).toContain("Licenciatura en Enfermería");
      expect(cells.join(" "), url).not.toContain(programName);
    }
    for (const url of [
      `/reports/student-list?groupId=${f.group}&format=pdf`
    ]) {
      const response = await download(url);
      expect(response.status).toBe(200);
      const text = (await pdfPages(response.body)).join(" ");
      expect(text, url).toContain("Licenciatura en Enfermería");
      expect(text, url).not.toContain(programName);
    }
    expect(get<{name:string}>("SELECT name FROM programs WHERE id=?", f.program)!.name).toBe(programName);
  });

  it("prints only the student's current semester in individual and group report cards", async () => {
    for (const semester of [1, 2, 3]) {
      const f = fixture(semester);
      for (const filter of [`studentId=${f.student}`, `groupId=${f.group}`]) {
        const response = await download(`/reports/report-card.pdf?${filter}`);
        expect(response.status).toBe(200);
        const text = (await pdfPages(response.body)).join(" ");
        expect(text).toContain(`Asignatura del semestre ${semester} prueba`);
        for (const number of [1, 2, 3, 4, 5, 6].filter(number => number !== semester)) expect(text).not.toContain(`Asignatura del semestre ${number} prueba`);
        expect(text).toContain("Firma del padre, madre o tutor");
        const issued = lastIssued(f.student);
        expect(text).toContain(issued.folio);
        expect(response.body.toString("latin1")).toContain(issued.verification_url);
      }
    }
  });

  it("separates cumulative coursework from future and unattempted plan subjects", async () => {
    const f = fixture();
    const record = getAcademicRecord(f.student, "academic_history");
    expect(record.subjects.map(subject => subject.semester_number)).toEqual([1, 2, 3]);
    expect(record.average).toBe(8.5);
    const response = await download(`/reports/academic-history.pdf?studentId=${f.student}`);
    expect(response.status).toBe(200);
    const text = (await pdfPages(response.body)).join(" ");
    expect(text).toContain("HISTORIAL ACADÉMICO");
    for (const number of [1, 2, 3]) expect(text).toContain(`Asignatura del semestre ${number} prueba`);
    for (const number of [4, 5, 6]) expect(text).not.toContain(`Asignatura del semestre ${number} prueba`);
    run("UPDATE student_subjects SET status='pending',final_score=NULL WHERE student_id=? AND semester_number=1", f.student);
    expect(getAcademicRecord(f.student, "academic_history").subjects.map(subject => subject.semester_number)).toEqual([2, 3]);
  });

  it("uses explicit current assignments and falls back to the current plan semester when none exist", () => {
    const f = fixture();
    const extra = Number(run("INSERT INTO subjects(code,name,program_id,credits) VALUES('UNASSIGNED','Optativa sin inscripción',?,5)", f.program).lastInsertRowid);
    run("INSERT INTO plan_subjects(plan_id,subject_id,subject_type,credits,recommended_period) VALUES(?,?,'elective',5,3)", f.plan, extra);
    expect(getAcademicRecord(f.student, "report_card").subjects.map(subject => subject.subject_id)).toEqual([f.subjects[2]]);
    run("DELETE FROM student_subjects WHERE student_id=? AND semester_number=3", f.student);
    expect(getAcademicRecord(f.student, "report_card").subjects.every(subject => subject.semester_number === 3)).toBe(true);
  });

  it("never carries a previous cycle's grades into the current report or treats a partial average as final", () => {
    const f = fixture();
    const teacher = get<{id:number}>("SELECT id FROM teachers LIMIT 1")!.id;
    const scale = get<{id:number}>("SELECT id FROM grading_scales LIMIT 1")!.id;
    const oldAssignment = Number(run("INSERT INTO subject_assignments(subject_id,group_id,teacher_id,period_id,grading_scale_id,evaluation_mode) VALUES(?,?,?,?,?,'final')", f.subjects[2], f.group, teacher, f.oldPeriod, scale).lastInsertRowid);
    run("INSERT INTO grades(enrollment_id,assignment_id,final_score,status) VALUES(?,?,10,'passed')", f.enrollment, oldAssignment);
    expect(getAcademicRecord(f.student, "report_card").subjects[0].final_score).toBeNull();
    const assignment = Number(run("INSERT INTO subject_assignments(subject_id,group_id,teacher_id,period_id,grading_scale_id,evaluation_mode) VALUES(?,?,?,?,?,'partials')", f.subjects[2], f.group, teacher, f.period, scale).lastInsertRowid);
    run("INSERT INTO grades(enrollment_id,assignment_id,partial_1,partial_2,final_score,status) VALUES(?,?,8,9,8.5,'pending')", f.enrollment, assignment);
    const report = getAcademicRecord(f.student, "report_card");
    expect(report.subjects[0]).toMatchObject({ semester_number: 3, partial_1: 8, partial_2: 9, partial_3: null, final_score: null, status: "in_progress" });
    expect(report.average).toBeNull();
  });

  it("does not infer semester from an evaluation sequence and rejects an unrelated evaluation cycle before streaming", async () => {
    const f = fixture();
    expect((await download(`/reports/report-card.pdf?studentId=${f.student}&periodId=${f.oldPeriod}`)).status).toBe(400);
    run("UPDATE enrollments SET curricular_period_id=NULL WHERE id=?", f.enrollment);
    run("UPDATE groups SET curricular_period_id=NULL WHERE id=?", f.group);
    expect((await download(`/reports/report-card.pdf?studentId=${f.student}`)).status).toBe(409);
    expect(all("SELECT id FROM issued_documents WHERE student_id=?", f.student)).toHaveLength(0);
  });

  it("uses the active group's calendar for different semesters, excluding global or other-cycle vacations", async () => {
    const f = fixture();
    const calendar = { startDate: "2026-08-10", endDate: "2027-01-23", vacations: [
      { start_date: "2026-12-18", end_date: "2027-01-04" }, { start_date: "2026-10-28", end_date: "2026-10-30" }
    ] };
    const saved = await request(app).put(`/api/settings/cycles/${f.cycle}/calendar`).set("Authorization", auth).send(calendar);
    expect(saved.status).toBe(200);
    run("INSERT INTO academic_calendar_events(event_type,title,start_date,end_date) VALUES('vacation','No debe figurar','2026-09-01','2026-09-02')");
    for (const semester of [1, 3]) {
      run("UPDATE enrollments SET curricular_period_id=(SELECT id FROM curricular_periods WHERE sequence=?) WHERE id=?", semester, f.enrollment);
      const certificate = getStudyCertificateData(f.student);
      expect(certificate.student.curricular_period_number).toBe(semester);
      expect(certificate.student.cycle_id).toBe(f.cycle);
      expect(certificate.calendar.vacations).toHaveLength(2);
      expect(certificate.calendar.activity_end).toBe("2027-01-23");
      const response = await download(`/reports/study-certificate.pdf?studentId=${f.student}`);
      expect(response.status).toBe(200);
      const text = (await pdfPages(response.body)).join(" ");
      expect(text).toContain(`2026B - 2027A prueba ${sequence}`);
      expect(text).toContain("10 de Agosto del 2026");
      expect(text).toContain("23 de Enero del 2027");
      expect(text).toContain("18 de Diciembre del 2026");
      expect(text).toContain("4 de Enero del 2027");
      expect(text).not.toContain("No debe figurar");
    }
    const first = get<{id:number}>("SELECT id FROM curricular_periods WHERE sequence=1")!.id;
    const expectedCalendar = getStudyCertificateData(f.student).calendar;
    const otherGroup = Number(run("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,curricular_period_id) SELECT 'Otro semestre',program_id,shift_id,cycle_id,active_cycle_id,? FROM groups WHERE id=?", first, f.group).lastInsertRowid);
    run("UPDATE enrollments SET group_id=?,curricular_period_id=? WHERE id=?", otherGroup, first, f.enrollment);
    expect(getStudyCertificateData(f.student).calendar).toEqual(expectedCalendar);
    run("DELETE FROM academic_calendar_events WHERE school_cycle_id IS NULL AND title='No debe figurar'");
  });

  it("falls back to the institutional active cycle instead of the formation cycle", () => {
    const f = fixture();
    const original = get<{active_cycle_id:number}>("SELECT active_cycle_id FROM institution_settings WHERE id=1")!.active_cycle_id;
    try {
      run("UPDATE groups SET active_cycle_id=NULL WHERE id=?", f.group);
      run("UPDATE institution_settings SET active_cycle_id=? WHERE id=1", f.cycle);
      expect(getStudyCertificateData(f.student).student.cycle_id).toBe(f.cycle);
      expect(getAcademicRecord(f.student, "report_card").student.curricular_period_number).toBe(3);
    } finally { run("UPDATE institution_settings SET active_cycle_id=? WHERE id=1", original); }
  });

  it("separates IFOP's own RVOE and CCT from the UNITEN collaboration in both PDF and QR", async () => {
    for (const authority of ["ifop", "uniten"] as const) {
      const f = fixture(), rvoe = `${authority.toUpperCase()}-RVOE-PRUEBA`;
      // The explicit plan governs recognition even if the program's old suffix says otherwise.
      run("UPDATE programs SET name=? WHERE id=?", `Licenciatura en Enfermería ${authority === "ifop" ? "UNITEN" : "IFOP"}`, f.program);
      run("UPDATE academic_plans SET certificate_authority=?,rvoe=? WHERE id=?", authority, rvoe, f.plan);
      const response = await download(`/reports/study-certificate.pdf?studentId=${f.student}`);
      expect(response.status).toBe(200);
      const text = (await pdfPages(response.body)).join(" "), issued = lastIssued(f.student);
      const verified = await request(app).get(`/api/documents/verify/${issued.token}`).expect(200);
      const cct = authority === "ifop" ? "27MSU0108N" : "18PSU0074C";
      expect(text).toContain(`CCT ${cct}`); expect(text).toContain(rvoe);
      expect(text).not.toContain(authority === "ifop" ? "18PSU0074C" : "27MSU0108N");
      if (authority === "ifop") {
        expect(text).toContain(`RVOE propio ${rvoe}`); expect(text).not.toMatch(/UNITEN|convenio/i);
      } else {
        expect(text).toContain("en convenio de colaboración"); expect(text).toContain("Centro Universitario Tecnológico de Enfermería");
        expect(text).toContain("UNITEN"); expect(text).not.toContain("RVOE propio");
      }
      expect(verified.body.document.content.certification).toMatchObject({ authority, cct, rvoe, collaborationAgreement: authority === "uniten" });
      expect(verified.body.document.student.program).toBe("Licenciatura en Enfermería");
      expect(verified.body.document.content.calendar).toMatchObject({ start: "2026-08-10", end: "2027-01-23" });
      if (authority === "ifop") expect(JSON.stringify(verified.body)).not.toContain("UNITEN");
      run("UPDATE academic_plans SET certificate_authority=?,rvoe='CORREGIDO' WHERE id=?", authority === "ifop" ? "uniten" : "ifop", f.plan);
      expect((await request(app).get(`/api/documents/verify/${issued.token}`)).body).toEqual(verified.body);
    }
  });

  it("prioritizes the student's assigned plan and refuses to guess between IFOP and UNITEN", async () => {
    const f = fixture();
    const uniten = Number(run("INSERT INTO academic_plans(program_id,code,name,version,certificate_authority,rvoe) VALUES(?,?,?,'2026','uniten','UNITEN-PRUEBA')", f.program, `UNITEN-ALT-${sequence}`, "Plan alterno UNITEN").lastInsertRowid);
    run("UPDATE groups SET plan_id=? WHERE id=?", uniten, f.group);
    expect(getStudyCertificateData(f.student).certification.authority).toBe("ifop");
    run("UPDATE enrollments SET plan_id=? WHERE id=?", uniten, f.enrollment);
    run("UPDATE groups SET plan_id=? WHERE id=?", f.plan, f.group);
    expect(getStudyCertificateData(f.student).certification.authority).toBe("uniten");
    run("UPDATE enrollments SET plan_id=NULL WHERE id=?", f.enrollment);
    expect(getStudyCertificateData(f.student).certification.authority).toBe("ifop");
    run("UPDATE groups SET plan_id=NULL WHERE id=?", f.group);
    const response = await download(`/reports/study-certificate.pdf?studentId=${f.student}`);
    expect(response.status).toBe(409); expect(JSON.parse(response.body.toString()).message).toContain("Asigna el plan IFOP o UNITEN");
    expect(all("SELECT id FROM issued_documents WHERE student_id=?", f.student)).toHaveLength(0);
  });

  it("stores the plan's institution explicitly, preserves it when renamed and validates changes without altering its RVOE", async () => {
    const f = fixture();
    const body = { programId: f.program, code: `NUEVO-UNITEN-${sequence}`, name: "Plan de colaboración UNITEN", version: "2027", rvoe: "RVOE-CONSERVADO", assignExisting: false,
      subjects: [{ code: `CERT-SUB-${sequence}`, name: "Asignatura de prueba", subjectType: "mandatory", credits: 5, recommendedPeriod: 1 }] };
    const created = await request(app).post("/api/plans").set("Authorization", auth).send(body).expect(201);
    expect(created.body.certificate_authority).toBe("uniten");
    const renamed = await request(app).put(`/api/plans/${created.body.id}`).set("Authorization", auth).send({ ...body, name: "Plan renombrado sin institución en el título" }).expect(200);
    expect(renamed.body.certificate_authority).toBe("uniten"); expect(renamed.body.rvoe).toBe(body.rvoe);
    await request(app).put(`/api/plans/${created.body.id}`).set("Authorization", auth).send({ ...body, certificateAuthority: "otra" }).expect(400);
    const changed = await request(app).put(`/api/plans/${created.body.id}`).set("Authorization", auth).send({ ...body, certificateAuthority: "ifop" }).expect(200);
    expect(changed.body.certificate_authority).toBe("ifop"); expect(changed.body.rvoe).toBe(body.rvoe);
    expect((await request(app).get(`/api/plans/${created.body.id}`).set("Authorization", auth)).body.plan.certificate_authority).toBe("ifop");
  });

  it("validates real dates and complete vacation ranges atomically", async () => {
    const f = fixture();
    const badCalendars = [
      { startDate: "2026-02-30", endDate: "2027-01-23", vacations: [] },
      { startDate: "2027-08-10", endDate: "2027-01-23", vacations: [] },
      { startDate: "2026-08-10", endDate: "2027-01-23", vacations: [{ start_date: "2025-12-18", end_date: "2027-01-04" }] },
      { startDate: "2026-08-10", endDate: "2027-01-23", vacations: [{ start_date: "2026-12-18", end_date: "2027-01-04" }, { start_date: "2027-01-01", end_date: "2027-01-05" }] }
    ];
    for (const calendar of badCalendars) expect((await request(app).put(`/api/settings/cycles/${f.cycle}/calendar`).set("Authorization", auth).send(calendar)).status).toBe(400);
    expect(get<{start_date:string}>("SELECT start_date FROM school_cycles WHERE id=?", f.cycle)!.start_date).toBe("2026-08-10");
    expect(all("SELECT id FROM academic_calendar_events WHERE school_cycle_id=?", f.cycle)).toHaveLength(0);
  });

  it("preserves the existing billing start when academic dates change", async () => {
    const f = fixture();
    const before = await request(app).get(`/api/payments/student/${f.student}`).set("Authorization", auth);
    expect(before.status).toBe(200);
    await request(app).patch(`/api/catalogs/cycles/${f.oldCycle}`).set("Authorization", auth)
      .send({ start_date: "2025-08-15", end_date: "2026-01-23" }).expect(200);
    const after = await request(app).get(`/api/payments/student/${f.student}`).set("Authorization", auth);
    expect(after.body.student.billingStartDate).toBe(before.body.student.billingStartDate);
    expect(after.body.student.billingStartDate).toBe("2025-08-10");
  });

  it("keeps issued names, dates and grades immutable and verifies anonymously after live data change", async () => {
    const f = fixture();
    run("UPDATE student_subjects SET final_score=8,status='completed' WHERE student_id=? AND semester_number=3", f.student);
    const response = await download(`/reports/report-card.pdf?studentId=${f.student}`);
    expect(response.status).toBe(200);
    const issued = lastIssued(f.student);
    const before = await request(app).get(`/api/documents/verify/${issued.token}`);
    expect(before.status).toBe(200); expect(before.body.status).toBe("valid");
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.body.document.content.subjects[0].score).toBe(8);
    expect(before.body.document.student.semester).toBe(3);
    expect(JSON.stringify(before.body)).not.toMatch(/private@example|555-PRIVATE|curp|birth_date/);
    run("UPDATE students SET first_name='Nombre cambiado' WHERE id=?", f.student);
    run("UPDATE student_subjects SET final_score=10 WHERE student_id=? AND semester_number=3", f.student);
    run("UPDATE school_cycles SET start_date='2026-08-15' WHERE id=?", f.cycle);
    const after = await request(app).get(`/api/documents/verify/${issued.token}`).set("Authorization", "Bearer expired-token");
    expect(after.status).toBe(200); expect(after.body).toEqual(before.body);
    expect(() => run("UPDATE issued_documents SET snapshot_json='{}' WHERE id=?", issued.id)).toThrow(/inmutables/);
    const text = (await pdfPages(response.body)).join(" ");
    expect(text).toContain(before.body.document.student.name);
    expect(text).toContain(issued.folio);
    await download(`/reports/report-card.pdf?studentId=${f.student}`);
    expect(lastIssued(f.student).token).not.toBe(issued.token);
  });

  it("rejects unknown tokens and restricts issuance, listing and revocation to authorized staff", async () => {
    const f = fixture();
    await request(app).get(`/api/documents/verify/${"a".repeat(48)}`).expect(404);
    await request(app).get("/api/documents/verify/invalid").expect(404);
    await request(app).get(`/api/reports/academic-history.pdf?studentId=${f.student}`).expect(401);
    await download(`/reports/report-card.pdf?studentId=${f.student}`);
    const issued = lastIssued(f.student);
    const studentUser = get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Alumno' LIMIT 1")!.id;
    const studentAuth = `Bearer ${signToken(loadUser(studentUser)!)}`;
    await request(app).get(`/api/reports/issued-documents?studentId=${f.student}`).set("Authorization", studentAuth).expect(403);
    await request(app).post(`/api/reports/issued-documents/${issued.id}/revoke`).set("Authorization", studentAuth).send({ reason: "No autorizado" }).expect(403);
    await request(app).post(`/api/reports/issued-documents/${issued.id}/revoke`).set("Authorization", auth).send({ reason: "Corrección institucional" }).expect(200);
    const verified = await request(app).get(`/api/documents/verify/${issued.token}`);
    expect(verified.body.status).toBe("revoked"); expect(verified.body.revokedAt).toBeTruthy();
    expect(verified.body.document.folio).toBe(issued.folio);
  });

  it("does not declare a record with a mismatched fingerprint official", async () => {
    const f = fixture();
    await download(`/reports/report-card.pdf?studentId=${f.student}`);
    const issued = lastIssued(f.student), token = "b".repeat(48);
    run(`INSERT INTO issued_documents(id,token,folio,document_type,student_id,issued_at,snapshot_json,snapshot_hash,verification_url)
      SELECT 'damaged-test',?,folio||'-INVALID',document_type,student_id,issued_at,snapshot_json,'incorrect',verification_url
      FROM issued_documents WHERE id=?`, token, issued.id);
    const response = await request(app).get(`/api/documents/verify/${token}`);
    expect(response.status).toBe(200); expect(response.body.status).toBe("invalid");
    expect(response.body.document).toBeUndefined();
  });

  it("embeds a readable QR in the printed workbook linked to the exact statement amounts and physical folios", async () => {
    const f = fixture();
    run("UPDATE programs SET name='Licenciatura en Enfermería UNITEN' WHERE id=?", f.program);
    run("INSERT INTO student_payments(student_id,enrollment_id,folio,amount,paid_at,concept,notes) VALUES(?,?,'INTERNAL-ONLY-TEST',1500,'2026-10-15','Inscripción',' 0043 ')", f.student, f.enrollment);
    const response = await download(`/payments/student/${f.student}/statement?format=xlsx`);
    expect(response.status).toBe(200);
    const archive = await JSZip.loadAsync(response.body);
    let decoded: string | undefined;
    for (const entry of Object.values(archive.files).filter(file => /^xl\/media\/.*\.png$/.test(file.name))) {
      const png = PNG.sync.read(await entry.async("nodebuffer"));
      decoded = decodeQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data || decoded;
    }
    const issued = lastIssued(f.student);
    expect(decoded).toBe(issued.verification_url);
    const verified = await request(app).get(`/api/documents/verify/${issued.token}`);
    expect(verified.body.document.content.totalPaid).toBe(1500);
    expect(verified.body.document.student.program).toBe("Licenciatura en Enfermería");
    expect(verified.body.document.content.payments).toEqual([{ date: "2026-10-15", concept: "Inscripción", amount: 1500, folio: "0043" }]);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(response.body);
    expect(workbook.worksheets[0].getCell("C9").value).toBe("Licenciatura en Enfermería");
    expect(String(workbook.worksheets[1].getCell("A2").value)).toContain("Licenciatura en Enfermería");
    expect(String(workbook.worksheets[1].getCell("A2").value)).not.toContain("UNITEN");
    expect(workbook.worksheets[0].getCell("A31").value).toMatchObject({ text: issued.folio, hyperlink: decoded });
    expect(workbook.worksheets[0].getCell("F16").value).toBe("0043");
    expect(String(workbook.worksheets[0].getCell("A35").value)).toBe(`CÓDIGO DE VERIFICACIÓN SHA-256: EC-${verified.body.fingerprint.toUpperCase()}`);
    const pdf = await download(`/payments/student/${f.student}/statement?format=pdf`);
    expect(pdf.status).toBe(200);
    const text = (await pdfPages(pdf.body)).join(" ");
    expect(text).toContain("Licenciatura en Enfermería");
    expect(text).not.toContain("Licenciatura en Enfermería UNITEN");
  });

  it("repeats identity, headings and footer safely on multi-page histories", async () => {
    const f = fixture();
    for (let index = 0; index < 38; index++) {
      const subject = Number(run("INSERT INTO subjects(code,name,program_id,credits) VALUES(?,?,?,5)", `LONG-${index}`, `Asignatura extensa de formación institucional y práctica profesional número ${index}`, f.program).lastInsertRowid);
      run("INSERT INTO student_subjects(student_id,enrollment_id,plan_id,subject_id,school_cycle_id,semester_number,credits,status) VALUES(?,?,?,?,?,3,5,'in_progress')", f.student, f.enrollment, f.plan, subject, f.cycle);
    }
    const response = await download(`/reports/academic-history.pdf?studentId=${f.student}`);
    expect(response.status).toBe(200);
    const pages = await pdfPages(response.body);
    expect(pages.length).toBeGreaterThan(1);
    for (const text of pages) {
      expect(text).toContain("Universidad IFOP"); expect(text).toContain("Campus Frontera");
      expect(text).toContain("María Alumno de prueba"); expect(text).toContain("Página");
      expect(text).toContain("Documento académico emitido por Universidad IFOP");
      expect(text).not.toContain("Asignatura del semestre 4");
    }
    expect(pages.join(" ")).toContain(lastIssued(f.student).folio);
  });

  it("requires a configured public URL in production and never derives QR destinations from request headers", () => {
    const oldMode = process.env.NODE_ENV, oldPublic = process.env.PUBLIC_APP_URL, oldRender = process.env.RENDER_EXTERNAL_URL, oldOrigin = process.env.APP_ORIGIN;
    try {
      run("UPDATE institution_settings SET public_app_url=NULL WHERE id=1");
      process.env.NODE_ENV = "production";
      delete process.env.PUBLIC_APP_URL; delete process.env.RENDER_EXTERNAL_URL; delete process.env.APP_ORIGIN;
      expect(() => publicAppUrl()).toThrow(/URL pública/);
      process.env.RENDER_EXTERNAL_URL = "https://universidad.example.test";
      expect(publicAppUrl()).toBe("https://universidad.example.test");
    } finally {
      for (const [key, value] of Object.entries({ NODE_ENV: oldMode, PUBLIC_APP_URL: oldPublic, RENDER_EXTERNAL_URL: oldRender, APP_ORIGIN: oldOrigin })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      run("UPDATE institution_settings SET public_app_url='https://escuela.example.test' WHERE id=1");
    }
  });
});
