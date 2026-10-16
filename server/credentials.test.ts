import { afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import request from "supertest";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { credentialSvg, fitCredentialText } from "../shared/credential-artwork.js";
import { credentialDimensions, type CredentialSnapshot } from "../shared/credentials.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifop-credentials-"));
process.env.DATABASE_PATH = path.join(directory, "school.db");
process.env.JWT_SECRET = "synthetic-credentials-test";
const { app } = await import("./app.js");
const { all, db, get, run } = await import("./db.js");
const { loadUser, signToken } = await import("./auth.js");
const { credentialFile, credentialToday, getCredentialState, latestCredentialIssue, sixMonthsAfter } = await import("./services/credentials.js");
const admin = get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador' LIMIT 1")!.id;
const auth = () => `Bearer ${signToken(loadUser(admin)!)}`;
run("UPDATE institution_settings SET public_app_url='https://escuela.example.test' WHERE id=1");
afterAll(() => { vi.useRealTimers(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
const jpeg = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#dce4f2" } }).jpeg({ quality: 98 }).toBuffer();
const hash = (buffer: Buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
let sequence = 0;
function fixture() {
  const n = ++sequence, today = credentialToday();
  const insert = (sql: string, ...args: (string | number | null)[]) => Number(run(sql, ...args).lastInsertRowid);
  const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 95);
  const cycle = insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,?,?)", `Ciclo credencial ${n}`, today, end.toISOString().slice(0, 10));
  const program = get<{id:number}>("SELECT id FROM programs LIMIT 1")!.id;
  const shift = get<{id:number}>("SELECT id FROM shifts LIMIT 1")!.id;
  const group = insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id) VALUES(?,?,?,?,?)", `Credencial ${n}`, program, shift, cycle, cycle);
  const student = insert("INSERT INTO students(student_number,first_name,last_name,second_last_name,status_id,email,phone) VALUES(?,?,?,?,(SELECT id FROM student_statuses WHERE is_terminal=0 LIMIT 1),?,?)", `CRED-${n}`, "María Fernanda", "Hernández", `de los Ángeles ${n}`, "private@example.invalid", "555-PRIVATE");
  const enrollment = insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id) VALUES(?,?,?,?,?)", student, program, shift, group, cycle);
  const user = insert("INSERT INTO users(full_name,email,password_hash,role_id,student_id) VALUES(?,?,?,(SELECT id FROM roles WHERE name='Alumno'),?)", `Estudiante ${n}`, `credencial${n}@example.invalid`, "unused-synthetic", student);
  return { student, cycle, group, enrollment, user, auth: () => `Bearer ${signToken(loadUser(user)!)}` };
}
const adminGet = (url: string) => request(app).get(`/api/credentials${url}`).set("Authorization", auth());
const post = (id: number, action: string, body: object) => request(app).post(`/api/credentials/students/${id}/${action}`).set("Authorization", auth()).send(body);
async function photo(student: number, image = jpeg, revision = getCredentialState(student).revision) {
  return request(app).post(`/api/credentials/students/${student}/photo`).set("Authorization", auth()).field("revision", String(revision)).attach("photo", image, "foto.jpg");
}
async function activate(student: number) { return post(student, "activate", { revision: getCredentialState(student).revision }); }
function binary(res: any, callback: any) {
  const chunks: Buffer[] = []; res.on("data", (b: Buffer) => chunks.push(b)); res.on("end", () => callback(null, Buffer.concat(chunks)));
}
async function pdfText(buffer: Buffer) {
  const worker = new Worker(new URL("./services/pdf-reader-worker.mjs", import.meta.url), { workerData: buffer, execArgv: [] });
  try {
    const result: any = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    expect(result.error).toBeUndefined();
    return result.pages.map((page: any) => page.matrix.flat().join(" ").replace(/\s+/g, " ")) as string[];
  } finally { await worker.terminate(); }
}

async function legacyMaskedPdf(snapshot: CredentialSnapshot) {
  const doc = new PDFDocument({ autoFirstPage: false }), chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(Buffer.from(chunk))); doc.once("error", reject); doc.once("end", () => resolve(Buffer.concat(chunks)));
  });
  const size = credentialDimensions(snapshot.template.size), width = size.width * 72 / 25.4, height = size.height * 72 / 25.4;
  const logo = `data:image/jpeg;base64,${fs.readFileSync("public/assets/campus-frontera.jpg").toString("base64")}`;
  const photo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const measure = (text: string, size: number, bold: boolean) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).widthOfString(text);
  for (const side of ["front", "back"] as const) {
    doc.addPage({ size: [width, height], margin: 0 });
    SVGtoPDF(doc as unknown as typeof PDFDocument, credentialSvg(snapshot, side, { logo, photo }, measure), 0, 0, { width, height, assumePt: true });
  }
  doc.end(); return completed;
}

describe("Student credentials", () => {
  it("grants administration to school staff while protecting the full roster and private images", async () => {
    const f = fixture();
    await request(app).get("/api/credentials/students").expect(401);
    await request(app).get("/api/credentials/students").set("Authorization", f.auth()).expect(403);
    for (const name of ["Administrador", "Control escolar", "Coordinador académico"]) {
      const role = get<{id:number}>("SELECT id FROM roles WHERE name=?", name);
      if (role) expect(get("SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.code='credentials.manage'", role.id)).toBeTruthy();
    }
    for (const name of ["Alumno", "Docente"]) expect(get("SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id JOIN roles r ON r.id=rp.role_id WHERE r.name=? AND p.code='credentials.manage'", name)).toBeUndefined();
    const result = await adminGet(`/students?search=${getCredentialState(f.student).student.number}`);
    expect(result.body.records).toHaveLength(1); expect(result.body.records[0].id).toBe(f.student);
    expect(JSON.stringify(result.body)).not.toMatch(/private@example|555-PRIVATE/);
  });

  it("requires an original photo and administrative activation before any student download", async () => {
    const f = fixture();
    expect((await adminGet(`/students/${f.student}`)).body.status).toBe("missing_photo");
    await post(f.student, "activate", { revision: 0 }).expect(409);
    await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).expect(403);
    const saved = await photo(f.student); expect(saved.status).toBe(200);
    expect(saved.body.status).toBe("draft"); expect(saved.body.photo).toMatchObject({ width: 1200, height: 1600, sha256: hash(jpeg) });
    const file = get<{photo_file:string}>("SELECT photo_file FROM student_credentials WHERE student_id=?", f.student)!.photo_file;
    expect(fs.readFileSync(credentialFile(file))).toEqual(jpeg);
    await request(app).get(`/uploads/credentials/${file}`).expect(404);
    await request(app).get("/api/portal/credential/photo").set("Authorization", f.auth()).expect(403);
    await photo(f.student, Buffer.from("<svg onload='alert(1)'/>"), saved.body.revision).then(response => expect(response.status).toBe(400));
    expect(getCredentialState(f.student).revision).toBe(saved.body.revision);
  });

  it("searches the complete roster without requiring accents and paginates beyond the initial results", async () => {
    run(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<80)
      INSERT INTO students(student_number,first_name,last_name,status_id)
      SELECT 'PAD-'||n,'Lucía','Credencial paginada '||n,(SELECT id FROM student_statuses WHERE is_terminal=0 LIMIT 1) FROM numbers`);
    const page = await adminGet("/students?search=lucia%20credencial%20paginada&page=3").expect(200);
    expect(page.body).toMatchObject({ total: 80, page: 3, pages: 3 }); expect(page.body.records).toHaveLength(20);
    const exact = await adminGet("/students?search=PAD-80").expect(200);
    expect(exact.body.records[0].student_number).toBe("PAD-80");
  });

  it("preserves orientation and accepts decoded PNG and WebP images rather than trusting file names", async () => {
    const f = fixture();
    const oriented = await sharp(jpeg).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await photo(f.student, oriented); expect(result.status).toBe(200);
    expect(result.body.photo).toMatchObject({ width: 1600, height: 1200, sha256: hash(oriented) });
    for (const image of [await sharp(jpeg).png().toBuffer(), await sharp(jpeg).webp({ lossless: true }).toBuffer()]) {
      expect((await photo(f.student, image)).status).toBe(200);
    }
    const invalid = await photo(f.student, jpeg.subarray(0, 150)); expect(invalid.status).toBe(400);
  });

  it("binds the QR to the approved student, photo, dates and immutable PDF, identically for staff and the owner", async () => {
    const f = fixture(); await photo(f.student);
    const result = await activate(f.student); expect(result.status).toBe(200); expect(result.body.canDownload).toBe(true);
    expect(result.body.student.number).toBe(`CRED-${sequence}`);
    const issue = latestCredentialIssue(f.student)!;
    const verified = await request(app).get(`/api/credentials/verify/${issue.token}`).set("Authorization", "Bearer expired").expect(200);
    expect(verified.body.status).toBe("active"); expect(verified.body.document.student.name).toBe(result.body.student.name);
    expect(verified.body.document.validity.validUntil).toBe(getCredentialState(f.student).validity!.validUntil);
    expect(verified.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(verified.body)).not.toMatch(/private@example|555-PRIVATE|birth_date|curp/);
    const staff = await adminGet(`/students/${f.student}/pdf`).buffer(true).parse(binary).expect(200);
    const own = await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).buffer(true).parse(binary).expect(200);
    expect(staff.body).toEqual(own.body); expect(staff.body).toEqual(fs.readFileSync(credentialFile(issue.card_file)));
    const raw = staff.body.toString("latin1"); expect(raw).toContain(issue.verification_url);
    expect(raw.startsWith("%PDF-1.7")).toBe(true);
    expect(raw).not.toContain("/Luminosity");
    expect(raw).toContain("/Width 1200"); expect(raw).toContain("/Height 1600"); expect(staff.body.includes(jpeg)).toBe(true);
    const pages = await pdfText(staff.body); expect(pages).toHaveLength(2);
    expect(pages[0]).toContain(result.body.student.name.toLocaleUpperCase("es-MX")); expect(pages[0]).toContain(result.body.student.number);
    expect(pages[0]).toContain("VIGENCIA:"); expect(pages[1]).toContain(issue.folio); expect(pages[1]).toContain(result.body.validity.cycle);
    const boxes = [...raw.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)]; expect(boxes).toHaveLength(2);
    for (const box of boxes) { expect(Number(box[1])).toBeCloseTo(50 * 72 / 25.4, 3); expect(Number(box[2])).toBeCloseTo(75 * 72 / 25.4, 3); }
    const letter = await adminGet(`/students/${f.student}/pdf?layout=letter`).buffer(true).parse(binary).expect(200);
    expect(await pdfText(letter.body)).toHaveLength(1); expect(letter.body.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
    expect(() => run("UPDATE credential_issues SET snapshot_json='{}' WHERE id=?", issue.id)).toThrow(/inmutable/);
    await request(app).get(verified.body.photoUrl).expect(200);
  }, 15_000);

  it("repairs an already active PDF on download without changing its approved data, QR, dates or original archive", async () => {
    const f = fixture(); await photo(f.student); await activate(f.student);
    const previous = latestCredentialIssue(f.student)!, snapshot = JSON.parse(previous.snapshot_json) as CredentialSnapshot;
    const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString("hex"), folio = `CEST-LEGACY-${sequence}`;
    const verificationUrl = `https://escuela.example.test/verificar-credencial/${token}`;
    snapshot.folio = folio;
    const legacy = await legacyMaskedPdf(snapshot), json = JSON.stringify(snapshot);
    expect(legacy.toString("latin1")).toContain("/Luminosity");
    const card = `issues/${id}-card.pdf`, print = `issues/${id}-print.pdf`;
    fs.writeFileSync(credentialFile(card), legacy); fs.writeFileSync(credentialFile(print), legacy);
    run("UPDATE credential_issues SET revoked_at=? WHERE id=?", new Date().toISOString(), previous.id);
    run(`INSERT INTO credential_issues(id,token,folio,student_id,photo_file,card_file,print_file,snapshot_json,snapshot_hash,verification_url,issued_by,issued_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, token, folio, f.student, previous.photo_file, card, print, json, hash(Buffer.from(json)), verificationUrl, admin, previous.issued_at);
    const before = getCredentialState(f.student);
    const downloaded = await Promise.all(Array.from({ length: 3 }, () => adminGet(`/students/${f.student}/pdf`).buffer(true).parse(binary).expect(200)));
    for (const response of downloaded) {
      expect(response.body.toString("latin1").startsWith("%PDF-1.7")).toBe(true);
      expect(response.body.toString("latin1")).not.toContain("/Luminosity");
      expect(response.body.toString("latin1")).toContain(verificationUrl);
      expect(response.body.includes(jpeg)).toBe(true);
      expect(response.body).toEqual(downloaded[0].body);
    }
    const own = await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).buffer(true).parse(binary).expect(200);
    expect(own.body).toEqual(downloaded[0].body);
    const letter = await adminGet(`/students/${f.student}/pdf?layout=letter`).buffer(true).parse(binary).expect(200);
    expect(letter.body.toString("latin1")).not.toContain("/Luminosity");
    expect(letter.body.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
    expect(fs.readFileSync(credentialFile(card))).toEqual(legacy);
    expect(fs.readFileSync(credentialFile(print))).toEqual(legacy);
    expect(latestCredentialIssue(f.student)).toMatchObject({ id, token, folio, card_file: card, print_file: print, snapshot_json: json });
    expect(getCredentialState(f.student)).toEqual(before);
    expect((await request(app).get(`/api/credentials/verify/${token}`)).body).toMatchObject({ status: "active", document: { folio, issuedAt: snapshot.issuedAt, validity: snapshot.validity } });
    await post(f.student, "deactivate", { revision: before.revision }).expect(200);
    await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).expect(403);
  }, 15_000);

  it("embeds a transparent PNG photograph and signature without SVG luminosity masks", async () => {
    const f = fixture();
    const portrait = await sharp({ create: { width: 1200, height: 1600, channels: 4, background: { r: 160, g: 180, b: 210, alpha: .6 } } }).png().toBuffer();
    const signature = await sharp({ create: { width: 800, height: 200, channels: 4, background: { r: 20, g: 30, b: 60, alpha: .5 } } }).png().toBuffer();
    const template = (await adminGet("/template")).body;
    const saved = await request(app).post("/api/credentials/template/signature").set("Authorization", auth()).field("version", String(template.version)).attach("signature", signature, "firma.png").expect(200);
    try {
      await photo(f.student, portrait); await activate(f.student);
      const pdf = await adminGet(`/students/${f.student}/pdf`).buffer(true).parse(binary).expect(200);
      const raw = pdf.body.toString("latin1");
      expect(raw.startsWith("%PDF-1.7")).toBe(true);
      expect(raw).not.toContain("/Luminosity"); expect(raw).toContain("/SMask");
      expect(raw).toContain("/Width 1200"); expect(raw).toContain("/Height 1600");
      expect(raw).toContain("/Width 800"); expect(raw).toContain("/Height 200");
    } finally {
      await request(app).delete("/api/credentials/template/signature").set("Authorization", auth()).send({ version: saved.body.version }).expect(200);
    }
  });

  it("always resolves a portal download from its authenticated student, even with another student ID", async () => {
    const a = fixture(), b = fixture(); await photo(a.student); await photo(b.student); await activate(a.student); await activate(b.student);
    const result = await request(app).get(`/api/portal/credential.pdf?studentId=${b.student}`).set("Authorization", a.auth()).buffer(true).parse(binary).expect(200);
    expect(result.body).toEqual(fs.readFileSync(credentialFile(latestCredentialIssue(a.student)!.card_file)));
    await request(app).get(`/api/credentials/students/${b.student}/pdf`).set("Authorization", a.auth()).expect(403);
    await request(app).get(`/api/credentials/students/${b.student}/photo`).set("Authorization", a.auth()).expect(403);
  });

  it("uses the group's active cycle rather than its original enrollment and caps validity to six calendar months", async () => {
    const f = fixture();
    const original = Number(run("INSERT INTO school_cycles(name,start_date,end_date) VALUES('Ciclo original credencial','2024-01-01','2024-06-30')").lastInsertRowid);
    run("UPDATE groups SET cycle_id=? WHERE id=?", original, f.group); run("UPDATE enrollments SET cycle_id=? WHERE id=?", original, f.enrollment);
    expect(getCredentialState(f.student).validity!.cycleId).toBe(f.cycle);
    const year = Number(credentialToday().slice(0, 4)) + 2;
    run("UPDATE school_cycles SET end_date=? WHERE id=?", `${year}-12-31`, f.cycle);
    await photo(f.student); const result = await activate(f.student); expect(result.status).toBe(200);
    expect(result.body.issue.snapshot.validity.validUntil).toBe(sixMonthsAfter(credentialToday()));
    expect(sixMonthsAfter("2026-08-31")).toBe("2027-02-28"); expect(sixMonthsAfter("2027-08-31")).toBe("2028-02-29");
    await post(f.student, "activate", { revision: result.body.revision, validUntil: `${year}-12-31` }).expect(400);
  });

  it("will not activate credentials for a past, future or invalid cycle or a student without active enrollment", async () => {
    const f = fixture(); await photo(f.student);
    for (const [start, end] of [["2020-01-01", "2020-06-30"], ["2099-01-01", "2099-06-30"], ["bad-date", "2099-06-30"]]) {
      run("UPDATE school_cycles SET start_date=?,end_date=? WHERE id=?", start, end, f.cycle);
      expect((await activate(f.student)).status).toBe(409);
    }
    run("UPDATE school_cycles SET start_date=?,end_date=? WHERE id=?", credentialToday(), sixMonthsAfter(credentialToday()), f.cycle);
    run("UPDATE enrollments SET is_active=0 WHERE id=?", f.enrollment); expect((await activate(f.student)).status).toBe(409);
    expect(latestCredentialIssue(f.student)).toBeUndefined();
  });

  it("expires QR validity and downloads after the approved closing date", async () => {
    const f = fixture(); await photo(f.student); await activate(f.student); const issue = latestCredentialIssue(f.student)!;
    const end = getCredentialState(f.student).issue!.snapshot.validity!.validUntil;
    try {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${end}T18:00:00Z`));
      expect((await request(app).get(`/api/credentials/verify/${issue.token}`)).body.status).toBe("active");
      vi.setSystemTime(new Date(new Date(`${end}T18:00:00Z`).getTime() + 86_400_000));
      const result = await request(app).get(`/api/credentials/verify/${issue.token}`).expect(200);
      expect(result.body.status).toBe("expired"); expect(result.body.photoUrl).toBeNull();
      await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).expect(403);
      await request(app).get(`/api/credentials/verify/${issue.token}/photo`).expect(403);
    } finally { vi.useRealTimers(); }
  });

  it("revokes old QR tokens when the photo or saved framing changes, and requires reactivation", async () => {
    const f = fixture(); await photo(f.student); await activate(f.student); const old = latestCredentialIssue(f.student)!;
    const saved = await request(app).patch(`/api/credentials/students/${f.student}`).set("Authorization", auth()).send({ revision: getCredentialState(f.student).revision, zoom: 1.6, cropX: .4 }).expect(200);
    expect(saved.body.status).toBe("draft"); expect(saved.body.canDownload).toBe(false);
    expect((await request(app).get(`/api/credentials/verify/${old.token}`)).body.status).toBe("revoked");
    await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).expect(403);
    await activate(f.student); const renewed = latestCredentialIssue(f.student)!; expect(renewed.token).not.toBe(old.token);
    await photo(f.student); expect(getCredentialState(f.student).status).toBe("draft");
    expect((await request(app).get(`/api/credentials/verify/${renewed.token}`)).body.status).toBe("revoked");
    await activate(f.student); const current = latestCredentialIssue(f.student)!;
    await post(f.student, "deactivate", { revision: getCredentialState(f.student).revision }).expect(200);
    expect(getCredentialState(f.student).status).toBe("revoked");
    expect((await request(app).get(`/api/credentials/verify/${current.token}`)).body.status).toBe("revoked");
  });

  it("blocks conflicting edits, invalid framing and unrecognized or damaged verification records", async () => {
    const f = fixture(); const first = await photo(f.student);
    await photo(f.student, jpeg, 0).then(response => expect(response.status).toBe(409));
    for (const zoom of [0, 4, "NaN"]) await post(f.student, "activate", { revision: first.body.revision, zoom }).expect(400);
    await post(f.student, "activate", { revision: first.body.revision, templateVersion: 999 }).expect(409);
    await activate(f.student); const issue = latestCredentialIssue(f.student)!;
    await post(f.student, "activate", { revision: first.body.revision }).expect(409);
    await request(app).get("/api/credentials/verify/unknown").expect(404);
    await request(app).get(`/api/credentials/verify/${"f".repeat(48)}`).expect(404);
    run("UPDATE credential_issues SET revoked_at=? WHERE id=?", new Date().toISOString(), issue.id);
    run(`INSERT INTO credential_issues(id,token,folio,student_id,photo_file,card_file,print_file,snapshot_json,snapshot_hash,verification_url,issued_at)
      SELECT 'damaged',?,folio||'-BROKEN',student_id,photo_file,card_file,print_file,snapshot_json,'bad',verification_url,issued_at FROM credential_issues WHERE id=?`, "e".repeat(48), issue.id);
    await request(app).get(`/api/credentials/verify/${"e".repeat(48)}`).expect(409);
  });

  it("requires a new approval if the student's identity, cycle or enrollment changes", async () => {
    const f = fixture(); await photo(f.student); await activate(f.student); const issue = latestCredentialIssue(f.student)!;
    run("UPDATE students SET first_name='Identidad corregida' WHERE id=?", f.student);
    expect((await request(app).get(`/api/credentials/verify/${issue.token}`)).body.status).toBe("needs_review");
    await adminGet(`/students/${f.student}/pdf`).expect(403);
    await activate(f.student); run("UPDATE school_cycles SET end_date=? WHERE id=?", sixMonthsAfter(credentialToday()), f.cycle);
    expect(getCredentialState(f.student).status).toBe("needs_review");
    await activate(f.student); run("UPDATE enrollments SET is_active=0 WHERE id=?", f.enrollment);
    expect(getCredentialState(f.student).status).toBe("inactive");
  });

  it.each(["IFOP", "UNITEN"])("displays only the degree for the %s program in previews, downloads and QR without losing identity checks", async institution => {
    const f = fixture(), name = `Licenciatura en Enfermería ${institution}`;
    const program = Number(run("INSERT INTO programs(code,name) VALUES(?,?)", `DISPLAY-${sequence}`, name).lastInsertRowid);
    run("UPDATE groups SET program_id=? WHERE id=?", program, f.group);
    run("UPDATE enrollments SET program_id=? WHERE id=?", program, f.enrollment);
    expect(getCredentialState(f.student).student.program).toBe("Licenciatura en Enfermería");
    await photo(f.student);
    const preview = await adminGet(`/students/${f.student}/preview.pdf`).buffer(true).parse(binary).expect(200);
    expect((await pdfText(preview.body))[0]).toContain("LICENCIATURA EN ENFERMERÍA");
    const activated = await activate(f.student);
    expect(activated.status).toBe(200); expect(activated.body.canDownload).toBe(true);
    expect(activated.body.issue.snapshot.student.program).toBe("Licenciatura en Enfermería");
    const issue = latestCredentialIssue(f.student)!;
    expect(JSON.parse(issue.snapshot_json).student.program).toBe(name);
    expect((await request(app).get(`/api/credentials/verify/${issue.token}`).expect(200)).body.document.student.program).toBe("Licenciatura en Enfermería");
    for (const layout of ["card", "letter"]) {
      const downloaded = await adminGet(`/students/${f.student}/pdf?layout=${layout}`).buffer(true).parse(binary).expect(200);
      const pages = await pdfText(downloaded.body);
      expect(pages[0]).toContain("LICENCIATURA EN ENFERMERÍA");
      expect(pages.join(" ")).not.toMatch(/ENFERMERÍA\s+(?:IFOP|UNITEN)/);
    }
    run("UPDATE programs SET name=? WHERE id=?", `Licenciatura en Enfermería ${institution === "IFOP" ? "UNITEN" : "IFOP"}`, program);
    expect(getCredentialState(f.student).status).toBe("needs_review");
    await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).expect(403);
  }, 20_000);

  it("cleans program labels in already approved v2 downloads while retaining the original snapshot, QR and approval", async () => {
    const f = fixture(), name = "Licenciatura en Enfermería UNITEN";
    const program = Number(run("INSERT INTO programs(code,name) VALUES(?,?)", `OLD-DISPLAY-${sequence}`, name).lastInsertRowid);
    run("UPDATE groups SET program_id=? WHERE id=?", program, f.group);
    run("UPDATE enrollments SET program_id=? WHERE id=?", program, f.enrollment);
    await photo(f.student); await activate(f.student);
    const previous = latestCredentialIssue(f.student)!, snapshot = JSON.parse(previous.snapshot_json) as CredentialSnapshot;
    const id = crypto.randomUUID(), token = crypto.randomBytes(24).toString("hex"), folio = `CEST-V2-${sequence}`;
    snapshot.folio = folio;
    const url = `https://escuela.example.test/verificar-credencial/${token}`;
    const legacyDoc = new PDFDocument(), chunks: Buffer[] = [];
    const legacyCompleted = new Promise<Buffer>(resolve => {
      legacyDoc.on("data", chunk => chunks.push(Buffer.from(chunk)));
      legacyDoc.on("end", () => resolve(Buffer.concat(chunks)));
    });
    legacyDoc.text(name.toLocaleUpperCase("es-MX")); legacyDoc.end();
    const original = await legacyCompleted;
    const card = `issues/${id}-card-v2.pdf`, print = `issues/${id}-print-v2.pdf`;
    fs.writeFileSync(credentialFile(card), original); fs.writeFileSync(credentialFile(print), original);
    const json = JSON.stringify(snapshot), fingerprint = hash(Buffer.from(json));
    run("UPDATE credential_issues SET revoked_at=? WHERE id=?", new Date().toISOString(), previous.id);
    run(`INSERT INTO credential_issues(id,token,folio,student_id,photo_file,card_file,print_file,snapshot_json,snapshot_hash,verification_url,issued_by,issued_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, token, folio, f.student, previous.photo_file, card, print, json, fingerprint, url, admin, previous.issued_at);
    expect(getCredentialState(f.student)).toMatchObject({ status: "active", canDownload: true, issue: { folio, snapshot: { student: { program: "Licenciatura en Enfermería" } } } });
    const staff = await adminGet(`/students/${f.student}/pdf`).buffer(true).parse(binary).expect(200);
    const own = await request(app).get("/api/portal/credential.pdf").set("Authorization", f.auth()).buffer(true).parse(binary).expect(200);
    expect(own.body).toEqual(staff.body); expect(staff.body).not.toEqual(original);
    const letter = await adminGet(`/students/${f.student}/pdf?layout=letter`).buffer(true).parse(binary).expect(200);
    for (const buffer of [staff.body, letter.body]) {
      const text = (await pdfText(buffer)).join(" ");
      expect(text).toContain("LICENCIATURA EN ENFERMERÍA"); expect(text).not.toContain("UNITEN");
      expect(buffer.toString("latin1")).toContain(url);
    }
    const verified = await request(app).get(`/api/credentials/verify/${token}`).expect(200);
    expect(verified.body).toMatchObject({ status: "active", verificationUrl: url, document: { folio, issuedAt: snapshot.issuedAt, validity: snapshot.validity, student: { program: "Licenciatura en Enfermería" } } });
    expect(latestCredentialIssue(f.student)).toMatchObject({ id, token, folio, snapshot_json: json, snapshot_hash: fingerprint, issued_at: previous.issued_at, revoked_at: null });
    expect(fs.readFileSync(credentialFile(card))).toEqual(original); expect(fs.readFileSync(credentialFile(print))).toEqual(original);
  }, 20_000);

  it("keeps approved PDFs unchanged when the design changes and applies customization on the next activation", async () => {
    const f = fixture(); await photo(f.student); await activate(f.student); const issue = latestCredentialIssue(f.student)!;
    const original = fs.readFileSync(credentialFile(issue.card_file));
    const template = (await adminGet("/template")).body;
    const updated = await request(app).patch("/api/credentials/template").set("Authorization", auth()).send({ version: template.version, size: "standard", primaryColor: "#193B49", sideLabel: "CAMPUS PERSONALIZADO", signatureFile: "../../secrets" }).expect(200);
    expect(updated.body.signatureFile).toBeNull();
    await request(app).patch("/api/credentials/template").set("Authorization", auth()).send({ version: template.version, primaryColor: "red" }).expect(409);
    expect((await adminGet(`/students/${f.student}/pdf`).buffer(true).parse(binary)).body).toEqual(original);
    await activate(f.student); const next = latestCredentialIssue(f.student)!;
    expect(JSON.parse(next.snapshot_json).template.sideLabel).toBe("CAMPUS PERSONALIZADO");
    expect(fs.readFileSync(credentialFile(next.card_file)).toString("latin1")).toContain("/MediaBox [0 0 153.070866 242.645669]");
    expect((await request(app).get(`/api/credentials/verify/${issue.token}`)).body.status).toBe("revoked");
  });

  it("fits long names inside a centered, fixed text area and escapes all SVG content", () => {
    const f = fixture(), state = getCredentialState(f.student), doc = new PDFDocument({ autoFirstPage: false });
    const measure = (value: string, size: number, bold: boolean) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).widthOfString(value);
    const name = "MARÍA FERNANDA DE LOS ÁNGELES HERNÁNDEZ DE LA CRUZ Y MONTENEGRO";
    const fit = fitCredentialText(name, 675, 100, 44, measure, true);
    expect(fit.lines.join(" ")).toBe(name); expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(100);
    for (const line of fit.lines) expect(measure(line, fit.size, true)).toBeLessThanOrEqual(675);
    const svg = credentialSvg({ student: { ...state.student, name: '<script>alert("x")</script>' }, template: { ...state.template, sideLabel: "FRANJA INSTITUCIONAL EXTENSA CON TEXTO PERSONALIZADO" }, framing: state.framing, photo: { width: 600, height: 600, sha256: "" }, issuedAt: "", folio: "BORRADOR", validity: state.validity }, "front", {}, measure, true);
    expect(svg).not.toContain("<script>"); expect(svg).toContain("&lt;script&gt;");
    expect(all("PRAGMA foreign_key_check")).toHaveLength(0); doc.end();
  });
});
