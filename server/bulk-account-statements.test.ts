import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { opendir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import request from "supertest";

const temporaryRoot = os.tmpdir();
const directory = fs.mkdtempSync(path.join(temporaryRoot, "ifop-bulk-statements-test-"));
process.env.DATABASE_PATH = path.join(directory, "school.db");
process.env.JWT_SECRET = "synthetic-bulk-statements-test";
const { app } = await import("./app.js");
const { all, db, get, run } = await import("./db.js");
const { loadUser, signToken } = await import("./auth.js");
const { statementBatchRoster } = await import("./services/account-statement-batch.js");
const insert = (sql: string, ...args: (string | number | null)[]) => Number(run(sql, ...args).lastInsertRowid);
const admin = get<{ id: number }>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!.id;
const auth = `Bearer ${signToken(loadUser(admin)!)}`;
run("UPDATE institution_settings SET public_app_url='https://escuela.example.test' WHERE id=1");
let sequence = 0;
function fixture(count = 2) {
  const n = ++sequence;
  const program = insert("INSERT INTO programs(code,name,duration_periods) VALUES(?,'Licenciatura en Enfermería IFOP',6)", `BULK-${n}`);
  const plan = insert("INSERT INTO academic_plans(program_id,code,name,version,tuition_amount) VALUES(?,?,?,'2026',1200)", program, `BULK-PLAN-${n}`, `Plan ${n}`);
  const cycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,'2026-08-10','2027-01-23')", `Ciclo ${n}`);
  const shift = get<{ id: number }>("SELECT id FROM shifts LIMIT 1")!.id;
  const cp = get<{ id: number }>("SELECT id FROM curricular_periods WHERE sequence=3")!.id;
  const group = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", `BULK-G${n}`, program, shift, cycle, cycle, plan, cp);
  const students = Array.from({ length: count }, (_, i) => {
    const number = `BULK-${n}-${String(i).padStart(2, '0')}`;
    const id = insert("INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,'Alumno',?,(SELECT id FROM student_statuses LIMIT 1))", number, `Apellido ${String(i).padStart(2, '0')}`);
    const enrollment = insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)", id, program, shift, group, cycle, plan, cp);
    return { id, enrollment, number };
  });
  const pay = (index: number, amount: number, date: string, physical: string) => insert(
    "INSERT INTO student_payments(student_id,enrollment_id,plan_id,folio,amount,paid_at,concept,concept_type,notes) VALUES(?,?,?,?,?,?,'Abono de prueba','other',?)",
    students[index].id, students[index].enrollment, plan, `BULK-PAY-${n}-${physical}`, amount, date, physical);
  return { group, students, pay, cycle, program, shift, plan, cp };
}
function binary(res: any, callback: any) { const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk)); res.on("end", () => callback(null, Buffer.concat(chunks))); }
const download = (query: string) => request(app).get(`/api/payments/statements.pdf?throughMonth=2026-10${query}`).set("Authorization", auth).buffer(true).parse(binary);
async function pdfPages(buffer: Buffer) {
  const worker = new Worker(new URL("./services/pdf-reader-worker.mjs", import.meta.url), { workerData: buffer, execArgv: [] });
  try {
    const result: any = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    expect(result.error).toBeUndefined();
    return result.pages.map((page: any) => page.matrix.flat().join(" ").replace(/\s+/g, " ")) as string[];
  } finally { await worker.terminate(); }
}
async function statementTemporaryFolders() {
  const folders: string[] = [];
  const entries = await opendir(temporaryRoot);
  for await (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("ifop-statements-")) folders.push(entry.name);
  }
  return folders;
}
afterAll(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("Bulk account statements", () => {
  it("lists all eligible students without the search limit, only once under their latest active enrollment", async () => {
    const f = fixture(26), other = fixture();
    run("UPDATE students SET is_active=0 WHERE id=?", f.students[0].id);
    run("UPDATE enrollments SET is_active=0 WHERE id=?", f.students[1].enrollment);
    insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id,plan_id,curricular_period_id) VALUES(?,?,?,?,?,?,?)",
      f.students[2].id, other.program, other.shift, other.group, other.cycle, other.plan, other.cp);
    const selected = statementBatchRoster(f.group);
    expect(selected).toHaveLength(23);
    expect(new Set(selected.map(st => st.id)).size).toBe(23);
    expect(selected.some(st => st.id === f.students[2].id)).toBe(false);
    expect(statementBatchRoster(other.group).filter(st => st.id === f.students[2].id)).toHaveLength(1);
    const options = await request(app).get("/api/payments/statement-options").set("Authorization", auth).expect(200);
    expect(options.body.studentCount).toBe(statementBatchRoster().length);
    expect(options.body.groups.find((g: any) => g.id === f.group).studentCount).toBe(23);
  });
  it("prints every student's complete statement separately, paginates payments and preserves amounts, physical folios and QR data", async () => {
    const f = fixture();
    for (let i = 1; i <= 13; i++) f.pay(0, 100, "2026-10-10", String(i).padStart(4, '0'));
    f.pay(0, 900, "2026-11-01", "9999");
    const paymentsBefore = all("SELECT * FROM student_payments ORDER BY id");
    const response = await download(`&groupId=${f.group}`).expect(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain(`grupo-${f.group}-2026-10.pdf`);
    const pages = await pdfPages(response.body);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain(f.students[0].number); expect(pages[1]).toContain(f.students[0].number);
    expect(pages[1]).toContain('Página 2 de 2');
    expect(pages[2]).toContain(f.students[1].number); expect(pages[2]).not.toContain(f.students[0].number);
    expect(pages.join(' ')).not.toContain('9999');
    const issued = all<{ student_id: number; token: string; verification_url: string; folio: string }>("SELECT * FROM issued_documents WHERE student_id IN (?,?) ORDER BY student_id", ...f.students.map(st => st.id));
    expect(issued).toHaveLength(2);
    for (const row of issued) {
      const verified = await request(app).get(`/api/documents/verify/${row.token}`).expect(200);
      expect(verified.body.document.student.program).toBe('Licenciatura en Enfermería');
      expect(response.body.toString('latin1')).toContain(row.verification_url);
      expect(pages.join(' ')).toContain(row.folio);
      expect(verified.body.document.content.totalPaid).toBe(row.student_id === f.students[0].id ? 1300 : 0);
      expect(verified.body.document.content.payments).toHaveLength(row.student_id === f.students[0].id ? 13 : 0);
      const individual = await request(app).get(`/api/payments/student/${row.student_id}?throughMonth=2026-10`).set('Authorization', auth).expect(200);
      expect(verified.body.document.content.totalPaid).toBe(individual.body.billing.summary.paidAmount);
    }
    expect(all("SELECT * FROM student_payments ORDER BY id")).toEqual(paymentsBefore);
  });
  it("includes all active accounts in the school export, not just the first twenty search results", async () => {
    const f = fixture(24);
    const prior = all<{ id: number }>("SELECT id FROM students WHERE is_active=1 AND id NOT IN (" + f.students.map(() => "?").join(",") + ")", ...f.students.map(st => st.id));
    // Isolate this school's current roster so the import parser's 40-page safety limit is respected.
    for (const student of prior) run("UPDATE students SET is_active=0 WHERE id=?", student.id);
    try {
      const ids = statementBatchRoster().map(st => st.id);
      expect(ids).toHaveLength(24);
      const response = await download('').expect(200);
      const pages = await pdfPages(response.body), text = pages.join(' ');
      for (const st of f.students) expect(text).toContain(st.number);
      const issued = all<{ student_id: number }>("SELECT DISTINCT student_id FROM issued_documents WHERE document_type='account_statement'").map(row => row.student_id);
      for (const id of ids) expect(issued).toContain(id);
      expect(pages).toHaveLength(24);
    } finally { for (const student of prior) run("UPDATE students SET is_active=1 WHERE id=?", student.id); }
  }, 20000);
  it("rejects unauthorized users and invalid or empty selections before issuing documents", async () => {
    const f = fixture(), before = get<{ n: number }>("SELECT COUNT(*) AS n FROM issued_documents")!.n;
    const uid = insert("INSERT INTO users(full_name,email,password_hash,role_id) VALUES('Consulta','bulk-consulta@example.invalid','unused',(SELECT id FROM roles WHERE name='Consulta'))");
    const limitedAuth = `Bearer ${signToken(loadUser(uid)!)}`;
    for (const url of ['/api/payments/statement-options', `/api/payments/statements.pdf?throughMonth=2026-10&groupId=${f.group}`]) {
      await request(app).get(url).expect(401);
      await request(app).get(url).set('Authorization', limitedAuth).expect(403);
    }
    for (const query of ['throughMonth=bad', 'throughMonth=2026-99', 'throughMonth=2026-10&groupId=-1']) {
      await request(app).get(`/api/payments/statements.pdf?${query}`).set('Authorization', auth).expect(400);
    }
    await download('&groupId=999999').expect(404);
    run("UPDATE students SET is_active=0 WHERE id IN (?,?)", ...f.students.map(st => st.id));
    await download(`&groupId=${f.group}`).expect(409);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM issued_documents")!.n).toBe(before);
  });
  it("cancels work and removes temporary files when the client disconnects", async () => {
    const f = fixture(30);
    const existing = new Set(await statementTemporaryFolders());
    const interrupted = download(`&groupId=${f.group}`);
    const pending = interrupted.then(() => undefined, () => undefined);
    for (let i = 0; i < 100; i++) {
      if (get<{ n: number }>("SELECT COUNT(*) AS n FROM issued_documents WHERE student_id=?", f.students[0].id)!.n) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    interrupted.abort(); await pending;
    let response;
    for (let i = 0; i < 30; i++) {
      response = await download(`&groupId=${f.group}`);
      if (response.status !== 503) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(response?.status).toBe(200);
    let remaining: string[] = [];
    for (let i = 0; i < 30; i++) {
      remaining = (await statementTemporaryFolders()).filter(name => !existing.has(name));
      if (!remaining.length) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(remaining).toEqual([]);
  }, 10000);
  it("allows one bulk generation at a time and releases its slot after a completed download", async () => {
    const f = fixture(8);
    const results = await Promise.all([download(`&groupId=${f.group}`), download(`&groupId=${f.group}`)]);
    expect(results.map(res => res.status).sort()).toEqual([200, 503]);
    await download(`&groupId=${f.group}`).expect(200);
  });
});
