import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

it("reverses the previous classification without losing receipts, coverage or audit records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE students(id INTEGER PRIMARY KEY,student_number TEXT);
      INSERT INTO students VALUES(1,'X1');
      CREATE TABLE student_tuition_charges(payment_id INTEGER,billing_month TEXT,amount REAL,status TEXT);
      CREATE TABLE student_payments(id INTEGER PRIMARY KEY,student_id INTEGER,folio TEXT,paid_at TEXT,amount REAL,concept_type TEXT,payment_method TEXT,covered_month TEXT);
      INSERT INTO student_payments VALUES(1,1,'COL-X1-202610','2026-10-10',1000,'tuition','Administrativo','2026-10');
      INSERT INTO student_payments VALUES(2,1,'REAL-RECEIPT','2026-09-03',6000,'tuition','Efectivo','2026-10');
      INSERT INTO student_tuition_charges VALUES(1,'2026-10',1000,'paid');`);
    db.exec(fs.readFileSync("server/migrations/037_cash_receipts_and_coverage.sql", "utf8"));
    expect(db.prepare("SELECT payment_kind FROM student_payments WHERE id=1").get()).toMatchObject({payment_kind:"coverage"});
    // A receipt and a coverage-only charge recorded while the reverted version was live.
    db.exec(`INSERT INTO student_payments VALUES(3,1,'NEW-RECEIPT','2026-10-19',2000,'tuition','Efectivo','2026-11','receipt','2026-12');
      INSERT INTO student_tuition_charges VALUES(3,'2026-11',1000,'paid'),(3,'2026-12',1000,'paid'),(NULL,'2027-01',1000,'paid');`);
    const receipts = db.prepare("SELECT id,folio,paid_at,amount,covered_month,covered_through_month FROM student_payments ORDER BY id").all();
    const charges = db.prepare("SELECT * FROM student_tuition_charges").all();
    const sql = fs.readFileSync("server/migrations/038_restore_previous_payment_accounting.sql", "utf8");
    db.exec(sql);
    expect(db.prepare("SELECT payment_kind FROM student_payments ORDER BY id").all()).toEqual([{payment_kind:"receipt"},{payment_kind:"receipt"},{payment_kind:"receipt"}]);
    expect(db.prepare("SELECT id,folio,paid_at,amount,covered_month,covered_through_month FROM student_payments ORDER BY id").all()).toEqual(receipts);
    expect(db.prepare("SELECT * FROM student_tuition_charges").all()).toEqual(charges);
    expect(db.prepare("SELECT * FROM payment_coverage_reclassifications").all()).toHaveLength(1);
    db.exec(sql);
    expect(db.prepare("SELECT COUNT(*) AS count FROM student_payments").get()).toMatchObject({count:3});
  } finally { db.close(); }
});
