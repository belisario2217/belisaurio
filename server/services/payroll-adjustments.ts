import { get } from "../db.js";
import { ApiError, asId, cleanText } from "../utils.js";
import { isoDate, payrollCalculation } from "./payroll.js";

const cents=(amount:number)=>Math.round(amount*100);
const money=(value:number)=>Math.round(value*100)/100;

/** Calculates the cash amount to pay, including authorized deductions and loan repayments. */
export function payrollWithDeductions(profile:{kind:string;rate:number;weekly_hours:number;id?:number},input:any,existingPaymentId?:number) {
 const base=payrollCalculation(profile,input);
 const manual=Number(input.manualDeduction??0);
 const reason=cleanText(input.deductionReason,300);
 if(!Number.isFinite(manual)||manual<0||manual>1e8||Math.abs(manual*100-Math.round(manual*100))>1e-6)throw new ApiError(400,'Ingresa un descuento válido con máximo dos decimales.');
 if(manual>0&&!reason)throw new ApiError(400,'Indica el motivo del descuento de nómina.');
 const paidAt=input.paidAt?isoDate(input.paidAt,"Fecha de pago"):null;
 const deductionIdsInput:unknown=input.deductionIds??[];
 if(!Array.isArray(deductionIdsInput)||deductionIdsInput.length>100)throw new ApiError(400,'Revisa los descuentos seleccionados.');
 const deductionIds:number[]=[];
 const seenDeductions=new Set<number>();
 let registeredCents=0;
 for(const rawId of deductionIdsInput){
  const id=asId(rawId,'Descuento');
  if(seenDeductions.has(id))throw new ApiError(400,'No puedes aplicar dos veces el mismo descuento.');
  seenDeductions.add(id);
  const deduction=get<{profile_id:number;amount:number;effective_date:string;payment_id:number|null}>('SELECT profile_id,amount,effective_date,payment_id FROM payroll_deductions WHERE id=?',id);
  if(!deduction)throw new ApiError(404,'El descuento ya no existe.');
  if(deduction.profile_id!==profile.id)throw new ApiError(400,'El descuento no pertenece a este trabajador.');
  if(deduction.payment_id!==null&&deduction.payment_id!==existingPaymentId)throw new ApiError(409,'Este descuento ya fue aplicado a otra nómina.');
  if(paidAt&&paidAt<deduction.effective_date)throw new ApiError(400,'La fecha de pago es anterior a la fecha del descuento.');
  deductionIds.push(id);
  registeredCents+=cents(deduction.amount);
 }
 const items:unknown=input.loanRepayments??[];
 if(!Array.isArray(items)||items.length>50)throw new ApiError(400,'Revisa los descuentos de adelantos y préstamos.');
 const selected=new Set<number>();
 const repayments:{loanId:number;amount:number}[]=[];
 let loanCents=0;
 for(const item of items){
  if(!item||typeof item!=='object')throw new ApiError(400,'Préstamo no válido.');
  const value=item as {loanId?:unknown;amount?:unknown};
  const amount=Number(value.amount),loanId=asId(value.loanId,'Adelanto o préstamo');
  if(selected.has(loanId))throw new ApiError(400,'Un préstamo solo puede descontarse una vez por nómina.');
  selected.add(loanId);
  if(!Number.isFinite(amount)||amount<=0||Math.abs(amount*100-Math.round(amount*100))>1e-6)throw new ApiError(400,'El descuento del préstamo debe ser positivo y tener máximo dos decimales.');
  const loan=get<{profile_id:number;principal:number;paid:number;issued_at:string}>(`SELECT l.profile_id,l.principal,l.issued_at,COALESCE((SELECT SUM(r.amount) FROM payroll_loan_repayments r
   WHERE r.loan_id=l.id AND r.payment_id<>?),0) AS paid FROM payroll_loans l WHERE l.id=?`,existingPaymentId??0,loanId);
  if(!loan)throw new ApiError(404,'No se encontró el adelanto o préstamo.');
  if(paidAt&&paidAt<loan.issued_at)throw new ApiError(400,'No puedes recuperar el préstamo antes de su fecha de entrega.');
  if(loan.profile_id!==profile.id)throw new ApiError(400,'El préstamo no corresponde a esta persona.');
  if(cents(amount)>cents(loan.principal)-cents(loan.paid))throw new ApiError(409,'El descuento supera el saldo pendiente del préstamo.');
  repayments.push({loanId,amount:money(amount)});
  loanCents+=cents(amount);
 }
 const grossCents=cents(base.amount),manualCents=cents(manual),netCents=grossCents-manualCents-registeredCents-loanCents;
 if(netCents<=0)throw new ApiError(400,'El pago neto debe ser mayor a cero. Reduce los descuentos.');
 return {...base,grossAmount:base.amount,manualDeduction:money(manual),deductionReason:reason,
  loanRepayments:repayments,deductionIds,registeredDeduction:registeredCents/100,loanDeduction:loanCents/100,totalDeductions:(manualCents+registeredCents+loanCents)/100,
  netAmount:netCents/100,amount:netCents/100};
}