import { useEffect, useMemo, useState } from "react";
import { ArrowUpCircle, BookOpenCheck, CalendarRange, CheckCircle2, GraduationCap, Save, Search, School, UsersRound } from "lucide-react";
import { Button, EmptyState, Field, Select, StatusBadge } from "../components/Ui";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

type Group = {
  id: number;
  name: string;
  program_id: number;
  program_name: string;
  shift_id: number;
  shift_name: string;
  study_modality: "escolarizado" | "semiescolarizado" | "complementario" | "en_linea";
  capacity: number;
  is_active: number;
  formation_cycle_id: number;
  formation_cycle_name: string;
  active_cycle_id: number | null;
  active_cycle_name: string | null;
  plan_id: number | null;
  plan_name: string | null;
  plan_version: string | null;
  curricular_period_id: number | null;
  curricular_period_name: string | null;
  curricular_period_number: number | null;
  student_count: number;
  mismatch_count: number;
};

type Cycle = { id: number; name: string; start_date: string; end_date: string };
type Plan = { id: number; name: string; version: string; program_id: number; program_name: string };
type Period = { id: number; name: string; sequence: number };
type EnrolledStudent = {
  id: number;
  student_number: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status_name: string;
  status_color: string;
  enrollment_id: number;
  cycle_id: number;
  cycle_name: string;
  plan_id: number | null;
  plan_name: string | null;
  curricular_period_id: number | null;
  curricular_period_name: string | null;
  context_matches: number;
  promotion: {
    eligible: boolean;
    currentPeriodNumber: number;
    targetPeriodNumber: number;
    targetPeriodName: string | null;
    overdueMonths: number;
    overdueAmount: number;
    recentTwoPaymentsCovered: boolean;
    registrationPaidForTarget: boolean;
    reasons: string[];
  };
};

type ListResponse = { groups: Group[]; cycles: Cycle[]; plans: Plan[]; periods: Period[] };
type DetailResponse = { group: Group; students: EnrolledStudent[]; updatedStudents?: number };

const modalityLabels = {
  escolarizado: "Escolarizado",
  semiescolarizado: "Semiescolarizado",
  complementario: "Complementario",
  en_linea: "En Línea"
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function GroupManagementPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [groupSearch, setGroupSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [form, setForm] = useState({ activeCycleId: "", planId: "", curricularPeriodId: "", syncStudents: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function applyDetail(result: DetailResponse) {
    setDetail(result);
    setForm({
      activeCycleId: result.group.active_cycle_id ? String(result.group.active_cycle_id) : "",
      planId: result.group.plan_id ? String(result.group.plan_id) : "",
      curricularPeriodId: result.group.curricular_period_id ? String(result.group.curricular_period_id) : "",
      syncStudents: true
    });
  }

  async function loadDetail(groupId: number) {
    const result = await api<DetailResponse>(`/group-management/${groupId}`);
    setSelectedId(groupId);
    applyDetail(result);
  }

  async function load(preferredId?: number) {
    const result = await api<ListResponse>("/group-management");
    setGroups(result.groups);
    setCycles(result.cycles);
    setPlans(result.plans);
    setPeriods(result.periods);
    const nextId = preferredId && result.groups.some((group) => group.id === preferredId)
      ? preferredId
      : result.groups.find((group) => group.is_active)?.id ?? result.groups[0]?.id;
    if (nextId) await loadDetail(nextId);
    else {
      setSelectedId(null);
      setDetail(null);
    }
  }

  useEffect(() => {
    load().catch((error) => toast.error(error instanceof Error ? error.message : "No fue posible cargar los grupos."))
      .finally(() => setLoading(false));
  }, []);

  const filteredGroups = useMemo(() => {
    const term = normalized(groupSearch);
    if (!term) return groups;
    return groups.filter((group) => normalized(`${group.name} ${group.program_name} ${group.shift_name} ${group.active_cycle_name ?? ""}`).includes(term));
  }, [groups, groupSearch]);

  const compatiblePlans = useMemo(() => {
    const group = detail?.group;
    if (!group) return [];
    const programName = normalized(group.program_name);
    return plans.filter((plan) => plan.program_id === group.program_id
      || normalized(plan.program_name) === programName
      || normalized(plan.name) === programName);
  }, [detail?.group, plans]);

  const filteredStudents = useMemo(() => {
    const term = normalized(studentSearch);
    const students = detail?.students ?? [];
    if (!term) return students;
    return students.filter((student) => normalized(`${student.full_name} ${student.student_number} ${student.curricular_period_name ?? ""}`).includes(term));
  }, [detail?.students, studentSearch]);

  const formHasChanges = Boolean(detail && (
    form.activeCycleId !== String(detail.group.active_cycle_id ?? "")
    || form.planId !== String(detail.group.plan_id ?? "")
    || form.curricularPeriodId !== String(detail.group.curricular_period_id ?? "")
  ));

  async function saveContext(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api<DetailResponse>(`/group-management/${detail.group.id}/context`, {
        method: "PATCH",
        body: form
      });
      applyDetail(result);
      const refreshed = await api<ListResponse>("/group-management");
      setGroups(refreshed.groups);
      setCycles(refreshed.cycles);
      setPlans(refreshed.plans);
      setPeriods(refreshed.periods);
      toast.success(form.syncStudents
        ? `Contexto guardado y ${result.updatedStudents ?? 0} alumno(s) sincronizado(s).`
        : "Contexto académico del grupo guardado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar el grupo.");
    } finally {
      setBusy(false);
    }
  }

  async function promoteStudent(student: EnrolledStudent, force = false) {
    const action = force ? "promover manualmente" : "promover";
    if (!window.confirm(`¿${action} a ${student.full_name} a ${student.promotion.targetPeriodName ?? `semestre ${student.promotion.targetPeriodNumber}`}?${force ? " Esta acción omitirá las validaciones automáticas." : ""}`)) return;
    setBusy(true);
    try {
      const result = await api<{ message: string; students: EnrolledStudent[] }>(`/group-management/enrollments/${student.enrollment_id}/promote`, { method: "POST", body: { force } });
      setDetail((current) => current ? { ...current, students: result.students } : current);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible promover al alumno.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group-admin-page">
      <section className="group-admin-intro">
        <div className="group-admin-intro-icon"><School size={26} /></div>
        <div><span>Control académico por grupo</span><h2>Administración de grupos</h2><p>Consulta su matrícula y establece el plan y ciclo escolar que cursan actualmente.</p></div>
        <div className="group-admin-total"><strong>{groups.reduce((total, group) => total + Number(group.student_count), 0)}</strong><span>alumnos inscritos</span></div>
      </section>

      <section className="group-admin-layout">
        <aside className="group-admin-pane">
          <header><div><span>Grupos registrados</span><strong>{groups.length} grupos</strong></div></header>
          <div className="group-admin-search search-box"><Search size={16} /><input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Buscar grupo o programa" /></div>
          <div className="group-admin-list">
            {filteredGroups.map((group) => (
              <button key={group.id} className={selectedId === group.id ? "active" : ""} onClick={() => loadDetail(group.id)}>
                <div className="group-admin-monogram">{group.name.slice(0, 3)}</div>
                <div><strong>{group.name}</strong><span>{group.program_name}</span><small>{group.student_count} alumnos · {group.active_cycle_name ?? "Sin ciclo activo"}</small></div>
                <i className={group.plan_id && group.active_cycle_id ? "ready" : "pending"} />
              </button>
            ))}
            {!filteredGroups.length && <p className="group-list-empty">No hay grupos que coincidan.</p>}
          </div>
        </aside>

        <div className="group-admin-workspace">
          {loading ? <div className="loading-panel">Cargando administración de grupos…</div> : detail ? <>
            <header className="group-admin-header">
              <div><span>{detail.group.program_name}</span><h2>{detail.group.name}</h2><p>{detail.group.shift_name} · {modalityLabels[detail.group.study_modality]} · Generación {detail.group.formation_cycle_name}</p></div>
              <StatusBadge active={Boolean(detail.group.is_active)} />
            </header>

            <div className="group-admin-metrics">
              <div><UsersRound size={20} /><span>Alumnos inscritos</span><strong>{detail.group.student_count} / {detail.group.capacity}</strong></div>
              <div><CalendarRange size={20} /><span>Ciclo activo</span><strong>{detail.group.active_cycle_name ?? "Por definir"}</strong></div>
              <div><BookOpenCheck size={20} /><span>Plan aplicado</span><strong>{detail.group.plan_name ?? "Por definir"}</strong></div>
              <div><GraduationCap size={20} /><span>Semestre del grupo</span><strong>{detail.group.curricular_period_name ?? "Por definir"}</strong></div>
              <div className={!detail.group.plan_id || !detail.group.active_cycle_id || detail.group.mismatch_count ? "metric-warning" : "metric-ready"}><CheckCircle2 size={20} /><span>Contexto de alumnos</span><strong>{!detail.group.plan_id || !detail.group.active_cycle_id ? "Por configurar" : detail.group.mismatch_count ? `${detail.group.mismatch_count} por sincronizar` : "Sincronizado"}</strong></div>
            </div>

            <form className="group-context-form" onSubmit={saveContext}>
              <div className="group-context-copy"><span>Configuración vigente</span><strong>Ciclo escolar y plan aplicado</strong><p>El ciclo de generación permanece intacto; aquí se controla el periodo que cursa el grupo.</p></div>
              <Field label="Ciclo escolar activo" required><Select options={cycles} value={form.activeCycleId} onChange={(event) => setForm({ ...form, activeCycleId: event.target.value })} required /></Field>
              <Field label="Plan académico aplicado" required><Select options={compatiblePlans.map((plan) => ({ id: plan.id, name: `${plan.name} · ${plan.version}` }))} value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })} required /></Field>
              <Field label="Semestre actual del grupo" required><Select options={periods} value={form.curricularPeriodId} onChange={(event) => setForm({ ...form, curricularPeriodId: event.target.value })} required /></Field>
              {can("students.manage") && <div className="group-context-actions">
                <label className="check-row group-sync-check"><input type="checkbox" checked={form.syncStudents} onChange={(event) => setForm({ ...form, syncStudents: event.target.checked })} /><span>Aplicar ciclo, plan y semestre a todos los alumnos inscritos</span></label>
                <Button type="submit" icon={<Save size={17} />} busy={busy} disabled={!form.activeCycleId || !form.planId || !form.curricularPeriodId || (!formHasChanges && !detail.group.mismatch_count)}>Guardar y sincronizar</Button>
              </div>}
            </form>

            <div className="group-roster-heading">
              <div><span>Matrícula activa</span><h3>Alumnos inscritos en {detail.group.name}</h3></div>
              <div className="search-box compact"><Search size={16} /><input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Buscar alumno" /></div>
            </div>
            {filteredStudents.length ? <div className="table-wrap group-roster-table"><table><thead><tr><th>Alumno</th><th>Periodo del plan</th><th>Reinscripción destino</th><th>Promoción</th><th>Estado</th></tr></thead><tbody>
              {filteredStudents.map((student) => <tr key={student.enrollment_id}>
                <td><div className="person-cell"><div className="mini-avatar">{student.full_name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div><div><strong>{student.full_name}</strong><span>{student.student_number}</span></div></div></td>
                <td>{student.curricular_period_name ?? "Sin definir"}</td>
                <td><StatusBadge active={student.promotion.registrationPaidForTarget} label={student.promotion.registrationPaidForTarget ? `${student.promotion.targetPeriodNumber}° PAGADA` : `${student.promotion.targetPeriodNumber}° PENDIENTE`} /></td>
                <td>{can("students.manage") ? <div className="inline-actions"><button className="promotion-button" disabled={busy || !student.promotion.eligible} onClick={() => promoteStudent(student)} title="Promover con validaciones"><ArrowUpCircle size={16} /> Promover</button>{!student.promotion.eligible && <button className="promotion-button force" disabled={busy} onClick={() => promoteStudent(student, true)} title="Promoción administrativa forzada"><ArrowUpCircle size={16} /> Forzar</button>}</div> : <StatusBadge active={student.promotion.eligible} label={student.promotion.eligible ? "AUTORIZADA" : "REVISIÓN ADMINISTRATIVA"} />}</td>
                <td><StatusBadge active={Boolean(student.context_matches)} label={student.context_matches ? "Sincronizado" : !detail.group.plan_id || !detail.group.active_cycle_id ? "Por configurar" : "Por sincronizar"} /></td>
              </tr>)}
            </tbody></table></div> : <EmptyState icon={<GraduationCap size={25} />} title={studentSearch ? "Sin coincidencias" : "Grupo sin alumnos inscritos"} text={studentSearch ? "Prueba con otro nombre o matrícula." : "Los alumnos aparecerán aquí al ser dados de alta en este grupo."} />}
          </> : <EmptyState icon={<School size={27} />} title="Aún no hay grupos" text="Crea un grupo desde Catálogos para administrarlo en esta sección." />}
        </div>
      </section>
    </div>
  );
}
