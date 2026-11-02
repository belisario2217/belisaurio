import { createHash } from "node:crypto";
import PayrollCore, { type PayrollState, type PayrollPayment, type PayrollTeacher } from "../../shared/teacher-payroll-core.mjs";
import IFOPCatalog from "../../shared/ifop-teacher-catalog.mjs";
import { all, get, run, transaction } from "../db.js";
import { ApiError, cleanText } from "../utils.js";

type CalendarTeacher = PayrollTeacher;
type CalendarPayment = PayrollPayment;
export type TeacherPayrollState = PayrollState;
type StoredState = { state_json:string;version:number;updated_at:string };
type LinkRow = { teacher_key:string;teacher_id:number;profile_id:number|null };
type ExpenseRow = { payment_key:string;teacher_key:string;expense_id:number;amount_cents:number;payment_date:string };
type Actor = { userId:number;ip?:string|null;reason?:unknown };
const maxDocumentBytes=8*1024*1024;
const normalizeName=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es").trim().replace(/\s+/g," ").replace(/^(?:profa?|profesora?|dra?)\.?\s+/,"");

function validatedState(input:unknown):TeacherPayrollState {
  try {
    const state=PayrollCore.validate(input) as TeacherPayrollState;
    if(state.settings.currency!=="MXN")throw new Error("Los egresos de la plataforma se registran en MXN. Convierte los importes del respaldo a MXN antes de importarlo; cambiar la etiqueta no convierte el dinero.");
    if(Buffer.byteLength(JSON.stringify(state),"utf8")>maxDocumentBytes)throw new Error("La nómina supera el máximo de 8 MB por respaldo.");
    return state;
  } catch(error) {
    throw new ApiError(400,error instanceof Error?error.message:"Los datos de nómina no son válidos.");
  }
}

function storedState() {
  const row=get<StoredState>("SELECT state_json,version,updated_at FROM teacher_payroll_state WHERE id=1");
  if(!row)throw new ApiError(503,"El control docente todavía no se ha inicializado. Reinicia la plataforma o solicita su inicialización administrativa.");
  try { return { row,state:validatedState(JSON.parse(row.state_json)) }; }
  catch { throw new ApiError(500,"No fue posible validar el control docente guardado. Se conservaron los datos originales."); }
}

function positiveRate(teacher:CalendarTeacher) {
  return teacher.revisions.find(r=>r.rateCents!==null&&r.rateCents>0)?.rateCents??null;
}

/** Link shared academic identities without replacing names, accounts, assignments or manual rates. */
function synchronizeLinks(state:TeacherPayrollState) {
  const keys=new Set(state.teachers.map(t=>t.id));
  for(const row of all<LinkRow>("SELECT * FROM teacher_payroll_links")) {
    if(!keys.has(row.teacher_key))run("DELETE FROM teacher_payroll_links WHERE teacher_key=?",row.teacher_key);
  }
  const issues:Array<{teacherKey:string;message:string}>=[];
  for(const teacher of state.teachers) {
    let link=get<LinkRow>("SELECT * FROM teacher_payroll_links WHERE teacher_key=?",teacher.id);
    if(!link) {
      const candidates=all<{id:number;full_name:string;is_active:number}>("SELECT id,full_name,is_active FROM teachers")
        .filter(t=>normalizeName(t.full_name)===normalizeName(teacher.name));
      const active=candidates.filter(t=>t.is_active===1);
      const matches=active.length?active:candidates;
      if(matches.length>1) {
        issues.push({teacherKey:teacher.id,message:"Hay varios docentes académicos con este nombre. Distingue sus nombres en el catálogo antes de registrar pagos."});
        continue;
      }
      let teacherId=matches[0]?.id;
      if(teacherId&&get("SELECT teacher_key FROM teacher_payroll_links WHERE teacher_id=?",teacherId)) {
        issues.push({teacherKey:teacher.id,message:"Este docente académico ya está vinculado a otra ficha del control por horas."});
        continue;
      }
      if(!teacherId) {
        const base="TP-"+createHash("sha256").update(teacher.id).digest("hex").slice(0,20);
        let employeeNumber=base,suffix=2;
        while(get("SELECT id FROM teachers WHERE employee_number=?",employeeNumber))employeeNumber=base+"-"+suffix++;
        const created=run("INSERT INTO teachers(employee_number,full_name,specialty) VALUES(?,?,?)",employeeNumber,teacher.name,teacher.role||"Docente");
        teacherId=Number(created.lastInsertRowid);
        run("UPDATE teachers SET teacher_number=printf('DOC%05d',id) WHERE id=?",teacherId);
      }
      const profile=get<{id:number;kind:string}>("SELECT id,kind FROM payroll_profiles WHERE teacher_id=?",teacherId);
      if(profile&&profile.kind!=="teacher")throw new ApiError(409,"La ficha académica está vinculada a una nómina incompatible. Revisa el catálogo de personal.");
      run("INSERT INTO teacher_payroll_links(teacher_key,teacher_id,profile_id) VALUES(?,?,?)",teacher.id,teacherId,profile?.id??null);
      link={teacher_key:teacher.id,teacher_id:teacherId,profile_id:profile?.id??null};
    }
    if(link.profile_id===null) {
      const rate=positiveRate(teacher);
      if(rate!==null) {
        const academic=get<{full_name:string}>("SELECT full_name FROM teachers WHERE id=?",link.teacher_id)!;
        const hours=teacher.revisions[0].schedule.reduce((sum,n)=>sum+n,0)/60;
        const inserted=run("INSERT INTO payroll_profiles(kind,teacher_id,full_name,position,rate,weekly_hours) VALUES('teacher',?,?,?,?,?)",
          link.teacher_id,academic.full_name,teacher.role||"Docente",rate/100,hours);
        run("UPDATE teacher_payroll_links SET profile_id=? WHERE teacher_key=?",Number(inserted.lastInsertRowid),teacher.id);
      }
    }
  }
  return issues;
}

function linkIssues(state:TeacherPayrollState) {
  return state.teachers.filter(t=>!get("SELECT teacher_key FROM teacher_payroll_links WHERE teacher_key=?",t.id))
    .map(t=>({teacherKey:t.id,message:"No se pudo vincular esta ficha con un único docente académico. Revisa los nombres del catálogo antes de pagar."}));
}

/** Startup-only initializer; GET endpoints never create academic or financial records. */
export function ensureTeacherPayrollState() {
  return transaction(()=>{
    const existing=get<StoredState>("SELECT state_json,version,updated_at FROM teacher_payroll_state WHERE id=1");
    const initial=existing?validatedState(JSON.parse(existing.state_json)):validatedState(IFOPCatalog.createState(PayrollCore));
    const merged=validatedState(IFOPCatalog.merge(initial,PayrollCore).state);
    const stateJson=JSON.stringify(merged);
    // On subsequent starts removed catalog teachers stay removed because the catalog receipt persists.
    synchronizeLinks(merged);
    if(!existing)run("INSERT INTO teacher_payroll_state(id,state_json,version) VALUES(1,?,1)",stateJson);
    else if(JSON.stringify(initial)!==stateJson)run("UPDATE teacher_payroll_state SET state_json=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=1",stateJson);
    return {initialized:!existing};
  });
}

export function getTeacherPayrollSnapshot() {
  const {row,state}=storedState();
  const links=all<{teacher_key:string;teacher_id:number;profile_id:number|null;teacher_active:number;profile_active:number|null}>(`SELECT l.*,t.is_active AS teacher_active,p.is_active AS profile_active
    FROM teacher_payroll_links l JOIN teachers t ON t.id=l.teacher_id LEFT JOIN payroll_profiles p ON p.id=l.profile_id ORDER BY l.teacher_key`)
    .map(l=>({teacherKey:l.teacher_key,teacherId:l.teacher_id,profileId:l.profile_id,teacherActive:!!l.teacher_active,profileActive:l.profile_active===null?null:!!l.profile_active}));
  const legacyPayments=all<{id:number;teacher_key:string;profile_id:number;period_start:string;period_end:string;paid_at:string;amount:number;staff_name:string}>(`SELECT p.id,l.teacher_key,p.profile_id,p.period_start,p.period_end,p.paid_at,p.amount,p.staff_name
    FROM payroll_payments p JOIN teacher_payroll_links l ON l.profile_id=p.profile_id ORDER BY p.paid_at,p.id`)
    .map(p=>({id:p.id,teacherKey:p.teacher_key,profileId:p.profile_id,periodStart:p.period_start,periodEnd:p.period_end,paidAt:p.paid_at,amount:p.amount,staffName:p.staff_name}));
  return {state,version:row.version,updatedAt:row.updated_at,links,legacyPayments,linkIssues:linkIssues(state)};
}

function paymentSignature(payment:CalendarPayment) {
  return JSON.stringify({teacherId:payment.teacherId,amountCents:payment.amountCents,allocations:payment.allocations.slice().sort((a,b)=>a.date.localeCompare(b.date))});
}

function assertNoLegacyOverlap(payment:CalendarPayment,profileId:number) {
  const existing=all<{period_start:string;period_end:string}>("SELECT period_start,period_end FROM payroll_payments WHERE profile_id=?",profileId);
  if(payment.allocations.some(a=>existing.some(p=>a.date>=p.period_start&&a.date<=p.period_end))) {
    throw new ApiError(409,"Este trabajo ya está cubierto por una nómina manual de la misma persona. Revisa o corrige ese pago antes de registrar un abono por calendario.");
  }
}

/** Called by legacy manual POST/PATCH so the protection also applies in the reverse direction. */
export function assertNoTeacherCalendarOverlap(profileId:number,from:string,to:string) {
  const links=all<{teacher_key:string}>("SELECT teacher_key FROM teacher_payroll_links WHERE profile_id=?",profileId);
  if(!links.length)return;
  const keys=new Set(links.map(l=>l.teacher_key));
  const {state}=storedState();
  if(state.payments.some(p=>keys.has(p.teacherId)&&p.allocations.some(a=>a.date>=from&&a.date<=to))) {
    throw new ApiError(409,"El período ya contiene pagos registrados en Control docente por hora. Corrige esos abonos antes de registrar una nómina manual superpuesta.");
  }
}

function validateNewPayments(previous:TeacherPayrollState,candidate:TeacherPayrollState) {
  const old=new Map(previous.payments.map(p=>[p.id,p]));
  const unchanged=candidate.payments.filter(p=>old.has(p.id)&&paymentSignature(p)===paymentSignature(old.get(p.id)!));
  const changed=candidate.payments.filter(p=>!old.has(p.id)||paymentSignature(p)!==paymentSignature(old.get(p.id)!));
  const validationState={...candidate,payments:unchanged.slice()};
  for(const payment of changed.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))) {
    const link=get<LinkRow>("SELECT * FROM teacher_payroll_links WHERE teacher_key=?",payment.teacherId);
    if(!link||link.profile_id===null)throw new ApiError(409,"Vincula al docente con una ficha de nómina y configura su tarifa antes de registrar pagos.");
    const active=get<{teacher_active:number;profile_active:number}>(`SELECT t.is_active AS teacher_active,p.is_active AS profile_active FROM teacher_payroll_links l
      JOIN teachers t ON t.id=l.teacher_id JOIN payroll_profiles p ON p.id=l.profile_id WHERE l.teacher_key=?`,payment.teacherId);
    if(!active?.teacher_active||!active.profile_active)throw new ApiError(409,"El docente o su ficha de nómina está inactivo en el catálogo. Reactívalo antes de registrar nuevos pagos.");
    assertNoLegacyOverlap(payment,link.profile_id);
    try {
      const engine=PayrollCore.engine(validationState);
      // Reuse the exact same monetary/unknown-rate checks as the client; retain imported date allocations.
      engine.allocate(payment.teacherId,payment.from,payment.to,payment.amountCents);
      for(const allocation of payment.allocations) {
        const day=engine.day(payment.teacherId,allocation.date);
        if(!day.contract||!day.priced||allocation.cents>Math.max(0,day.balance))throw new Error("La distribución del pago supera el saldo confirmado de una fecha o contiene horas sin tarifa.");
      }
    } catch(error) { throw new ApiError(400,error instanceof Error?error.message:"El pago no es válido."); }
    validationState.payments.push(payment);
  }
}

function removeMissingExpenses(candidate:TeacherPayrollState) {
  const keys=new Set(candidate.payments.map(p=>p.id));
  for(const record of all<ExpenseRow>("SELECT * FROM teacher_payroll_expenses")) {
    if(!keys.has(record.payment_key)) {
      run("DELETE FROM teacher_payroll_expenses WHERE payment_key=?",record.payment_key);
      const deleted=run("DELETE FROM operating_expenses WHERE id=?",record.expense_id);
      if(Number(deleted.changes)!==1)throw new ApiError(409,"No se encontró el egreso vinculado. No se modificó la nómina.");
    }
  }
}

function synchronizeExpenses(state:TeacherPayrollState,userId:number) {
  const concept=get<{id:number}>("SELECT id FROM expense_concepts WHERE name='Nómina docente'");
  if(!concept)throw new ApiError(409,"No se encontró el concepto de egreso Nómina docente.");
  const teachers=new Map(state.teachers.map(t=>[t.id,t]));
  for(const payment of state.payments) {
    const name=teachers.get(payment.teacherId)!.name;
    const values={concept:`Nómina docente por hora · ${name}`,amount:payment.amountCents/100,date:payment.date,notes:cleanText([payment.method,payment.note,`Trabajo: ${payment.from} a ${payment.to}`].filter(Boolean).join(" · "),1000)};
    const existing=get<ExpenseRow>("SELECT * FROM teacher_payroll_expenses WHERE payment_key=?",payment.id);
    if(existing) {
      const result=run("UPDATE operating_expenses SET concept=?,category='payroll',amount=?,paid_at=?,notes=?,concept_id=? WHERE id=?",values.concept,values.amount,values.date,values.notes,concept.id,existing.expense_id);
      if(Number(result.changes)!==1)throw new ApiError(409,"No se encontró el egreso vinculado. No se modificó la nómina.");
      run("UPDATE teacher_payroll_expenses SET teacher_key=?,amount_cents=?,payment_date=?,updated_at=CURRENT_TIMESTAMP WHERE payment_key=?",payment.teacherId,payment.amountCents,payment.date,payment.id);
    } else {
      const result=run("INSERT INTO operating_expenses(concept,category,amount,paid_at,notes,created_by,concept_id) VALUES(?,'payroll',?,?,?,?,?)",values.concept,values.amount,values.date,values.notes,userId,concept.id);
      run("INSERT INTO teacher_payroll_expenses(payment_key,teacher_key,expense_id,amount_cents,payment_date) VALUES(?,?,?,?,?)",payment.id,payment.teacherId,Number(result.lastInsertRowid),payment.amountCents,payment.date);
    }
  }
}

export function saveTeacherPayrollSnapshot(input:unknown,expectedVersion:unknown,actor:Actor) {
  if(typeof expectedVersion!=="number"||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new ApiError(400,"Incluye la versión del control docente que estás actualizando.");
  const normalized=validatedState(input);
  return transaction(()=>{
    const {row,state:previous}=storedState();
    if(row.version!==expectedVersion)throw new ApiError(409,"Otra persona guardó cambios en el control docente. Recarga los datos antes de volver a guardar; tus cambios no se sobrescribieron.",{version:row.version});
    const state={...normalized,catalogs:[...new Set([...previous.catalogs,...normalized.catalogs])]};
    for(const payment of state.payments) {
      const old=previous.payments.find(p=>p.id===payment.id);
      if(old&&old.teacherId!==payment.teacherId)throw new ApiError(409,"Un pago guardado no puede reasignarse a otro docente. Elimina el registro incorrecto y crea un pago nuevo con su propia referencia.");
    }
    // Delete reconciled ledgers before obsolete links, all within the same rollback boundary.
    removeMissingExpenses(state);
    synchronizeLinks(state);
    validateNewPayments(previous,state);
    synchronizeExpenses(state,actor.userId);
    const updated=run("UPDATE teacher_payroll_state SET state_json=?,version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND version=?",JSON.stringify(state),actor.userId,expectedVersion);
    if(Number(updated.changes)!==1)throw new ApiError(409,"La versión cambió. No se guardaron los cambios de nómina.");
    run("INSERT INTO activity_logs(user_id,action,entity_type,entity_id,details_json,ip_address) VALUES(?,'update','teacher_payroll','1',?,?)",actor.userId,
      JSON.stringify({version:expectedVersion+1,reason:cleanText(actor.reason,500),teachers:state.teachers.length,attendance:state.attendance.length,payments:state.payments.length}),actor.ip??null);
    return getTeacherPayrollSnapshot();
  });
}
