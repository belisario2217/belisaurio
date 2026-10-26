import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Award, CircleGauge, GraduationCap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, LoadingState } from "../components/Ui";

type Dossier = { student:{id:number;first_name:string;last_name:string;second_last_name:string|null;student_number:string;curp:string|null;birth_date:string|null;email:string|null;phone:string|null;near_graduation:number};academic:{student:{program_name:string;group_name:string;plan_name:string};progress:{percentage:number;completedSubjects:number;totalSubjects:number;earnedCredits:number;totalCredits:number;average:number|null};subjects:Array<{subject_id:number;name:string;code:string;recommended_period:number;status:string;explicit_status?:string;final_score:number|null}>;billing?:{summary:{paidAmount:number;balance:number};payments:Array<{id:number;paid_at:string;concept:string;amount:number}>}}|null };
const money=(v:number)=>v.toLocaleString('es-MX',{style:'currency',currency:'MXN'});
export function StudentDossierPage() {
  const {id}=useParams(),{can}=useAuth(),toast=useToast();
  const [data,setData]=useState<Dossier|null>(null),[error,setError]=useState(''),[tab,setTab]=useState('academic');
  useEffect(()=>{setData(null);setError('');const controller=new AbortController();api<Dossier>(`/improvements/students/${id}`,{signal:controller.signal}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[id]);
  async function mark(){if(!data)return;try{await api(`/improvements/students/${id}/graduation`,{method:'PATCH',body:{nearGraduation:!data.student.near_graduation}});setData({...data,student:{...data.student,near_graduation:data.student.near_graduation?0:1}});toast.success('Distintivo actualizado.');}catch(e){toast.error(e instanceof Error?e.message:'No se guardó el distintivo.');}}
  if(error)return <p role="alert" className="assistant-error">{error}</p>;
  if(!data)return <LoadingState label="Consultando expediente académico"/>;
  const {student:s,academic:a}=data;
  return <div className="page-stack"><Link to="/alumnos">← Volver a alumnos</Link><section className="overview-strip"><div><span>Expediente · {s.student_number}</span><h2>{[s.first_name,s.last_name,s.second_last_name].filter(Boolean).join(' ')}</h2><p>{a?.student.program_name||'Sin inscripción activa'} · {a?.student.group_name||'Sin grupo'}</p>{Boolean(s.near_graduation)&&<span className="graduation-badge"><Award size={16}/> Próximo a egresar</span>}</div>{can('students.manage')&&<Button variant="secondary" icon={<GraduationCap size={17}/>} onClick={()=>void mark()}>{s.near_graduation?'Quitar distintivo':'Marcar próximo a egresar'}</Button>}</section>
    <nav className="dossier-tabs" aria-label="Secciones del expediente">{[['academic','Avance académico'],['profile','Datos personales'],...(a?.billing?[['payments','Cobros']]:[])].map(([key,label])=><button key={key} aria-pressed={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    {tab==='profile'&&<section className="panel"><dl className="profile-grid">{[['Matrícula',s.student_number],['CURP',s.curp],['Nacimiento',s.birth_date],['Correo',s.email],['Teléfono',s.phone],['Plan',a?.student.plan_name]].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'Sin registrar'}</dd></div>)}</dl></section>}
    {tab==='academic'&&<section className="panel"><div className="panel-heading"><div><span>Avance curricular</span><h3>{a?.progress.percentage??0}% del plan completado</h3></div><CircleGauge/></div><div className="workspace-help"><progress max="100" value={a?.progress.percentage??0}/><p>{a?.progress.completedSubjects??0} de {a?.progress.totalSubjects??0} materias acreditadas · {a?.progress.earnedCredits??0} de {a?.progress.totalCredits??0} créditos. Las materias pendientes y en curso no se cuentan como acreditadas.</p></div>
      <div className="table-wrap"><table><thead><tr><th>Materia</th><th>Periodo del plan</th><th>Estado</th><th>Calificación</th></tr></thead><tbody>{a?.subjects.map(su=><tr key={su.subject_id}><td><strong>{su.name}</strong><small className="table-sub">{su.code}</small></td><td>{su.recommended_period}</td><td>{su.status==='passed'?'Acreditada':su.status==='failed'?'No aprobada':su.explicit_status==='in_progress'||su.status==='in_progress'?'En curso':'Pendiente'}</td><td>{su.final_score??'Sin calificación'}</td></tr>)}</tbody></table></div>{!a?.subjects.length&&<p className="workspace-help">No hay materias del plan registradas todavía.</p>}
    </section>}
    {tab==='payments'&&a?.billing&&<section className="panel"><div className="panel-heading"><h3>Estado de cuenta</h3></div><p className="workspace-help">Pagado: {money(a.billing.summary.paidAmount)} · Saldo: {money(a.billing.summary.balance)}</p><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>{a.billing.payments.map(p=><tr key={p.id}><td>{p.paid_at}</td><td>{p.concept}</td><td>{money(p.amount)}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
