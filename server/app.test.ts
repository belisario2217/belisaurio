import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";

const testDb = path.resolve("data/test-school.db");
for (const suffix of ["", "-shm", "-wal"]) {
  const file = `${testDb}${suffix}`;
  if (fs.existsSync(file)) fs.rmSync(file);
}
process.env.DATABASE_PATH = testDb;
process.env.JWT_SECRET = "test-secret";

const { app } = await import("./app.js");
const { db } = await import("./db.js");
const { certificateProgramName, repairAcademicAccents } = await import("./services/study-certificate.js");

let token = "";

function binaryParser(response: any, callback: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error: Error) => callback(error, Buffer.alloc(0)));
}

beforeAll(async () => {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@aulanova.edu.mx", password: "Admin123!" });
  token = response.body.token;
});

afterAll(() => {
  db.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${testDb}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

describe("Aula Nova API", () => {
  it("authenticates and exposes permissions", async () => {
    const branding = await request(app).get("/api/branding");
    expect(branding.status).toBe(200);
    expect(branding.body.institution_name).toBeTruthy();
    expect(branding.body.logo_path).toBe("/assets/campus-frontera.jpg");
    expect(certificateProgramName("LICENCIATURA EN ENFERMERÍA IFOP")).toBe("LICENCIATURA EN ENFERMERÍA");
    expect(certificateProgramName("LICENCIATURA EN ENFERMERÍA UNITEN")).toBe("LICENCIATURA EN ENFERMERÍA");
    expect(certificateProgramName("LICENCIATURA EN ENFERMER?A IFOP")).toBe("LICENCIATURA EN ENFERMERÍA");
    expect(repairAcademicAccents("Patolog?a M?dico Quir?rgica e Ingl?s T?cnico")).toBe("Patología Médico Quirúrgica e Inglés Técnico");

    const response = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.user.roleName).toBe("Administrador");
    expect(response.body.user.permissions).toContain("grades.manage");
    expect(response.body.user.permissions).toContain("payments.manage");
  });

  it("provides the student login, academic levels and curricular portal", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "an26001@alumnoifop.edu", password: "Alumno123!" });
    expect(login.status).toBe(200);
    expect(login.body.user.roleName).toBe("Alumno");
    expect(login.body.user.studentId).toBeTypeOf("number");

    const studentToken = login.body.token;
    const portal = await request(app).get("/api/portal").set("Authorization", `Bearer ${studentToken}`);
    expect(portal.status).toBe(200);
    expect(portal.body.progress.totalCredits).toBeGreaterThan(0);
    expect(portal.body.subjects.length).toBeGreaterThan(0);

    const forbidden = await request(app).get("/api/grades/assignments").set("Authorization", `Bearer ${studentToken}`);
    expect(forbidden.status).toBe(403);

    const levels = await request(app).get("/api/catalogs/levels").set("Authorization", `Bearer ${token}`);
    const names = levels.body.records.map((level: any) => level.name);
    expect(names).toEqual(expect.arrayContaining(["Licenciatura", "Maestría", "Especialidad"]));
    const programs = await request(app).get("/api/catalogs/programs").set("Authorization", `Bearer ${token}`);
    const programNames = programs.body.records.map((program: any) => program.name);
    expect(programNames).toEqual(expect.arrayContaining(["Licenciatura", "Maestría", "Especialidad"]));
  });

  it("creates a three-partial assignment and calculates its average", async () => {
    const responses = await Promise.all(
      ["subjects", "groups", "teachers", "periods", "scales"].map((type) =>
        request(app).get(`/api/catalogs/${type}`).set("Authorization", `Bearer ${token}`)
      )
    );
    const [subjects, groups, teachers, periods, scales] = responses.map((response) => response.body.records);
    const created = await request(app)
      .post("/api/grades/assignments")
      .set("Authorization", `Bearer ${token}`)
      .send({
        subjectId: subjects.find((subject: any) => subject.code === "COM-101").id,
        groupId: groups.find((group: any) => group.name === "1A").id,
        teacherId: teachers[0].id,
        periodId: periods.find((period: any) => period.name === "Primer parcial").id,
        gradingScaleId: scales[0].id,
        evaluationMode: "partials"
      });
    expect(created.status).toBe(201);
    expect(created.body.evaluation_mode).toBe("partials");

    const studentLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "an26001@alumnoifop.edu", password: "Alumno123!" });
    const ungradedPortal = await request(app)
      .get("/api/portal")
      .set("Authorization", `Bearer ${studentLogin.body.token}`);
    const inheritedAssignment = ungradedPortal.body.subjects.find((subject: any) => subject.code === "COM-101");
    expect(inheritedAssignment.teacher_name).toBe(created.body.teacher_name);
    expect(inheritedAssignment.final_score).toBeNull();

    const roster = await request(app)
      .get(`/api/grades/assignment/${created.body.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    const student = roster.body.students[0];
    const saved = await request(app)
      .put(`/api/grades/assignment/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ grades: [{ enrollmentId: student.enrollment_id, partials: { partial1: 8, partial2: 9, partial3: 10 } }] });
    expect(saved.status).toBe(200);

    const refreshed = await request(app)
      .get(`/api/grades/assignment/${created.body.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    const grade = refreshed.body.students.find((item: any) => item.enrollment_id === student.enrollment_id);
    expect(grade.final_score).toBe(9);
    expect(grade.status).toBe("passed");
    expect([grade.partial_1, grade.partial_2, grade.partial_3]).toEqual([8, 9, 10]);
  });

  it("restricts teachers to their assignments and confirms monthly attendance", async () => {
    const roles = await request(app).get("/api/users/roles/list").set("Authorization", `Bearer ${token}`);
    const teacherRole = roles.body.find((role: any) => role.name === "Docente");
    const createdUser = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        fullName: "Laura Méndez Ortega",
        email: "laura.mendez@aulanova.edu.mx",
        password: "Docente123!",
        roleId: teacherRole.id,
        isActive: true
      });
    expect(createdUser.status).toBe(201);
    const teacherLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "laura.mendez@aulanova.edu.mx", password: "Docente123!" });
    expect(teacherLogin.status).toBe(200);
    const teacherToken = teacherLogin.body.token;

    const assignments = await request(app)
      .get("/api/grades/assignments")
      .set("Authorization", `Bearer ${teacherToken}`);
    expect(assignments.status).toBe(200);
    expect(assignments.body.length).toBeGreaterThan(0);
    expect(assignments.body.every((assignment: any) => assignment.teacher_name === "Laura Méndez Ortega")).toBe(true);
    const allAssignments = await request(app).get("/api/grades/assignments").set("Authorization", `Bearer ${token}`);
    const anotherTeacherAssignment = allAssignments.body.find((item: any) => item.teacher_name !== "Laura Méndez Ortega");
    if (anotherTeacherAssignment) {
      const forbiddenRoster = await request(app)
        .get(`/api/grades/assignment/${anotherTeacherAssignment.id}/roster`)
        .set("Authorization", `Bearer ${teacherToken}`);
      expect(forbiddenRoster.status).toBe(403);
    }
    const assignment = assignments.body.find((item: any) => item.subject_code === "COM-101") ?? assignments.body[0];
    const roster = await request(app)
      .get(`/api/grades/assignment/${assignment.id}/roster`)
      .set("Authorization", `Bearer ${teacherToken}`);
    const target = roster.body.students[0];

    const registrationPayment = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .send({
        studentId: target.student_id,
        folio: "REG-ATT-001",
        amount: 1000,
        paidAt: "2026-08-10",
        paymentMethod: "Efectivo",
        concept: "Inscripción primer semestre",
        conceptType: "enrollment",
        registrationPeriodNumber: 1,
        notes: "0998"
    });
    expect(registrationPayment.status).toBe(201);
    expect(registrationPayment.body.billing.payments.find((payment: any) => payment.folio === "REG-ATT-001").concept_type).toBe("enrollment");

    const attendance = await request(app)
      .put(`/api/attendance/assignment/${assignment.id}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({
        month: "2026-08",
        scheduledClasses: 10,
        confirm: true,
        records: roster.body.students.map((student: any) => ({
          enrollmentId: student.enrollment_id,
          attendedClasses: student.enrollment_id === target.enrollment_id ? 8 : 7
        }))
      });
    expect(attendance.status).toBe(200);

    const refreshed = await request(app)
      .get(`/api/grades/assignment/${assignment.id}/roster`)
      .set("Authorization", `Bearer ${teacherToken}`);
    const eligibleStudent = refreshed.body.students.find((student: any) => student.enrollment_id === target.enrollment_id);
    expect(eligibleStudent.eligibility.attendancePercentage).toBe(80);
    expect(eligibleStudent.eligibility.registrationPaid).toBe(true);
    expect(eligibleStudent.eligibility.eligible).toBe(true);
    expect(refreshed.body.students.find((student: any) => student.enrollment_id !== target.enrollment_id).eligibility.eligible).toBe(false);

    const grade = await request(app)
      .put(`/api/grades/assignment/${assignment.id}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ grades: [{ enrollmentId: target.enrollment_id, partials: { partial1: 9, partial2: 9, partial3: 9 } }] });
    expect(grade.status).toBe(200);
  });

  it("creates a complete academic plan with mandatory and elective subjects", async () => {
    const programs = await request(app).get("/api/catalogs/programs").set("Authorization", `Bearer ${token}`);
    const programId = programs.body.records[0].id;
    const created = await request(app)
      .post("/api/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({
        programId,
        code: "PLAN-TEST-2026",
        matriculationCode: "PT",
        name: "Plan automatizado",
        version: "2026",
        assignExisting: false,
        subjects: [
          { code: "PLAN-T01", name: "Fundamentos", subjectType: "mandatory", credits: 6, recommendedPeriod: 1 },
          { code: "PLAN-T02", name: "Seminario optativo", subjectType: "elective", credits: 4, recommendedPeriod: 2 }
        ]
      });
    expect(created.status).toBe(201);
    expect(created.body.total_credits).toBe(10);
    expect(created.body.matriculation_code).toBe("PT");

    const duplicate = await request(app)
      .post("/api/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({
        programId,
        code: "PLAN-TEST-2026-DUP",
        matriculationCode: "PTD",
        name: "Plán automatizado",
        version: " 2026 ",
        assignExisting: false,
        subjects: [
          { code: "PLAN-DUP-01", name: "Materia duplicada", subjectType: "mandatory", credits: 5, recommendedPeriod: 1 }
        ]
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toContain("Ya existe el plan académico");

    const detail = await request(app).get(`/api/plans/${created.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.body.subjects).toHaveLength(2);
    expect(detail.body.subjects.map((subject: any) => subject.subject_type)).toEqual(expect.arrayContaining(["mandatory", "elective"]));

    const updated = await request(app)
      .put(`/api/plans/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        programId,
        code: "PLAN-TEST-2026",
        matriculationCode: "PT",
        name: "Plan automatizado editado",
        version: "2027",
        assignExisting: false,
        subjects: [
          { code: "PLAN-T01", name: "Fundamentos actualizados", subjectType: "mandatory", credits: 8, recommendedPeriod: 1 },
          { code: "PLAN-T02", name: "Seminario optativo", subjectType: "elective", credits: 4, recommendedPeriod: 2 }
        ]
      });
    expect(updated.status).toBe(200);
    expect(updated.body.total_credits).toBe(12);
    expect(updated.body.name).toBe("Plan automatizado editado");

    await request(app)
      .delete(`/api/plans/${created.body.id}/permanent`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app).get(`/api/plans/${created.body.id}`).set("Authorization", `Bearer ${token}`).expect(404);
  });

  it("recognizes a plan attached to an equivalent duplicate program record", async () => {
    const { planMatchesProgram } = await import("./services/student-identity.js");
    expect(planMatchesProgram(
      { program_id: 90, name: "Plan Enfermería 2026", program_name: "LICENCIATURA EN ENFERMERÍA IFOP" },
      { id: 91, name: "Licenciatura en Enfermeria IFOP" }
    )).toBe(true);
    expect(planMatchesProgram(
      { program_id: 90, name: "Licenciatura en Enfermería IFOP", program_name: "Licenciatura" },
      { id: 91, name: "LICENCIATURA EN ENFERMERIA IFOP" }
    )).toBe(true);
  });

  it("manages student tuition payments and exports account statements", async () => {
    const programs = await request(app).get("/api/catalogs/programs").set("Authorization", `Bearer ${token}`);
    const programId = programs.body.records.find((program: any) => program.name === "Bachillerato General").id;
    await request(app)
      .post("/api/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({
        programId,
        code: "PAY-PLAN-2026",
        matriculationCode: "BG",
        name: "Plan con colegiatura",
        version: "2026",
        tuitionAmount: 1000,
        assignExisting: true,
        subjects: [
          { code: "PAY-101", name: "Materia de control de pagos", subjectType: "mandatory", credits: 6, recommendedPeriod: 1 }
        ]
      })
      .expect(201);

    const search = await request(app)
      .get("/api/payments/students?search=AN26001")
      .set("Authorization", `Bearer ${token}`);
    expect(search.status).toBe(200);
    const studentId = search.body.records[0].id;

    const account = await request(app)
      .get(`/api/payments/student/${studentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(account.body.billing.summary.expectedAmount).toBe(36000);
    expect(account.body.billing.summary.totalInstallments).toBe(36);
    expect(account.body.billing.schedule[0].dueDate).toBe("2026-08-10");

    await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .send({
        studentId,
        folio: "FOL-PAY-INVALID",
        amount: 100,
        paidAt: "2026-09-03",
        paymentMethod: "Efectivo",
        concept: "Colegiatura",
        notes: "1001"
      })
      .expect(400);

    const created = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .send({
        studentId,
        folio: "FOL-PAY-001",
        amount: 1200,
        paidAt: "2026-09-03",
        paymentMethod: "Efectivo",
        concept: "Colegiatura",
        notes: "1000"
      });
    expect(created.status).toBe(201);
    expect(created.body.billing.summary.paidAmount).toBe(1200);
    expect(created.body.billing.summary.balance).toBe(800);
    const createdPayment = created.body.billing.payments.find((payment: any) => payment.folio === "FOL-PAY-001");
    expect(createdPayment.notes).toBe("1000");
    const paymentId = createdPayment.id;

    const updated = await request(app)
      .patch(`/api/payments/${paymentId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        studentId,
        folio: "FOL-PAY-001",
        amount: 1500,
        paidAt: "2026-09-03",
        paymentMethod: "Transferencia",
        concept: "Colegiatura",
        notes: "1000"
      });
    expect(updated.status).toBe(200);
    expect(updated.body.billing.summary.paidAmount).toBe(1500);

    const additionalPaymentIds: number[] = [];
    for (let index = 1; index <= 12; index += 1) {
      const folio = `FOL-PAY-${String(index + 1).padStart(3, "0")}`;
      const additional = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${token}`)
        .send({
          studentId,
          folio,
          amount: 100 + index,
          paidAt: `2026-08-${String(index).padStart(2, "0")}`,
          paymentMethod: "Transferencia",
          concept: "Pago complementario",
          notes: String(index + 42).padStart(4, "0")
        });
      expect(additional.status).toBe(201);
      additionalPaymentIds.push(additional.body.billing.payments.find((payment: any) => payment.folio === folio).id);
    }

    const report = await request(app)
      .get("/api/payments/report?month=2026-09&format=pdf")
      .set("Authorization", `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(report.headers["content-type"]).toContain("application/pdf");

    const statement = await request(app)
      .get(`/api/payments/student/${studentId}/statement?format=xlsx`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(binaryParser);
    expect(statement.status).toBe(200);
    expect(statement.headers["content-type"]).toContain("spreadsheetml");
    expect(statement.body.length).toBeGreaterThan(10_000);
    const statementWorkbook = XLSX.read(statement.body, { type: "buffer", cellDates: true });
    expect(statementWorkbook.SheetNames).toEqual(expect.arrayContaining(["Estado de Cuenta", "Movimientos"]));
    const statementSheet = statementWorkbook.Sheets["Estado de Cuenta"];
    expect(statementSheet.A5.v).toBe("ESTADO DE CUENTA DEL ALUMNO");
    expect(statementSheet.C8.v).toContain("Sof");
    expect(statementSheet.A13.v).toBe("TOTAL PAGADO");
    expect(statementSheet.E13.v).toBe(2778);
    expect(statementSheet.E16.v).toBe(1500);
    expect(statementSheet.F16.v).toBe("1000");
    expect(statementSheet.H16.v).toBe("PAGADO");
    expect(statementSheet.A34.v).toContain("Frontera, Centla, Tab.");
    expect(statementSheet.A35.v).toContain("CÓDIGO DE VERIFICACIÓN SHA-256: EC-");
    expect(statementSheet["!merges"]?.length).toBeGreaterThan(10);
    expect(statementSheet.A41.v).toBe("ESTADO DE CUENTA DEL ALUMNO");
    expect(statementSheet.E52.v).toBe(101);
    expect(statementSheet.F52.v).toBe("0043");

    const historicalAccount = await request(app)
      .get(`/api/payments/student/${studentId}?throughMonth=2026-08`)
      .set("Authorization", `Bearer ${token}`);
    expect(historicalAccount.status).toBe(200);
    expect(historicalAccount.body.throughMonth).toBe("2026-08");
    expect(historicalAccount.body.billing.payments).toHaveLength(12);
    expect(historicalAccount.body.billing.summary.paidAmount).toBe(1278);
    expect(statementSheet.H52.v).toBe("PAGADO");
    const statementCsv = XLSX.utils.sheet_to_csv(statementSheet);
    const movementsCsv = XLSX.utils.sheet_to_csv(statementWorkbook.Sheets["Movimientos"]);
    expect(statementCsv).not.toContain("SALDO PENDIENTE");
    expect(statementCsv).not.toContain("FOL-PAY-001");
    expect(movementsCsv).not.toContain("SALDO PENDIENTE");
    expect(movementsCsv).not.toContain("FOL-PAY-001");
    expect(movementsCsv).toContain("FOLIO FÍSICO");

    const paginationWorkbook = new ExcelJS.Workbook();
    await paginationWorkbook.xlsx.load(statement.body);
    const printableSheet = paginationWorkbook.getWorksheet("Estado de Cuenta");
    expect(printableSheet?.pageSetup.printArea).toBe("A1:H72");
    expect(printableSheet?.getCell("A71").value).toContain("CÓDIGO DE VERIFICACIÓN SHA-256: EC-");

    const statementPdf = await request(app)
      .get(`/api/payments/student/${studentId}/statement?format=pdf`)
      .set("Authorization", `Bearer ${token}`);
    expect(statementPdf.status).toBe(200);
    expect(statementPdf.headers["content-type"]).toContain("application/pdf");
    expect(statementPdf.body.length).toBeGreaterThan(3_000);
    expect(statementPdf.body.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(2);

    await request(app)
      .get(`/api/payments/student/${studentId}/statement?format=txt`)
      .set("Authorization", `Bearer ${token}`)
      .expect(400);

    await request(app)
      .delete(`/api/payments/${paymentId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    for (const additionalPaymentId of additionalPaymentIds) {
      await request(app)
        .delete(`/api/payments/${additionalPaymentId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);
    }
    const afterDelete = await request(app)
      .get(`/api/payments/student/${studentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(afterDelete.body.billing.summary.paidAmount).toBe(0);

    const tuitionGridPayment = {
      startMonth: "2026-08",
      months: ["2026-08"],
      rows: [{ studentId, months: [{ month: "2026-08", amount: 1000, paid: true, notes: "0077" }] }]
    };
    await request(app)
      .patch("/api/payments/tuition-grid")
      .set("Authorization", `Bearer ${token}`)
      .send(tuitionGridPayment)
      .expect(200);
    const afterGridPayment = await request(app)
      .get(`/api/payments/student/${studentId}`)
      .set("Authorization", `Bearer ${token}`);
    const augustPayment = afterGridPayment.body.billing.payments.find(
      (payment: any) => payment.folio === "COL-AN26001-202608"
    );
    expect(augustPayment.concept).toBe("Colegiatura agosto 2026");
    expect(augustPayment.covered_month).toBe("2026-08");

    tuitionGridPayment.rows[0].months[0].amount = 1100;
    await request(app)
      .patch("/api/payments/tuition-grid")
      .set("Authorization", `Bearer ${token}`)
      .send(tuitionGridPayment)
      .expect(200);
    const afterGridUpdate = await request(app)
      .get(`/api/payments/student/${studentId}`)
      .set("Authorization", `Bearer ${token}`);
    const updatedAugustPayment = afterGridUpdate.body.billing.payments.find(
      (payment: any) => payment.folio === "COL-AN26001-202608"
    );
    expect(updatedAugustPayment.concept).toBe("Colegiatura agosto 2026");
    expect(updatedAugustPayment.amount).toBe(1100);

    tuitionGridPayment.rows[0].months[0].paid = false;
    await request(app)
      .patch("/api/payments/tuition-grid")
      .set("Authorization", `Bearer ${token}`)
      .send(tuitionGridPayment)
      .expect(200);
    const afterGridDelete = await request(app)
      .get(`/api/payments/student/${studentId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(afterGridDelete.body.billing.payments.some(
      (payment: any) => payment.folio === "COL-AN26001-202608"
    )).toBe(false);
  });

  it("lists editable catalogs and creates a shift", async () => {
    const list = await request(app).get("/api/catalogs").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((catalog: any) => catalog.key === "programs")).toBe(true);

    const created = await request(app)
      .post("/api/catalogs/shifts")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Mixto", start_time: "10:00", end_time: "17:00" });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Mixto");
  });

  it("creates and filters a student enrollment", async () => {
    const catalogs = await Promise.all(
      ["programs", "shifts", "groups", "cycles", "semesters", "statuses"].map((type) =>
        request(app).get(`/api/catalogs/${type}`).set("Authorization", `Bearer ${token}`)
      )
    );
    const [programs, shifts, groups, cycles, semesters, statuses] = catalogs.map((response) => response.body.records);
    const targetGroup = groups.find((group: any) => group.name === "1A");
    const targetPeriod = semesters.find((period: any) => period.sequence === 1);
    const targetCycle = cycles.find((cycle: any) => cycle.id === targetGroup.cycle_id);
    expect(targetCycle.name).toBe("2026B - 2027A");
    expect(targetCycle.start_date).toBe("2026-08-10");
    expect(targetPeriod.name).toBe("PRIMER SEMESTRE");
    expect(targetPeriod.cycle_id).toBeUndefined();
    const plan = await request(app)
      .post("/api/plans")
      .set("Authorization", `Bearer ${token}`)
      .send({
        programId: targetGroup.program_id,
        code: "MATRICULA-LE-2026",
        matriculationCode: "LE",
        name: "Plan de prueba para matrícula",
        version: "2026",
        assignExisting: false,
        subjects: [
          { code: "MATRICULA-101", name: "Materia para matrícula", subjectType: "mandatory", credits: 4, recommendedPeriod: 1 }
        ]
      });
    expect(plan.status).toBe(201);
    const outsidePlanDuration = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Periodo",
        lastName: "Fuera",
        statusId: statuses[0].id,
        programId: targetGroup.program_id,
        shiftId: targetGroup.shift_id,
        groupId: targetGroup.id,
        cycleId: targetGroup.cycle_id,
        planId: plan.body.id,
        curricularPeriodId: semesters.find((period: any) => period.sequence === 7).id
      });
    expect(outsidePlanDuration.status).toBe(400);
    expect(outsidePlanDuration.body.message).toContain("excede la duración del plan");

    const created = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Juan Carlos",
        lastName: "Cordova",
        secondLastName: "Marin",
        statusId: statuses[0].id,
        programId: targetGroup.program_id,
        shiftId: targetGroup.shift_id,
        groupId: targetGroup.id,
        cycleId: targetGroup.cycle_id,
        planId: plan.body.id,
        curricularPeriodId: targetPeriod.id
      });
    expect(created.status).toBe(201);
    expect(created.body.student_number).toBe("0826CMJLEESC");
    expect(created.body.email).toBe("0826cmjleesc@alumnoifop.edu");
    expect(created.body.plan_id).toBe(plan.body.id);
    expect(created.body.curricular_period_id).toBe(targetPeriod.id);
    expect(created.body.curricular_period_name).toBe("PRIMER SEMESTRE");
    expect(created.body.access).toEqual({
      email: "0826cmjleesc@alumnoifop.edu",
      temporaryPassword: "1234juan"
    });
    const users = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);
    const studentUser = users.body.find((user: any) => user.student_id === created.body.id);
    const temporaryCredentials = await request(app)
      .get(`/api/users/${studentUser.id}/student-credentials`)
      .set("Authorization", `Bearer ${token}`);
    expect(temporaryCredentials.status).toBe(200);
    expect(temporaryCredentials.body.passwordStatus).toBe("temporary");
    expect(temporaryCredentials.body.temporaryPassword).toBe("1234juan");

    const studentLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "0826cmjleesc@alumnoifop.edu", password: "1234juan" });
    expect(studentLogin.status).toBe(200);
    expect(studentLogin.body.user.studentId).toBe(created.body.id);
    expect(studentLogin.body.user.passwordMustChange).toBe(true);

    await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${studentLogin.body.token}`)
      .send({ currentPassword: "1234juan", newPassword: "NuevaClave2026!", confirmPassword: "NuevaClave2026!" })
      .expect(200);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "0826cmjleesc@alumnoifop.edu", password: "NuevaClave2026!" })
      .expect(200);
    const personalizedCredentials = await request(app)
      .get(`/api/users/${studentUser.id}/student-credentials`)
      .set("Authorization", `Bearer ${token}`);
    expect(personalizedCredentials.body.passwordStatus).toBe("personalized");
    expect(personalizedCredentials.body.temporaryPassword).toBeNull();
    await request(app)
      .get(`/api/users/${studentUser.id}/student-credentials`)
      .set("Authorization", `Bearer ${studentLogin.body.token}`)
      .expect(403);

    const reset = await request(app)
      .post(`/api/users/${studentUser.id}/reset-student-password`)
      .set("Authorization", `Bearer ${token}`);
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toBe("1234juan");
    const resetCredentials = await request(app)
      .get(`/api/users/${studentUser.id}/student-credentials`)
      .set("Authorization", `Bearer ${token}`);
    expect(resetCredentials.body.passwordStatus).toBe("temporary");
    expect(resetCredentials.body.temporaryPassword).toBe("1234juan");
    await request(app)
      .post("/api/auth/login")
      .send({ email: "0826cmjleesc@alumnoifop.edu", password: "1234juan" })
      .expect(200);

    const duplicate = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Juan Carlos",
        lastName: "Cordova",
        secondLastName: "Marin",
        statusId: statuses[0].id,
        programId: targetGroup.program_id,
        shiftId: targetGroup.shift_id,
        groupId: targetGroup.id,
        cycleId: targetGroup.cycle_id,
        planId: plan.body.id,
        curricularPeriodId: targetPeriod.id
      });
    expect(duplicate.status).toBe(409);

    const filtered = await request(app)
      .get("/api/students?search=0826CMJLEESC")
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.body.pagination.total).toBe(1);

    const independentCycle = await request(app)
      .post("/api/catalogs/cycles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "2027B - 2028A", start_date: "2027-08-10", end_date: "2028-07-31" });
    expect(independentCycle.status).toBe(201);
    const differentCycleStudent = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Ana",
        lastName: "Ciclo",
        secondLastName: "Libre",
        statusId: statuses[0].id,
        programId: targetGroup.program_id,
        shiftId: targetGroup.shift_id,
        groupId: targetGroup.id,
        cycleId: independentCycle.body.id,
        planId: plan.body.id,
        curricularPeriodId: targetPeriod.id
      });
    expect(differentCycleStudent.status).toBe(201);
    expect(differentCycleStudent.body.cycle_id).toBe(independentCycle.body.id);
    expect(differentCycleStudent.body.group_id).toBe(targetGroup.id);
    expect(differentCycleStudent.body.student_number).toBe("0827CLALEESC");
    await request(app)
      .delete(`/api/students/${differentCycleStudent.body.id}/permanent`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const assignments = await request(app)
      .get(`/api/grades/assignments?groupId=${targetGroup.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(assignments.body.length).toBeGreaterThan(0);
    const groupAssignment = assignments.body[0];
    const roster = await request(app)
      .get(`/api/grades/assignment/${groupAssignment.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    expect(roster.body.students.some((student: any) => student.student_id === created.body.id)).toBe(true);

    const curricular = await request(app)
      .get(`/api/reports/curricular-subjects?studentId=${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    const inheritedSubject = curricular.body.find((subject: any) => subject.subject_id === groupAssignment.subject_id);
    expect(inheritedSubject).toBeTruthy();
    expect(inheritedSubject.teacher_name).toBe(groupAssignment.teacher_name);

    await request(app)
      .delete(`/api/students/${created.body.id}/permanent`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    const removed = await request(app).get("/api/students?search=0826CMJLEESC").set("Authorization", `Bearer ${token}`);
    expect(removed.body.pagination.total).toBe(0);
    await request(app)
      .delete(`/api/plans/${plan.body.id}/permanent`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
  });

  it("administers a group's active cycle, plan and enrolled students", async () => {
    const list = await request(app)
      .get("/api/group-management")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const group = list.body.groups.find((item: any) => item.name === "1A");
    const currentCycle = list.body.cycles.find((item: any) => item.name === "2026B - 2027A");
    const otherCycle = list.body.cycles.find((item: any) => item.name === "2027B - 2028A");
    const plan = list.body.plans.find((item: any) => item.name === "Plan con colegiatura");
    expect(group.student_count).toBeGreaterThan(0);
    expect(group.formation_cycle_name).toBe("2026B - 2027A");
    expect(plan).toBeTruthy();

    const detail = await request(app)
      .get(`/api/group-management/${group.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.students).toHaveLength(group.student_count);
    expect(detail.body.students[0].student_number).toBeTruthy();

    const contextOnly = await request(app)
      .patch(`/api/group-management/${group.id}/context`)
      .set("Authorization", `Bearer ${token}`)
      .send({ activeCycleId: otherCycle.id, planId: plan.id, syncStudents: false });
    expect(contextOnly.status).toBe(200);
    expect(contextOnly.body.group.formation_cycle_name).toBe("2026B - 2027A");
    expect(contextOnly.body.group.active_cycle_name).toBe("2027B - 2028A");
    expect(contextOnly.body.group.mismatch_count).toBe(group.student_count);

    const synchronized = await request(app)
      .patch(`/api/group-management/${group.id}/context`)
      .set("Authorization", `Bearer ${token}`)
      .send({ activeCycleId: currentCycle.id, planId: plan.id, syncStudents: true });
    expect(synchronized.status).toBe(200);
    expect(synchronized.body.updatedStudents).toBe(group.student_count);
    expect(synchronized.body.group.active_cycle_name).toBe("2026B - 2027A");
    expect(synchronized.body.group.plan_name).toBe("Plan con colegiatura");
    expect(synchronized.body.group.mismatch_count).toBe(0);
    expect(synchronized.body.students.every((student: any) => student.context_matches === 1)).toBe(true);
  });

  it("permanently deletes an unused subject", async () => {
    const programs = await request(app).get("/api/catalogs/programs").set("Authorization", `Bearer ${token}`);
    const subject = await request(app)
      .post("/api/catalogs/subjects")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "DELETE-101", name: "Materia eliminable", program_id: programs.body.records[0].id, credits: 3, hours_per_week: 2 });
    expect(subject.status).toBe(201);
    await request(app)
      .delete(`/api/catalogs/subjects/${subject.body.id}/permanent`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    const subjects = await request(app).get("/api/catalogs/subjects").set("Authorization", `Bearer ${token}`);
    expect(subjects.body.records.some((item: any) => item.id === subject.body.id)).toBe(false);
  });

  it("force deletes a catalog record and its dependencies", async () => {
    const levels = await request(app).get("/api/catalogs/levels").set("Authorization", `Bearer ${token}`);
    const program = await request(app)
      .post("/api/catalogs/programs")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "FORCE-PROG", name: "Programa para borrado forzado", level_id: levels.body.records[0].id, duration_periods: 2 });
    const subject = await request(app)
      .post("/api/catalogs/subjects")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "FORCE-101", name: "Dependencia forzada", program_id: program.body.id, credits: 3, hours_per_week: 2 });
    expect(subject.status).toBe(201);

    await request(app)
      .delete(`/api/catalogs/programs/${program.body.id}/permanent`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    await request(app)
      .delete(`/api/catalogs/programs/${program.body.id}/permanent?force=true`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const subjects = await request(app).get("/api/catalogs/subjects").set("Authorization", `Bearer ${token}`);
    expect(subjects.body.records.some((item: any) => item.id === subject.body.id)).toBe(false);
  });

  it("previews and applies an Excel student import", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{
      "Nombre(s)": "Marina",
      "Apellido paterno": "Importada",
      "Programa": "Bachillerato General",
      "Plan académico": "Plan con colegiatura",
      "Turno": "Matutino",
      "Grupo": "1A",
      "Ciclo escolar": "2026B - 2027A",
      "Periodo del plan": "PRIMER SEMESTRE",
      "Estatus": "Activo"
    }]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Alumnos");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const preview = await request(app)
      .post("/api/students/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", buffer, "alumnos.xlsx");
    expect(preview.status).toBe(200);
    expect(preview.body.summary.valid).toBe(1);
    expect(preview.body.rows[0].studentNumber).toBe("0826IXMBGESC");

    const applied = await request(app)
      .post("/api/students/import/apply")
      .set("Authorization", `Bearer ${token}`)
      .send({ previewId: preview.body.previewId, existingMode: "ignore" });
    expect(applied.status).toBe(200);
    expect(applied.body.created).toBe(1);
    const imported = await request(app).get("/api/students?search=0826IXMBGESC").set("Authorization", `Bearer ${token}`);
    expect(imported.body.records[0].email).toBe("0826ixmbgesc@alumnoifop.edu");
    expect(imported.body.records[0].curricular_period_name).toBe("PRIMER SEMESTRE");
    const importedLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "0826ixmbgesc@alumnoifop.edu", password: "1234marina" });
    expect(importedLogin.status).toBe(200);
    expect(importedLogin.body.user.studentId).toBe(imported.body.records[0].id);
  });

  it("updates grades and records immutable history", async () => {
    const assignments = await request(app).get("/api/grades/assignments").set("Authorization", `Bearer ${token}`);
    const assignment = assignments.body.find((item: any) => item.evaluation_mode === "criteria");
    const roster = await request(app)
      .get(`/api/grades/assignment/${assignment.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    const student = roster.body.students[0];
    const updated = await request(app)
      .put(`/api/grades/assignment/${assignment.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ grades: [{ enrollmentId: student.enrollment_id, score: 8.8, comments: "Prueba automatizada", reason: "Validación" }] });
    expect(updated.status).toBe(200);

    const refreshed = await request(app)
      .get(`/api/grades/assignment/${assignment.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    const grade = refreshed.body.students.find((item: any) => item.enrollment_id === student.enrollment_id);
    expect(grade.final_score).toBe(8.8);
    const history = await request(app)
      .get(`/api/grades/history/${grade.grade_id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(history.body[0].old_score).not.toBe(history.body[0].new_score);

    const components = Object.fromEntries(roster.body.criteria.map((criterion: any) => [criterion.id, 9]));
    const weighted = await request(app)
      .put(`/api/grades/assignment/${assignment.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ grades: [{ enrollmentId: student.enrollment_id, components, comments: "Cálculo ponderado", reason: "Prueba de ponderaciones" }] });
    expect(weighted.status).toBe(200);
    const weightedRoster = await request(app)
      .get(`/api/grades/assignment/${assignment.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    const weightedGrade = weightedRoster.body.students.find((item: any) => item.enrollment_id === student.enrollment_id);
    expect(weightedGrade.final_score).toBe(9);
    expect(Object.keys(weightedGrade.components)).toHaveLength(roster.body.criteria.length);
  });

  it("previews and applies a grade import with update mode", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([{
      "Matrícula": "AN26002",
      "Nombre del alumno": "Diego Martínez Cruz",
      "Programa de estudios": "Bachillerato General",
      "Turno": "Matutino",
      "Grupo": "1A",
      "Materia": "MAT-101",
      "Periodo": "Primer parcial",
      "Calificación": 8.4,
      "Observaciones": "Importación validada"
    }]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Calificaciones");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const preview = await request(app)
      .post("/api/grades/import/preview")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", buffer, "calificaciones.xlsx");
    expect(preview.status).toBe(200);
    expect(preview.body.summary.valid).toBe(1);
    expect(preview.body.summary.existing).toBe(1);

    const applied = await request(app)
      .post("/api/grades/import/apply")
      .set("Authorization", `Bearer ${token}`)
      .send({ previewId: preview.body.previewId, existingMode: "update" });
    expect(applied.status).toBe(200);
    expect(applied.body.updated).toBe(1);
  });

  it("blocks edits while grade entry is closed", async () => {
    const assignments = await request(app).get("/api/grades/assignments").set("Authorization", `Bearer ${token}`);
    const assignment = assignments.body[0];
    const roster = await request(app)
      .get(`/api/grades/assignment/${assignment.id}/roster`)
      .set("Authorization", `Bearer ${token}`);
    await request(app)
      .post(`/api/grades/assignment/${assignment.id}/toggle-lock`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const blocked = await request(app)
      .put(`/api/grades/assignment/${assignment.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ grades: [{ enrollmentId: roster.body.students[0].enrollment_id, score: 7 }] });
    expect(blocked.status).toBe(409);
    await request(app)
      .post(`/api/grades/assignment/${assignment.id}/toggle-lock`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  });

  it("manages roles, users and institutional settings", async () => {
    const role = await request(app)
      .post("/api/users/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Tutor de prueba", description: "Rol creado por pruebas" });
    expect(role.status).toBe(201);
    const roleDetail = await request(app)
      .get(`/api/users/roles/${role.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    const permissionId = roleDetail.body.permissions.find((permission: any) => permission.code === "students.view").id;
    await request(app)
      .put(`/api/users/roles/${role.body.id}/permissions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ permissionIds: [permissionId] })
      .expect(200);
    const user = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Usuario de Prueba", email: "usuario.prueba@example.com", password: "Prueba123!", roleId: role.body.id });
    expect(user.status).toBe(201);

    const cannotDeleteSelf = await request(app)
      .delete("/api/users/1")
      .set("Authorization", `Bearer ${token}`);
    expect(cannotDeleteSelf.status).toBe(400);

    const deleted = await request(app)
      .delete(`/api/users/${user.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(200);
    const userRows = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);
    expect(userRows.body.some((item: any) => item.id === user.body.id)).toBe(false);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "usuario.prueba@example.com", password: "Prueba123!" })
      .expect(401);

    const studentAccess = userRows.body.find((item: any) => item.student_number === "AN26001");
    expect(studentAccess).toBeTruthy();
    await request(app)
      .delete(`/api/users/${studentAccess.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const { ensureAllStudentAccounts } = await import("./services/student-account.js");
    ensureAllStudentAccounts();
    const usersAfterProvision = await request(app).get("/api/users").set("Authorization", `Bearer ${token}`);
    expect(usersAfterProvision.body.some((item: any) => item.id === studentAccess.id)).toBe(false);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "an26001@alumnoifop.edu", password: "Alumno123!" })
      .expect(401);

    const current = await request(app).get("/api/settings").set("Authorization", `Bearer ${token}`);
    const settings = current.body.settings;
    const updated = await request(app)
      .patch("/api/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        institutionName: "Instituto Aula Nova",
        address: settings.address,
        phone: settings.phone,
        email: settings.email,
        directorName: "Lic. Carla Méndez - Control Escolar",
        activeCycleId: settings.active_cycle_id,
        defaultScaleId: settings.default_scale_id,
        footerText: "Pie institucional validado",
        primaryColor: settings.primary_color,
        secondaryColor: settings.secondary_color
      });
    expect(updated.status).toBe(200);
    expect(updated.body.footer_text).toBe("Pie institucional validado");
    expect(updated.body.director_name).toBe("Lic. Carla Méndez - Control Escolar");

    const student = await request(app)
      .get("/api/students?search=AN26001")
      .set("Authorization", `Bearer ${token}`);
    const statement = await request(app)
      .get(`/api/payments/student/${student.body.records[0].id}/statement?format=xlsx`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(binaryParser);
    const workbook = XLSX.read(statement.body, { type: "buffer" });
    expect(workbook.Sheets["Estado de Cuenta"].C32.v).toBe("Lic. Carla Méndez - Control Escolar");
  });

  it("returns analytics and generates a report card PDF", async () => {
    const analytics = await request(app).get("/api/analytics").set("Authorization", `Bearer ${token}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.summary.students).toBeGreaterThan(0);

    const students = await request(app).get("/api/students?pageSize=1").set("Authorization", `Bearer ${token}`);
    const report = await request(app)
      .get(`/api/reports/report-card.pdf?studentId=${students.body.records[0].id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(report.status).toBe(200);
    expect(report.headers["content-type"]).toContain("application/pdf");
    expect(report.body.length).toBeGreaterThan(1000);

    const certificate = await request(app)
      .get(`/api/reports/study-certificate.pdf?studentId=${students.body.records[0].id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(certificate.status).toBe(200);
    expect(certificate.headers["content-type"]).toContain("application/pdf");
    expect(certificate.headers["content-disposition"]).toContain("CE-");
    expect(certificate.headers["content-disposition"]).toContain("-CONSTANCIA.pdf");
    expect(certificate.body.length).toBeGreaterThan(1000);
  });

  it("exports student, grade and operational reports", async () => {
    const endpoints = [
      ["/api/students/export/file?format=xlsx", "spreadsheetml"],
      ["/api/students/export/file?format=csv", "text/csv"],
      ["/api/grades/export/file?format=xlsx", "spreadsheetml"],
      ["/api/grades/export/file?format=pdf", "application/pdf"],
      ["/api/reports/data/gradebook?format=xlsx", "spreadsheetml"],
      ["/api/reports/data/teachers?format=pdf", "application/pdf"]
    ];
    for (const [endpoint, contentType] of endpoints) {
      const response = await request(app).get(endpoint).set("Authorization", `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain(contentType);
      expect(response.body.length ?? response.text.length).toBeGreaterThan(30);
    }
    const groups = await request(app).get("/api/catalogs/groups").set("Authorization", `Bearer ${token}`);
    const groupWithStudents = groups.body.records.find((group: any) => group.name === "1A");
    const groupReport = await request(app)
      .get(`/api/reports/report-card.pdf?groupId=${groupWithStudents.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(groupReport.status).toBe(200);
    expect(groupReport.body.length).toBeGreaterThan(1000);
  });

  it("generates the institutional attendance list for every modality", async () => {
    const groups = await request(app).get("/api/catalogs/groups").set("Authorization", `Bearer ${token}`);
    const group = groups.body.records.find((item: any) => item.name === "1A");
    const workbookResponse = await request(app)
      .get(`/api/reports/data/attendance?format=xlsx&groupId=${group.id}&mode=semiescolarizado&month=2026-08`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse(binaryParser);
    expect(workbookResponse.status).toBe(200);
    expect(workbookResponse.headers["content-type"]).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookResponse.body);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("C2").value).toContain("CAMPUS FRONTERA");
    expect(sheet.getCell("A5").value).toBe("LISTA DE ASISTENCIA");
    expect(sheet.getCell("U7").value).toBe(group.name);
    expect(sheet.getCell("F13").value).toBe("S");
    expect(sheet.getCell("B14").value).toBeTruthy();
    expect(sheet.pageSetup.orientation).toBe("landscape");
    expect(sheet.pageSetup.printArea).toBe("A1:X37");

    const complementaryPdf = await request(app)
      .get(`/api/reports/data/attendance?format=pdf&groupId=${group.id}&mode=complementario&month=2026-08`)
      .set("Authorization", `Bearer ${token}`);
    expect(complementaryPdf.status).toBe(200);
    expect(complementaryPdf.headers["content-type"]).toContain("application/pdf");
    expect(complementaryPdf.body.length).toBeGreaterThan(3_000);
    expect(complementaryPdf.body.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length).toBeGreaterThan(0);
  });

  it("promotes a student only with recent tuition and target-semester registration", async () => {
    const blockedEnrollment = db.prepare(
      `SELECT e.id FROM enrollments e JOIN students st ON st.id = e.student_id
       WHERE st.student_number = 'AN26003' AND e.is_active = 1`
    ).get() as any;
    const blocked = await request(app)
      .post(`/api/group-management/enrollments/${blockedEnrollment.id}/promote`)
      .set("Authorization", `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain("dos mensualidades");

    const student = db.prepare(
      `SELECT st.id, e.id AS enrollment_id FROM students st
       JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
       WHERE st.student_number = 'AN26002'`
    ).get() as any;
    for (const [index, coveredMonth] of ["2026-06", "2026-07"].entries()) {
      const payment = await request(app)
        .post("/api/payments")
        .set("Authorization", `Bearer ${token}`)
        .send({
          studentId: student.id,
          folio: `PROM-TUI-${index + 1}`,
          amount: 1000,
          paidAt: `${coveredMonth}-10`,
          paymentMethod: "Efectivo",
          concept: `Colegiatura ${coveredMonth}`,
          conceptType: "tuition",
          coveredMonth,
          notes: String(900 + index).padStart(4, "0")
        });
      expect(payment.status).toBe(201);
    }
    const reenrollment = await request(app)
      .post("/api/payments")
      .set("Authorization", `Bearer ${token}`)
      .send({
        studentId: student.id,
        folio: "PROM-REG-2",
        amount: 1500,
        paidAt: "2026-07-15",
        paymentMethod: "Efectivo",
        concept: "Reinscripción segundo semestre",
        conceptType: "reenrollment",
        registrationPeriodNumber: 2,
        notes: "0902"
      });
    expect(reenrollment.status).toBe(201);

    const promoted = await request(app)
      .post(`/api/group-management/enrollments/${student.enrollment_id}/promote`)
      .set("Authorization", `Bearer ${token}`);
    expect(promoted.status).toBe(200);
    const period = db.prepare(
      `SELECT cp.sequence FROM enrollments e JOIN curricular_periods cp ON cp.id = e.curricular_period_id WHERE e.id = ?`
    ).get(student.enrollment_id) as any;
    expect(period.sequence).toBe(2);
  });

  it("allows audited manual registration, financial clearance and forced promotion", async () => {
    const student = db.prepare(
      `SELECT st.id, e.id AS enrollment_id FROM students st
       JOIN enrollments e ON e.student_id = st.id AND e.is_active = 1
       WHERE st.student_number = 'AN26004'`
    ).get() as any;

    const clearance = await request(app)
      .post(`/api/students/${student.id}/financial-clearance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ cleared: true, note: "Cuenta revisada por control escolar" });
    expect(clearance.status).toBe(200);
    expect(clearance.body.financial_clearance_override).toBe(1);

    const registration = await request(app)
      .post(`/api/students/${student.id}/registration-status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "paid", periodNumber: 2, physicalFolio: "0998", amount: 1500, paidAt: "2026-08-09" });
    expect(registration.status).toBe(200);
    expect(registration.body.registration_paid).toBe(1);
    expect(registration.body.curricular_period_number).toBe(2);
    expect(registration.body.registration_folio).toBe("0998");

    const payment = db.prepare(
      "SELECT amount, notes, registration_period_number FROM student_payments WHERE student_id = ? AND concept_type = 'reenrollment' ORDER BY id DESC LIMIT 1"
    ).get(student.id) as any;
    expect(payment.amount).toBe(1500);
    expect(payment.notes).toBe("0998");
    expect(payment.registration_period_number).toBe(2);

    const blockedStudent = db.prepare(
      `SELECT e.id FROM enrollments e JOIN students st ON st.id = e.student_id
       WHERE st.student_number = 'AN26003' AND e.is_active = 1`
    ).get() as any;
    const forced = await request(app)
      .post(`/api/group-management/enrollments/${blockedStudent.id}/promote`)
      .set("Authorization", `Bearer ${token}`)
      .send({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.message).toContain("manualmente");
  });

  it("manages academic dates and updates a whole group's subject status", async () => {
    const group = db.prepare("SELECT id, cycle_id FROM groups WHERE name = '1A' ORDER BY id LIMIT 1").get() as any;
    const subject = db.prepare(
      `SELECT ss.id FROM student_subjects ss JOIN enrollments e ON e.id = ss.enrollment_id
       WHERE e.group_id = ? AND ss.school_cycle_id = ? AND ss.semester_number = 1 LIMIT 1`
    ).get(group.id, group.cycle_id) as any;
    expect(subject).toBeTruthy();
    db.prepare("UPDATE student_subjects SET status = 'pending' WHERE id = ?").run(subject.id);

    const event = await request(app)
      .post("/api/settings/calendar-events")
      .set("Authorization", `Bearer ${token}`)
      .send({
        cycleId: group.cycle_id,
        eventType: "class_start",
        title: "Inicio de clases de prueba",
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        autoStartSubjects: true
      });
    expect(event.status).toBe(201);

    const rows = await request(app)
      .get(`/api/reports/curricular-subjects?groupId=${group.id}&cycleId=${group.cycle_id}&semester=1`)
      .set("Authorization", `Bearer ${token}`);
    expect(rows.status).toBe(200);
    expect(rows.body.find((row: any) => row.id === subject.id)?.status).toBe("in_progress");

    const bulk = await request(app)
      .patch("/api/reports/curricular-subjects/status-group")
      .set("Authorization", `Bearer ${token}`)
      .send({ groupId: group.id, cycleId: group.cycle_id, semester: 1, status: "pending" });
    expect(bulk.status).toBe(200);
    expect(bulk.body.count).toBeGreaterThan(0);
    expect((db.prepare("SELECT status FROM student_subjects WHERE id = ?").get(subject.id) as any).status).toBe("pending");
    const manualPriority = await request(app)
      .get(`/api/reports/curricular-subjects?groupId=${group.id}&cycleId=${group.cycle_id}&semester=1`)
      .set("Authorization", `Bearer ${token}`);
    expect(manualPriority.body.find((row: any) => row.id === subject.id)?.status).toBe("pending");

    const settings = await request(app).get("/api/settings").set("Authorization", `Bearer ${token}`);
    expect(settings.body.calendarEvents.some((item: any) => item.title === "Inicio de clases de prueba")).toBe(true);
    await request(app)
      .delete(`/api/settings/calendar-events/${event.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
  });

  it("uses the group's active cycle when assigning subjects without evaluation periods", async () => {
    const group = db.prepare(
      "SELECT id, active_cycle_id, plan_id FROM groups WHERE name = '1A' ORDER BY id LIMIT 1"
    ).get() as any;
    const enrollment = db.prepare(
      "SELECT plan_id FROM enrollments WHERE group_id = ? AND is_active = 1 ORDER BY id LIMIT 1"
    ).get(group.id) as any;
    const planId = group.plan_id ?? enrollment.plan_id;
    const subject = db.prepare(
      "SELECT subject_id FROM plan_subjects WHERE plan_id = ? ORDER BY id LIMIT 1"
    ).get(planId) as any;
    expect(group).toBeTruthy();
    expect(planId).toBeTruthy();
    expect(subject).toBeTruthy();

    const newCycle = await request(app)
      .post("/api/catalogs/cycles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ciclo sin periodos para asignación", start_date: "2028-08-10", end_date: "2029-07-31" });
    expect(newCycle.status).toBe(201);
    db.prepare("UPDATE groups SET active_cycle_id = ? WHERE id = ?").run(newCycle.body.id, group.id);

    try {
      const assigned = await request(app)
        .post("/api/reports/curricular-subjects/bulk")
        .set("Authorization", `Bearer ${token}`)
        .send({
          groupId: group.id,
          planId,
          cycleId: group.active_cycle_id,
          semester: 1,
          subjectIds: [subject.subject_id],
          status: "in_progress"
        });
      expect(assigned.status).toBe(201);

      const period = db.prepare(
        "SELECT id FROM academic_periods WHERE cycle_id = ? AND is_active = 1 LIMIT 1"
      ).get(newCycle.body.id) as any;
      expect(period).toBeTruthy();
      expect(period.id).toBeTruthy();

      const curricular = db.prepare(
        "SELECT id FROM student_subjects WHERE school_cycle_id = ? AND subject_id = ? LIMIT 1"
      ).get(newCycle.body.id, subject.subject_id) as any;
      expect(curricular).toBeTruthy();
    } finally {
      db.prepare("UPDATE groups SET active_cycle_id = ? WHERE id = ?").run(group.active_cycle_id, group.id);
    }
  });
});
