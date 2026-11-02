/* Núcleo independiente: fechas civiles, minutos y centavos enteros. */
const PayrollCore = (() => {
  'use strict';
  const DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && +s.slice(0,4)>=1900 && +s.slice(0,4)<=2200 && Number.isFinite(Date.parse(s+'T00:00:00Z')) && iso(new Date(s+'T00:00:00Z')) === s;
  const ordinal = s => Date.parse(s+'T00:00:00Z') / DAY;
  const addDays = (s,n) => iso(new Date((ordinal(s)+n)*DAY));
  const weekday = s => (new Date(s+'T00:00:00Z').getUTCDay()+6)%7;
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const monthRange = m => { const [y,n]=m.split('-').map(Number); return [m+'-01',iso(new Date(Date.UTC(y,n,0)))]; };
  const weekRange = d => { const a=addDays(d,-weekday(d)); return [a,addDays(a,6)]; };
  function* dates(from,to) { for(let n=ordinal(from),end=ordinal(to);n<=end;n++) yield iso(new Date(n*DAY)); }
  const minutes = value => {
    const s=String(value).trim().replace(',','.');
    if(/^\d{1,2}:\d{2}$/.test(s)) { const [h,m]=s.split(':').map(Number); if(m<60 && h*60+m<=1440)return h*60+m; }
    if(/^\d{1,2}(\.\d{1,4})?$/.test(s)) { const n=Math.round(Number(s)*60); if(n<=1440)return n; }
    throw new Error('Escribe horas entre 0 y 24, por ejemplo 2:30 o 2,5.');
  };
  const duration = m => `${Math.floor(m/60)}:${pad(m%60)}`;
  const cents = s => { const v=String(s).trim().replace(',','.'); if(!/^\d{1,7}(\.\d{1,2})?$/.test(v))throw new Error('Escribe un importe positivo con un máximo de dos decimales.'); return Math.round(Number(v)*100); };
  const amount = (mins,rate) => rate===null||rate===undefined?null:Math.round(mins*rate/60);
  const clock = m => `${pad(Math.floor(m/60))}:${pad(m%60)}`;
  function normalizeBlocks(input) {
    if(!Array.isArray(input)||input.length>500)throw new Error('El horario admite hasta 500 bloques.');
    const result=input.map(b=>{
      if(!b||!Number.isInteger(b.day)||b.day<0||b.day>6||!Number.isInteger(b.start)||!Number.isInteger(b.end)||b.start<0||b.end>1440||b.end<=b.start)throw new Error('Cada bloque necesita un día y una hora final posterior a la inicial.');
      if(typeof b.subject!=='string'||!b.subject.trim()||b.subject.length>200||typeof b.group!=='string'||b.group.length>100||typeof b.modality!=='string'||b.modality.length>100)throw new Error('Revisa materia, grupo y modalidad de cada bloque.');
      return {day:b.day,start:b.start,end:b.end,subject:b.subject.trim(),group:b.group.trim(),modality:b.modality.trim()};
    }).sort((a,b)=>a.day-b.day||a.start-b.start||a.end-b.end);
    for(let i=1;i<result.length;i++)if(result[i].day===result[i-1].day&&result[i].start<result[i-1].end)throw new Error('Hay clases que se superponen para el mismo docente y día. Corrige sus horas.');
    return result;
  }
  const scheduleFromBlocks=blocks=>normalizeBlocks(blocks).reduce((days,b)=>{days[b.day]+=b.end-b.start;return days;},[0,0,0,0,0,0,0]);
  function previewRevision(t,date=today()) {
    return t.revisions.filter(r=>!r.from||r.from<=date).sort((a,b)=>b.from.localeCompare(a.from))[0]||t.revisions[0];
  }
  const empty = () => ({schemaVersion:2,settings:{currency:'MXN',weekdays:[0,1,2,3,4],organization:'Mi centro educativo',demo:false,cycle:''},catalogs:[],teachers:[],rules:[],attendance:[],payments:[]});
  function engine(state) {
    const teachers=new Map(state.teachers.map(t=>[t.id,t]));
    const records=new Map(state.attendance.map(a=>[a.teacherId+'|'+a.date,a]));
    const paid=new Map();
    state.payments.forEach(p=>p.allocations.forEach(a=>{const k=p.teacherId+'|'+a.date;paid.set(k,(paid.get(k)||0)+a.cents);}));
    const cache=new Map();
    function contract(t,date) {
      if(!t||!t.start||date<t.start||(t.end&&date>t.end))return null;
      let found=null; for(const r of t.revisions)if(r.from<=date&&(!found||r.from>found.from))found=r;
      return found;
    }
    function rule(tid,date) {
      let global=null,personal=null;
      for(const r of state.rules)if(r.from<=date&&r.to>=date) { if(r.teacherId===tid)personal=r; else if(r.teacherId===null)global=r; }
      const r=personal||global;
      const weekdays=teachers.get(tid)?.weekdays||state.settings.weekdays;
      return r ? {kind:r.kind,reason:r.reason,source:r.teacherId?'Individual':'General',id:r.id} : {kind:weekdays.includes(weekday(date))?'open':'closed',reason:teachers.get(tid)?.weekdays?'Semana hábil del docente':'Calendario semanal base',source:'Base'};
    }
    function day(tid,date) {
      const k=tid+'|'+date; if(cache.has(k))return cache.get(k);
      const t=teachers.get(tid),r=contract(t,date),a=records.get(k),policy=rule(tid,date);
      const nominal=r?r.schedule[weekday(date)]:0,rate=r?r.rateCents:null;
      const priced=!!r&&rate!==null;
      const planned=policy.kind==='open'?nominal:0;
      const worked=r&&a?a.minutes:0;
      const credit=policy.kind==='paid'?Math.max(0,nominal-worked):0;
      const base=priced?amount(planned+(policy.kind==='paid'?nominal:0),rate):0;
      const earned=priced?amount(worked+credit,rate):0;
      const pending=r&&planned>0&&!a?planned:0;
      const discount=priced&&a&&policy.kind==='open'?Math.max(0,base-amount(worked,rate)):0;
      const missing=r&&a&&policy.kind==='open'?Math.max(0,planned-worked):0;
      const pendingCents=pending?base:0;
      const extra=Math.max(0,earned-base);
      const paidCents=paid.get(k)||0;
      let status=!r?'Fuera de vigencia':policy.kind==='paid'?'Suspensión pagada':policy.kind==='closed'?'No hábil / suspensión':planned?'Por confirmar':'Sin horario';
      if(r&&a)status=a.status==='absent'?'Falta completa':a.status==='partial'?'Registro parcial':worked>planned?'Horas extra':'Asistencia';
      const unpriced=!priced?worked+credit:0;
      const pendingRateMinutes=!priced?planned+credit:0;
      const blocks=r?.blocks?.filter(b=>b.day===weekday(date))||[];
      const result={date,teacherId:tid,teacher:t,contract:r,record:a,policy,nominal,rate,planned,worked,credit,base,earned,pending,discount,missing,pendingCents,extra,paid:paidCents,balance:earned-paidCents,status,unpriced,pendingRateMinutes,priced,blocks};
      cache.set(k,result);return result;
    }
    const fields=['nominal','planned','worked','credit','base','earned','pending','discount','missing','pendingCents','extra','paid','balance','unpriced','pendingRateMinutes'];
    function aggregate(from,to,teacherId='') {
      if(!validDate(from)||!validDate(to)||to<from||ordinal(to)-ordinal(from)>3660)throw new Error('El período debe contener fechas válidas y abarcar como máximo 10 años.');
      const selected=state.teachers.filter(t=>!teacherId||t.id===teacherId);
      const totals=Object.fromEntries(fields.map(k=>[k,0]));totals.pendingDays=0;totals.absentDays=0;totals.partialDays=0;
      const rows=selected.map(t=>{
        const row={teacher:t,days:[],...Object.fromEntries(fields.map(k=>[k,0])),pendingDays:0,absentDays:0,partialDays:0,datePending:!t.start};
        for(const date of dates(from,to)) {
          const d=day(t.id,date);
          if(d.nominal||d.record||d.paid||d.earned){row.days.push(d);for(const k of fields)row[k]+=d[k];if(d.pending)row.pendingDays++;if(d.record?.status==='absent'&&d.planned)row.absentDays++;if(d.record?.status==='partial'&&d.planned)row.partialDays++;}
        }
        for(const k of [...fields,'pendingDays','absentDays','partialDays'])totals[k]+=row[k];
        return row;
      });
      totals.owed=rows.reduce((n,r)=>n+Math.max(0,r.balance),0);
      totals.excess=rows.reduce((n,r)=>n+Math.max(0,-r.balance),0);
      return {rows,totals,from,to};
    }
    function allocate(tid,from,to,paymentCents) {
      const summary=aggregate(from,to,tid),net=summary.totals.balance;
      if(!summary.rows.length)throw new Error('Selecciona un docente válido.');
      if(summary.rows[0].datePending||summary.totals.unpriced||summary.totals.pendingRateMinutes)throw new Error('Configura las fechas de vigencia y las tarifas de este período antes de registrar el pago.');
      if(!Number.isInteger(paymentCents)||paymentCents<=0||paymentCents>Math.max(0,net))throw new Error('El pago debe ser mayor que cero y no superar el saldo confirmado de este período.');
      const allocations=[]; let rest=paymentCents;
      for(const d of summary.rows[0].days){const c=Math.min(rest,Math.max(0,d.balance));if(c){allocations.push({date:d.date,cents:c});rest-=c;}if(!rest)break;}
      if(rest)throw new Error('No fue posible distribuir el pago. Revisa el período.');return allocations;
    }
    return {contract,rule,day,aggregate,allocate,records,paid};
  }
  function validate(input) {
    const fail=m=>{throw new Error('Respaldo inválido: '+m);};
    const str=(v,max=200)=>{if(typeof v!=='string'||v.length>max)fail('texto fuera de formato.');return v;};
    const date=v=>{if(!validDate(v))fail('fecha no válida.');return v;};
    const integer=(v,min,max)=>{if(!Number.isInteger(v)||v<min||v>max)fail('valor numérico fuera de rango.');return v;};
    const array=(v,max)=>{if(!Array.isArray(v)||v.length>max)fail('lista fuera de formato.');return v;};
    const ids=new Set();const id=v=>{str(v,100);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(v)||ids.has(v))fail('identificador repetido o inválido.');ids.add(v);return v;};
    if(!input||![1,2].includes(input.schemaVersion))fail('versión incompatible.');
    const s=input.settings;if(!s||!['MXN','USD','EUR','COP','PEN','ARS','CLP'].includes(s.currency))fail('moneda desconocida.');
    const weekdays=array(s.weekdays,7).map(v=>integer(v,0,6));if(new Set(weekdays).size!==weekdays.length)fail('días repetidos.');
    const out=empty();out.settings={currency:s.currency,weekdays,organization:str(s.organization,120),demo:!!s.demo,cycle:str(s.cycle||'',100)};
    out.catalogs=array(input.catalogs||[],100).map(v=>str(v,100));if(new Set(out.catalogs).size!==out.catalogs.length)fail('cargas de horarios repetidas.');
    out.teachers=array(input.teachers,500).map(t=>{
      const from=t.start===''?'':date(t.start),end=t.end?date(t.end):'';if(end&&(!from||end<from))fail('vigencia invertida o sin inicio.');
      const seen=new Set();const revisions=array(t.revisions,1000).map(r=>{const f=from?date(r.from):r.from===''?'':fail('fecha pendiente inconsistente.');if(seen.has(f)||f<from)fail('vigencia de horario repetida o anterior al ingreso.');seen.add(f);const schedule=array(r.schedule,7).map(v=>integer(v,0,1440));if(schedule.length!==7)fail('se requieren siete días de horario.');const result={from:f,rateCents:r.rateCents===null?null:integer(r.rateCents,0,999999999),schedule};if(r.blocks!==undefined){result.blocks=normalizeBlocks(r.blocks);const derived=scheduleFromBlocks(result.blocks);if(derived.some((m,i)=>m!==schedule[i]))fail('las horas no coinciden con los bloques de clase.');}return result;}).sort((a,b)=>a.from.localeCompare(b.from));
      if(!revisions.length||revisions[0].from!==from)fail('falta la tarifa inicial.');
      if(!from&&revisions.length!==1)fail('un docente sin fecha solo puede tener un horario pendiente.');
      if(!str(t.name,100).trim())fail('docente sin nombre.');
      const teacher={id:id(t.id),name:t.name,role:str(t.role||'',100),start:from,end,notes:str(t.notes||'',2000),revisions};
      if(t.sourceKey!==undefined)teacher.sourceKey=str(t.sourceKey,100);
      if(t.weekdays!==undefined){teacher.weekdays=array(t.weekdays,7).map(v=>integer(v,0,6));if(new Set(teacher.weekdays).size!==teacher.weekdays.length)fail('días hábiles del docente repetidos.');}
      return teacher;
    });
    const tids=new Set(out.teachers.map(t=>t.id));const tid=v=>{if(!tids.has(v))fail('docente inexistente.');return v;};
    out.rules=array(input.rules,20000).map(r=>{const from=date(r.from),to=date(r.to);if(to<from||!['open','closed','paid'].includes(r.kind))fail('regla de calendario incorrecta.');return {id:id(r.id),teacherId:r.teacherId===null?null:tid(r.teacherId),from,to,kind:r.kind,reason:str(r.reason||'',300)};});
    const attendanceKeys=new Set();
    out.attendance=array(input.attendance,500000).map(a=>{const teacherId=tid(a.teacherId),d=date(a.date),k=teacherId+'|'+d;if(attendanceKeys.has(k))fail('asistencia duplicada.');attendanceKeys.add(k);if(!['present','partial','absent'].includes(a.status))fail('estado de asistencia inválido.');const minutes=integer(a.minutes,0,1440);if(a.status==='absent'&&minutes!==0)fail('una falta completa debe tener cero horas.');const t=out.teachers.find(t=>t.id===teacherId);if(!t.start||d<t.start||(t.end&&d>t.end))fail('asistencia fuera de vigencia.');return {teacherId,date:d,status:a.status,minutes,note:str(a.note||'',1000)};});
    out.payments=array(input.payments,100000).map(p=>{
      const teacherId=tid(p.teacherId),from=date(p.from),to=date(p.to),paymentDate=date(p.date);if(to<from)fail('período de pago invertido.');
      const seen=new Set();const allocations=array(p.allocations,10000).map(a=>{const d=date(a.date);if(d<from||d>to||seen.has(d))fail('distribución de pago fuera del período o repetida.');seen.add(d);return {date:d,cents:integer(a.cents,1,99999999999)};});
      const amountCents=integer(p.amountCents,1,99999999999);if(allocations.reduce((n,a)=>n+a.cents,0)!==amountCents)fail('el importe del pago no coincide con su distribución.');
      return {id:id(p.id),teacherId,date:paymentDate,from,to,amountCents,allocations,method:str(p.method||'',100),note:str(p.note||'',1000)};
    });return out;
  }
  return {validDate,ordinal,addDays,weekday,today,monthRange,weekRange,dates,minutes,duration,cents,amount,empty,engine,validate,pad,clock,normalizeBlocks,scheduleFromBlocks,previewRevision};
})();

export { PayrollCore };
export default PayrollCore;
