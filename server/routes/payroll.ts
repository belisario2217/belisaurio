import { Router } from "express";
import { all, get, run, transaction } from "../db.js";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { ApiError, asId, cleanText } from "../utils.js";
import { sendCsv } from "../utils.js";
import { isoDate, payrollCalculation } from "../services/payroll.js";

export const payrollRouter=Router();
payrollRouter.get('/profiles',requirePermission('payments.view'),(_req,res)=>res.json({profiles:all(`SELECT p.*,t.teacher_number FROM payroll_profiles p LEFT JOIN teachers t ON t.id=p.teacher_id ORDER BY p.kind,spanish_sort(p.full_name)`),teachers:all(`SELECT t.id,t.full_name,t.teacher_number,
  COALESCE((SELECT SUM(hours) FROM (SELECT a.group_id,a.subject_id,MAX(s.hours_per_week) AS hours FROM subject_assignments a JOIN subjects s ON s.id=a.subject_id JOIN groups g ON g.id=a.group_id JOIN academic_periods ap ON ap.id=a.period_id WHERE a.teacher_id=t.id AND a.is_active=1 AND g.is_active=1 AND ap.cycle_id=COALESCE(g.active_cycle_id,g.cycle_id) GROUP BY a.group_id,a.subject_id)),0) AS suggested_hours
  FROM teachers t WHERE t.is_active=1 ORDER BY spanish_sort(t.full_name)`)}));
function profileValues(body:any){
 const kind=String(body.kind??''),teacherId=kind==='teacher'?asId(body.teacherId,'Docente'):null,rate=Number(body.rate),weeklyHours=kind==='teacher'?Number(body.weeklyHours):0;
 if(!['teacher','administrative'].includes(kind)||!Number.isFinite(rate)||rate<=0||rate>1e6||!Number.isFinite(weeklyHours)||weeklyHours<0||weeklyHours>168)throw new ApiError(400,'Revisa tipo de nómina, tarifa y horas semanales.');
 const teacher=teacherId?get<{full_name:string}>('SELECT full_name FROM teachers WHERE id=? AND is_active=1',teacherId):null;
 if(teacherId&&!teacher)throw new ApiError(400,'Selecciona un docente activo.');
 const fullName=teacher?.full_name??cleanText(body.fullName,180);
 if(!fullName)throw new ApiError(400,'Escribe el nombre del trabajador.');
 return {kind,teacherId,fullName,rate,weeklyHours,position:cleanText(body.position,120)};
}
payrollRouter.post('/profiles',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const p=profileValues(req.body);
 const result=run('INSERT INTO payroll_profiles(kind,teacher_id,full_name,position,rate,weekly_hours) VALUES(?,?,?,?,?,?)',p.kind,p.teacherId,p.fullName,p.position,p.rate,p.weeklyHours);
 res.status(201).json({id:Number(result.lastInsertRowid)});
});
payrollRouter.patch('/profiles/:id',requirePermission('payments.manage'),(req,res)=>{
 const id=asId(req.params.id,'Trabajador'),current=get<any>('SELECT * FROM payroll_profiles WHERE id=?',id);if(!current)throw new ApiError(404,'No se encontró el trabajador.');
 if(req.body.kind&&req.body.kind!==current.kind)throw new ApiError(400,'La clase de nómina de una ficha no puede cambiar.');
 const p=profileValues({kind:current.kind,teacherId:current.teacher_id,fullName:req.body.fullName??current.full_name,position:req.body.position??current.position,rate:req.body.rate??current.rate,weeklyHours:req.body.weeklyHours??current.weekly_hours});
 run('UPDATE payroll_profiles SET full_name=?,position=?,rate=?,weekly_hours=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',p.fullName,p.position,p.rate,p.weeklyHours,req.body.isActive===undefined?current.is_active:req.body.isActive?1:0,id);res.json({message:'Ficha de nómina actualizada.'});
});
function profile(id:unknown){const row=get<any>('SELECT * FROM payroll_profiles WHERE id=? AND is_active=1',asId(id,'Trabajador'));if(!row)throw new ApiError(404,'Selecciona una ficha de nómina activa.');return row;}
payrollRouter.post('/preview',requirePermission('payments.view'),(req,res)=>{
 if(req.body.paymentId){
  const previous=get<any>('SELECT * FROM payroll_payments WHERE id=?',asId(req.body.paymentId,'Pago'));
  if(!previous)throw new ApiError(404,'No se encontró el pago.');
  return res.json(payrollCalculation({kind:previous.kind,rate:previous.rate,weekly_hours:previous.weekly_hours},req.body));
 }
 return res.json(payrollCalculation(profile(req.body.profileId),req.body));
});
payrollRouter.post('/payments',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const p=profile(req.body.profileId),calculation=payrollCalculation(p,req.body),paidAt=isoDate(req.body.paidAt,'Fecha de pago'),notes=cleanText(req.body.notes,500);
 if(req.body.expectedAmount!==undefined&&(Number(req.body.expectedAmount)!==calculation.amount||Number(req.body.expectedRate)!==calculation.rate))throw new ApiError(409,'La tarifa o el cálculo cambió. Revisa el cálculo de nuevo antes de registrar el pago.');
 const payment=transaction(()=>{
  if(get('SELECT id FROM payroll_payments WHERE profile_id=? AND period_start=? AND period_end=?',p.id,calculation.periodStart,calculation.periodEnd))throw new ApiError(409,'Ya hay un pago registrado para esta persona y este periodo.');
  if(get('SELECT id FROM payroll_payments WHERE profile_id=? AND period_start<=? AND period_end>=?',p.id,calculation.periodEnd,calculation.periodStart))throw new ApiError(409,'Este periodo se cruza con otro pago de la misma persona. Revisa las fechas para no pagar dos veces los mismos días.');
  const conceptName=p.kind==='teacher'?'Nómina docente':'Nómina administrativa',concept=get<{id:number}>('SELECT id FROM expense_concepts WHERE name=?',conceptName)!;
  const expense=run('INSERT INTO operating_expenses(concept,category,amount,paid_at,notes,created_by,concept_id) VALUES(?,?,?,?,?,?,?)',`${conceptName} · ${p.full_name}`,'payroll',calculation.amount,paidAt,notes,req.user!.id,concept.id);
  const result=run(`INSERT INTO payroll_payments(profile_id,period_start,period_end,staff_name,kind,rate,weekly_hours,weeks,worked_days,amount,paid_at,expense_id,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,p.id,calculation.periodStart,calculation.periodEnd,p.full_name,p.kind,calculation.rate,calculation.weeklyHours,calculation.weeks,calculation.workedDays,calculation.amount,paidAt,Number(expense.lastInsertRowid),notes);
  return {id:Number(result.lastInsertRowid),expenseId:Number(expense.lastInsertRowid),...calculation};
 });res.status(201).json(payment);
});
// Los ajustes usan la tarifa histórica guardada, no la tarifa actual de la ficha.
payrollRouter.patch('/payments/:id',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Pago'),previous=get<any>('SELECT * FROM payroll_payments WHERE id=?',id);
 if(!previous)throw new ApiError(404,'No se encontró el pago de nómina.');
 if(req.body.expectedOriginalAmount!==undefined&&Number(req.body.expectedOriginalAmount)!==previous.amount)throw new ApiError(409,'Este pago fue modificado por otra persona. Actualiza el listado.');
 const calculation=payrollCalculation({kind:previous.kind,rate:previous.rate,weekly_hours:previous.weekly_hours},req.body);
 const paidAt=isoDate(req.body.paidAt,'Fecha de pago'),notes=cleanText(req.body.notes,500);
 if(req.body.expectedAmount!==undefined&&(Number(req.body.expectedAmount)!==calculation.amount||Number(req.body.expectedRate)!==calculation.rate))throw new ApiError(409,'El cálculo cambió. Revisa el importe antes de guardar.');
 transaction(()=>{
  const overlap=get('SELECT id FROM payroll_payments WHERE profile_id=? AND id<>? AND period_start<=? AND period_end>=?',previous.profile_id,id,calculation.periodEnd,calculation.periodStart);
  if(overlap)throw new ApiError(409,'El periodo se cruza con otro pago de esta persona.');
  run('UPDATE payroll_payments SET period_start=?,period_end=?,rate=?,weekly_hours=?,weeks=?,worked_days=?,amount=?,paid_at=?,notes=? WHERE id=?',
   calculation.periodStart,calculation.periodEnd,calculation.rate,calculation.weeklyHours,calculation.weeks,calculation.workedDays,calculation.amount,paidAt,notes,id);
  const updated=run('UPDATE operating_expenses SET amount=?,paid_at=?,notes=? WHERE id=?',calculation.amount,paidAt,notes,previous.expense_id);
  if(Number(updated.changes)!==1)throw new ApiError(409,'No se encontró el egreso vinculado. No se modificó el pago.');
  logActivity(req,'update','payroll_payments',id,{before:{amount:previous.amount,paidAt:previous.paid_at,periodStart:previous.period_start,periodEnd:previous.period_end},after:{amount:calculation.amount,paidAt,periodStart:calculation.periodStart,periodEnd:calculation.periodEnd}});
 });
 res.json({id,expenseId:previous.expense_id,...calculation});
});
payrollRouter.delete('/payments/:id',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Pago');
 transaction(()=>{
  const payment=get<any>('SELECT * FROM payroll_payments WHERE id=?',id);
  if(!payment)throw new ApiError(404,'No se encontró el pago de nómina.');
  run('DELETE FROM payroll_payments WHERE id=?',id);
  const removed=run('DELETE FROM operating_expenses WHERE id=?',payment.expense_id);
  if(Number(removed.changes)!==1)throw new ApiError(409,'No se encontró el egreso vinculado. No se eliminó el pago.');
  logActivity(req,'delete','payroll_payments',id,{amount:payment.amount,expenseId:payment.expense_id,staffName:payment.staff_name});
 });
 res.status(204).end();
});
payrollRouter.get('/payments',requirePermission('payments.view'),(req,res)=>{
 const month=String(req.query.month??'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new ApiError(400,'Selecciona un mes válido.');
 res.json(all('SELECT * FROM payroll_payments WHERE substr(paid_at,1,7)=? ORDER BY paid_at DESC,id DESC',month));
});
payrollRouter.get('/concepts',requirePermission('payments.view'),(_req,res)=>res.json(all('SELECT * FROM expense_concepts WHERE is_active=1 ORDER BY spanish_sort(name)')));
payrollRouter.post('/concepts',requirePermission('payments.manage'),(req,res)=>{
 const name=cleanText(req.body.name,180),category=String(req.body.category??'operating');if(!name||!['operating','payroll','other'].includes(category))throw new ApiError(400,'Revisa el concepto de egreso.');
 const result=run('INSERT INTO expense_concepts(name,category) VALUES(?,?)',name,category);res.status(201).json({id:Number(result.lastInsertRowid)});
});

payrollRouter.get('/export',requirePermission('payments.view'),(req,res)=>{
 const month=String(req.query.month??''),kind=String(req.query.kind??'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!['teacher','administrative'].includes(kind))throw new ApiError(400,'Selecciona mes y tipo de nómina.');
 const rows=all<any>('SELECT * FROM payroll_payments WHERE substr(paid_at,1,7)=? AND kind=? ORDER BY spanish_sort(staff_name),paid_at',month,kind).map(p=>({'Persona':p.staff_name,'Inicio':p.period_start,'Fin':p.period_end,'Tarifa':p.rate,'Horas semanales':p.weekly_hours,'Semanas':p.weeks,'Días trabajados':p.worked_days,'Importe':p.amount,'Fecha de pago':p.paid_at}));
 sendCsv(res,`nomina-${kind}-${month}.csv`,Object.keys(rows[0]??{Persona:"",Inicio:"",Fin:"",Importe:""}),rows.map(row=>Object.values(row)));
});
