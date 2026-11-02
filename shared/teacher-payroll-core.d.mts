export interface PayrollBlock { day:number; start:number; end:number; subject:string; group:string; modality:string }
export interface PayrollRevision { from:string; rateCents:number|null; schedule:number[]; blocks?:PayrollBlock[] }
export interface PayrollTeacher { id:string; name:string; role:string; start:string; end:string; notes:string; revisions:PayrollRevision[]; sourceKey?:string; weekdays?:number[] }
export interface PayrollRule { id:string; teacherId:string|null; from:string; to:string; kind:'open'|'closed'|'paid'; reason:string }
export interface PayrollAttendance { teacherId:string; date:string; status:'present'|'partial'|'absent'; minutes:number; note:string }
export interface PayrollAllocation { date:string; cents:number }
export interface PayrollPayment { id:string; teacherId:string; date:string; from:string; to:string; amountCents:number; allocations:PayrollAllocation[]; method:string; note:string }
export interface PayrollState { schemaVersion:2; settings:{ currency:string; weekdays:number[]; organization:string; demo:boolean; cycle:string }; catalogs:string[]; teachers:PayrollTeacher[]; rules:PayrollRule[]; attendance:PayrollAttendance[]; payments:PayrollPayment[] }
export interface PayrollSums { nominal:number; planned:number; worked:number; credit:number; base:number; earned:number; pending:number; discount:number; missing:number; pendingCents:number; extra:number; paid:number; balance:number; unpriced:number; pendingRateMinutes:number }
export interface PayrollDay extends PayrollSums { date:string; teacherId:string; teacher:PayrollTeacher; contract:PayrollRevision|null; record?:PayrollAttendance; policy:{kind:'open'|'closed'|'paid';reason:string;source:string;id?:string}; rate:number|null; status:string; priced:boolean; blocks:PayrollBlock[] }
export interface PayrollRow extends PayrollSums { teacher:PayrollTeacher; days:PayrollDay[]; datePending:boolean; pendingDays:number; absentDays:number; partialDays:number }
export interface PayrollTotals extends PayrollSums { pendingDays:number; absentDays:number; partialDays:number; owed:number; excess:number }
export interface PayrollAggregate { rows:PayrollRow[]; totals:PayrollTotals; from:string; to:string }
export interface PayrollEngine { contract(teacher:PayrollTeacher,date:string):PayrollRevision|null; rule(teacherId:string,date:string):PayrollDay['policy']; day(teacherId:string,date:string):PayrollDay; aggregate(from:string,to:string,teacherId?:string):PayrollAggregate; allocate(teacherId:string,from:string,to:string,cents:number):PayrollAllocation[]; records:Map<string,PayrollAttendance>; paid:Map<string,number> }
export interface PayrollCoreApi {
 validDate(value:unknown):boolean; ordinal(date:string):number; addDays(date:string,n:number):string; weekday(date:string):number; today():string; monthRange(month:string):[string,string]; weekRange(date:string):[string,string]; dates(from:string,to:string):Generator<string>; minutes(value:unknown):number; duration(minutes:number):string; cents(value:unknown):number;
 amount(minutes:number,rate:number):number; amount(minutes:number,rate:null|undefined):null; amount(minutes:number,rate:number|null|undefined):number|null;
 empty():PayrollState; engine(state:PayrollState):PayrollEngine; validate(input:unknown):PayrollState; pad(value:number):string; clock(minutes:number):string; normalizeBlocks(input:unknown):PayrollBlock[]; scheduleFromBlocks(input:unknown):number[]; previewRevision(teacher:PayrollTeacher,date?:string):PayrollRevision;
}
declare const PayrollCore:PayrollCoreApi;
export {PayrollCore};
export default PayrollCore;
