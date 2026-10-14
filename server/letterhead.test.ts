import { afterAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import request from "supertest";
import ExcelJS from "exceljs";
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ifop-letterhead-'));process.env.DATABASE_PATH=path.join(root,'school.db');process.env.JWT_SECRET='synthetic-letterhead-secret';
const {app}=await import('./app.js'),{db,get,run}=await import('./db.js'),{loadUser,signToken}=await import('./auth.js'),{parseWorkbook}=await import('./services/files.js');
const admin=get<{id:number}>("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='Administrador'")!.id;
const auth=()=>`Bearer ${signToken(loadUser(admin)!)}`;
const binary=(response:any,callback:any)=>{const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.on('end',()=>callback(null,Buffer.concat(chunks)));};
const download=(url:string)=>request(app).get('/api'+url).set('Authorization',auth()).buffer(true).parse(binary);
afterAll(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
it('brands every generic workbook and import template with the configured school, logo and print titles',async()=>{
 const urls=['/students/export/file?format=xlsx','/grades/export/file?format=xlsx','/reports/data/students?format=xlsx','/payments/report?month=2026-10&format=xlsx','/students/template/import.xlsx','/grades/template/legacy.xlsx','/payments/template/import.xlsx'];
 for(const url of urls){const response=await download(url);expect(response.status,url).toBe(200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(response.body);const sheet=workbook.worksheets[0];expect(sheet.getCell('B1').value,url).toBe('Universidad IFOP');expect(sheet.getCell('B2').value).toBe('Campus Frontera');expect(sheet.getImages().length,url).toBeGreaterThan(0);expect(sheet.pageSetup.printTitlesRow).toBe('1:7');expect(workbook.creator).toBe('Universidad IFOP');}
});
it('preserves import fields and values when a branded template is read again',async()=>{
 const template=await download('/students/template/import.xlsx');expect(template.status).toBe(200);const rows=parseWorkbook(template.body);expect(rows.length).toBeGreaterThan(0);expect(rows[0]).toHaveProperty('Nombre(s)');expect(rows[0]).toHaveProperty('Programa');expect(Object.keys(rows[0])).not.toContain('Universidad IFOP');
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(template.body);workbook.worksheets[0].getCell('A8').value='Nombre de prueba';const edited=await workbook.xlsx.writeBuffer();expect(parseWorkbook(Buffer.from(edited))[0]['Nombre(s)']).toBe('Nombre de prueba');
});
it('keeps acta input addresses and formulas while adding school branding',async()=>{
 const response=await download('/grades/template/import.xlsx');expect(response.status).toBe(200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(response.body);const sheet=workbook.worksheets[0];expect(String(sheet.getCell('A1').value)).toContain('Universidad IFOP');expect(String(sheet.getCell('A1').value)).toContain('Campus Frontera');expect(String(sheet.getCell('A1').value)).toContain('ACTA GRUPAL DE CALIFICACIONES');expect(sheet.getImages().length).toBeGreaterThan(0);expect(sheet.pageSetup.printTitlesRow).toBe('1:5');expect(sheet.getCell('H6').value).toHaveProperty('formula');
});
it('repeats the PDF letterhead and table headings on continuation pages',async()=>{
 const status=get<{id:number}>('SELECT id FROM student_statuses LIMIT 1')!.id;
 for(let i=0;i<50;i++)run('INSERT INTO students(student_number,first_name,last_name,status_id) VALUES(?,?,?,?)',`EXPORT-${i}`,'Alumno de prueba',`Apellido ${i}`,status);
 const response=await download('/students/export/file?format=pdf');expect(response.status).toBe(200);expect(response.body.toString('latin1')).toContain('/Subtype /Image');
 const worker=new Worker(new URL('./services/pdf-reader-worker.mjs',import.meta.url),{workerData:response.body,execArgv:[]});
 try{const result:any=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});expect(result.error).toBeUndefined();expect(result.pages.length).toBeGreaterThan(1);for(const page of result.pages){const text=page.matrix.flat().join(' ').replace(/\s+/g,' ');expect(text).toContain('Universidad IFOP');expect(text).toContain('Campus Frontera');expect(text).toContain('Página');expect(text).toContain('Apellido');}}
 finally{await worker.terminate();}
});
