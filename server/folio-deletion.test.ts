import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import ExcelJS from "exceljs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifop-folio-deletion-"));
process.env.DATABASE_PATH = path.join(directory, "school.db");
process.env.JWT_SECRET = "synthetic-folio-deletion";
const { app } = await import("./app.js");
const { db, get, run } = await import("./db.js");
const { loadUser, signToken } = await import("./auth.js");
const admin = get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador' LIMIT 1")!.id;
const auth = `Bearer ${signToken(loadUser(admin)!)}`;
const today = new Intl.DateTimeFormat("sv-SE", {timeZone:"America/Mexico_City"}).format(new Date());
const month = today.slice(0,7);
let sequence = 0;
afterAll(() => { db.close(); fs.rmSync(directory, {recursive:true,force:true}); });
function fixture() {
  const n = ++sequence;
  const insert = (sql:string,...args:(string|number)[]) => Number(run(sql,...args).lastInsertRowid);
  const program = insert("INSERT INTO programs(code,name,duration_periods) VALUES(?,?,6)",`FOL-${n}`,`Programa folios ${n}`);
  const plan = insert("INSERT INTO academic_plans(program_id,code,name,version,tuition_amount) VALUES(?,?,?,'2026',1000)",program,`FOL-PLAN-${n}`,`Plan folios ${n}`);
  const cycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,?,?)",`Folios ${n}`,`${month}-01`,`${month}-28`);
  const shift = get<{id:number}>("SELECT id FROM shifts LIMIT 1")!.id;
  const period = get<{id:number}>("SELECT id FROM curricular_periods WHERE sequence=3")!.id;
  const group = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)",`FOL-G${n}`,program,shift,cycle,cycle,plan,period);
  const student = insert("INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,?,?,(SELECT id FROM student_statuses WHERE is_terminal=0 LIMIT 1))",`FOL-${n}`,"Estudiante",`Folios ${n}`);
  const enrollment = insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id,plan_id,curricular_period_id,tuition_start_date,tuition_due_day) VALUES(?,?,?,?,?,?,?,?,1)",student,program,shift,group,cycle,plan,period,`${month}-01`);
  const user = insert("INSERT INTO users(full_name,email,password_hash,role_id,student_id) VALUES(?,?,?,(SELECT id FROM roles WHERE name='Alumno'),?)",`Alumno folios ${n}`,`folios${n}@example.invalid`,"unused",student);
  return {student,enrollment,group,studentAuth:`Bearer ${signToken(loadUser(user)!)}`};
}
const adminGet = (url:string) => request(app).get(`/api${url}`).set("Authorization",auth);
async function pay(f:ReturnType<typeof fixture>, physical:string, amount=1000, concept="Colegiatura", registrationPeriodNumber?:number) {
  const folio = `SYNTHETIC-${f.student}-${physical}-${Date.now()}-${Math.random()}`;
  const response = await request(app).post("/api/payments").set("Authorization",auth).send({studentId:f.student,folio,amount,paidAt:today,concept,conceptType:registrationPeriodNumber ? "reenrollment" : concept === "Colegiatura" ? "tuition" : "other",coveredMonth:registrationPeriodNumber ? null : month,registrationPeriodNumber,notes:physical});
  expect(response.status).toBe(201);
  return response.body.billing.payments.find((p:any)=>p.folio===folio).id as number;
}
const remove = (source:string,id:number) => request(app).delete(`/api/payments/folios/${source}/${id}`).set("Authorization",auth);
const portal = (f:ReturnType<typeof fixture>) => request(app).get("/api/portal").set("Authorization",f.studentAuth);
function binary(response:any,callback:any) {
  const chunks:Buffer[]=[]; response.on("data",(b:Buffer)=>chunks.push(b)); response.on("end",()=>callback(null,Buffer.concat(chunks)));
}

describe("Deleting receipt records",()=>{
  it("removes only the selected duplicate and recalculates account, portal, balance, overview, grid and exports",async()=>{
    const f=fixture();
    const keep=await pay(f,"72101"), duplicate=await pay(f,"72101");
    const balanceBefore=(await adminGet(`/improvements/balance?month=${month}`)).body;
    const overviewBefore=(await adminGet(`/payments/overview?month=${month}`)).body;
    await remove("payment",duplicate).expect(204);
    const account=(await adminGet(`/payments/student/${f.student}`)).body;
    expect(account.billing.payments.map((p:any)=>p.id)).toEqual([keep]);
    expect(account.billing.summary).toMatchObject({paidAmount:1000,tuitionPaidAmount:1000,balance:0,paidInstallments:1});
    const balance=(await adminGet(`/improvements/balance?month=${month}`)).body;
    expect(balance.income).toBe(balanceBefore.income-1000); expect(balance.balance).toBe(balanceBefore.balance-1000);
    const overview=(await adminGet(`/payments/overview?month=${month}`)).body;
    expect(overview.summary.amount).toBe(overviewBefore.summary.amount-1000); expect(overview.summary.count).toBe(overviewBefore.summary.count-1);
    const grid=await adminGet(`/payments/tuition-grid?groupId=${f.group}&startMonth=${month}&months=1`);
    expect(grid.body.records[0].months[0].paid).toBe(true);
    expect(get<{payment_id:number}>("SELECT payment_id FROM student_tuition_charges WHERE student_id=? AND billing_month=?",f.student,month)!.payment_id).toBe(keep);
    const listed=(await adminGet("/payments/folios")).body.folios.filter((p:any)=>p.student_id===f.student);
    expect(listed.map((p:any)=>p.id)).toEqual([keep]);
    const student=await portal(f); expect(student.status).toBe(200); expect(student.body.billing.summary.paidAmount).toBe(1000);
    const statement=await adminGet(`/payments/student/${f.student}/statement?format=xlsx&throughMonth=${month}`).buffer(true).parse(binary).expect(200);
    const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(statement.body);
    const issued=get<{snapshot_json:string}>("SELECT snapshot_json FROM issued_documents WHERE student_id=? AND document_type='account_statement' ORDER BY rowid DESC LIMIT 1",f.student)!;
    const snapshot=JSON.parse(issued.snapshot_json);
    expect(snapshot.content.totalPaid).toBe(1000); expect(snapshot.content.payments).toHaveLength(1);
    await remove("payment",keep).expect(204);
    const final=(await adminGet(`/payments/student/${f.student}`)).body;
    expect(final.billing.summary).toMatchObject({paidAmount:0,balance:1000,paidInstallments:0});
    expect((await adminGet(`/payments/tuition-grid?groupId=${f.group}&startMonth=${month}&months=1`)).body.records[0].months[0].paid).toBe(false);
    expect(get("SELECT payment_id,notes FROM student_tuition_charges WHERE student_id=? AND billing_month=?",f.student,month)).toMatchObject({payment_id:null,notes:null});
    expect((await portal(f)).body.billing.payments).toHaveLength(0);
    expect(get("SELECT id FROM student_payments WHERE id=?",duplicate)).toBeUndefined();
    expect(get("SELECT id FROM activity_logs WHERE action='delete' AND entity_type='student_payments' AND entity_id=?",String(duplicate))).toBeTruthy();
  });

  it.each(["folios","cobros"])("does not resurrect manual registration after deleting its payment from %s",async section=>{
    const f=fixture();
    const registration=await request(app).post(`/api/students/${f.student}/registration-status`).set("Authorization",auth).send({status:"paid",periodNumber:3,physicalFolio:"72102",amount:750,paidAt:today}).expect(200);
    expect(registration.body.registration_paid).toBe(1);
    const manual=get<{id:number;payment_id:number}>("SELECT id,payment_id FROM student_registration_status WHERE enrollment_id=?",f.enrollment)!;
    const before=(await adminGet(`/improvements/balance?month=${month}`)).body;
    if(section==="folios") await remove("payment",manual.payment_id).expect(204);
    else await request(app).delete(`/api/payments/${manual.payment_id}`).set("Authorization",auth).expect(204);
    expect(get("SELECT id FROM student_registration_status WHERE id=?",manual.id)).toBeUndefined();
    expect((await adminGet("/payments/folios")).body.folios.filter((p:any)=>p.student_id===f.student)).toEqual([]);
    expect((await adminGet(`/payments/student/${f.student}`)).body.registration.paid).toBe(0);
    expect((await portal(f)).body.registration.paid).toBe(0);
    expect((await adminGet(`/students/record/${f.student}`)).body.registration_paid).toBe(0);
    const after=(await adminGet(`/improvements/balance?month=${month}`)).body;
    expect(after.income).toBe(before.income-750); expect(after.balance).toBe(before.balance-750);
  });

  it("keeps another valid registration payment when removing a duplicate linked receipt",async()=>{
    const f=fixture();
    await request(app).post(`/api/students/${f.student}/registration-status`).set("Authorization",auth).send({status:"paid",periodNumber:3,physicalFolio:"72103",amount:600,paidAt:today}).expect(200);
    const manual=get<{payment_id:number}>("SELECT payment_id FROM student_registration_status WHERE enrollment_id=?",f.enrollment)!;
    const keep=Number(run(`INSERT INTO student_payments(student_id,enrollment_id,plan_id,folio,amount,paid_at,concept,concept_type,registration_period_number,notes)
      SELECT student_id,enrollment_id,plan_id,folio||'-DUPLICATE',amount,paid_at,concept,concept_type,registration_period_number,notes
      FROM student_payments WHERE id=?`,manual.payment_id).lastInsertRowid);
    await remove("payment",manual.payment_id).expect(204);
    const account=(await adminGet(`/payments/student/${f.student}`)).body;
    expect(account.registration.paid).toBe(1); expect(account.billing.payments.map((p:any)=>p.id)).toEqual([keep]);
    expect((await portal(f)).body.registration.paid).toBe(1);
  });

  it("deletes legacy unlinked registration records without mistaking their IDs for payment IDs",async()=>{
    const f=fixture();
    const id=Number(run("INSERT INTO student_registration_status(enrollment_id,period_number,status,physical_folio,amount,paid_at) VALUES(?,3,'paid','72104',450,?)",f.enrollment,today).lastInsertRowid);
    const keep=await pay(f,"72105",100,"Otros conceptos");
    const manual=(await adminGet("/payments/folios")).body.folios.find((p:any)=>p.source==="registration"&&p.id===-id);
    expect(manual).toBeTruthy();
    await remove("registration",id).expect(204);
    expect(get("SELECT id FROM student_registration_status WHERE id=?",id)).toBeUndefined();
    expect(get("SELECT id FROM student_payments WHERE id=?",keep)).toBeTruthy();
    expect((await portal(f)).body.registration.paid).toBe(0);
    await remove("registration",id).expect(404);
  });

  it("checks permissions and rejects stale or invalid records without changing financial data",async()=>{
    const f=fixture(), id=await pay(f,"72106");
    const role=Number(run("INSERT INTO roles(name) VALUES('Consulta de folios')").lastInsertRowid);
    run("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE code='payments.view'",role);
    const reader=Number(run("INSERT INTO users(full_name,email,password_hash,role_id) VALUES('Consulta','folio-reader@example.invalid','unused',?)",role).lastInsertRowid);
    const readerAuth=`Bearer ${signToken(loadUser(reader)!)}`;
    await request(app).delete(`/api/payments/folios/payment/${id}`).expect(401);
    for(const authorization of [f.studentAuth,readerAuth]) {
      await request(app).delete(`/api/payments/folios/payment/${id}`).set("Authorization",authorization).expect(403);
      await request(app).delete(`/api/payments/folios/registration/${id}`).set("Authorization",authorization).expect(403);
    }
    await remove("invalid",id).expect(400); await remove("payment",99999999).expect(404);
    await remove("payment",0).expect(400);
    const linked=Number(run("INSERT INTO student_registration_status(enrollment_id,period_number,status,payment_id) VALUES(?,3,'paid',?)",f.enrollment,id).lastInsertRowid);
    await remove("registration",linked).expect(409);
    expect(get("SELECT id FROM student_payments WHERE id=?",id)).toBeTruthy();
    // An audit failure must roll back every related record, not leave half a deletion.
    db.exec("CREATE TEMP TRIGGER fail_delete_audit BEFORE INSERT ON activity_logs WHEN NEW.action='delete' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    const logged = vi.spyOn(console,"error").mockImplementation(()=>{});
    try { await remove("payment",id).expect(500); }
    finally { db.exec("DROP TRIGGER fail_delete_audit"); logged.mockRestore(); }
    expect(get("SELECT id FROM student_payments WHERE id=?",id)).toBeTruthy();
    expect(get("SELECT id FROM student_registration_status WHERE id=?",linked)).toBeTruthy();
    expect(get<{payment_id:number}>("SELECT payment_id FROM student_tuition_charges WHERE student_id=? AND billing_month=?",f.student,month)!.payment_id).toBe(id);
  });
});
