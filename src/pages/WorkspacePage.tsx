import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpenCheck, CircleGauge, FileText, GraduationCap, ReceiptText, School, Sparkles, UsersRound } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EmptyState, LoadingState } from "../components/Ui";
import { DashboardPage } from "./DashboardPage";

type Workspace = { counts?: Record<string, number>; teacher?: { full_name: string; teacher_number: string; specialty: string | null }; groups?: Array<{id:number;name:string;program_name:string}>; assignments?: Array<{id:number;subject_name:string;group_name:string;period_name:string}> };
export function WorkspacePage() {
  const { user, can } = useAuth();
  const [data,setData] = useState<Workspace|null>(null), [error,setError] = useState('');
  useEffect(()=>{api<Workspace>('/improvements/workspace').then(setData).catch(e=>setError(e.message));},[]);
  const actions = [
    { to:'/alumnos', label:'Alumnos y expedientes', description:'Consulta fichas, avance y próximos egresos.', permission:'students.view', icon:GraduationCap },
    { to:'/calificaciones',label:'Calificaciones',description:'Captura y revisa resultados por grupo y materia.',permission:'grades.view',icon:BookOpenCheck },
    { to:'/documentos',label:'Documentos oficiales',description:'Genera boletas y constancias de estudios.',permission:'reports.view',icon:FileText },
    { to:'/reportes',label:'Reportes y avance',description:'Consulta resultados y administra el avance curricular.',permission:'reports.view',icon:CircleGauge },
    { to:'/balance',label:'Balance mensual',description:'Compara ingresos, egresos y nómina.',permission:'payments.view',icon:ReceiptText },
    { to:'/asistente-importacion',label:'Asistente de archivos',description:'Adapta documentos y aprende formatos confirmados.',permission:can('students.import')?'students.import':'grades.import',icon:Sparkles }
  ];
  return <div className="page-stack">
    <section className="overview-strip"><div><span>{user?.roleName} · Campus Frontera</span><h2>Hola, {user?.fullName.split(' ')[0]}</h2><p>Tu espacio de trabajo en Universidad IFOP.</p></div></section>
    {error&&<p className="assistant-error" role="alert">{error}</p>}
    {!data&&!error&&<LoadingState label="Preparando tu vista"/>}
    {data?.counts&&<section className="metric-grid">{Object.entries(data.counts).map(([key,count])=><article className="metric" key={key}><UsersRound/><div><span>{{students:'Alumnos activos',groups:'Grupos activos',teachers:'Docentes activos',nearGraduation:'Próximos a egresar'}[key]}</span><strong>{count}</strong></div></article>)}</section>}
    {data?.teacher&&<section className="panel"><div className="panel-heading"><div><span>Mi perfil docente</span><h3>{data.teacher.full_name}</h3></div><GraduationCap/></div><p className="workspace-help">Matrícula docente: <strong>{data.teacher.teacher_number}</strong>{data.teacher.specialty&&` · ${data.teacher.specialty}`}. Tu cuenta está ligada directamente a esta ficha.</p>
      <div className="table-wrap"><table><thead><tr><th>Grupo</th><th>Materia</th><th>Evaluación</th><th>Acciones</th></tr></thead><tbody>{data.assignments?.map(a=><tr key={a.id}><td>{a.group_name}</td><td>{a.subject_name}</td><td>{a.period_name}</td><td><Link to="/calificaciones">Ver calificaciones</Link></td></tr>)}</tbody></table></div>{!data.assignments?.length&&<EmptyState icon={<School/>} title="Sin materias asignadas" text="Tus grupos y materias aparecerán cuando administración los vincule a tu ficha docente."/>}</section>}
    <section className="workspace-grid">{actions.filter(a=>can(a.permission)).map(a=><Link key={a.to} to={a.to} className="workspace-card"><a.icon size={26}/><h3>{a.label}</h3><p>{a.description}</p></Link>)}</section>
    {can('analytics.view')&&<DashboardPage/>}
  </div>;
}
