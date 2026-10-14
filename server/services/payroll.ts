import { ApiError } from "../utils.js";
export function isoDate(value: unknown, label: string) {
  const date = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, `${label}: usa una fecha válida.`);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new ApiError(400, `${label}: la fecha no existe.`);
  return date;
}
export function payrollCalculation(profile: {kind:string;rate:number;weekly_hours:number}, input: any) {
  const periodStart=isoDate(input.periodStart,'Inicio del periodo'), periodEnd=isoDate(input.periodEnd,'Fin del periodo');
  const span=(Date.parse(periodEnd)-Date.parse(periodStart))/86400000+1;
  if(span<1||span>366)throw new ApiError(400,'El periodo debe durar entre 1 y 366 días.');
  const rate=Number(profile.rate), weeklyHours=profile.kind==='teacher'?Number(input.weeklyHours??profile.weekly_hours):0;
  const weeks=profile.kind==='teacher'?Number(input.weeks):0, workedDays=profile.kind==='administrative'?Number(input.workedDays):0;
  if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(weeklyHours)||weeklyHours<0||weeklyHours>168||!Number.isFinite(weeks)||weeks<0||weeks>Math.ceil(span/7)||!Number.isFinite(workedDays)||workedDays<0||workedDays>span||!Number.isInteger(workedDays))throw new ApiError(400,'Revisa tarifa, horas semanales, semanas pagadas o días trabajados.');
  const amount=Math.round((profile.kind==='teacher'?weeklyHours*weeks*rate:workedDays*rate)*100)/100;
  if(amount<=0||amount>1e8)throw new ApiError(400,'El cálculo debe producir un importe mayor que cero y dentro del límite de registro.');
  return {periodStart,periodEnd,rate,weeklyHours,weeks,workedDays,amount,formula:profile.kind==='teacher'?`${weeklyHours} horas/semana × ${weeks} semanas × $${rate}/hora`:`${workedDays} días × $${rate}/día`};
}
