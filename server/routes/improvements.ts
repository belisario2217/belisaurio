import { Router } from "express";
import { all, get, run } from "../db.js";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { ApiError, asId, cleanText, sendCsv } from "../utils.js";
import { isTeacherUser, teacherIdForUser } from "../services/teacher-scope.js";
import { isoDate } from "../services/payroll.js";
import { studentPortalData } from "./portal.js";

export const improvementsRouter = Router();
function studentAccess(req: AuthenticatedRequest, studentId: number) {
  if (req.user!.studentId) {
    if (req.user!.studentId !== studentId) throw new ApiError(403, "Consulta tu propio expediente.");
  } else if (isTeacherUser(req.user)) {
    const teacherId = teacherIdForUser(req.user);
    if (!get(`SELECT e.id FROM enrollments e JOIN subject_assignments a ON a.group_id=e.group_id
      WHERE e.student_id=? AND e.is_active=1 AND a.teacher_id=? AND a.is_active=1`, studentId, teacherId!)) {
      throw new ApiError(403, "Solo puedes consultar alumnos de tus grupos asignados.");
    }
  } else if (!req.user!.permissions.includes("students.view")) throw new ApiError(403, "No puedes consultar expedientes.");
}
improvementsRouter.get("/students/:id", (req: AuthenticatedRequest, res) => {
  const id = asId(req.params.id, "Alumno"); studentAccess(req, id);
  const student = get("SELECT id,student_number,first_name,last_name,second_last_name,curp,birth_date,email,phone,near_graduation FROM students WHERE id=?", id);
  if (!student) throw new ApiError(404, "No se encontró el alumno.");
  let academic = null;
  if (get("SELECT id FROM enrollments WHERE student_id=? AND is_active=1", id)) academic = studentPortalData(id);
  const canSeeFinancial = req.user!.studentId === id || req.user!.permissions.includes("payments.view");
  if (academic && !canSeeFinancial) { const { billing, registration, promotion, ...rest } = academic; res.json({ student, academic: rest }); }
  else res.json({ student, academic });
});
improvementsRouter.patch("/students/:id/graduation", requirePermission("students.manage"), (req, res) => {
  const id = asId(req.params.id, "Alumno");
  if (typeof req.body.nearGraduation !== "boolean") throw new ApiError(400, "Indica si el alumno está próximo a egresar.");
  if (!get("SELECT id FROM students WHERE id=?", id)) throw new ApiError(404, "No se encontró el alumno.");
  run("UPDATE students SET near_graduation=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", req.body.nearGraduation ? 1 : 0, id);
  res.json({ message: "Distintivo actualizado." });
});
improvementsRouter.get("/workspace", (req: AuthenticatedRequest, res) => {
  if (isTeacherUser(req.user)) {
    const id = teacherIdForUser(req.user);
    res.json({ teacher: get("SELECT id,full_name,teacher_number,employee_number,email,phone,specialty FROM teachers WHERE id=?", id!),
      groups: all(`SELECT DISTINCT g.id,g.name,p.name AS program_name FROM groups g JOIN programs p ON p.id=g.program_id
        JOIN subject_assignments a ON a.group_id=g.id WHERE a.teacher_id=? AND a.is_active=1 ORDER BY spanish_sort(g.name)`, id!),
      assignments: all(`SELECT a.id,s.name AS subject_name,g.name AS group_name,p.name AS period_name FROM subject_assignments a
        JOIN subjects s ON s.id=a.subject_id JOIN groups g ON g.id=a.group_id JOIN academic_periods p ON p.id=a.period_id
        WHERE a.teacher_id=? AND a.is_active=1 ORDER BY spanish_sort(g.name),spanish_sort(s.name),p.sequence`, id!) });
  } else {
    const counts: Record<string, number> = {};
    if (req.user!.permissions.includes("students.view")) {
      counts.students = get<{n:number}>("SELECT COUNT(*) AS n FROM students WHERE is_active=1")!.n;
      counts.nearGraduation = get<{n:number}>("SELECT COUNT(*) AS n FROM students WHERE is_active=1 AND near_graduation=1")!.n;
      counts.groups = get<{n:number}>("SELECT COUNT(*) AS n FROM groups WHERE is_active=1")!.n;
    }
    if (req.user!.permissions.includes("catalogs.view")) counts.teachers = get<{n:number}>("SELECT COUNT(*) AS n FROM teachers WHERE is_active=1")!.n;
    res.json({ counts });
  }
});
improvementsRouter.get("/search", (req: AuthenticatedRequest, res) => {
  const search = cleanText(req.query.q, 100);
  if (search.length < 2) { res.json([]); return; }
  const term = `%${search}%`, results: unknown[] = [];
  if (req.user!.permissions.includes("students.view") && !isTeacherUser(req.user) && !req.user!.studentId) {
    results.push(...all(`SELECT st.id,TRIM(st.first_name||' '||st.last_name||' '||COALESCE(st.second_last_name,'')) AS name,
      student_number AS detail,'/alumnos/'||st.id||'/expediente' AS path FROM students st WHERE st.is_active=1
      AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.second_last_name LIKE ? OR student_number LIKE ?)
      ORDER BY spanish_sort(st.last_name),spanish_sort(COALESCE(st.second_last_name,'')),spanish_sort(st.first_name) LIMIT 12`, term, term, term, term));
  }
  res.json(results);
});
improvementsRouter.get("/teacher-options", requirePermission("users.manage"), (_req, res) => res.json(all("SELECT id,full_name || ' · ' || teacher_number AS name FROM teachers WHERE is_active=1 ORDER BY spanish_sort(full_name)")));
improvementsRouter.patch("/users/:id/teacher", requirePermission("users.manage"), (req, res) => {
  const id = asId(req.params.id, "Usuario"), teacherId = req.body.teacherId ? asId(req.body.teacherId, "Docente") : null;
  if (!get("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND r.name='Docente' AND u.deleted_at IS NULL", id)) throw new ApiError(400, "Selecciona un usuario con rol Docente.");
  if (teacherId && !get("SELECT id FROM teachers WHERE id=? AND is_active=1", teacherId)) throw new ApiError(400, "El docente no está activo.");
  if (teacherId && get("SELECT id FROM users WHERE teacher_id=? AND id<>? AND deleted_at IS NULL", teacherId,id)) throw new ApiError(409, "Este docente ya está vinculado a otro usuario.");
  run("UPDATE users SET teacher_id=? WHERE id=?", teacherId,id); res.json({ message: "Usuario vinculado a su docente." });
});
function monthRange(input: unknown) {
  const month = String(input ?? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit'}).format(new Date()).replace('/', '-'));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, "Selecciona un mes válido.");
  const [year,number] = month.split('-').map(Number);
  return { month, start: `${month}-01`, end: `${number===12?year+1:year}-${String(number===12?1:number+1).padStart(2,'0')}-01` };
}
improvementsRouter.get("/balance", requirePermission("payments.view"), (req, res) => {
  const range = monthRange(req.query.month);
  const income = get<{amount:number}>("SELECT COALESCE(SUM(amount),0) AS amount FROM student_payments WHERE paid_at>=? AND paid_at<?", range.start,range.end)!.amount;
  const expenses = all<any>("SELECT * FROM operating_expenses WHERE paid_at>=? AND paid_at<? ORDER BY paid_at DESC,id DESC",range.start,range.end);
  const breakdown = all("SELECT COALESCE(ec.name, CASE oe.category WHEN 'payroll' THEN 'Nómina' WHEN 'operating' THEN 'Operación' ELSE 'Otro' END) AS name,SUM(oe.amount) AS amount FROM operating_expenses oe LEFT JOIN expense_concepts ec ON ec.id=oe.concept_id WHERE oe.paid_at>=? AND oe.paid_at<? GROUP BY 1 ORDER BY spanish_sort(name)",range.start,range.end);
  const expense = expenses.reduce((sum,row)=>sum+Number(row.amount),0);
  res.json({ month: range.month, income, expense, balance: Math.round((income-expense)*100)/100, expenses, breakdown });
});
function expenseValues(body:any){
 const concept=cleanText(body.concept,180),amount=Number(body.amount),paidAt=isoDate(body.paidAt,'Fecha del egreso');
 const conceptId=body.conceptId?asId(body.conceptId,'Concepto'):null;
 const chosen=conceptId?get<{category:string}>('SELECT category FROM expense_concepts WHERE id=? AND is_active=1',conceptId):null;
 if(conceptId&&!chosen)throw new ApiError(400,'El concepto de egreso no está activo.');
 const category=chosen?.category??String(body.category??'operating');
 if(!concept||!Number.isFinite(amount)||amount<=0||amount>1e8||!['operating','other'].includes(category))throw new ApiError(400,'Revisa el concepto, importe y categoría. Los egresos de nómina se administran desde Nómina.');
 return {concept,amount:Math.round(amount*100)/100,paidAt,category,conceptId,notes:cleanText(body.notes,500)};
}
improvementsRouter.post("/expenses", requirePermission("payments.manage"), (req: AuthenticatedRequest, res) => {
 const p=expenseValues(req.body);
 const result=run("INSERT INTO operating_expenses(concept,category,amount,paid_at,notes,created_by,concept_id) VALUES(?,?,?,?,?,?,?)",p.concept,p.category,p.amount,p.paidAt,p.notes,req.user!.id,p.conceptId);
 logActivity(req,'create','operating_expenses',Number(result.lastInsertRowid),{amount:p.amount,category:p.category});
 res.status(201).json({id:Number(result.lastInsertRowid)});
});
improvementsRouter.patch("/expenses/:id",requirePermission("payments.manage"),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Egreso'),previous=get<any>('SELECT * FROM operating_expenses WHERE id=?',id);
 if(!previous)throw new ApiError(404,'No se encontró el egreso.');
 if(get('SELECT id FROM payroll_payments WHERE expense_id=?',id))throw new ApiError(409,'Este egreso corresponde a un pago de nómina. Edítalo desde Nómina.');
 const p=expenseValues(req.body);
 run('UPDATE operating_expenses SET concept=?,category=?,amount=?,paid_at=?,notes=?,concept_id=? WHERE id=?',p.concept,p.category,p.amount,p.paidAt,p.notes,p.conceptId,id);
 logActivity(req,'update','operating_expenses',id,{before:{amount:previous.amount,paidAt:previous.paid_at},after:{amount:p.amount,paidAt:p.paidAt}});
 res.json({id,message:'Egreso actualizado.'});
});
improvementsRouter.delete("/expenses/:id",requirePermission("payments.manage"),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Egreso'),previous=get<any>('SELECT * FROM operating_expenses WHERE id=?',id);
 if(!previous)throw new ApiError(404,'No se encontró el egreso.');
 if(get('SELECT id FROM payroll_payments WHERE expense_id=?',id))throw new ApiError(409,'Este egreso corresponde a un pago de nómina. Elimínalo desde Nómina.');
 run('DELETE FROM operating_expenses WHERE id=?',id);
 logActivity(req,'delete','operating_expenses',id,{concept:previous.concept,amount:previous.amount});
 res.status(204).end();
});

improvementsRouter.get("/balance/export",requirePermission("payments.view"),(req,res)=>{
 const range=monthRange(req.query.month);
 const rows=all<any>("SELECT oe.*,ec.name AS concept_name FROM operating_expenses oe LEFT JOIN expense_concepts ec ON ec.id=oe.concept_id WHERE oe.paid_at>=? AND oe.paid_at<? ORDER BY oe.paid_at,oe.id",range.start,range.end).map(e=>({'Fecha':e.paid_at,'Tipo de egreso':e.concept_name??e.category,'Concepto':e.concept,'Importe':e.amount,'Notas':e.notes??''}));
 sendCsv(res,`egresos-${range.month}.csv`,Object.keys(rows[0]??{Fecha:"",Concepto:"",Importe:""}),rows.map(row=>Object.values(row)));
});
