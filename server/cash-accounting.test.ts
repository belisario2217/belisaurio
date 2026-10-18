import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import request from "supertest";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"ifop-cash-"));
process.env.DATABASE_PATH=path.join(directory,"school.db");
process.env.JWT_SECRET="synthetic-cash-tests";
const {app}=await import("./app.js");
const {db,get,run}=await import("./db.js");
const {loadUser,signToken}=await import("./auth.js");
const auth=`Bearer ${signToken(loadUser(get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador' LIMIT 1")!.id)!)}`;
let sequence=0;
afterAll(()=>{vi.useRealTimers();db.close();fs.rmSync(directory,{recursive:true,force:true});});
function fixture(){
 const n=++sequence,insert=(sql:string,...args:(string|number)[])=>Number(run(sql,...args).lastInsertRowid);
 const p=insert("INSERT INTO programs(code,name,duration_periods) VALUES(?,?,1)",`CASH-${n}`,`Programa caja ${n}`);
 const plan=insert("INSERT INTO academic_plans(program_id,code,name,version,tuition_amount) VALUES(?,?,?,'2026',1000)",p,`CP-${n}`,`Plan caja ${n}`);
 const cycle=insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2026-08-01','2027-02-28')",`CC-${n}`);
 const shift=get<{id:number}>("SELECT id FROM shifts LIMIT 1")!.id;
 const group=insert("INSERT INTO groups(name,program_id,plan_id,shift_id,cycle_id,active_cycle_id) VALUES(?,?,?,?,?,?)",`CG-${n}`,p,plan,shift,cycle,cycle);
 const st=insert("INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,?,?,(SELECT id FROM student_statuses WHERE is_terminal=0 LIMIT 1))",`CASH-${n}`,"Alumna",`Caja ${n}`);
 insert("INSERT INTO enrollments(student_id,program_id,plan_id,shift_id,group_id,cycle_id,tuition_start_date,tuition_due_day) VALUES(?,?,?,?,?,?,'2026-09-01',1)",st,p,plan,shift,group,cycle);
 return {student:st,group};
}
const read=(url:string)=>request(app).get(`/api${url}`).set("Authorization",auth);
async function receipt(f:ReturnType<typeof fixture>,physical:string,paidAt="2026-09-03",amount=6000,start="2026-09",end="2027-02"){
 const folio=`CASH-RECEIPT-${f.student}-${physical}`;
 const result=await request(app).post("/api/payments").set("Authorization",auth).send({studentId:f.student,folio,notes:physical,paidAt,amount,concept:"Colegiatura",conceptType:"tuition",coveredMonth:start,coveredThroughMonth:end});
 expect(result.status,result.body.message).toBe(201);
 return {result,id:result.body.billing.payments.find((row:any)=>row.folio===folio).id as number};
}
function binary(res:any,callback:any){const chunks:Buffer[]=[];res.on("data",(b:Buffer)=>chunks.push(b));res.on("end",()=>callback(null,Buffer.concat(chunks)));}
async function pdfText(buffer:Buffer){
 const worker=new Worker(new URL("./services/pdf-reader-worker.mjs",import.meta.url),{workerData:buffer,execArgv:[]});
 try {const output:any=await new Promise((resolve,reject)=>{worker.once("message",resolve);worker.once("error",reject);});expect(output.error).toBeUndefined();return output.pages.map((p:any)=>p.matrix.flat().join(" ")).join(" ");}
 finally {await worker.terminate();}
}
describe("Cash receipts independent of tuition coverage",()=>{
 it("counts a prepaid six-month receipt only in September and preserves all six covered months",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-18T18:00:00Z"));
  const f=fixture(),before=(await read("/improvements/balance?month=2026-09")).body;
  const {id,result}=await receipt(f,"0460");
  expect(result.body.billing.summary).toMatchObject({paidAmount:6000,paidInstallments:6,balance:0});
  expect(result.body.billing.payments).toHaveLength(1);
  expect(result.body.billing.schedule.filter((s:any)=>s.status==="paid").map((s:any)=>s.paidAmount)).toEqual([1000,1000,1000,1000,1000,1000]);
  expect((await read("/payments/overview?month=2026-09")).body.summary).toMatchObject({count:1,amount:6000});
  expect((await read("/payments/overview?month=2026-10")).body.summary).toMatchObject({count:0,amount:0});
  expect((await read("/improvements/balance?month=2026-09")).body.income).toBe(before.income+6000);
  expect((await read("/improvements/balance?month=2026-10")).body.income).toBe(0);
  const row=(await read("/payments/folios")).body.folios.find((row:any)=>row.id===id);
  expect(row.paid_at).toBe("2026-09-03");expect(row.covered_months.split(", ")).toHaveLength(6);
  const grid=(await read(`/payments/tuition-grid?groupId=${f.group}&startMonth=2026-09&months=6`)).body;
  await request(app).patch("/api/payments/tuition-grid").set("Authorization",auth).send({startMonth:grid.startMonth,months:grid.months,rows:grid.records}).expect(200);
  expect(get<{paid_at:string;amount:number}>("SELECT paid_at,amount FROM student_payments WHERE id=?",id)).toMatchObject({paid_at:"2026-09-03",amount:6000});
  expect((await read("/payments/overview?month=2026-10")).body.summary.amount).toBe(0);
  grid.records[0].months[1].paid=false;
  await request(app).patch("/api/payments/tuition-grid").set("Authorization",auth).send({startMonth:grid.startMonth,months:grid.months,rows:grid.records}).expect(409);
  expect(get("SELECT id FROM student_payments WHERE id=?",id)).toBeTruthy();
  vi.useRealTimers();
 });
 it("records manual coverage without creating, deleting or dating cash receipts",async()=>{
  const f=fixture(),before=(await read("/improvements/balance?month=2026-10")).body.income;
  await request(app).patch("/api/payments/tuition-grid").set("Authorization",auth).send({startMonth:"2026-10",months:["2026-10"],rows:[{studentId:f.student,months:[{month:"2026-10",paid:true,amount:1000,notes:"0461"}]}]}).expect(200);
  const account=(await read(`/payments/student/${f.student}`)).body;
  expect(account.billing.summary.paidAmount).toBe(0);expect(account.billing.summary.paidInstallments).toBe(1);expect(account.billing.payments).toHaveLength(0);
  expect((await read("/improvements/balance?month=2026-10")).body.income).toBe(before);
 });
 it("keeps the receipt date on coverage edits and moves income only when the actual cash date is corrected",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-18T18:00:00Z"));
  const f=fixture(),{id}=await receipt(f,"0462","2026-08-15",2000,"2026-09","2026-10");
  const change=(paidAt:string)=>request(app).patch(`/api/payments/${id}`).set("Authorization",auth).send({folio:`EDIT-${id}`,notes:"0462",paidAt,amount:2000,concept:"Colegiatura",coveredMonth:"2026-10",coveredThroughMonth:"2026-11"});
  await change("2026-08-15").expect(200);
  expect((await read(`/payments/student/${f.student}`)).body.billing.summary.balance).toBe(1000);
  expect((await read("/payments/overview?month=2026-10")).body.summary.amount).toBe(0);
  await change("2026-10-04").expect(200);
  expect((await read("/payments/overview?month=2026-10")).body.summary.amount).toBe(2000);
  const updated=(await read(`/payments/student/${f.student}`)).body;
  expect(updated.billing.payments[0].covered_through_month).toBe("2026-11");
  vi.useRealTimers();
 });
 it("exports a readable ordered PDF starting at 0460, inclusive, with one entry per real receipt",async()=>{
  const f=fixture();await receipt(f,"0459","2026-09-04",1000,"2026-09","2026-09");await receipt(f,"10000","2026-09-05",1000,"2026-10","2026-10");
  const list=await read("/payments/folios?from=460");expect(list.status).toBe(200);
  expect(list.body.folios.map((row:any)=>row.physical_folio)).toEqual(["0460","0462","10000"]);
  const pdf=await read("/payments/folios/export?format=pdf&from=460").buffer(true).parse(binary).expect(200);
  expect(pdf.headers["content-type"]).toContain("application/pdf");
  const text=await pdfText(pdf.body);expect(text).toContain("Relación de folios desde 0460");expect(text).not.toContain("0459");expect(text).toContain("10000");expect(text).toContain("2026-09-03");
  expect(text.indexOf("0462")).toBeLessThan(text.indexOf("10000"));
  await read("/payments/folios?from=0").expect(400);await request(app).get("/api/payments/folios/export?format=pdf&from=460").expect(401);
 });
 it("keeps reimported receipts as one cash entry and preserves their existing multi-month coverage",async()=>{
  const f=fixture(),{id}=await receipt(f,"0463");
  const number=get<{student_number:string}>("SELECT student_number FROM students WHERE id=?",f.student)!.student_number;
  const csv=Buffer.from(`Matrícula,Numero de folio fisico,Fecha de pago,Monto,Concepto,Mes\n${number},0463,2026-09-03,6000,Colegiatura,2026-09\n`);
  const preview=await request(app).post("/api/payments/import/preview").set("Authorization",auth).attach("file",csv,"recibos.csv");
  expect(preview.status,preview.body.message).toBe(200);
  await request(app).post("/api/payments/import/apply").set("Authorization",auth).send({previewId:preview.body.previewId,existingMode:"update"}).expect(200);
  const account=(await read(`/payments/student/${f.student}`)).body;
  expect(account.billing.payments).toHaveLength(1);expect(account.billing.payments[0].id).toBe(id);
  expect(account.billing.payments[0].paid_at).toBe("2026-09-03");expect(account.billing.payments[0].covered_through_month).toBe("2027-02");
  expect(account.billing.summary).toMatchObject({paidAmount:6000,paidInstallments:6});
 });
 it("excludes preserved legacy coverage from live cash totals, account movements and folios",async()=>{
  const f=fixture(),before=(await read("/improvements/balance?month=2026-10")).body.income;
  const id=Number(run(`INSERT INTO student_payments(student_id,folio,amount,paid_at,concept,concept_type,payment_method,covered_month,notes,payment_kind)
   VALUES(?,'LEGACY-COVERAGE-TEST',1000,'2026-10-10','Colegiatura octubre','tuition','Administrativo','2026-10','0464','coverage')`,f.student).lastInsertRowid);
  run("INSERT INTO student_tuition_charges(student_id,billing_month,amount,status,payment_id) VALUES(?,'2026-10',1000,'paid',?)",f.student,id);
  expect((await read("/improvements/balance?month=2026-10")).body.income).toBe(before);
  expect((await read("/payments/folios")).body.folios.some((row:any)=>row.id===id)).toBe(false);
  const account=(await read(`/payments/student/${f.student}`)).body;
  expect(account.billing.summary).toMatchObject({paidAmount:0,paidInstallments:1});expect(account.billing.payments).toHaveLength(0);
  expect(get("SELECT id FROM student_payments WHERE id=?",id)).toBeTruthy();
 });
 it("distributes cents without duplicating the receipt amount across covered months",async()=>{
  const f=fixture(),{result}=await receipt(f,"0465","2026-09-01",1000.01,"2026-09","2026-11");
  const amounts=result.body.billing.schedule.filter((row:any)=>row.status==="paid").map((row:any)=>row.paidAmount);
  expect(amounts).toHaveLength(3);expect(Math.round(amounts.reduce((sum:number,n:number)=>sum+n,0)*100)).toBe(100001);
  expect(result.body.billing.payments).toHaveLength(1);expect(result.body.billing.summary.paidAmount).toBe(1000.01);
 });
 it("retains a remaining prepaid receipt across every month when its duplicate is removed",async()=>{
  const f=fixture(),first=await receipt(f,"0466"),second=await receipt(f,"0467");
  await request(app).delete(`/api/payments/folios/payment/${second.id}`).set("Authorization",auth).expect(204);
  const account=(await read(`/payments/student/${f.student}`)).body;
  expect(account.billing.summary).toMatchObject({paidAmount:6000,paidInstallments:6});
  expect(account.billing.tuitionCharges.every((c:any)=>c.payment_id===first.id&&c.amount===1000)).toBe(true);
  await request(app).delete(`/api/payments/folios/payment/${first.id}`).set("Authorization",auth).expect(204);
  expect((await read(`/payments/student/${f.student}`)).body.billing.summary).toMatchObject({paidAmount:0,paidInstallments:0});
 });
 it("reclassifies only the exact legacy grid signature without deleting records or changing cash dates",()=>{
  const legacy=new DatabaseSync(":memory:");
  try {
   legacy.exec(`CREATE TABLE students(id INTEGER PRIMARY KEY,student_number TEXT); INSERT INTO students VALUES(1,'X1');
    CREATE TABLE student_tuition_charges(payment_id INTEGER);
    CREATE TABLE student_payments(id INTEGER PRIMARY KEY,student_id INTEGER,folio TEXT,paid_at TEXT,amount REAL,concept_type TEXT,payment_method TEXT,covered_month TEXT);
    INSERT INTO student_payments VALUES(1,1,'COL-X1-202610','2026-10-10',1000,'tuition','Administrativo','2026-10');
    INSERT INTO student_payments VALUES(2,1,'REAL-RECEIPT','2026-09-03',6000,'tuition','Efectivo','2026-10');
    INSERT INTO student_payments VALUES(3,1,'COL-X1-202611','2026-09-03',1000,'tuition','Administrativo','2026-11');`);
   legacy.exec(fs.readFileSync("server/migrations/037_cash_receipts_and_coverage.sql","utf8"));
   expect(legacy.prepare("SELECT payment_kind FROM student_payments ORDER BY id").all().map((r:any)=>r.payment_kind)).toEqual(["coverage","receipt","receipt"]);
   expect(legacy.prepare("SELECT paid_at,amount FROM student_payments WHERE id=1").get()).toMatchObject({paid_at:"2026-10-10",amount:1000});
   expect(legacy.prepare("SELECT reason FROM payment_coverage_reclassifications").all()).toHaveLength(1);
  }finally{legacy.close();}
 });
});
