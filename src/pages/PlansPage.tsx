import { useEffect, useMemo, useState } from "react";
import { BookCopy, BookOpen, Calculator, Pencil, Plus, Power, Trash2, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { Button, EmptyState, Field, Select, StatusBadge } from "../components/Ui";
import { planCertification, type CertificateAuthority } from "../../shared/plan-certification";

type Plan = {
  id: number;
  program_id: number;
  code: string;
  matriculation_code: string;
  name: string;
  version: string;
  rvoe: string | null;
  certificate_authority: CertificateAuthority;
  program_name: string;
  level_name: string;
  subject_count: number;
  total_credits: number;
  mandatory_credits: number;
  elective_credits: number;
  tuition_amount: number;
  is_active: number;
  description: string | null;
};

type PlanSubject = {
  id: number;
  code: string;
  name: string;
  subject_type: "mandatory" | "elective";
  credits: number;
  recommended_period: number;
  hours_per_week: number;
};

type SubjectDraft = {
  code: string;
  name: string;
  subjectType: "mandatory" | "elective";
  credits: string;
  recommendedPeriod: string;
  hoursPerWeek: string;
};

const emptySubject = (): SubjectDraft => ({
  code: "",
  name: "",
  subjectType: "mandatory",
  credits: "",
  recommendedPeriod: "1",
  hoursPerWeek: ""
});

const emptyPlanForm = () => ({ programId: "", code: "", matriculationCode: "", name: "", version: "2026", rvoe: "", certificateAuthority: "ifop" as CertificateAuthority, description: "", tuitionAmount: "", assignExisting: true });

export function PlansPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [subjects, setSubjects] = useState<PlanSubject[]>([]);
  const [programs, setPrograms] = useState<Array<{ id: number; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyPlanForm);
  const [drafts, setDrafts] = useState<SubjectDraft[]>([emptySubject()]);

  async function loadPlans(preferredId?: number) {
    const records = await api<Plan[]>("/plans");
    setPlans(records);
    const next = records.find((plan) => plan.id === (preferredId ?? selected?.id)) ?? records[0] ?? null;
    setSelected(next);
    if (next) {
      const detail = await api<{ subjects: PlanSubject[] }>(`/plans/${next.id}`);
      setSubjects(detail.subjects);
    } else {
      setSubjects([]);
    }
  }

  useEffect(() => {
    loadPlans();
    api<{ records: Array<{ id: number; name: string; is_active: number }> }>("/catalogs/programs")
      .then((result) => setPrograms(result.records.filter((program) => program.is_active)))
      .catch(() => undefined);
  }, []);

  async function selectPlan(plan: Plan) {
    setSelected(plan);
    const detail = await api<{ subjects: PlanSubject[] }>(`/plans/${plan.id}`);
    setSubjects(detail.subjects);
  }

  function updateSubject(index: number, patch: Partial<SubjectDraft>) {
    setDrafts((current) => current.map((subject, subjectIndex) => subjectIndex === index ? { ...subject, ...patch } : subject));
  }

  function openCreate() {
    setEditingPlan(null);
    setForm(emptyPlanForm());
    setDrafts([emptySubject()]);
    setOpen(true);
  }

  async function openEdit() {
    if (!selected) return;
    const detail = await api<{ plan: Plan; subjects: PlanSubject[] }>(`/plans/${selected.id}`);
    setEditingPlan(detail.plan);
    setForm({
      programId: String(detail.plan.program_id),
      code: detail.plan.code,
      matriculationCode: detail.plan.matriculation_code,
      name: detail.plan.name,
      version: detail.plan.version,
      rvoe: detail.plan.rvoe ?? "",
      certificateAuthority: detail.plan.certificate_authority,
      description: detail.plan.description ?? "",
      tuitionAmount: String(detail.plan.tuition_amount ?? 0),
      assignExisting: false
    });
    setDrafts(detail.subjects.map((subject) => ({
      code: subject.code,
      name: subject.name,
      subjectType: subject.subject_type,
      credits: String(subject.credits),
      recommendedPeriod: String(subject.recommended_period),
      hoursPerWeek: String(subject.hours_per_week || "")
    })));
    setOpen(true);
  }

  async function savePlan(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await api<Plan>(editingPlan ? `/plans/${editingPlan.id}` : "/plans", { method: editingPlan ? "PUT" : "POST", body: { ...form, subjects: drafts } });
      toast.success(editingPlan ? "Plan académico actualizado." : "Plan académico creado y créditos calculados.");
      setOpen(false);
      setEditingPlan(null);
      setForm(emptyPlanForm());
      setDrafts([emptySubject()]);
      await loadPlans(saved.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible crear el plan.");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/plans/${deleting.id}/permanent`, { method: "DELETE" });
      toast.success("Plan académico eliminado definitivamente.");
      setDeleting(null);
      setSelected(null);
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar el plan.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePlan() {
    if (!selected) return;
    try {
      const updated = await api<Plan>(`/plans/${selected.id}/toggle`, { method: "POST" });
      toast.success(updated.is_active ? "Plan activado." : "Plan desactivado.");
      await loadPlans(updated.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible actualizar el plan.");
    }
  }

  const draftCredits = useMemo(() => drafts.reduce((sum, subject) => sum + Number(subject.credits || 0), 0), [drafts]);

  return (
    <div className="plans-layout">
      <aside className="plans-pane">
        <header><div><span>Oferta académica</span><strong>{plans.length} planes</strong></div>{can("catalogs.manage") && <button className="icon-button primary-icon" onClick={openCreate} title="Nuevo plan"><Plus size={18} /></button>}</header>
        <div className="plans-list">
          {plans.map((plan) => (
            <button key={plan.id} className={selected?.id === plan.id ? "active" : ""} onClick={() => selectPlan(plan)}>
              <BookCopy size={19} />
              <div><strong>{plan.name}</strong><span>{plan.level_name} · {plan.version}</span><small>{plan.subject_count} asignaturas · {plan.total_credits} créditos</small></div>
              <i className={plan.is_active ? "active" : ""} />
            </button>
          ))}
        </div>
      </aside>

      <section className="plan-workspace">
        {selected ? <>
          <header className="plan-header">
            <div><span>{selected.program_name}</span><h2>{selected.name}</h2><p>{selected.code} · Matrícula {selected.matriculation_code} · Versión {selected.version}{selected.rvoe ? ` · RVOE ${selected.rvoe}` : ""}</p><p>{planCertification[selected.certificate_authority].label} · CCT {planCertification[selected.certificate_authority].cct}</p></div>
            {can("catalogs.manage") && <div className="plan-header-actions"><Button variant="secondary" icon={<Pencil size={17} />} onClick={openEdit}>Editar</Button><Button variant="secondary" icon={<Power size={17} />} onClick={togglePlan}>{selected.is_active ? "Desactivar" : "Activar"}</Button><Button variant="danger" icon={<Trash2 size={17} />} onClick={() => setDeleting(selected)}>Eliminar</Button></div>}
          </header>
          <div className="plan-summary">
            <div><Calculator size={20} /><span>Créditos totales</span><strong>{selected.total_credits}</strong></div>
            <div><BookOpen size={20} /><span>Obligatorios</span><strong>{selected.mandatory_credits}</strong></div>
            <div><BookCopy size={20} /><span>Optativos</span><strong>{selected.elective_credits}</strong></div>
            <div><Calculator size={20} /><span>Colegiatura</span><strong>{Number(selected.tuition_amount || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })}</strong></div>
            <div><span>Estatus</span><StatusBadge active={Boolean(selected.is_active)} label={selected.is_active ? "Activo" : "Inactivo"} /></div>
          </div>
          <div className="table-wrap plan-subject-table"><table><thead><tr><th>Semestre</th><th>Asignatura</th><th>Tipo</th><th>Horas / semana</th><th>Créditos</th><th>% del plan</th></tr></thead><tbody>
            {subjects.map((subject) => <tr key={subject.id}><td>{subject.recommended_period}</td><td><strong className="table-main">{subject.name}</strong><span className="table-sub">{subject.code}</span></td><td><span className={`subject-type ${subject.subject_type}`}>{subject.subject_type === "mandatory" ? "Obligatoria" : "Optativa"}</span></td><td>{subject.hours_per_week || "—"}</td><td><strong>{subject.credits}</strong></td><td>{selected.total_credits ? (subject.credits / selected.total_credits * 100).toFixed(1) : "0.0"}%</td></tr>)}
          </tbody></table></div>
        </> : <EmptyState icon={<BookCopy size={26} />} title="Aún no hay planes académicos" text="Crea un plan y agrega todas sus asignaturas." />}
      </section>

      <Modal open={open} onClose={() => setOpen(false)} title={editingPlan ? "Editar plan académico" : "Nuevo plan académico"} size="large">
        <form onSubmit={savePlan}>
          <div className="form-grid three">
            <Field label="Programa" required><Select options={programs} value={form.programId} onChange={(event) => setForm({ ...form, programId: event.target.value })} required /></Field>
            <Field label="Clave del plan" required><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="LIC-ADM-2026" required /></Field>
            <Field label="Código para matrícula" required hint="Código corto del programa, por ejemplo LE."><input maxLength={10} value={form.matriculationCode} onChange={(event) => setForm({ ...form, matriculationCode: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="LE" required /></Field>
            <Field label="Versión" required><input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} required /></Field>
            <Field label="Institución del plan" required hint={`CCT ${planCertification[form.certificateAuthority].cct}. ${form.certificateAuthority === "ifop" ? "Sin convenio con otra escuela." : "Incluye el convenio de colaboración con UNITEN."}`}><select required value={form.certificateAuthority} onChange={event => setForm({ ...form, certificateAuthority: event.target.value as CertificateAuthority })}><option value="ifop">IFOP · RVOE propio</option><option value="uniten">UNITEN · Convenio de colaboración</option></select></Field>
            <Field label="RVOE" hint={form.certificateAuthority === "ifop" ? "Número de RVOE propio de IFOP. Es distinto de la CCT." : "Número de RVOE del plan UNITEN."}><input value={form.rvoe} onChange={(event) => setForm({ ...form, rvoe: event.target.value.toUpperCase() })} placeholder="RVOE de este plan" /></Field>
          </div>
          <div className="form-grid two">
            <Field label="Nombre" required><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Plan de estudios 2026" required /></Field>
            <Field label="Colegiatura por periodo"><input type="number" min="0" step="0.01" value={form.tuitionAmount} onChange={(event) => setForm({ ...form, tuitionAmount: event.target.value })} placeholder="0.00" /></Field>
            <Field label="Descripción"><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          </div>
          <div className="plan-subject-editor-title"><div><strong>Asignaturas del plan</strong><span>Registra tipo, créditos y semestre sugerido.</span></div><b>{draftCredits} créditos</b></div>
          <div className="plan-subject-editor">
            {drafts.map((subject, index) => <div className="plan-subject-row" key={index}>
              <span>{index + 1}</span>
              <input aria-label={`Clave asignatura ${index + 1}`} value={subject.code} onChange={(event) => updateSubject(index, { code: event.target.value })} placeholder="Clave" required />
              <input aria-label={`Nombre asignatura ${index + 1}`} value={subject.name} onChange={(event) => updateSubject(index, { name: event.target.value })} placeholder="Nombre de la asignatura" required />
              <select aria-label={`Tipo asignatura ${index + 1}`} value={subject.subjectType} onChange={(event) => updateSubject(index, { subjectType: event.target.value as SubjectDraft["subjectType"] })}><option value="mandatory">Obligatoria</option><option value="elective">Optativa</option></select>
              <input aria-label={`Créditos asignatura ${index + 1}`} type="number" min="0.5" step="0.5" value={subject.credits} onChange={(event) => updateSubject(index, { credits: event.target.value })} placeholder="Créditos" required />
              <input aria-label={`Semestre asignatura ${index + 1}`} type="number" min="1" value={subject.recommendedPeriod} onChange={(event) => updateSubject(index, { recommendedPeriod: event.target.value })} title="Semestre sugerido" required />
              <button type="button" className="icon-button" disabled={drafts.length === 1} onClick={() => setDrafts((current) => current.filter((_, subjectIndex) => subjectIndex !== index))} title="Quitar asignatura"><Trash2 size={17} /></button>
            </div>)}
          </div>
          <button type="button" className="add-subject-button" onClick={() => setDrafts((current) => [...current, emptySubject()])}><Plus size={17} /> Agregar asignatura</button>
          <label className="check-row"><input type="checkbox" checked={form.assignExisting} onChange={(event) => setForm({ ...form, assignExisting: event.target.checked })} /><span>Asignar este plan a los alumnos activos del programa</span></label>
          <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" busy={busy}>{editingPlan ? "Guardar cambios" : "Crear plan"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Eliminar plan académico" size="small">
        <div className="danger-confirmation"><TriangleAlert size={30} /><div><strong>Esta acción no se puede deshacer</strong><p>Se eliminará “{deleting?.name}” y su estructura curricular. Las materias compartidas permanecerán en el catálogo.</p></div></div>
        <div className="modal-actions"><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="danger" icon={<Trash2 size={17} />} busy={busy} onClick={permanentlyDelete}>Eliminar plan</Button></div>
      </Modal>
    </div>
  );
}
