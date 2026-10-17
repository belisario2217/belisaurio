import { Router } from "express";
import { all, get, run, transaction } from "../db.js";
import { logActivity, requirePermission, type AuthenticatedRequest } from "../auth.js";
import { ApiError, asId, cleanText } from "../utils.js";
import { sendCsv } from "../utils.js";
import { isoDate } from "../services/payroll.js";
import { payrollWithDeductions } from "../services/payroll-adjustments.js";

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

function installments(paymentId:number,items:Array<{loanId:number;amount:number}>) {
 run('DELETE FROM payroll_loan_repayments WHERE payment_id=?',paymentId);
 for(const item of items)run('INSERT INTO payroll_loan_repayments(loan_id,payment_id,amount) VALUES(?,?,?)',item.loanId,paymentId,item.amount);
}
function paymentRow(id:number){
 const row=get<any>('SELECT * FROM payroll_payments WHERE id=?',id);
 if(!row)throw new ApiError(404,'No se encontró el pago de nómina.');
 return row;
}
payrollRouter.post('/preview',requirePermission('payments.view'),(req,res)=>{
 const existing=req.body.paymentId?paymentRow(asId(req.body.paymentId,'Pago')):null;
 const p=existing?{id:existing.profile_id,kind:existing.kind,rate:existing.rate,weekly_hours:existing.weekly_hours}:profile(req.body.profileId);
 res.json(payrollWithDeductions(p,req.body,existing?.id));
});
payrollRouter.post('/payments',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const p=profile(req.body.profileId),paidAt=isoDate(req.body.paidAt,'Fecha de pago'),notes=cleanText(req.body.notes,500);
 const payment=transaction(()=>{
  const calc=payrollWithDeductions(p,req.body);
  if(req.body.expectedAmount!==undefined&&(Number(req.body.expectedAmount)!==calc.amount||Number(req.body.expectedRate)!==calc.rate))throw new ApiError(409,'La tarifa o el cálculo cambió. Revisa el importe antes de pagar.');
  if(get('SELECT id FROM payroll_payments WHERE profile_id=? AND period_start<=? AND period_end>=?',p.id,calc.periodEnd,calc.periodStart))throw new ApiError(409,'Este periodo se cruza con otro pago de la misma persona.');
  const conceptName=p.kind==='teacher'?'Nómina docente':'Nómina administrativa',concept=get<{id:number}>('SELECT id FROM expense_concepts WHERE name=?',conceptName)!;
  const expense=run('INSERT INTO operating_expenses(concept,category,amount,paid_at,notes,created_by,concept_id) VALUES(?,?,?,?,?,?,?)',
   `${conceptName} · ${p.full_name}`,'payroll',calc.amount,paidAt,notes,req.user!.id,concept.id);
  const result=run(`INSERT INTO payroll_payments(profile_id,period_start,period_end,staff_name,kind,rate,weekly_hours,weeks,worked_days,amount,paid_at,expense_id,notes,gross_amount,manual_deduction,deduction_reason)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,p.id,calc.periodStart,calc.periodEnd,p.full_name,p.kind,calc.rate,calc.weeklyHours,calc.weeks,calc.workedDays,calc.amount,paidAt,Number(expense.lastInsertRowid),notes,calc.grossAmount,calc.manualDeduction,calc.deductionReason);
  const id=Number(result.lastInsertRowid);
  installments(id,calc.loanRepayments);
  logActivity(req,'create','payroll_payments',id,{gross:calc.grossAmount,manualDeduction:calc.manualDeduction,loanDeduction:calc.loanDeduction,net:calc.amount});
  return {id,expenseId:Number(expense.lastInsertRowid),...calc};
 });
 res.status(201).json(payment);
});
payrollRouter.patch('/payments/:id',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Pago'),paidAt=isoDate(req.body.paidAt,'Fecha de pago'),notes=cleanText(req.body.notes,500);
 const result=transaction(()=>{
  const previous=paymentRow(id);
  if(req.body.expectedOriginalAmount!==undefined&&Number(req.body.expectedOriginalAmount)!==previous.amount)throw new ApiError(409,'El pago fue modificado por otra persona. Actualiza la información.');
  const calc=payrollWithDeductions({id:previous.profile_id,kind:previous.kind,rate:previous.rate,weekly_hours:previous.weekly_hours},req.body,id);
  if(req.body.expectedAmount!==undefined&&(Number(req.body.expectedAmount)!==calc.amount||Number(req.body.expectedRate)!==calc.rate))throw new ApiError(409,'El cálculo cambió. Revisa el importe.');
  if(get('SELECT id FROM payroll_payments WHERE profile_id=? AND id<>? AND period_start<=? AND period_end>=?',
   previous.profile_id,id,calc.periodEnd,calc.periodStart))throw new ApiError(409,'El periodo se cruza con otro pago de esta persona.');
  run('UPDATE payroll_payments SET period_start=?,period_end=?,rate=?,weekly_hours=?,weeks=?,worked_days=?,amount=?,paid_at=?,notes=?,gross_amount=?,manual_deduction=?,deduction_reason=? WHERE id=?',
   calc.periodStart,calc.periodEnd,calc.rate,calc.weeklyHours,calc.weeks,calc.workedDays,calc.amount,paidAt,notes,calc.grossAmount,calc.manualDeduction,calc.deductionReason,id);
  const expense=run('UPDATE operating_expenses SET amount=?,paid_at=?,notes=? WHERE id=?',calc.amount,paidAt,notes,previous.expense_id);
  if(Number(expense.changes)!==1)throw new ApiError(409,'No se encontró el egreso vinculado. No se modificó el pago.');
  installments(id,calc.loanRepayments);
  logActivity(req,'update','payroll_payments',id,{before:{net:previous.amount,gross:previous.gross_amount},after:{net:calc.amount,gross:calc.grossAmount,manualDeduction:calc.manualDeduction,loanDeduction:calc.loanDeduction}});
  return {id,expenseId:previous.expense_id,...calc};
 });
 res.json(result);
});
payrollRouter.delete('/payments/:id',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Pago');
 transaction(()=>{
  const payment=paymentRow(id);
  // ON DELETE CASCADE restituye automáticamente las amortizaciones al saldo por cobrar.
  run('DELETE FROM payroll_payments WHERE id=?',id);
  const expense=run('DELETE FROM operating_expenses WHERE id=?',payment.expense_id);
  if(Number(expense.changes)!==1)throw new ApiError(409,'No se encontró el egreso vinculado. No se eliminó el pago.');
  logActivity(req,'delete','payroll_payments',id,{net:payment.amount,expenseId:payment.expense_id});
 });
 res.status(204).end();
});
payrollRouter.get('/payments',requirePermission('payments.view'),(req,res)=>{
 const month=String(req.query.month??'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new ApiError(400,'Selecciona un mes válido.');
 const rows=all<any>('SELECT * FROM payroll_payments WHERE substr(paid_at,1,7)=? ORDER BY paid_at DESC,id DESC',month);
 res.json(rows.map(row=>({...row,loanRepayments:all('SELECT loan_id AS loanId,amount FROM payroll_loan_repayments WHERE payment_id=? ORDER BY id',row.id)})));
});
payrollRouter.get('/loans',requirePermission('payments.view'),(req,res)=>{
 const profileId=req.query.profileId?asId(req.query.profileId,'Trabajador'):null;
 res.json(all(`SELECT l.*,p.full_name,p.kind AS staff_kind,
  COALESCE((SELECT SUM(r.amount) FROM payroll_loan_repayments r WHERE r.loan_id=l.id),0) AS repaid,
  ROUND(l.principal-COALESCE((SELECT SUM(r.amount) FROM payroll_loan_repayments r WHERE r.loan_id=l.id),0),2) AS balance
  FROM payroll_loans l JOIN payroll_profiles p ON p.id=l.profile_id
  WHERE (? IS NULL OR l.profile_id=?) ORDER BY l.issued_at DESC,l.id DESC`,profileId,profileId));
});
payrollRouter.post('/loans',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const p=profile(req.body.profileId),kind=String(req.body.kind??'');
 const principal=Number(req.body.amount),issuedAt=isoDate(req.body.issuedAt,'Fecha de entrega'),notes=cleanText(req.body.notes,500);
 if(!['advance','loan'].includes(kind)||!Number.isFinite(principal)||principal<0.01||principal>1e8||
 Math.abs(principal*100-Math.round(principal*100))>1e-6)throw new ApiError(400,'Indica tipo e importe válido con dos decimales.');
 const rounded=Math.round(principal*100)/100;
 const created=transaction(()=>{
  const conceptName=kind==='advance'?'Adelanto de sueldo':'Préstamo al personal';
  const concept=get<{id:number}>('SELECT id FROM expense_concepts WHERE name=?',conceptName)!;
  const expense=run('INSERT INTO operating_expenses(concept,category,amount,paid_at,notes,created_by,concept_id) VALUES(?,?,?,?,?,?,?)',
    `${conceptName} · ${p.full_name}`,'payroll',rounded,issuedAt,notes,req.user!.id,concept.id);
  const record=run('INSERT INTO payroll_loans(profile_id,kind,principal,issued_at,notes,expense_id,created_by) VALUES(?,?,?,?,?,?,?)',
    p.id,kind,rounded,issuedAt,notes,Number(expense.lastInsertRowid),req.user!.id);
  const id=Number(record.lastInsertRowid);
  logActivity(req,'create','payroll_loans',id,{profileId:p.id,kind,amount:rounded,expenseId:Number(expense.lastInsertRowid)});
  return {id,expenseId:Number(expense.lastInsertRowid)};
 });
 res.status(201).json(created);
});
payrollRouter.delete('/loans/:id',requirePermission('payments.manage'),(req:AuthenticatedRequest,res)=>{
 const id=asId(req.params.id,'Adelanto o préstamo');
 transaction(()=>{
  const loan=get<any>('SELECT * FROM payroll_loans WHERE id=?',id);
  if(!loan)throw new ApiError(404,'No se encontró el adelanto o préstamo.');
  if(get('SELECT id FROM payroll_loan_repayments WHERE loan_id=?',id))throw new ApiError(409,'Este préstamo ya tiene descuentos aplicados. Corrige primero los pagos de nómina vinculados.');
  run('DELETE FROM payroll_loans WHERE id=?',id);
  const deleted=run('DELETE FROM operating_expenses WHERE id=?',loan.expense_id);
  if(Number(deleted.changes)!==1)throw new ApiError(409,'No se encontró el egreso vinculado.');
  logActivity(req,'delete','payroll_loans',id,{amount:loan.principal,expenseId:loan.expense_id});
 });
 res.status(204).end();
});
payrollRouter.get('/concepts',requirePermission('payments.view'),(_req,res)=>res.json(all('SELECT * FROM expense_concepts WHERE is_active=1 ORDER BY spanish_sort(name)')));
payrollRouter.post('/concepts',requirePermission('payments.manage'),(req,res)=>{
 const name=cleanText(req.body.name,180),category=String(req.body.category??'operating');if(!name||!['operating','payroll','other'].includes(category))throw new ApiError(400,'Revisa el concepto de egreso.');
 const result=run('INSERT INTO expense_concepts(name,category) VALUES(?,?)',name,category);res.status(201).json({id:Number(result.lastInsertRowid)});
});

payrollRouter.get('/export',requirePermission('payments.view'),(req,res)=>{
 const month=String(req.query.month??''),kind=String(req.query.kind??'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!['teacher','administrative'].includes(kind))throw new ApiError(400,'Selecciona mes y tipo de nómina.');
 const rows=all<any>(`SELECT p.*,COALESCE((SELECT SUM(amount) FROM payroll_loan_repayments r WHERE r.payment_id=p.id),0) AS loan_deduction FROM payroll_payments p WHERE substr(p.paid_at,1,7)=? AND p.kind=? ORDER BY spanish_sort(p.staff_name),p.paid_at`,month,kind).map(p=>({'Persona':p.staff_name,'Inicio':p.period_start,'Fin':p.period_end,'Tarifa':p.rate,'Horas semanales':p.weekly_hours,'Semanas':p.weeks,'Días trabajados':p.worked_days,'Sueldo bruto':p.gross_amount,'Descuentos generales':p.manual_deduction,'Motivo':p.deduction_reason,'Descuentos por préstamos':p.loan_deduction,'Pago neto':p.amount,'Importe':p.amount,'Fecha de pago':p.paid_at}));
 sendCsv(res,`nomina-${kind}-${month}.csv`,Object.keys(rows[0]??{Persona:"",Inicio:"",Fin:"",Importe:""}),rows.map(row=>Object.values(row)));
});
