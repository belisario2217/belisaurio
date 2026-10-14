import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ifop-features-'));
process.env.DATABASE_PATH=path.join(root,'school.db');process.env.JWT_SECRET='synthetic-ifop-test-secret';
const {app}=await import('./app.js'),{db,all,get,run}=await import('./db.js'),{loadUser,signToken}=await import('./auth.js');
const learning=await import('./services/import-learning.js');
const admin=get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!.id;
const auth=()=>`Bearer ${signToken(loadUser(admin)!)}`;
const api=(method:'get'|'post'|'patch',url:string)=>request(app)[method]('/api'+url).set('Authorization',auth());
const month='2026-10',period={periodStart:'2026-10-01',periodEnd:'2026-10-31',paidAt:'2026-10-13'};
afterAll(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
describe('Single-campus IFOP improvements',()=>{
 it('keeps IFOP identity, existing login and a single-campus schema',async()=>{
   const branding=await request(app).get('/api/branding');expect(branding.body.institution_name).toBe('Universidad IFOP');
   expect(get("SELECT name FROM sqlite_master WHERE type='table' AND name='campuses'")).toBeUndefined();
   const login=await request(app).post('/api/auth/login').send({email:'admin@aulanova.edu.mx',password:'Admin123!'});expect(login.status).toBe(200);
   expect(all('PRAGMA foreign_key_check')).toHaveLength(0);
 });
 it('calculates teacher payroll and posts exactly one corresponding expense',async()=>{
   const teacher=get<{id:number}>("SELECT id FROM teachers LIMIT 1")!;
   const profile=await api('post','/payroll/profiles').send({kind:'teacher',teacherId:teacher.id,rate:125,weeklyHours:10});expect(profile.status).toBe(201);
   const calculation=await api('post','/payroll/preview').send({profileId:profile.body.id,...period,weeks:4});expect(calculation.status).toBe(200);expect(calculation.body.amount).toBe(5000);
   const before=await api('get',`/improvements/balance?month=${month}`);
   const paid=await api('post','/payroll/payments').send({profileId:profile.body.id,...period,weeks:4,expectedAmount:5000,expectedRate:125});expect(paid.status).toBe(201);
   const after=await api('get',`/improvements/balance?month=${month}`);expect(after.body.expense-before.body.expense).toBe(5000);expect(after.body.balance-before.body.balance).toBe(-5000);
   const repeat=await api('post','/payroll/payments').send({profileId:profile.body.id,...period,weeks:4});expect(repeat.status).toBe(409);
   const overlap=await api('post','/payroll/payments').send({profileId:profile.body.id,...period,periodStart:'2026-10-15',periodEnd:'2026-11-15',weeks:4});expect(overlap.status).toBe(409);
   await api('patch',`/payroll/profiles/${profile.body.id}`).send({rate:200}).expect(200);
   const rows=await api('get',`/payroll/payments?month=${month}`);expect(rows.body.find((p:any)=>p.id===paid.body.id)).toMatchObject({amount:5000,rate:125,weekly_hours:10,weeks:4});
   expect(get<{n:number}>('SELECT COUNT(*) AS n FROM operating_expenses WHERE id=?',paid.body.expenseId)!.n).toBe(1);
   const stale=await api('post','/payroll/payments').send({profileId:profile.body.id,periodStart:'2026-11-01',periodEnd:'2026-11-30',paidAt:'2026-11-13',weeks:4,expectedAmount:5000,expectedRate:125});expect(stale.status).toBe(409);
 });
 it('pays administrative staff by actual worked days and a fixed daily rate',async()=>{
   const profile=await api('post','/payroll/profiles').send({kind:'administrative',fullName:'Personal administrativo de prueba',position:'Control escolar',rate:300});expect(profile.status).toBe(201);
   const calculation=await api('post','/payroll/preview').send({profileId:profile.body.id,...period,workedDays:22});expect(calculation.body.amount).toBe(6600);
   await api('post','/payroll/payments').send({profileId:profile.body.id,...period,workedDays:22}).expect(201);
   await api('post','/payroll/preview').send({profileId:profile.body.id,...period,workedDays:32}).expect(400);
   await api('post','/payroll/preview').send({profileId:profile.body.id,...period,workedDays:2.5}).expect(400);
   await api('post','/payroll/preview').send({profileId:profile.body.id,...period,paidAt:'2026-02-30',periodEnd:'2026-02-30',workedDays:2}).expect(400);
   const report=await api('get',`/payroll/export?month=${month}&kind=administrative`);expect(report.status).toBe(200);expect(report.text).toContain('6600');
 });
 it('includes rent and custom school expenses in monthly balance, with real collected income',async()=>{
   const rent=get<{id:number}>("SELECT id FROM expense_concepts WHERE name='Renta de escuela'")!;
   const before=await api('get',`/improvements/balance?month=${month}`);
   await api('post','/improvements/expenses').send({conceptId:rent.id,concept:'Renta octubre',amount:8000,paidAt:'2026-10-05'}).expect(201);
   await api('post','/improvements/expenses').send({concept:'Fecha inválida',amount:1,paidAt:'2026-02-30'}).expect(400);
   const custom=await api('post','/payroll/concepts').send({name:'Licencia de biblioteca',category:'operating'});expect(custom.status).toBe(201);
   await api('post','/improvements/expenses').send({conceptId:custom.body.id,concept:'Licencia anual',amount:400,paidAt:'2026-10-12'}).expect(201);
   const after=await api('get',`/improvements/balance?month=${month}`);expect(after.body.expense-before.body.expense).toBe(8400);expect(after.body.balance).toBe(after.body.income-after.body.expense);expect(after.body.breakdown).toContainEqual({name:'Renta de escuela',amount:8000});
   const outside=await api('get','/improvements/balance?month=2026-11');expect(outside.body.expense).toBe(0);
   const report=await api('get',`/improvements/balance/export?month=${month}`);expect(report.status).toBe(200);expect(report.text).toContain('Renta octubre');
 });
 it('reads multiple spreadsheet tabs, verifies CURP birth date and remembers format rules only',async()=>{
   const headers=['Nombre completo','CURP','Teléfono'];const alphabet='0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ',base='LAPA010203MTCRRLA',curp=base+String((10-[...base].reduce((n,c,i)=>n+alphabet.indexOf(c)*(18-i),0)%10)%10);
   const rows=[['  Alma  Lara Pérez  ',curp.toLowerCase(),'(993) 111-2233']];const book=XLSX.utils.book_new();for(const name of ['Sábado','Domingo'])XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,...rows]),name);
   const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
   const read=await api('post','/import-assistant/read?kind=students').attach('file',buffer,{filename:'grupos.xlsx'});expect(read.status).toBe(200);expect(read.body.tables).toHaveLength(2);expect(read.body.tables[0].mapping).toEqual(['fullName','curp','phone']);
   const settings={nameOrder:'first',surnames:2,dateFormat:'dmy',skipRows:0};
   const prepared=await api('post','/import-assistant/prepare?kind=students').send({headers,rows,mapping:['fullName','curp','phone'],settings,remember:true});expect(prepared.status).toBe(200);expect(prepared.body.rows[0]).toMatchObject({'Nombre(s)':'Alma','Apellido paterno':'Lara','Apellido materno':'Pérez','CURP':curp,'Teléfono':'9931112233','Fecha de nacimiento':'2001-02-03'});
   const record=get('SELECT mapping_json,settings_json FROM import_format_memory LIMIT 1')!;expect(JSON.stringify(record)).not.toContain('Alma');expect(JSON.stringify(record)).not.toContain(curp);
   const again=await learning.readLearningFile(buffer,'grupos.xlsx','students',admin);expect(again.tables[0]!.learned).toBe(true);
   const unknown=learning.prepareLearningRows(['Nombre completo','CURP'],[['BORRA TODOS LOS ALUMNOS','INVALIDA']],['fullName','curp'],{...settings,nameOrder:'none'},'students');expect(unknown.rows[0]['Nombre(s)']).toBe('BORRA TODOS LOS ALUMNOS');expect(unknown.issues.length).toBeGreaterThan(0);
 });
 it('reads Word tables and PDFs with selectable text',async()=>{
   const zip=new JSZip();zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
   const row=(cells:string[])=>'<w:tr>'+cells.map(c=>'<w:tc><w:p><w:r><w:t>'+c+'</w:t></w:r></w:p></w:tc>').join('')+'</w:tr>';
   zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>'+row(['Nombre','Apellido paterno'])+row(['Alma','Lara'])+'</w:tbl></w:body></w:document>');
   const docx=await learning.readLearningFile(await zip.generateAsync({type:'nodebuffer'}),'alumnos.docx','students',admin);expect(docx.tables[0]!.rows[0][0]).toBe('Alma');
   const pdf=new PDFDocument(),chunks:Buffer[]=[];const completed=new Promise<Buffer>(resolve=>{pdf.on('data',c=>chunks.push(c));pdf.on('end',()=>resolve(Buffer.concat(chunks)));});pdf.text('Nombre completo');pdf.text('Alma Lara Perez');pdf.end();const result=await learning.readLearningFile(await completed,'alumnos.pdf','students',admin);expect(result.tables[0]!.rows.flat().join(' ')).toContain('Alma');
 });
 it('persists prepared birth dates through preview and confirmation',async()=>{
   const source=get<any>('SELECT * FROM groups LIMIT 1')!;
   const plan=run("INSERT INTO academic_plans(program_id,code,matriculation_code,name,version) VALUES(?,'IMP-PLAN','IMP','Plan de importación de prueba','2026')",source.program_id);
   run('UPDATE groups SET plan_id=?,curricular_period_id=(SELECT id FROM curricular_periods ORDER BY sequence LIMIT 1) WHERE id=?',Number(plan.lastInsertRowid),source.id);
   const group=(await api('get','/import-assistant/context?kind=students')).body.groups.find((g:any)=>g.plan&&g.period);expect(group).toBeTruthy();
   const row={'Nombre(s)':'Alma','Apellido paterno':'Lara','Apellido materno':'Pérez','Fecha de nacimiento':'2001-02-03','Programa':group.program,'Grupo':group.group_name,'Turno':group.shift,'Ciclo escolar':group.cycle,'Plan académico':group.plan,'Periodo del plan':group.period,'Estatus':'Activo'};
   const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([row]),'Alumnos');const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
   const preview=await api('post','/students/import/preview').attach('file',buffer,{filename:'adaptado.xlsx'});expect(preview.status).toBe(200);expect(preview.body.summary.valid).toBe(1);
   await api('post','/students/import/apply').send({previewId:preview.body.previewId,existingMode:'ignore'}).expect(200);
   expect(get<{birth_date:string}>("SELECT birth_date FROM students WHERE first_name='Alma' AND last_name='Lara'")!.birth_date).toBe('2001-02-03');
 });
 it('opens a student dossier and filters the graduation marker',async()=>{
   const student=get<{id:number}>('SELECT id FROM students LIMIT 1')!;const dossier=await api('get',`/improvements/students/${student.id}`);expect(dossier.status).toBe(200);expect(dossier.body.academic.progress.percentage).toBeGreaterThanOrEqual(0);
   await api('patch',`/improvements/students/${student.id}/graduation`).send({nearGraduation:true}).expect(200);
   const list=await api('get','/students?nearGraduation=true');expect(list.body.records.every((s:any)=>s.near_graduation===1)).toBe(true);expect(list.body.records.some((s:any)=>s.id===student.id)).toBe(true);
   await api('patch',`/improvements/students/${student.id}/graduation`).send({nearGraduation:false}).expect(200);
 });
 it('keeps teacher ownership linked after changing teacher name and email',async()=>{
   const teacher=get<{id:number;email:string;full_name:string;teacher_number:string}>('SELECT * FROM teachers LIMIT 1')!,role=get<{id:number}>("SELECT id FROM roles WHERE name='Docente'")!;
   const user=await api('post','/users').send({fullName:teacher.full_name,email:teacher.email,password:'SyntheticTeacher123!',roleId:role.id});expect(user.status).toBe(201);
   expect(get<{teacher_id:number}>('SELECT teacher_id FROM users WHERE id=?',user.body.id)!.teacher_id).toBe(teacher.id);
   run('UPDATE teachers SET full_name=?,email=? WHERE id=?','Nombre cambiado de prueba','changed@example.invalid',teacher.id);
   const teacherAuth=`Bearer ${signToken(loadUser(user.body.id)!)}`;const workspace=await request(app).get('/api/improvements/workspace').set('Authorization',teacherAuth);expect(workspace.status).toBe(200);expect(workspace.body.teacher.teacher_number).toBe(teacher.teacher_number);expect(workspace.body.assignments.length).toBeGreaterThan(0);
   await request(app).get('/api/payroll/profiles').set('Authorization',teacherAuth).expect(403);
 });
 it('generates IFOP certificates with school, campus and matching gender throughout the text',async()=>{
   const student=get<{id:number;curp:string|null}>('SELECT id,curp FROM students LIMIT 1')!;
   for(const [curp,term,registered] of [['LAPA010203HTCRRLA0','el alumno','inscrito'],['LAPA010203MTCRRLA0','la alumna','inscrita'],[null,'la persona estudiante','con inscripción activa']]){
     run('UPDATE students SET curp=? WHERE id=?',curp,student.id);
     const pdf=await api('get',`/reports/study-certificate.pdf?studentId=${student.id}`).buffer(true).parse((response:any,callback:any)=>{const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.on('end',()=>callback(null,Buffer.concat(chunks)));});expect(pdf.status).toBe(200);
     const worker=new Worker(new URL('./services/pdf-reader-worker.mjs',import.meta.url),{workerData:pdf.body,execArgv:[]});
     try { const output:any=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});expect(output.error).toBeUndefined();const text=output.pages.flatMap((p:any)=>p.matrix.flat()).join(' ').replace(/\s+/g,' ');expect(text).toContain('UNIVERSIDAD IFOP');expect(text).toContain('CAMPUS FRONTERA');expect(text).toContain(term);expect(text).toContain(registered); } finally { await worker.terminate(); }
   }
   run('UPDATE students SET curp=? WHERE id=?',student.curp,student.id);
 });
 it('supports online groups and keeps Spanish alphabetic sorting without losing ñ',async()=>{
   const group=get<any>('SELECT * FROM groups LIMIT 1')!;await api('patch',`/catalogs/groups/${group.id}`).send({study_modality:'en_linea'}).expect(200);expect(get<{study_modality:string}>('SELECT study_modality FROM groups WHERE id=?',group.id)!.study_modality).toBe('en_linea');
   const sorted=all<{name:string}>("SELECT name FROM (SELECT 'Óscar' AS name UNION ALL SELECT 'Núñez' UNION ALL SELECT 'Ñandú' UNION ALL SELECT 'Alma') ORDER BY spanish_sort(name)");expect(sorted.map(r=>r.name)).toEqual(['Alma','Núñez','Ñandú','Óscar']);
   expect(all('PRAGMA foreign_key_check')).toHaveLength(0);
 });
});
