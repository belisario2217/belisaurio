import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"ifop-photo-review-"));
process.env.DATABASE_PATH=path.join(root,"school.db");process.env.JWT_SECRET="synthetic-photo-review";
const {app}=await import("./app.js");
const {db,get,run,all}=await import("./db.js");
const {loadUser,signToken}=await import("./auth.js");
const {credentialFile,credentialToday,getCredentialState,latestCredentialIssue,approveCredentialPhoto,rejectCredentialPhoto,submitCredentialPhoto}=await import("./services/credentials.js");
const {prepareCredentialPhoto}=await import("./services/credential-photo-preparation.js");
const admin=get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador' LIMIT 1")!.id;
const staff=`Bearer ${signToken(loadUser(admin)!)}`;
run("UPDATE institution_settings SET public_app_url='https://escuela.example.test' WHERE id=1");
afterAll(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
const portrait=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1066"><rect width="800" height="1066" fill="#d9d9d9"/><path d="M100 1066V850Q400 640 700 850V1066" fill="white"/><ellipse cx="400" cy="440" rx="170" ry="230" fill="#a3623e"/><path d="M230 360Q190 170 400 170Q610 170 570 360Q400 260 230 360" fill="#242222"/></svg>')).jpeg({quality:98}).toBuffer();
let counter=0;
function fixture(){
  const n=++counter,day=credentialToday(),end=new Date(`${day}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+100);
  const insert=(sql:string,...args:(string|number|null)[])=>Number(run(sql,...args).lastInsertRowid);
  const cycle=insert("INSERT INTO school_cycles(name,start_date,end_date) VALUES(?,?,?)",`Foto ${n}`,day,end.toISOString().slice(0,10));
  const program=get<{id:number}>("SELECT id FROM programs LIMIT 1")!.id,shift=get<{id:number}>("SELECT id FROM shifts LIMIT 1")!.id;
  const group=insert("INSERT INTO groups(name,program_id,shift_id,cycle_id,active_cycle_id) VALUES(?,?,?,?,?)",`Foto ${n}`,program,shift,cycle,cycle);
  const student=insert("INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,?,?,(SELECT id FROM student_statuses WHERE is_terminal=0 LIMIT 1))",`FOTO-${n}`,"Estudiante",`Prueba ${n}`);
  insert("INSERT INTO enrollments(student_id,program_id,shift_id,group_id,cycle_id) VALUES(?,?,?,?,?)",student,program,shift,group,cycle);
  const user=insert("INSERT INTO users(full_name,email,password_hash,role_id,student_id) VALUES(?,?,?,(SELECT id FROM roles WHERE name='Alumno'),?)",`Estudiante ${n}`,`photo-${n}@example.invalid`,"synthetic-only",student);
  return {student,user,auth:`Bearer ${signToken(loadUser(user)!)}`};
}
function send(f:ReturnType<typeof fixture>,buffer=portrait,fields:Record<string,string>={}){
  return request(app).post("/api/portal/credential/photo-submission").set("Authorization",f.auth)
    .field({requirementsAccepted:"true",previousId:getCredentialState(f.student).submission?.id||"",...fields}).attach("photo",buffer,"selfie.jpg");
}
const reviewBody=(student:number)=>({revision:getCredentialState(student).revision,templateVersion:getCredentialState(student).template.version,requirementsAccepted:true,variant:"prepared",cropX:.5,cropY:.5,zoom:1});
const approve=(f:ReturnType<typeof fixture>,body=reviewBody(f.student))=>request(app).post(`/api/credentials/students/${f.student}/submissions/${getCredentialState(f.student).submission!.id}/approve`).set("Authorization",staff).send(body);
async function existingCredential(f:ReturnType<typeof fixture>){
  await request(app).post(`/api/credentials/students/${f.student}/photo`).set("Authorization",staff).field("revision","0").attach("photo",portrait,"foto.jpg").expect(200);
  await request(app).post(`/api/credentials/students/${f.student}/activate`).set("Authorization",staff).send({revision:getCredentialState(f.student).revision}).expect(200);
  return latestCredentialIssue(f.student)!;
}
function binary(response:any,callback:any){const chunks:Buffer[]=[];response.on("data",(chunk:Buffer)=>chunks.push(chunk));response.on("end",()=>callback(null,Buffer.concat(chunks)));}

describe("Student credential photo review",()=>{
  it("requires an authenticated linked active student, valid image and confirmation",async()=>{
    const f=fixture();
    await request(app).post("/api/portal/credential/photo-submission").expect(401);
    await send(f,portrait,{requirementsAccepted:"false"}).expect(400);
    await send(f,Buffer.from("invalid image")).expect(400);
    await send(f,await sharp({create:{width:100,height:100,channels:3,background:"white"}}).png().toBuffer()).expect(400);
    await send(f,Buffer.alloc(10*1024*1024+1)).expect(400);
    run("UPDATE students SET is_active=0 WHERE id=?",f.student);await send(f).expect(403);
    expect(getCredentialState(f.student).submission).toBeNull();
  });
  it("lightens neutral background pixels while preserving dimensions and the face's appearance",async()=>{
    const result=await prepareCredentialPhoto(portrait);
    expect(result.processing.adjusted).toBe(true);
    const original=await sharp(result.original).raw().toBuffer({resolveWithObject:true}),prepared=await sharp(result.prepared).raw().toBuffer({resolveWithObject:true});
    expect(prepared.info).toMatchObject({width:800,height:1066});
    expect(prepared.data[20*3]).toBeGreaterThan(248);
    const index=(440*800+400)*3;
    for(let channel=0;channel<3;channel++)expect(Math.abs(prepared.data[index+channel]-original.data[index+channel])).toBeLessThan(8);
    const pale=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1066"><rect width="800" height="1066" fill="#dedede"/><ellipse cx="400" cy="440" rx="170" ry="230" fill="#e1d4cc"/></svg>')).jpeg({quality:98}).toBuffer();
    const lightSkin=await prepareCredentialPhoto(pale),skinBefore=await sharp(lightSkin.original).raw().toBuffer(),skinAfter=await sharp(lightSkin.prepared).raw().toBuffer();
    for(let channel=0;channel<3;channel++)expect(Math.abs(skinBefore[index+channel]-skinAfter[index+channel])).toBeLessThan(8);
    const unchanged=await prepareCredentialPhoto(portrait,false);expect(unchanged.prepared).toEqual(unchanged.original);expect(unchanged.processing.adjusted).toBe(false);
  });
  it("keeps submissions private, binds them to the owner and does not issue an unreviewed credential",async()=>{
    const f=fixture(),other=fixture();const response=await send(f,portrait,{studentId:String(other.student)}).expect(200);
    expect(response.body.student.id).toBe(f.student);expect(response.body.canDownload).toBe(false);expect(response.body.issue).toBeNull();
    expect(response.body.submission).toMatchObject({status:"pending",photo:{width:800,height:1066},framing:{cropX:.5,cropY:.5,zoom:1}});
    expect(getCredentialState(other.student).submission).toBeNull();
    const image=await request(app).get(`/api/portal/credential/photo-submission/photo?studentId=${other.student}`).set("Authorization",f.auth).expect(200);
    expect(image.headers["cache-control"]).toContain("no-store");expect(image.body.dataUrl).toMatch(/^data:image\/jpeg/);
    await request(app).get("/api/portal/credential/photo-submission/photo").set("Authorization",other.auth).expect(404);
    await request(app).get(`/api/credentials/students/${f.student}/submissions/${response.body.submission.id}/photo`).set("Authorization",other.auth).expect(403);
    await request(app).get(`/api/credentials/students/${other.student}/submissions/${response.body.submission.id}/photo`).set("Authorization",staff).expect(404);
    await request(app).get("/api/portal/credential.pdf").set("Authorization",f.auth).expect(403);
    const row=get<{source_file:string}>("SELECT source_file FROM credential_photo_submissions WHERE student_id=?",f.student)!;
    expect(fs.readFileSync(credentialFile(row.source_file))).toEqual(portrait);
  });
  it("publishes only after explicit staff review, using exactly the approved photo, framing, QR and PDF for both platforms",async()=>{
    const f=fixture();await send(f).expect(200);const id=getCredentialState(f.student).submission!.id;
    await request(app).post(`/api/credentials/students/${f.student}/submissions/${id}/approve`).set("Authorization",f.auth).send(reviewBody(f.student)).expect(403);
    await approve(f,{...reviewBody(f.student),requirementsAccepted:false}).expect(400);
    await approve(f,{...reviewBody(f.student),revision:99}).expect(409);
    const result=await approve(f,{...reviewBody(f.student),cropX:.45,cropY:.35,zoom:1.2}).expect(200);
    expect(result.body).toMatchObject({canDownload:true,framing:{cropX:.45,cropY:.35,zoom:1.2},submission:{status:"approved"}});
    expect(result.body.issue.snapshot.framing).toEqual(result.body.framing);
    const own=await request(app).get("/api/portal/credential.pdf").set("Authorization",f.auth).buffer(true).parse(binary).expect(200);
    const official=await request(app).get(`/api/credentials/students/${f.student}/pdf`).set("Authorization",staff).buffer(true).parse(binary).expect(200);
    expect(own.body).toEqual(official.body);expect(own.body.subarray(0,8).toString()).toBe("%PDF-1.7");
    const issue=latestCredentialIssue(f.student)!;
    const verified=await request(app).get(`/api/credentials/verify/${issue.token}`).expect(200);
    expect(verified.body.status).toBe("active");expect(verified.body.document.photo.sha256).toBe(result.body.issue.snapshot.photo.sha256);
    expect(own.body.toString("latin1")).toContain(issue.verification_url);
    const publishedPhoto=await request(app).get(`/api/credentials/verify/${issue.token}/photo`).buffer(true).parse(binary).expect(200);
    expect(publishedPhoto.body).toEqual(fs.readFileSync(credentialFile(issue.photo_file)));
  },15000);
  it("exposes a review queue, rejects with useful feedback and guards against stale replacements",async()=>{
    const f=fixture();await send(f).expect(200);const first=getCredentialState(f.student).submission!.id;
    await send(f).expect(200);const latest=getCredentialState(f.student).submission!.id;
    expect(latest).not.toBe(first);expect(get<{status:string}>("SELECT status FROM credential_photo_submissions WHERE id=?",first)!.status).toBe("superseded");
    await request(app).post(`/api/credentials/students/${f.student}/submissions/${first}/approve`).set("Authorization",staff).send(reviewBody(f.student)).expect(409);
    await send(f,portrait,{previousId:first}).expect(409);
    const list=await request(app).get(`/api/credentials/students?pendingPhotos=1&search=FOTO-${counter}`).set("Authorization",staff).expect(200);
    expect(list.body.records).toHaveLength(1);expect(list.body.records[0].pending_photo).toBe(1);
    const reject=()=>request(app).post(`/api/credentials/students/${f.student}/submissions/${latest}/reject`).set("Authorization",staff);
    await reject().send({reason:""}).expect(400);
    await reject().send({reason:"Usa una pared blanca y tu uniforme escolar."}).expect(200);
    const portal=await request(app).get("/api/portal/credential").set("Authorization",f.auth).expect(200);
    expect(portal.body.submission).toMatchObject({status:"rejected",reviewNote:"Usa una pared blanca y tu uniforme escolar."});
    await send(f).expect(200);expect(getCredentialState(f.student).submission!.status).toBe("pending");
  });
  it("keeps the current credential valid throughout submission and rejection, then replaces it atomically on approval",async()=>{
    const f=fixture(),old=await existingCredential(f),oldPdf=fs.readFileSync(credentialFile(old.card_file));
    await send(f).expect(200);const id=getCredentialState(f.student).submission!.id;
    expect(latestCredentialIssue(f.student)!.id).toBe(old.id);
    await request(app).get(`/api/credentials/verify/${old.token}`).expect(200).expect(r=>expect(r.body.status).toBe("active"));
    expect((await request(app).get("/api/portal/credential.pdf").set("Authorization",f.auth).buffer(true).parse(binary)).body).toEqual(oldPdf);
    rejectCredentialPhoto(f.student,id,"La foto debe tener uniforme.",admin);expect(getCredentialState(f.student).canDownload).toBe(true);
    await send(f).expect(200);await approve(f).expect(200);
    expect(latestCredentialIssue(f.student)!.id).not.toBe(old.id);
    await request(app).get(`/api/credentials/verify/${old.token}`).expect(200).expect(r=>expect(r.body.status).toBe("revoked"));
    expect(all("SELECT id FROM credential_issues WHERE student_id=? AND revoked_at IS NULL",f.student)).toHaveLength(1);
    expect(fs.readFileSync(credentialFile(old.card_file))).toEqual(oldPdf);
  },15000);
  it("does not revoke or partly publish when a submission is rejected while its PDF is being prepared",async()=>{
    const f=fixture(),old=await existingCredential(f);await send(f).expect(200);
    const id=getCredentialState(f.student).submission!.id;
    const publishing=approveCredentialPhoto(f.student,id,reviewBody(f.student),admin);
    rejectCredentialPhoto(f.student,id,"Envía una foto con fondo blanco.",admin);
    await expect(publishing).rejects.toMatchObject({status:409});
    expect(getCredentialState(f.student)).toMatchObject({canDownload:true,submission:{status:"rejected"}});
    expect(latestCredentialIssue(f.student)!.id).toBe(old.id);
    expect(all("SELECT id FROM credential_issues WHERE student_id=?",f.student)).toHaveLength(1);
  },15000);
  it("normalizes orientation and retains resolution when the original variant is approved",async()=>{
    const f=fixture(),oriented=await sharp(portrait).withMetadata({orientation:6}).jpeg().toBuffer();
    const response=await send(f,oriented).expect(200);
    expect(response.body.submission.photo).toMatchObject({width:1066,height:800});
    await approve(f,{...reviewBody(f.student),variant:"original"}).expect(200);
    const issue=latestCredentialIssue(f.student)!,info=await sharp(credentialFile(issue.photo_file)).metadata();
    expect(info).toMatchObject({width:1066,height:800});expect(info.orientation).toBeUndefined();
    expect(getCredentialState(f.student).issue!.snapshot.photo).toMatchObject({width:1066,height:800});
    const selected=await request(app).get("/api/portal/credential/photo-submission/photo").set("Authorization",f.auth).expect(200);
    expect(Buffer.from(selected.body.dataUrl.split(",")[1],"base64")).toEqual(fs.readFileSync(credentialFile(issue.photo_file)));
  },15000);
  it("bounds simultaneous photo preparation and recovers after conflicts without losing the next valid submission",async()=>{
    const f=fixture(),body={requirementsAccepted:true,previousId:""};
    const pending=Array.from({length:4},()=>submitCredentialPhoto(f.student,portrait,body,f.user).then(()=>200,error=>error.status));
    await expect(submitCredentialPhoto(f.student,portrait,body,f.user)).rejects.toMatchObject({status:503});
    expect(await Promise.all(pending)).toEqual([200,409,409,409]);
    await send(f).expect(200);expect(getCredentialState(f.student).submission!.status).toBe("pending");
  });
});
