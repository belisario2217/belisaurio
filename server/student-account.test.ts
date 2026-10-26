import { afterAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"ifop-account-perf-"));
process.env.DATABASE_PATH=path.join(root,"school.db");
const {db,get,run}=await import("./db.js");
const {ensureAllStudentAccounts,provisionStudentAccount}=await import("./services/student-account.js");
afterAll(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
let sequence=0;
function fixture() {
  const n=++sequence,studentNumber=`ACCOUNT-PERF-${n}`;
  const studentId=Number(run("INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,'Rosa','Prueba',(SELECT id FROM student_statuses LIMIT 1))",studentNumber).lastInsertRowid);
  const input={studentId,studentNumber,firstName:"Rosa",lastName:"Prueba"};
  const account=provisionStudentAccount(input);
  return {input,account};
}
const changes=()=>get<{count:number}>("SELECT total_changes() AS count")!.count;

it("does not rewrite unchanged accounts when startup provisioning runs again",()=>{
  ensureAllStudentAccounts();
  const f=fixture();
  run("UPDATE users SET updated_at='2000-01-01' WHERE id=?",f.account.userId);
  run("UPDATE students SET updated_at='2000-01-01' WHERE id=?",f.input.studentId);
  const before=changes();
  const repeated=ensureAllStudentAccounts();
  expect(changes()).toBe(before);
  expect(repeated).toMatchObject({created:0,failed:0});
  expect(get("SELECT updated_at FROM users WHERE id=?",f.account.userId)).toMatchObject({updated_at:"2000-01-01"});
  expect(get("SELECT updated_at FROM students WHERE id=?",f.input.studentId)).toMatchObject({updated_at:"2000-01-01"});
});

it("still synchronizes changed names, institutional email and activation without replacing the password",()=>{
  const f=fixture(),before=get("SELECT password_hash,temporary_password_name FROM users WHERE id=?",f.account.userId)!;
  run("UPDATE students SET first_name='María',student_number='ACCOUNT-CHANGED' WHERE id=?",f.input.studentId);
  run("UPDATE users SET is_active=0 WHERE id=?",f.account.userId);
  const result=provisionStudentAccount({...f.input,firstName:"María",studentNumber:"ACCOUNT-CHANGED"});
  expect(result).toMatchObject({created:false,userId:f.account.userId});
  expect(get("SELECT full_name,email,is_active,password_hash,temporary_password_name FROM users WHERE id=?",f.account.userId))
    .toMatchObject({...before,full_name:"María Prueba",email:"account-changed@alumnoifop.edu",is_active:1});
  expect(get("SELECT email FROM students WHERE id=?",f.input.studentId)).toMatchObject({email:"account-changed@alumnoifop.edu"});
});

it("keeps deleted student accounts deleted without writing their data",()=>{
  const f=fixture();
  run("UPDATE users SET deleted_at=CURRENT_TIMESTAMP,is_active=0 WHERE id=?",f.account.userId);
  const user=get("SELECT * FROM users WHERE id=?",f.account.userId),before=changes();
  provisionStudentAccount({...f.input,firstName:"Nombre cambiado"});
  expect(changes()).toBe(before);
  expect(get("SELECT * FROM users WHERE id=?",f.account.userId)).toEqual(user);
});
