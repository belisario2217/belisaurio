import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Award, BarChart3, BookOpenCheck, FileText, GraduationCap, IdCard, ReceiptText, School, Sparkles, TableProperties, UsersRound, Wallet } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EmptyState, LoadingState } from "../components/Ui";
import { DashboardPage } from "./DashboardPage";

type Workspace = { counts?: Record<string, number>; teacher?: { full_name: string; teacher_number: string; specialty: string | null }; groups?: Array<{id:number;name:string;program_name:string}>; assignments?: Array<{id:number;subject_name:string;group_name:string;period_name:string}> };
const metrics = [
  {key:"students",label:"Alumnos activos",icon:GraduationCap,tone:"general"},
  {key:"groups",label:"Grupos activos",icon:School,tone:"academic"},
  {key:"teachers",label:"Docentes activos",icon:UsersRound,tone:"campus"},
  {key:"nearGraduation",label:"Próximos a egresar",icon:Award,tone:"community"}
];

export function WorkspacePage() {
  const { user, can } = useAuth();
  const [data,setData] = useState<Workspace|null>(null), [error,setError] = useState("");
  useEffect(()=>{
    const controller=new AbortController();
    api<Workspace>("/improvements/workspace",{signal:controller.signal}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[]);
  const groups = [
    {name:"Gestión académica",description:"Las personas y su formación.",tone:"academic",actions:[
      {to:"/alumnos",label:"Alumnos y expedientes",description:"Consulta fichas y trayectorias.",permission:"students.view",icon:GraduationCap},
      {to:"/grupos",label:"Grupos",description:"Organiza grupos y semestres.",permission:"students.view",icon:School},
      {to:"/calificaciones",label:"Calificaciones",description:"Revisa y captura resultados.",permission:"grades.view",icon:BookOpenCheck}
    ]},
    {name:"Servicios escolares",description:"Documentos, identidad y archivos.",tone:"campus",actions:[
      {to:"/documentos",label:"Documentos oficiales",description:"Emite boletas y constancias.",permission:"reports.view",icon:FileText},
      {to:"/reportes",label:"Reportes y avance",description:"Consulta información académica.",permission:"reports.view",icon:BarChart3},
      {to:"/credenciales",label:"Credenciales",description:"Gestiona fotos y acreditaciones.",permission:"credentials.manage",icon:IdCard},
      {to:"/asistente-importacion",label:"Asistente de archivos",description:"Prepara tus cargas de datos.",permission:can("students.import")?"students.import":"grades.import",icon:Sparkles}
    ]},
    {name:"Finanzas",description:"Cuentas claras, en un mismo lugar.",tone:"finance",actions:[
      {to:"/cobros",label:"Cobros",description:"Consulta pagos y estados de cuenta.",permission:"payments.view",icon:ReceiptText},
      {to:"/colegiaturas-mensuales",label:"Colegiaturas",description:"Revisa la cobertura por mes.",permission:"tuition.manage",icon:TableProperties},
      {to:"/balance",label:"Balance mensual",description:"Consulta ingresos y egresos.",permission:"payments.view",icon:Wallet}
    ]}
  ];
  return <div className="page-stack workspace-home">
    <section className="overview-strip workspace-hero">
      <div><span className="workspace-hero-label"><Sparkles size={15}/>{user?.roleName} · Tu espacio IFOP</span><h2>Hola, <em>{user?.fullName.split(" ")[0]}</em><span>.</span></h2><p>Todo listo para lo que sigue. Organiza tu día y conecta con tu comunidad.</p></div>
      <div className="workspace-hero-orb" aria-hidden="true"><GraduationCap size={54} strokeWidth={1.15}/></div>
    </section>
    {error&&<p className="assistant-error" role="alert">{error}</p>}
    {!data&&!error&&<LoadingState label="Preparando tu vista"/>}
    {data?.counts&&<section className="workspace-stats" aria-label="Resumen de la comunidad">{metrics.filter(metric=>data.counts![metric.key]!==undefined).map(metric=><article className="workspace-stat" data-tone={metric.tone} key={metric.key}><span className="workspace-stat-icon"><metric.icon size={21}/></span><div><span>{metric.label}</span><strong>{data.counts![metric.key]}</strong></div><span className="workspace-stat-detail">Comunidad IFOP</span></article>)}</section>}
    {data?.teacher&&<section className="panel"><div className="panel-heading"><div><span>Mi perfil docente</span><h3>{data.teacher.full_name}</h3></div><GraduationCap/></div><p className="workspace-help">Matrícula docente: <strong>{data.teacher.teacher_number}</strong>{data.teacher.specialty&&` · ${data.teacher.specialty}`}. Tu cuenta está ligada directamente a esta ficha.</p>
      <div className="table-wrap"><table><thead><tr><th>Grupo</th><th>Materia</th><th>Evaluación</th><th>Acciones</th></tr></thead><tbody>{data.assignments?.map(a=><tr key={a.id}><td>{a.group_name}</td><td>{a.subject_name}</td><td>{a.period_name}</td><td><Link to="/calificaciones">Ver calificaciones</Link></td></tr>)}</tbody></table></div>{!data.assignments?.length&&<EmptyState icon={<School/>} title="Sin materias asignadas" text="Tus grupos y materias aparecerán cuando administración los vincule a tu ficha docente."/>}</section>}
    {groups.map(group=>{
      const actions=group.actions.filter(action=>can(action.permission));
      return actions.length>0&&<section className="workspace-group" data-tone={group.tone} data-count={actions.length} key={group.name}>
        <header className="workspace-group-heading"><div><h3>{group.name}</h3><p>{group.description}</p></div><span>{actions.length} {actions.length === 1 ? "acceso" : "accesos"}</span></header>
        <div className="workspace-grid">{actions.map(action=><Link key={action.to} to={action.to} className="workspace-card"><div className="workspace-card-top"><span><action.icon size={23}/></span><ArrowUpRight size={17}/></div><h3>{action.label}</h3><p>{action.description}</p></Link>)}</div>
      </section>;
    })}
    {can("analytics.view")&&<DashboardPage/>}
  </div>;
}
