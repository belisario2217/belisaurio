import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import C, { type PayrollState, type PayrollPayment } from "../shared/teacher-payroll-core.mjs";
import IFOPCatalog from "../shared/ifop-teacher-catalog.mjs";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"ifop-calendar-payroll-"));
process.env.DATABASE_PATH=path.join(root,"school.db");
process.env.JWT_SECRET="synthetic-calendar-payroll-test";
const {app}=await import("./app.js");
const {db,all,get,run}=await import("./db.js");
const {loadUser,signToken}=await import("./auth.js");
const {ensureTeacherPayrollState}=await import("./services/teacher-payroll.js");
const admin=get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!.id;
const auth=()=>`Bearer ${signToken(loadUser(admin)!)}`;
const api=(method:"get"|"post"|"put"|"patch"|"delete",url:string)=>request(app)[method]("/api"+url).set("Authorization",auth());
type Snapshot={state:PayrollState;version:number;links:Array<{teacherKey:string;teacherId:number;profileId:number}>;legacyPayments:Array<{id:number;teacherKey:string}>};
let snapshot:Snapshot;

beforeEach(async()=>{
  const previous=await api("get","/teacher-payroll");expect(previous.status).toBe(200);
  const reset=await api("put","/teacher-payroll").send({state:IFOPCatalog.createState(C),expectedVersion:previous.body.version,reason:"Preparar prueba aislada"});
  expect(reset.status).toBe(200);snapshot=reset.body;
});
afterAll(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
const clone=()=>structuredClone(snapshot.state);
function activate(state:PayrollState){for(const t of state.teachers){t.start="2026-10-01";t.end="2027-06-30";for(const r of t.revisions)r.from=t.start;}return state;}
function attendance(state:PayrollState,minutes=120){state.attendance.push({teacherId:"ifop-alondra",date:"2026-10-05",status:minutes===0?"absent":minutes<180?"partial":"present",minutes,note:"Registro de prueba"});return state;}
function payment(state:PayrollState,cents:number,id="calendar-pay-1"){const p:PayrollPayment={id,teacherId:"ifop-alondra",date:"2026-10-06",from:"2026-10-01",to:"2026-10-31",amountCents:cents,allocations:C.engine(state).allocate("ifop-alondra","2026-10-01","2026-10-31",cents),method:"Transferencia",note:"Abono de prueba"};state.payments.push(p);return state;}
async function put(state:PayrollState){const response=await api("put","/teacher-payroll").send({state,expectedVersion:snapshot.version,reason:"Prueba de integración"});if(response.status===200)snapshot=response.body;return response;}

describe("Native teacher calendar payroll",()=>{
  it("initializes four schedules and links without duplicate academic identities or profiles",async()=>{
    expect(snapshot.state.teachers).toHaveLength(4);
    expect(snapshot.state.teachers.map(t=>t.revisions[0].schedule.reduce((s,n)=>s+n,0)/60)).toEqual([13,18,21,13]);
    expect(snapshot.state.teachers.reduce((s,t)=>s+(t.revisions[0].blocks?.length||0),0)).toBe(37);
    expect(snapshot.state.teachers.map(t=>t.revisions[0].rateCents)).toEqual([15000,13000,15000,13000]);
    expect(snapshot.state.teachers.every(t=>t.start==="")).toBe(true);
    const counts=()=>[get<{n:number}>("SELECT COUNT(*) AS n FROM teachers")!.n,get<{n:number}>("SELECT COUNT(*) AS n FROM payroll_profiles")!.n];
    const before=counts();const version=snapshot.version;
    ensureTeacherPayrollState();ensureTeacherPayrollState();
    await api("get","/teacher-payroll").expect(200);await api("get","/teacher-payroll").expect(200);
    expect(counts()).toEqual(before);
    expect((await api("get","/teacher-payroll")).body.version).toBe(version);
    expect(all("PRAGMA foreign_key_check")).toHaveLength(0);
  });

  it("preserves shared academic names, accounts and existing manual rates on initialization",()=>{
    const link=snapshot.links.find(l=>l.teacherKey==="ifop-alondra")!;
    const academic=get<any>("SELECT * FROM teachers WHERE id=?",link.teacherId)!;
    const profile=get<any>("SELECT * FROM payroll_profiles WHERE id=?",link.profileId)!;
    run("UPDATE payroll_profiles SET rate=91.25,weekly_hours=7 WHERE id=?",link.profileId);
    ensureTeacherPayrollState();
    expect(get("SELECT full_name,email,employee_number FROM teachers WHERE id=?",link.teacherId)).toEqual({full_name:academic.full_name,email:academic.email,employee_number:academic.employee_number});
    expect(get("SELECT rate,weekly_hours FROM payroll_profiles WHERE id=?",link.profileId)).toEqual({rate:91.25,weekly_hours:7});
    run("UPDATE payroll_profiles SET rate=?,weekly_hours=? WHERE id=?",profile.rate,profile.weekly_hours,link.profileId);
  });

  it("requires authentication and a distinct management permission for writes",async()=>{
    await request(app).get("/api/teacher-payroll").expect(401);
    const role=run("INSERT INTO roles(name,description) VALUES('Consulta nómina de prueba','Solo lectura')");
    const roleId=Number(role.lastInsertRowid),permission=get<{id:number}>("SELECT id FROM permissions WHERE code='payments.view'")!.id;
    run("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",roleId,permission);
    const user=run("INSERT INTO users(full_name,email,password_hash,role_id) VALUES('Consulta de prueba','payroll-readonly@example.test','unused',?)",roleId);
    const token=`Bearer ${signToken(loadUser(Number(user.lastInsertRowid))!)}`;
    await request(app).get("/api/teacher-payroll").set("Authorization",token).expect(200);
    await request(app).put("/api/teacher-payroll").set("Authorization",token).send({state:clone(),expectedVersion:snapshot.version}).expect(403);
    await request(app).post("/api/teacher-payroll/initialize").set("Authorization",token).expect(403);
  });

  it("rejects stale versions without losing either document or cash ledger changes",async()=>{
    const staleVersion=snapshot.version,staleState=clone();
    const state=clone();state.settings.organization="Cambio que debe conservarse";
    await put(state).then(r=>expect(r.status).toBe(200));
    staleState.settings.organization="Cambio obsoleto";
    const response=await api("put","/teacher-payroll").send({state:staleState,expectedVersion:staleVersion});expect(response.status).toBe(409);
    const current=await api("get","/teacher-payroll");expect(current.body.state.settings.organization).toBe("Cambio que debe conservarse");
    expect(current.body.version).toBe(snapshot.version);
    expect(get<{n:number}>("SELECT COUNT(*) AS n FROM teacher_payroll_expenses")!.n).toBe(0);
  });

  it("persists actual partial attendance and shows its discount once",async()=>{
    const state=attendance(activate(clone()),120);
    expect((await put(state)).status).toBe(200);
    const day=C.engine(snapshot.state).day("ifop-alondra","2026-10-05");
    expect(day).toMatchObject({nominal:180,worked:120,missing:60,base:45000,discount:15000,earned:30000,balance:30000});
    expect(day.base-day.discount).toBe(day.earned);
    expect(snapshot.state.teachers[0].revisions[0].blocks).toHaveLength(7);
  });

  it("does not pay unconfirmed work or work with an unknown tariff",async()=>{
    const state=attendance(activate(clone()));state.teachers[0].revisions[0].rateCents=null;
    expect((await put(state)).status).toBe(200);
    expect(C.engine(snapshot.state).day("ifop-alondra","2026-10-05").unpriced).toBe(120);
    const invalid=clone();invalid.payments.push({id:"unpriced-payment",teacherId:"ifop-alondra",date:"2026-10-06",from:"2026-10-05",to:"2026-10-05",amountCents:10000,allocations:[{date:"2026-10-05",cents:10000}],method:"Prueba",note:""});
    expect((await put(invalid)).status).toBe(400);
    expect(get<{n:number}>("SELECT COUNT(*) AS n FROM teacher_payroll_expenses")!.n).toBe(0);
  });

  it("supports multiple partial payments for one period with exactly one expense per payment",async()=>{
    const state=attendance(activate(clone()));payment(state,10000);payment(state,5000,"calendar-pay-2");
    const before=(await api("get","/improvements/balance?month=2026-10")).body.expense;
    expect((await put(state)).status).toBe(200);
    const ledger=all<any>("SELECT * FROM teacher_payroll_expenses");expect(ledger).toHaveLength(2);
    expect(new Set(ledger.map(r=>r.expense_id)).size).toBe(2);
    const after=(await api("get","/improvements/balance?month=2026-10")).body;
    expect(after.expense-before).toBe(150);
    expect(after.expenses.filter((r:any)=>r.teacher_payroll_payment_key)).toHaveLength(2);
    expect(C.engine(snapshot.state).day("ifop-alondra","2026-10-05")).toMatchObject({earned:30000,paid:15000,balance:15000});
    expect((await put(clone())).status).toBe(200);
    expect(all("SELECT * FROM teacher_payroll_expenses")).toHaveLength(2);
    expect((await api("get","/improvements/balance?month=2026-10")).body.expense).toBe(after.expense);
  });

  it("keeps recorded payments and expenses after a correction produces an excess payment",async()=>{
    const state=attendance(activate(clone()));payment(state,30000);
    expect((await put(state)).status).toBe(200);
    const ledger=get<any>("SELECT * FROM teacher_payroll_expenses")!;
    const corrected=clone();corrected.attendance[0].minutes=60;
    expect((await put(corrected)).status).toBe(200);
    expect(C.engine(snapshot.state).day("ifop-alondra","2026-10-05").balance).toBe(-15000);
    expect(get<any>("SELECT * FROM teacher_payroll_expenses")!.expense_id).toBe(ledger.expense_id);
    expect(get<any>("SELECT amount FROM operating_expenses WHERE id=?",ledger.expense_id)!.amount).toBe(300);
  });

  it("edits or deletes its cash expense atomically and protects against direct expense edits",async()=>{
    const state=attendance(activate(clone()));payment(state,10000);expect((await put(state)).status).toBe(200);
    const expenseId=get<{expense_id:number}>("SELECT expense_id FROM teacher_payroll_expenses")!.expense_id;
    await api("patch",`/improvements/expenses/${expenseId}`).send({concept:"Alteración",category:"operating",amount:1,paidAt:"2026-10-06"}).expect(409);
    await api("delete",`/improvements/expenses/${expenseId}`).expect(409);
    const changed=clone();changed.payments[0].amountCents=12500;changed.payments[0].allocations[0].cents=12500;
    expect((await put(changed)).status).toBe(200);
    expect(get("SELECT amount FROM operating_expenses WHERE id=?",expenseId)).toEqual({amount:125});
    const removed=clone();removed.payments=[];expect((await put(removed)).status).toBe(200);
    expect(get("SELECT id FROM operating_expenses WHERE id=?",expenseId)).toBeUndefined();
    expect(all("SELECT * FROM teacher_payroll_expenses")).toHaveLength(0);
  });

  it("rolls back prior deletions and catalog writes when a replacement payment is invalid",async()=>{
    const state=attendance(activate(clone()));payment(state,10000);expect((await put(state)).status).toBe(200);
    const version=snapshot.version,expense=get<any>("SELECT * FROM teacher_payroll_expenses")!;
    const bad=clone();bad.payments=[{...bad.payments[0],id:"too-large-payment",amountCents:40000,allocations:[{date:"2026-10-05",cents:40000}]}];
    bad.teachers.push({...structuredClone(bad.teachers[0]),id:"must-not-be-created",name:"No debe crearse",sourceKey:"test-rollback"});
    expect((await put(bad)).status).toBe(400);
    const current=(await api("get","/teacher-payroll")).body;expect(current.version).toBe(version);expect(current.state.payments[0].id).toBe("calendar-pay-1");
    expect(get<any>("SELECT * FROM teacher_payroll_expenses")!.expense_id).toBe(expense.expense_id);
    expect(get("SELECT id FROM teachers WHERE full_name='No debe crearse'")).toBeUndefined();
    expect(get("SELECT amount FROM operating_expenses WHERE id=?",expense.expense_id)).toEqual({amount:100});
  });

  it("rejects malformed allocation references and incompatible currencies without any mutation",async()=>{
    const oldVersion=snapshot.version;
    const bad=clone();bad.payments.push({id:"missing-teacher",teacherId:"missing",date:"2026-10-05",from:"2026-10-05",to:"2026-10-05",amountCents:1,allocations:[{date:"2026-10-05",cents:1}],method:"",note:""});
    expect((await put(bad)).status).toBe(400);
    const currency=clone();currency.settings.currency="USD";expect((await put(currency)).status).toBe(400);
    expect((await api("get","/teacher-payroll")).body.version).toBe(oldVersion);
  });

  it("blocks calendar work already paid in the historical manual module",async()=>{
    const link=snapshot.links.find(l=>l.teacherKey==="ifop-alondra")!;
    const manual=await api("post","/payroll/payments").send({profileId:link.profileId,periodStart:"2026-10-01",periodEnd:"2026-10-31",paidAt:"2026-10-31",weeklyHours:1,weeks:1});expect(manual.status).toBe(201);
    const state=attendance(activate(clone()));payment(state,10000);
    expect((await put(state)).status).toBe(409);
    const current=(await api("get","/teacher-payroll")).body;expect(current.legacyPayments).toEqual(expect.arrayContaining([expect.objectContaining({id:manual.body.id,teacherKey:"ifop-alondra"})]));
    await api("delete",`/payroll/payments/${manual.body.id}`).expect(204);
    expect((await put(state)).status).toBe(200);
  });

  it("blocks manual POST and PATCH from paying dates already covered by calendar allocations",async()=>{
    const link=snapshot.links.find(l=>l.teacherKey==="ifop-alondra")!;
    const form={profileId:link.profileId,periodStart:"2026-09-01",periodEnd:"2026-09-30",paidAt:"2026-09-30",weeklyHours:1,weeks:1};
    const manual=await api("post","/payroll/payments").send(form);expect(manual.status).toBe(201);
    const state=attendance(activate(clone()));payment(state,10000);expect((await put(state)).status).toBe(200);
    const overlap={...form,periodStart:"2026-10-01",periodEnd:"2026-10-31",paidAt:"2026-10-31"};
    await api("post","/payroll/payments").send(overlap).expect(409);
    await api("patch",`/payroll/payments/${manual.body.id}`).send(overlap).expect(409);
    expect(get("SELECT period_start FROM payroll_payments WHERE id=?",manual.body.id)).toEqual({period_start:"2026-09-01"});
    await api("delete",`/payroll/payments/${manual.body.id}`).expect(204);
  });

  it("retains an auditable version and does not recreate a removed catalog teacher",async()=>{
    const teacherId=snapshot.state.teachers[3].id;
    const state=clone();state.teachers=state.teachers.filter(t=>t.id!==teacherId);
    expect((await put(state)).status).toBe(200);const version=snapshot.version;
    ensureTeacherPayrollState();const current=(await api("get","/teacher-payroll")).body;
    expect(current.state.teachers).toHaveLength(3);expect(current.version).toBe(version);
    expect(get("SELECT id FROM activity_logs WHERE entity_type='teacher_payroll' AND action='update' ORDER BY id DESC LIMIT 1")).toBeTruthy();
    expect(all("PRAGMA foreign_key_check")).toHaveLength(0);
  });
});
