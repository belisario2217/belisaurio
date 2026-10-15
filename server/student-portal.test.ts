import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import request from "supertest";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifop-student-portal-"));
process.env.DATABASE_PATH = path.join(directory, "school.db");
process.env.JWT_SECRET = "synthetic-student-portal";
const { app } = await import("./app.js");
const { db, get, run } = await import("./db.js");
const { loadUser, signToken } = await import("./auth.js");
const { activeStudentPortalData, studentPortalData } = await import("./routes/portal.js");
const { getAcademicRecord } = await import("./services/academic-record.js");
const admin = get<{id:number;password_hash:string}>("SELECT u.* FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!;
const adminAuth = `Bearer ${signToken(loadUser(admin.id)!)}`;
run("UPDATE institution_settings SET public_app_url='https://escuela.example.test',director_name='Director de prueba' WHERE id=1");
afterAll(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
function fixture(semester = 3) {
  const key = ++sequence;
  const insert = (sql: string, ...args: (string | number | null)[]) => Number(run(sql, ...args).lastInsertRowid);
  const program = insert("INSERT INTO programs(code,name,duration_periods) VALUES(?,?,6)", `PORTAL-${key}`, `Programa ${key}`);
  const plan = insert("INSERT INTO academic_plans(program_id,code,name,version) VALUES(?,?,?,'2026')", program, `PORTAL-PLAN-${key}`, `Plan ${key}`);
  const oldCycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2025-08-10','2026-01-23')", `Anterior ${key}`);
  const cycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2026-08-10','2027-01-23')", `Activo ${key}`);
  const shift = get<{id:number}>("SELECT id FROM shifts LIMIT 1")!.id;
  const cp = get<{id:number}>("SELECT id FROM curricular_periods WHERE sequence=?", semester)!.id;
  const group = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", `PORTAL-G${key}`, program, shift, oldCycle, cycle, plan, cp);
  const student = insert("INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,?,?,(SELECT id FROM student_statuses LIMIT 1))", `PORTAL-${key}`, "Estudiante", `Prueba ${key}`);
  const enrollment = insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", student, program, shift, group, oldCycle, plan, cp);
  const period = insert("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Primer parcial',1,'2026-08-10','2026-10-20')", cycle);
  const teacher = get<{id:number}>("SELECT id FROM teachers LIMIT 1")!.id;
  const scale = get<{id:number}>("SELECT id FROM grading_scales LIMIT 1")!.id;
  const addSubject = (name: string, atSemester: number, status: string | null, atCycle: number = cycle, score: number | null = null) => {
    const subject = insert("INSERT INTO subjects(code,name,program_id,credits) VALUES(?,?,?,5)", `P${key}-${name}`, name, program);
    run("INSERT INTO plan_subjects(plan_id,subject_id,subject_type,credits,recommended_period) VALUES(?,?,'mandatory',5,?)", plan, subject, atSemester);
    if (status) run("INSERT INTO student_subjects(student_id,enrollment_id,plan_id,subject_id,school_cycle_id,semester_number,credits,status,final_score,status_manual_override) VALUES(?,?,?,?,?,?,5,?,?,1)", student, enrollment, plan, subject, atCycle, atSemester, status, score);
    return subject;
  };
  const past = addSubject("Materia cursada", 1, "completed", oldCycle, 8);
  const current = addSubject("Materia activa", semester, "in_progress");
  const future = addSubject("Materia futura", 6, "pending");
  const unloaded = addSubject("Materia aún no cargada", semester, null);
  const pending = addSubject("Materia pendiente", semester, "pending");
  const old = addSubject("Materia de otro ciclo", semester, "in_progress", oldCycle);
  const assignment = insert("INSERT INTO subject_assignments(subject_id,group_id,teacher_id,period_id,grading_scale_id,evaluation_mode) VALUES(?,?,?,?,?,'partials')", current, group, teacher, period, scale);
  const pendingAssignment = insert("INSERT INTO subject_assignments(subject_id,group_id,teacher_id,period_id,grading_scale_id,evaluation_mode) VALUES(?,?,?,?,?,'partials')", pending, group, teacher, period, scale);
  const role = get<{id:number}>("SELECT id FROM roles WHERE name='Alumno'")!.id;
  const user = insert("INSERT INTO users(full_name,email,password_hash,role_id,student_id) VALUES(?,?,?,?,?)", `Estudiante ${key}`, `portal-${key}@example.invalid`, admin.password_hash, role, student);
  const auth = `Bearer ${signToken(loadUser(user)!)}`;
  return { student, enrollment, plan, group, cp, cycle, oldCycle, period, current, past, future, unloaded, pending, old, assignment, pendingAssignment, auth, addSubject };
}
const capture = (f: ReturnType<typeof fixture>, partials: Record<string,number|null>) => request(app).put(`/api/grades/assignment/${f.assignment}`).set("Authorization",adminAuth).send({grades:[{enrollmentId:f.enrollment,partials}]});
function binary(response: any, callback: any) {
  const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("end", () => callback(null,Buffer.concat(chunks)));
}
async function pdfText(buffer: Buffer) {
  const worker = new Worker(new URL("./services/pdf-reader-worker.mjs",import.meta.url),{workerData:buffer,execArgv:[]});
  try { const output: any = await new Promise((resolve,reject) => { worker.once("message",resolve); worker.once("error",reject); });
    expect(output.error).toBeUndefined(); return output.pages.map((p:any)=>p.matrix.flat().join(" ")).join(" ").replace(/\s+/g," ");
  } finally { await worker.terminate(); }
}

describe("Student portal coursework and report", () => {
  it("shows only loaded current-semester subjects in the active cycle and respects administrative pending status", async () => {
    const f = fixture();
    const response = await request(app).get("/api/portal").set("Authorization",f.auth).expect(200);
    expect(response.body.subjects.map((s:any)=>s.subject_id)).toEqual([f.current]);
    expect(response.body.subjects[0]).toMatchObject({recommended_period:3,status:"in_progress",course_cycle_name:`Activo ${sequence}`});
    expect(response.body.activeSubjects).toBeUndefined();
    expect(response.body.student.billing_start_date).toBe("2025-08-10");
    expect(studentPortalData(f.student).subjects.some(s=>s.subject_id===f.future)).toBe(true);
  });
  it("uses group semester and cycle when the enrollment has no individual semester", () => {
    const f = fixture(); run("UPDATE enrollments SET curricular_period_id=NULL,plan_id=NULL WHERE id=?",f.enrollment);
    expect(activeStudentPortalData(f.student).subjects.map(s=>s.subject_id)).toEqual([f.current]);
  });
  it("keeps a first partial out of final grades, completion counts and official report finals, including stale curricular averages", async () => {
    const f = fixture(); await capture(f,{partial1:9,partial2:null,partial3:null}).expect(200);
    expect(get("SELECT status,final_score FROM student_subjects WHERE enrollment_id=? AND subject_id=? AND school_cycle_id=?",f.enrollment,f.current,f.cycle)).toMatchObject({status:"in_progress",final_score:null});
    run("UPDATE student_subjects SET status='completed',final_score=9 WHERE student_id=? AND subject_id=?",f.student,f.current);
    const data = activeStudentPortalData(f.student);
    expect(data.subjects[0]).toMatchObject({partial_1:9,partial_2:null,partial_3:null,final_score:null,status:"in_progress"});
    expect(data.progress).toMatchObject({average:8,completedSubjects:1});
    expect(getAcademicRecord(f.student,"report_card").subjects.find(s=>s.subject_id===f.current)).toMatchObject({final_score:null,status:"in_progress"});
  });
  it("publishes a final only when all three partials are present, including a zero and a failed result", async () => {
    const f = fixture(); await capture(f,{partial1:0,partial2:null,partial3:null}).expect(200);
    expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({partial_1:0,final_score:null,status:"in_progress"});
    await capture(f,{partial1:0,partial2:3,partial3:3}).expect(200);
    expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({final_score:2,status:"failed"});
    await capture(f,{partial1:8,partial2:9,partial3:10}).expect(200);
    expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({final_score:9,status:"passed"});
  });
  it("treats a scalar capture on a partial assignment as its configured partial instead of a semester final", async () => {
    const f = fixture();
    await request(app).put(`/api/grades/assignment/${f.assignment}`).set("Authorization",adminAuth).send({grades:[{enrollmentId:f.enrollment,score:7}]}).expect(200);
    expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({partial_1:7,partial_2:null,partial_3:null,final_score:null,status:"in_progress"});
  });
  it("does not blend grades from another school cycle or expose future or unplaced plan subjects", () => {
    const f=fixture();
    const futurePeriod=Number(run("INSERT INTO academic_periods(cycle_id,name,sequence,start_date,end_date) VALUES(?,'Primer parcial',1,'2025-08-10','2025-10-20')",f.oldCycle).lastInsertRowid);
    const oldAssignment=Number(run("INSERT INTO subject_assignments(subject_id,group_id,teacher_id,period_id,grading_scale_id,evaluation_mode) SELECT subject_id,group_id,teacher_id,?,grading_scale_id,'final' FROM subject_assignments WHERE id=?",futurePeriod,f.assignment).lastInsertRowid);
    run("INSERT INTO grades(enrollment_id,assignment_id,final_score,status) VALUES(?,?,10,'passed')",f.enrollment,oldAssignment);
    expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({partial_1:null,final_score:null});
  });
  it("shows the active assignment when a legacy curricular row still points to the formation cycle", async () => {
    const f=fixture();
    run("UPDATE student_subjects SET school_cycle_id=?,status='completed',final_score=10 WHERE student_id=? AND subject_id=?",f.oldCycle,f.student,f.current);
    run("INSERT INTO grades(enrollment_id,assignment_id,partial_1,final_score,status) VALUES(?,?,9,9,'pending')",f.enrollment,f.assignment);
    expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({subject_id:f.current,partial_1:9,partial_2:null,final_score:null,status:"in_progress"});
  });
  it("downloads only the authenticated student's informative report, with an immutable QR snapshot and no signatures or seals", async () => {
    const f=fixture(),other=fixture(); await capture(f,{partial1:9,partial2:null,partial3:null}).expect(200);
    const pdf=await request(app).get(`/api/portal/report-card.pdf?studentId=${other.student}`).set("Authorization",f.auth).buffer(true).parse(binary).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");expect(pdf.headers["cache-control"]).toContain("no-store");
    const text=await pdfText(pdf.body);
    expect(text).toContain("BOLETA DEL ALUMNO");expect(text).toContain("No tiene valor para trámites");expect(text).toContain("Materia activa");
    expect(text).not.toMatch(/FIRMA|SELLO|Director de prueba|Materia futura|Materia pendiente|Materia aún no cargada|Materia cursada|Materia de otro ciclo/);
    const issued=get<{token:string;verification_url:string}>("SELECT token,verification_url FROM issued_documents WHERE student_id=? ORDER BY rowid DESC LIMIT 1",f.student)!;
    expect(pdf.body.toString("latin1")).toContain(issued.verification_url);
    const verified=await request(app).get(`/api/documents/verify/${issued.token}`).expect(200);
    expect(verified.body.message).toContain("no tiene valor para trámites");expect(verified.body.message).not.toContain("es oficial");
    expect(verified.body.document).toMatchObject({title:"Boleta del alumno",institution:{directorName:""},content:{purpose:"student_copy",average:null}});
    expect(verified.body.document.content.subjects).toHaveLength(1);
    expect(verified.body.document.content.subjects[0]).toMatchObject({partial1:9,partial2:null,partial3:null,score:null});
    await capture(f,{partial1:8,partial2:9,partial3:10}).expect(200);
    expect((await request(app).get(`/api/documents/verify/${issued.token}`)).body).toEqual(verified.body);
  });
  it("requires a linked student and authentication for a report download", async () => {
    await request(app).get("/api/portal/report-card.pdf").expect(401);
    await request(app).get("/api/portal/report-card.pdf").set("Authorization",adminAuth).expect(403);
  });
  it("repairs only proven automatic third-semester copies, preserves real partials and keeps the original records", () => {
    const copied=fixture(),real=fixture(),historical=fixture(2);
    for(const f of [copied,real,historical]) {
      const grade=Number(run("INSERT INTO grades(enrollment_id,assignment_id,partial_1,partial_2,partial_3,final_score,status,updated_by) VALUES(?,?,8,8,8,8,'passed',?)",f.enrollment,f.assignment,admin.id).lastInsertRowid);
      run("INSERT INTO grade_history(grade_id,new_score,reason,changed_by) VALUES(?,8,?,?)",grade,f===real?"Captura de parciales":"Sincronizacion desde trayectoria curricular",admin.id);
      run("UPDATE student_subjects SET final_score=8,status='completed' WHERE enrollment_id=? AND subject_id=?",f.enrollment,f.current);
    }
    db.exec(fs.readFileSync(path.resolve("server/migrations/033_repair_third_semester_partials.sql"),"utf8"));
    expect(activeStudentPortalData(copied.student).subjects[0]).toMatchObject({partial_1:8,partial_2:null,partial_3:null,final_score:null,status:"in_progress"});
    for(const f of [real,historical]) expect(activeStudentPortalData(f.student).subjects[0]).toMatchObject({partial_1:8,partial_2:8,partial_3:8,final_score:8,status:"passed"});
    const backup=get<{original_grade_json:string;original_subjects_json:string}>("SELECT * FROM grade_partial_repairs LIMIT 1")!;
    expect(JSON.parse(backup.original_grade_json)).toMatchObject({partial_2:8,partial_3:8,status:"passed"});
    expect(JSON.parse(backup.original_subjects_json)[0]).toMatchObject({status:"completed",final_score:8});
  });
});
