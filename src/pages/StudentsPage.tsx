import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, ChevronLeft, ChevronRight, Download, FileDown, FileSpreadsheet, FileText, MoreHorizontal,
  Pencil, Plus, Power, Printer, Search, Upload, UserRound, UsersRound, Trash2, TriangleAlert
} from "lucide-react";
import { api, download, openDocument } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { Button, EmptyState, Field, Select, StatusBadge } from "../components/Ui";

type Student = {
  id: number;
  near_graduation: number;
  student_number: string;
  first_name: string;
  last_name: string;
  second_last_name: string | null;
  full_name: string;
  curp: string | null;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_active: number;
  status_id: number;
  status_name: string;
  status_color: string;
  program_id: number;
  program_name: string;
  shift_id: number;
  shift_name: string;
  group_id: number;
  group_name: string;
  cycle_id: number;
  cycle_name: string;
  curricular_period_id: number | null;
  curricular_period_name: string | null;
  curricular_period_number: number | null;
  plan_id: number | null;
  plan_name: string | null;
  study_modality: "escolarizado" | "semiescolarizado" | "complementario" | "en_linea" | null;
  registration_paid: number;
  registration_folio: string | null;
  registration_amount: number | null;
  registration_paid_at: string | null;
  financial_clearance_override: number;
  financial_override_note: string | null;
};

type Option = {
  id: number;
  name: string;
  color?: string;
  program_id?: number;
  shift_id?: number;
  cycle_id?: number;
  active_cycle_id?: number;
  plan_id?: number;
  curricular_period_id?: number;
  duration_periods?: number;
  sequence?: number;
  study_modality?: "escolarizado" | "semiescolarizado" | "complementario" | "en_linea";
};
type PlanOption = { id: number; name: string; program_id: number; program_name: string; matriculation_code: string; is_active: number };
type Filters = { search: string; programId: string; shiftId: string; groupId: string; cycleId: string; statusId: string; nearGraduation: string };
const blankFilters: Filters = { search: "", programId: "", shiftId: "", groupId: "", cycleId: "", statusId: "", nearGraduation: "" };
const blankForm = {
  studentNumber: "", firstName: "", lastName: "", secondLastName: "", curp: "", birthDate: "",
  email: "", phone: "", notes: "", statusId: "", programId: "", shiftId: "", groupId: "", cycleId: "", planId: "", curricularPeriodId: ""
};

const modalityLabels = {
  escolarizado: "Escolarizado (ESC)",
  semiescolarizado: "Semiescolarizado (SEM)",
  complementario: "Complementario (COM)",
  en_linea: "En Línea (LIN)"
};

function normalizeAcademicLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function StudentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<Student[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0, pages: 1 });
  const [filters, setFilters] = useState<Filters>(blankFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(blankFilters);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [editing, setEditing] = useState<Student | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [existingMode, setExistingMode] = useState("ignore");
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [createdAccess, setCreatedAccess] = useState<{ studentName: string; studentNumber: string; email: string; temporaryPassword: string } | null>(null);
  const [registrationStudent, setRegistrationStudent] = useState<Student | null>(null);
  const [registrationForm, setRegistrationForm] = useState({ status: "paid", periodNumber: "", physicalFolio: "", amount: "", paidAt: new Date().toISOString().slice(0, 10) });

  async function load(page = 1, current = appliedFilters) {
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    Object.entries(current).forEach(([key, value]) => value && query.set(key, value));
    const result = await api<{ records: Student[]; pagination: typeof pagination }>(`/students?${query}`);
    setRecords(result.records);
    setPagination(result.pagination);
  }

  useEffect(() => {
    Promise.all(["programs", "shifts", "groups", "cycles", "semesters", "statuses"].map(async (type) => {
      const result = await api<{ records: any[] }>(`/catalogs/${type}`);
      return [type, result.records.filter((item) => item.is_active).map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        program_id: item.program_id,
        shift_id: item.shift_id,
        cycle_id: item.cycle_id,
        active_cycle_id: item.active_cycle_id,
        plan_id: item.plan_id,
        curricular_period_id: item.curricular_period_id,
        duration_periods: item.duration_periods,
        sequence: item.sequence,
        study_modality: item.study_modality
      }))] as const;
    })).then((entries) => setOptions(Object.fromEntries(entries)));
    api<PlanOption[]>("/plans").then((records) => setPlans(records.filter((plan) => plan.is_active)));
    load();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load(1, { ...appliedFilters, search: filters.search }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const filterGroups = useMemo(() => {
    const groups = options.groups ?? [];
    if (!filters.programId) return groups;
    return groups.filter((group) => String(group.program_id ?? "") === filters.programId);
  }, [options.groups, filters.programId]);

  const formGroups = useMemo(() => {
    const groups = options.groups ?? [];
    if (!form.programId) return groups;
    return groups.filter((group) => String(group.program_id ?? "") === form.programId);
  }, [options.groups, form.programId]);

  const formPlans = useMemo(() => {
    const program = (options.programs ?? []).find((item) => String(item.id) === form.programId);
    const programName = normalizeAcademicLabel(program?.name);
    return plans
      .filter((plan) => !form.programId
        || String(plan.program_id) === form.programId
        || (programName && normalizeAcademicLabel(plan.program_name) === programName)
        || (programName && normalizeAcademicLabel(plan.name) === programName))
      .map((plan) => ({ id: plan.id, name: `${plan.name} (${plan.matriculation_code})` }));
  }, [plans, options.programs, form.programId]);

  const formCurricularPeriods = useMemo(() => {
    const program = (options.programs ?? []).find((item) => String(item.id) === form.programId);
    return [...(options.semesters ?? [])]
      .filter((period) => !program?.duration_periods || Number(period.sequence) <= program.duration_periods)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  }, [options.programs, options.semesters, form.programId]);

  const selectedFormGroup = useMemo(
    () => (options.groups ?? []).find((group) => String(group.id) === form.groupId),
    [options.groups, form.groupId]
  );

  useEffect(() => {
    if (!formOpen || !form.programId || form.planId || formPlans.length !== 1) return;
    setForm((current) => current.programId === form.programId && !current.planId
      ? { ...current, planId: String(formPlans[0].id) }
      : current);
  }, [formOpen, form.programId, form.planId, formPlans]);

  useEffect(() => {
    if (!formOpen || !form.programId || !formCurricularPeriods.length) return;
    const currentIsValid = formCurricularPeriods.some((period) => String(period.id) === form.curricularPeriodId);
    if (currentIsValid) return;
    setForm((current) => current.programId === form.programId
      ? { ...current, curricularPeriodId: String(formCurricularPeriods[0].id) }
      : current);
  }, [formOpen, form.programId, form.curricularPeriodId, formCurricularPeriods]);

  function selectProgram(programId: string) {
    const selectedGroup = (options.groups ?? []).find((group) => String(group.id) === filters.groupId);
    const groupId = selectedGroup && String(selectedGroup.program_id ?? "") !== programId ? "" : filters.groupId;
    setFilters({ ...filters, programId, groupId });
  }

  function selectGroup(groupId: string) {
    const group = (options.groups ?? []).find((item) => String(item.id) === groupId);
    setFilters({
      ...filters,
      groupId,
      programId: group?.program_id ? String(group.program_id) : filters.programId
    });
  }

  function selectFormProgram(programId: string) {
    const group = (options.groups ?? []).find((item) => String(item.id) === form.groupId);
    const plan = plans.find((item) => String(item.id) === form.planId);
    const program = (options.programs ?? []).find((item) => String(item.id) === programId);
    const programName = normalizeAcademicLabel(program?.name);
    const planMatches = plan && (
      String(plan.program_id) === programId
      || normalizeAcademicLabel(plan.program_name) === programName
      || normalizeAcademicLabel(plan.name) === programName
    );
    setForm({
      ...form,
      programId,
      groupId: group && String(group.program_id) === programId ? form.groupId : "",
      planId: planMatches ? form.planId : ""
    });
  }

  function selectFormGroup(groupId: string) {
    const group = (options.groups ?? []).find((item) => String(item.id) === groupId);
    if (!group) return setForm({ ...form, groupId });
    const programId = String(group.program_id ?? form.programId);
    const selectedPlan = plans.find((plan) => String(plan.id) === form.planId);
    const groupPlan = plans.find((plan) => plan.id === group.plan_id);
    const program = (options.programs ?? []).find((item) => String(item.id) === programId);
    const programName = normalizeAcademicLabel(program?.name);
    const planMatches = selectedPlan && (
      String(selectedPlan.program_id) === programId
      || normalizeAcademicLabel(selectedPlan.program_name) === programName
      || normalizeAcademicLabel(selectedPlan.name) === programName
    );
    setForm({
      ...form,
      groupId,
      programId,
      shiftId: String(group.shift_id ?? form.shiftId),
      cycleId: group.active_cycle_id ? String(group.active_cycle_id) : form.cycleId,
      planId: groupPlan ? String(groupPlan.id) : planMatches ? form.planId : "",
      curricularPeriodId: group.curricular_period_id ? String(group.curricular_period_id) : form.curricularPeriodId
    });
  }

  function openCreate() {
    setEditing(null);
    setForm(blankForm);
    setFormOpen(true);
  }

  function openEdit(student: Student) {
    setEditing(student);
    setForm({
      studentNumber: student.student_number,
      firstName: student.first_name,
      lastName: student.last_name,
      secondLastName: student.second_last_name ?? "",
      curp: student.curp ?? "",
      birthDate: student.birth_date ?? "",
      email: student.email ?? "",
      phone: student.phone ?? "",
      notes: student.notes ?? "",
      statusId: String(student.status_id),
      programId: String(student.program_id),
      shiftId: String(student.shift_id),
      groupId: String(student.group_id),
      cycleId: String(student.cycle_id),
      planId: student.plan_id ? String(student.plan_id) : "",
      curricularPeriodId: student.curricular_period_id ? String(student.curricular_period_id) : ""
    });
    setFormOpen(true);
    setMenuFor(null);
  }

  async function saveStudent(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await api<Student & { access?: { email: string; temporaryPassword: string | null } }>(editing ? `/students/${editing.id}` : "/students", {
        method: editing ? "PATCH" : "POST",
        body: form
      });
      toast.success(editing ? "Alumno actualizado." : `Alumno registrado con matrícula ${saved.student_number}.`);
      if (!editing && saved.access?.temporaryPassword) {
        setCreatedAccess({
          studentName: saved.full_name,
          studentNumber: saved.student_number,
          email: saved.access.email,
          temporaryPassword: saved.access.temporaryPassword
        });
      }
      setFormOpen(false);
      load(pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(student: Student) {
    try {
      await api(`/students/${student.id}/toggle`, { method: "POST" });
      toast.success(student.is_active ? "Alumno dado de baja." : "Alumno reactivado.");
      load(pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible actualizar el estatus.");
    }
    setMenuFor(null);
  }

  function openRegistration(student: Student) {
    setRegistrationStudent(student);
    setRegistrationForm({
      status: student.registration_paid ? "paid" : "pending",
      periodNumber: String(student.curricular_period_number ?? 1),
      physicalFolio: student.registration_folio ?? "",
      amount: student.registration_amount == null ? "" : String(student.registration_amount),
      paidAt: student.registration_paid_at ?? new Date().toISOString().slice(0, 10)
    });
    setMenuFor(null);
  }

  async function saveRegistration(event: React.FormEvent) {
    event.preventDefault();
    if (!registrationStudent) return;
    setBusy(true);
    try {
      await api(`/students/${registrationStudent.id}/registration-status`, { method: "POST", body: registrationForm });
      toast.success(registrationForm.status === "paid" ? "Reinscripción y semestre actualizados." : "Inscripción marcada como pendiente.");
      setRegistrationStudent(null);
      await load(pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible actualizar la reinscripción.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFinancialClearance(student: Student) {
    const cleared = !student.financial_clearance_override;
    const note = cleared ? window.prompt("Motivo de la regularización administrativa (opcional):", "Cuenta verificada manualmente") : null;
    if (cleared && note === null) return;
    if (!cleared && !window.confirm("¿Volver a usar el cálculo automático para este alumno?")) return;
    try {
      await api(`/students/${student.id}/financial-clearance`, { method: "POST", body: { cleared, note } });
      toast.success(cleared ? "Cuenta marcada como regularizada." : "Se restauró el cálculo automático.");
      await load(pagination.page);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible actualizar la cuenta.");
    }
    setMenuFor(null);
  }

  async function permanentlyDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/students/${deleting.id}/permanent`, { method: "DELETE" });
      toast.success("Alumno eliminado definitivamente.");
      setDeleting(null);
      await load(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar al alumno.");
    } finally {
      setBusy(false);
    }
  }

  async function previewImport(file: File) {
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    try {
      setPreview(await api("/students/import/preview", { method: "POST", body }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible leer el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    setBusy(true);
    try {
      const result = await api<{ message: string; created: number; updated: number; ignored: number; accountsCreated: number }>("/students/import/apply", {
        method: "POST",
        body: { previewId: preview.previewId, existingMode }
      });
      toast.success(`${result.message} ${result.created} alumnos y ${result.accountsCreated} accesos nuevos.`);
      setImportOpen(false);
      setPreview(null);
      load(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible aplicar la importación.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="toolbar">
        <div className="toolbar-primary">
          <div className="search-box"><Search size={18} /><input placeholder="Buscar por nombre o matrícula" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></div>
          <Select value={filters.programId} onChange={(event) => selectProgram(event.target.value)} options={options.programs ?? []} placeholder="Todos los programas" aria-label="Programa" />
          <Select value={filters.groupId} onChange={(event) => selectGroup(event.target.value)} options={filterGroups} placeholder="Todos los grupos" aria-label="Grupo" />
          <select aria-label="Próximos a egresar" value={filters.nearGraduation} onChange={event => setFilters({...filters, nearGraduation:event.target.value})}><option value="">Todos los alumnos</option><option value="true">Próximos a egresar</option></select>
          <Button variant="secondary" onClick={() => { setAppliedFilters(filters); load(1, filters); }}>Filtrar</Button>
        </div>
        <div className="toolbar-actions">
          {can("students.import") && <Link className="button button-secondary" to="/asistente-importacion">Asistente de archivos</Link>}
          {can("students.import") && <Button variant="secondary" icon={<Upload size={17} />} onClick={() => { setImportOpen(true); setPreview(null); }}>Importar</Button>}
          {can("students.export") && (
            <div className="split-actions">
              <button title="Exportar Excel" onClick={() => download("/students/export/file?format=xlsx", "alumnos.xlsx")}><FileSpreadsheet size={17} /></button>
              <button title="Exportar CSV" onClick={() => download("/students/export/file?format=csv", "alumnos.csv")}><FileDown size={17} /></button>
              <button title="Exportar PDF" onClick={() => download("/students/export/file?format=pdf", "alumnos.pdf")}><FileText size={17} /></button>
            </div>
          )}
          {can("students.manage") && <Button icon={<Plus size={18} />} onClick={openCreate}>Nuevo alumno</Button>}
        </div>
      </section>

      <section className="table-section">
        <header className="section-heading">
          <div><span>Directorio</span><h2>{pagination.total} alumnos registrados</h2></div>
          <div className="legend"><i className="legend-active" /> Activo <i className="legend-inactive" /> Inactivo</div>
        </header>
        {records.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Alumno</th><th>Matrícula</th><th>Programa</th><th>Turno / grupo</th><th>Inscripción</th><th>Estatus</th><th>Contacto</th><th aria-label="Acciones" /></tr></thead>
              <tbody>
                {records.map((student) => (
                  <tr key={student.id} className={!student.is_active ? "row-muted" : ""}>
                    <td><div className="person-cell"><div className="mini-avatar">{student.full_name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div><div><strong><Link to={`/alumnos/${student.id}/expediente`}>{student.full_name}</Link></strong>{Boolean(student.near_graduation) && <span className="graduation-badge">Próximo a egresar</span>}<span>{student.curp || "Sin CURP registrada"}</span></div></div></td>
                    <td><code>{student.student_number}</code></td>
                    <td><strong className="table-main">{student.program_name}</strong><span className="table-sub">{student.cycle_name}</span></td>
                    <td><strong className="table-main">{student.shift_name}</strong><span className="table-sub">Grupo {student.group_name}</span></td>
                    <td><StatusBadge active={Boolean(student.registration_paid)} label={student.registration_paid ? "REINSCRITO" : "PENDIENTE"} />{student.financial_clearance_override ? <span className="table-sub">Cuenta regularizada</span> : null}</td>
                    <td><span className="custom-status" style={{ "--status-color": student.status_color } as React.CSSProperties}>{student.status_name}</span></td>
                    <td><strong className="table-main">{student.email || "Sin correo"}</strong><span className="table-sub">{student.phone || "Sin teléfono"}</span></td>
                    <td className="action-cell">
                      <button className="icon-button" onClick={() => setMenuFor(menuFor === student.id ? null : student.id)} aria-label="Acciones"><MoreHorizontal size={19} /></button>
                      {menuFor === student.id && (
                        <div className="row-menu">
                          <Link to={`/alumnos/${student.id}/expediente`}>Ver expediente y avance</Link>
                          {can("students.manage") && <button onClick={() => openEdit(student)}><Pencil size={16} /> Editar</button>}
                          {can("students.manage") && <button onClick={() => openRegistration(student)}><BadgeCheck size={16} /> Modificar reinscripción</button>}
                          {can("students.manage") && <button onClick={() => toggleFinancialClearance(student)}><BadgeCheck size={16} /> {student.financial_clearance_override ? "Usar cálculo automático" : "Marcar cuenta regularizada"}</button>}
                          {can("students.manage") && <button onClick={() => toggle(student)}><Power size={16} /> {student.is_active ? "Dar de baja" : "Reactivar"}</button>}
                          <button onClick={() => openDocument(`/reports/report-card.pdf?studentId=${student.id}`)}><Printer size={16} /> Generar boleta</button>
                          <button onClick={() => openDocument(`/reports/study-certificate.pdf?studentId=${student.id}`)}><FileText size={16} /> Generar constancia</button>
                          {can("students.manage") && <button className="danger-menu-item" onClick={() => { setDeleting(student); setMenuFor(null); }}><Trash2 size={16} /> Eliminar definitivamente</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState icon={<UsersRound size={24} />} title="No hay alumnos con estos filtros" text="Ajusta la búsqueda o registra un alumno." />}
        <footer className="pagination">
          <span>Página {pagination.page} de {Math.max(1, pagination.pages)}</span>
          <div>
            <button className="icon-button" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
            <button className="icon-button" disabled={pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)} aria-label="Página siguiente"><ChevronRight size={18} /></button>
          </div>
        </footer>
      </section>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? "Editar alumno" : "Registrar alumno"} size="large">
        <form onSubmit={saveStudent}>
          <div className="form-section-title"><UserRound size={18} /><div><strong>Datos personales</strong><span>Identificación y contacto del alumno</span></div></div>
          <div className="form-grid three">
            <Field label="Matrícula" hint={editing ? "Identificador protegido." : "Se genera con ciclo, iniciales, plan y modalidad."}><input value={editing ? form.studentNumber : "Automática al registrar"} readOnly /></Field>
            <Field label="Nombre(s)" required><input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required /></Field>
            <Field label="Apellido paterno" required><input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required /></Field>
            <Field label="Apellido materno" hint="Si no existe, la matrícula usará X."><input value={form.secondLastName} onChange={(event) => setForm({ ...form, secondLastName: event.target.value })} /></Field>
            <Field label="CURP"><input value={form.curp} onChange={(event) => setForm({ ...form, curp: event.target.value.toUpperCase() })} /></Field>
            <Field label="Fecha de nacimiento"><input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></Field>
            <Field label="Correo institucional" hint="matrícula@alumnoifop.edu"><input type="email" value={editing ? form.email : "Automático al registrar"} readOnly /></Field>
            <Field label="Teléfono"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
            <Field label="Estatus" required><Select value={form.statusId} onChange={(event) => setForm({ ...form, statusId: event.target.value })} options={options.statuses ?? []} required /></Field>
          </div>
          <div className="form-section-title"><GraduationCapIcon /><div><strong>Inscripción académica</strong><span>Ubicación dentro del ciclo escolar</span></div></div>
          <div className="form-grid three">
            <Field label="Programa" required><Select value={form.programId} onChange={(event) => selectFormProgram(event.target.value)} options={options.programs ?? []} required /></Field>
            <Field label="Turno" required><Select value={form.shiftId} onChange={(event) => setForm({ ...form, shiftId: event.target.value })} options={options.shifts ?? []} required /></Field>
            <Field label="Grupo" required><Select value={form.groupId} onChange={(event) => selectFormGroup(event.target.value)} options={formGroups} required /></Field>
            <Field label="Ciclo escolar" hint="Intervalo temporal; por ejemplo, 2026B - 2027A." required><Select value={form.cycleId} onChange={(event) => setForm({ ...form, cycleId: event.target.value })} options={options.cycles ?? []} required /></Field>
            <Field label="Periodo del plan" hint="Avance del alumno; es independiente del ciclo escolar." required><Select value={form.curricularPeriodId} onChange={(event) => setForm({ ...form, curricularPeriodId: event.target.value })} options={formCurricularPeriods} required /></Field>
            <Field label="Plan académico" required><Select value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })} options={formPlans} required /></Field>
            <Field label="Modalidad del grupo"><input value={selectedFormGroup?.study_modality ? modalityLabels[selectedFormGroup.study_modality] : "Selecciona un grupo"} readOnly /></Field>
            <Field label="Observaciones"><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
          </div>
          <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" busy={busy}>{editing ? "Guardar cambios" : "Registrar alumno"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(registrationStudent)} onClose={() => setRegistrationStudent(null)} title="Modificar inscripción o reinscripción" size="small">
        <form onSubmit={saveRegistration}>
          <p className="modal-copy">Actualiza manualmente el estado y el semestre de {registrationStudent?.full_name}. Esta acción queda registrada en auditoría.</p>
          <div className="form-grid two">
            <Field label="Estado" required><select value={registrationForm.status} onChange={(event) => setRegistrationForm({ ...registrationForm, status: event.target.value })}><option value="paid">REINSCRITO / PAGADO</option><option value="pending">PENDIENTE</option></select></Field>
            <Field label="Semestre promovido" required><select value={registrationForm.periodNumber} onChange={(event) => setRegistrationForm({ ...registrationForm, periodNumber: event.target.value })} required>{(options.semesters ?? []).map((period) => <option key={period.id} value={period.sequence}>{period.name}</option>)}</select></Field>
            {registrationForm.status === "paid" && <>
              <Field label="Folio físico" required hint="Folio consecutivo, mínimo cuatro dígitos y sin máximo."><input inputMode="numeric" pattern="0*[1-9][0-9]*" value={registrationForm.physicalFolio} onChange={(event) => setRegistrationForm({ ...registrationForm, physicalFolio: event.target.value.replace(/\D/g, "") })} placeholder="0001" required /></Field>
              <Field label="Monto pagado" required><input type="number" min="0.01" step="0.01" value={registrationForm.amount} onChange={(event) => setRegistrationForm({ ...registrationForm, amount: event.target.value })} required /></Field>
              <Field label="Fecha de pago" required><input type="date" value={registrationForm.paidAt} onChange={(event) => setRegistrationForm({ ...registrationForm, paidAt: event.target.value })} required /></Field>
            </>}
          </div>
          <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setRegistrationStudent(null)}>Cancelar</Button><Button type="submit" busy={busy}>Guardar estado</Button></div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar alumnos" size="large">
        {!preview ? (
          <div className="import-step">
            <div className="drop-zone" onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet size={36} />
              <strong>Selecciona un archivo Excel o CSV</strong>
              <span>Máximo 2,000 filas y 5 MB</span>
              <input ref={fileRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && previewImport(event.target.files[0])} />
            </div>
            <button className="template-link" onClick={() => download("/students/template/import.xlsx", "plantilla-alumnos.xlsx")}><Download size={17} /> Descargar plantilla base</button>
          </div>
        ) : (
          <div className="preview-step">
            <div className="import-summary">
              <div><span>Filas</span><strong>{preview.summary.total}</strong></div>
              <div className="summary-valid"><span>Válidas</span><strong>{preview.summary.valid}</strong></div>
              <div className="summary-error"><span>Con error</span><strong>{preview.summary.errors}</strong></div>
              <div><span>Existentes</span><strong>{preview.summary.existing}</strong></div>
            </div>
            {preview.errors.length > 0 && <div className="error-list">{preview.errors.slice(0, 6).map((error: any) => <p key={`${error.row}-${error.message}`}><b>Fila {error.row}</b>{error.message}</p>)}</div>}
            <div className="segmented">
              <button className={existingMode === "ignore" ? "active" : ""} onClick={() => setExistingMode("ignore")}>Ignorar existentes</button>
              <button className={existingMode === "update" ? "active" : ""} onClick={() => setExistingMode("update")}>Actualizar existentes</button>
            </div>
            <div className="mini-preview-table">
              <table><thead><tr><th>Fila</th><th>Matrícula</th><th>Nombre</th><th>Estado</th></tr></thead><tbody>
                {preview.rows.slice(0, 8).map((row: any) => <tr key={row.row}><td>{row.row}</td><td>{row.studentNumber}</td><td>{row.firstName} {row.lastName}</td><td><StatusBadge active={!row.exists} label={row.exists ? "Existente" : "Nuevo"} /></td></tr>)}
              </tbody></table>
            </div>
            <div className="modal-actions"><Button variant="ghost" onClick={() => setPreview(null)}>Elegir otro archivo</Button><Button busy={busy} onClick={applyImport} disabled={!preview.summary.valid}>Confirmar importación</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Eliminar alumno" size="small">
        <div className="danger-confirmation"><TriangleAlert size={30} /><div><strong>Se eliminará todo el expediente</strong><p>Esta acción borrará a {deleting?.full_name}, sus inscripciones, calificaciones y cuenta de acceso vinculada. No se puede deshacer.</p></div></div>
        <div className="modal-actions"><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="danger" icon={<Trash2 size={17} />} busy={busy} onClick={permanentlyDelete}>Eliminar alumno</Button></div>
      </Modal>

      <Modal open={Boolean(createdAccess)} onClose={() => setCreatedAccess(null)} title="Acceso institucional creado" size="small">
        <div className="form-grid">
          <p>El alumno {createdAccess?.studentName} ya puede ingresar a la plataforma. Comparte estas credenciales de forma segura.</p>
          <Field label="Matrícula"><input value={createdAccess?.studentNumber ?? ""} readOnly /></Field>
          <Field label="Correo institucional"><input value={createdAccess?.email ?? ""} readOnly /></Field>
          <Field label="Contraseña temporal"><input value={createdAccess?.temporaryPassword ?? ""} readOnly /></Field>
          <div className="modal-actions"><Button onClick={() => setCreatedAccess(null)}>Entendido</Button></div>
        </div>
      </Modal>
    </div>
  );
}

function GraduationCapIcon() {
  return <UsersRound size={18} />;
}
