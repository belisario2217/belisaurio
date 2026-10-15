import { afterAll, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ifop-upgrade-')),filename=path.join(root,'school.db');
const legacy=new DatabaseSync(filename);legacy.exec('PRAGMA foreign_keys=ON;');
const directory=path.resolve('server/migrations');
for(const file of fs.readdirSync(directory).filter(n=>n.endsWith('.sql')&&Number(n.slice(0,3))<=26).sort()){
 legacy.exec(fs.readFileSync(path.join(directory,file),'utf8'));legacy.prepare('INSERT INTO schema_migrations(name) VALUES(?)').run(file);
}
legacy.exec(`INSERT INTO roles(id,name) VALUES(100,'Docente');
INSERT INTO users(id,full_name,email,password_hash,role_id) VALUES(100,'Docente de prueba','legacy@example.invalid','test-hash',100);
INSERT INTO teachers(id,employee_number,full_name,email) VALUES(100,'LEG-100','Docente de prueba','legacy@example.invalid');
INSERT INTO programs(id,code,name) VALUES(100,'LEG','Programa de prueba');
INSERT INTO shifts(id,name) VALUES(100,'Turno de prueba');
INSERT INTO school_cycles(id,name,start_date,end_date) VALUES(100,'Generación de prueba','2026-08-01','2027-07-31');
INSERT INTO curricular_periods(id,name,sequence) VALUES(100,'Periodo de prueba',100);
INSERT INTO student_statuses(id,name) VALUES(100,'Activo');
INSERT INTO students(id,student_number,first_name,last_name,status_id) VALUES(100,'LEGACY-100','Nombre','Apellido',100);
INSERT INTO groups(id,name,program_id,shift_id,cycle_id,active_cycle_id,curricular_period_id) VALUES(100,'Grupo de prueba',100,100,100,100,100);
INSERT INTO enrollments(id,student_id,program_id,shift_id,group_id,cycle_id) VALUES(100,100,100,100,100,100);`);
legacy.exec("UPDATE sqlite_sequence SET seq=150 WHERE name='groups'");
legacy.exec(`INSERT INTO programs(id,code,name) VALUES(101,'LEG-UNITEN','Licenciatura en Enfermería UNITEN'),(102,'LEG-IFOP','Licenciatura en Enfermería IFOP');
INSERT INTO academic_plans(id,program_id,code,name,version,rvoe) VALUES
 (100,101,'PLAN-PROPIO','Plan IFOP propio','2026','RVOE-PROPIO-CONSERVADO'),
 (101,102,'PLAN-COLAB','Plan UNITEN colaboración','2026','RVOE-UNITEN-CONSERVADO'),
 (102,101,'PLAN-NEUTRO-U','Plan sin sufijo','2026',NULL),
 (103,100,'PLAN-NEUTRO-I','Plan sin sufijo','2026',NULL),
 (104,101,'CODIGO-UNITEN','Otra versión IFOP','2026',NULL);`);
legacy.close();process.env.DATABASE_PATH=filename;
const {db,get,all,run,migrate}=await import('./db.js');
afterAll(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
it('upgrades existing single-campus academic data with all foreign keys and passwords preserved',()=>{
 expect(get<{group_id:number}>('SELECT group_id FROM enrollments WHERE id=100')!.group_id).toBe(100);
 expect(get<{study_modality:string}>('SELECT study_modality FROM groups WHERE id=100')!.study_modality).toBe('escolarizado');
 run("UPDATE groups SET study_modality='en_linea' WHERE id=100");
 expect(all('PRAGMA foreign_key_check')).toHaveLength(0);
 expect(get<{seq:number}>("SELECT seq FROM sqlite_sequence WHERE name='groups'")!.seq).toBe(150);
 expect(get<{password_hash:string;teacher_id:number}>('SELECT password_hash,teacher_id FROM users WHERE id=100')).toMatchObject({password_hash:'test-hash',teacher_id:100});
 expect(get<{teacher_number:string}>('SELECT teacher_number FROM teachers WHERE id=100')!.teacher_number).toBe('DOC00100');
 const before=all('SELECT name FROM schema_migrations').length;migrate();expect(all('SELECT name FROM schema_migrations')).toHaveLength(before);
 expect(get<{foreign_keys:number}>('PRAGMA foreign_keys')!.foreign_keys).toBe(1);
 expect(all<{id:number;certificate_authority:string}>("SELECT id,certificate_authority FROM academic_plans WHERE id BETWEEN 100 AND 104 ORDER BY id")).toEqual([
  {id:100,certificate_authority:'ifop'},{id:101,certificate_authority:'uniten'},{id:102,certificate_authority:'uniten'},
  {id:103,certificate_authority:'ifop'},{id:104,certificate_authority:'ifop'}
 ]);
 expect(get<{rvoe:string}>("SELECT rvoe FROM academic_plans WHERE id=100")!.rvoe).toBe('RVOE-PROPIO-CONSERVADO');
 expect(get<{rvoe:string}>("SELECT rvoe FROM academic_plans WHERE id=101")!.rvoe).toBe('RVOE-UNITEN-CONSERVADO');
});
