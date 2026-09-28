import { useEffect, useRef, useState } from "react";
import {
  BookOpenCheck, Check, Download, FileDown, FileSpreadsheet, FileText, History,
  Lock, LockOpen, Pencil, Plus, Save, Search, Trash2, Upload
} from "lucide-react";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { Button, EmptyState, Field, Select, StatusBadge } from "../components/Ui";

type Option = { id: number; name: string; default_weight?: number; program_id?: number };
type Assignment = {
  id: number;
  subject_id: number;
  subject_name: string;
  subject_code: string;
  group_id: number;
  group_name: string;
  program_name: string;
  shift_name: string;
  teacher_name: string;
  teacher_id: number;
  period_name: string;
  period_id: number;
  cycle_name: string;
  grading_scale_id: number;
  min_score: number;
  max_score: number;
  passing_score: number;
  grade_entry_locked: number;
  evaluation_mode: "partials" | "criteria" | "final";
};
type RosterRow = {
  enrollment_id: number;
  student_id: number;
  student_number: string;
  student_name: string;
  grade_id: number | null;
  final_score: number | null;
  status: string | null;
  comments: string | null;
  components: Record<string, number>;
  partial_1: number | null;
  partial_2: number | null;
  partial_3: number | null;
  eligibility: {
    eligible: boolean;
    attendancePercentage: number;
    registrationPaid: boolean;
    reasons: string[];
  };
};
type Roster = { assignment: Assignment; criteria: any[]; students: RosterRow[] };
type ImportOption = { id: number; group_id: number; group_name: string; subject_name: string; subject_code: string; semester: number; period_name: string; cycle_name: string };

export function GradesPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { score: string; comments: string; components: Record<string, string>; partials: [string, string, string] }>>({});
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [filters, setFilters] = useState({ groupId: "", teacherId: "", periodId: "" });
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [assignmentForm, setAssignmentForm] = useState({ subjectId: "", groupId: "", teacherId: "", periodId: "", gradingScaleId: "", evaluationMode: "partials" });
  const [weights, setWeights] = useState<Record<number, number>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importOptions, setImportOptions] = useState<ImportOption[]>([]);
  const [importGroup, setImportGroup] = useState("");
  const [importSemesters, setImportSemesters] = useState<number[]>([]);
  const [importAssignments, setImportAssignments] = useState<number[]>([]);
  const [importFormat, setImportFormat] = useState("acta");
  const [preview, setPreview] = useState<any>(null);
  const [existingMode, setExistingMode] = useState("ignore");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  async function loadAssignments(current = filters) {
    const query = new URLSearchParams(Object.entries(current).filter(([, value]) => value)).toString();
    const records = await api<Assignment[]>(`/grades/assignments${query ? `?${query}` : ""}`);
    setAssignments(records);
    if (selected) {
      const refreshed = records.find((item) => item.id === selected.id);
      if (refreshed) setSelected(refreshed);
    }
  }

  async function loadRoster(assignment: Assignment) {
    setSelected(assignment);
    const data = await api<Roster>(`/grades/assignment/${assignment.id}/roster`);
    setRoster(data);
    setDrafts(Object.fromEntries(data.students.map((student) => [student.enrollment_id, {
      score: student.final_score == null ? "" : String(student.final_score),
      comments: student.comments ?? "",
      components: Object.fromEntries(Object.entries(student.components ?? {}).map(([key, value]) => [key, String(value)])),
      partials: [student.partial_1, student.partial_2, student.partial_3].map((value) => value == null ? "" : String(value)) as [string, string, string]
    }])));
  }

  useEffect(() => {
    Promise.all(["groups", "teachers", "periods", "subjects", "scales", "criteria"].map(async (type) => {
      const result = await api<{ records: any[] }>(`/catalogs/${type}`);
      return [type, result.records.filter((item) => item.is_active).map((item) => ({
        id: item.id,
        name: item.name || item.full_name,
        default_weight: item.default_weight,
        program_id: item.program_id
      }))] as const;
    })).then((entries) => {
      const mapped = Object.fromEntries(entries);
      setOptions(mapped);
      setWeights(Object.fromEntries((mapped.criteria ?? []).map((criterion: Option) => [criterion.id, criterion.default_weight || 0])));
    });
    loadAssignments();
  }, []);

  async function saveGrades() {
    if (!selected || !roster) return;
    setBusy(true);
    try {
      await api(`/grades/assignment/${selected.id}`, {
        method: "PUT",
        body: {
          grades: roster.students.filter((student) => user?.roleName !== "Docente" || student.eligibility.eligible).map((student) => {
            const draft = drafts[student.enrollment_id] ?? { score: "", comments: "", components: {}, partials: ["", "", ""] };
            const componentDraft = draft.components ?? {};
            const hasComponents = Object.values(componentDraft).some((value) => value !== "");
            return {
              enrollmentId: student.enrollment_id,
              score: roster.criteria.length && hasComponents ? null : draft.score,
              comments: draft.comments,
              components: hasComponents ? componentDraft : undefined,
              partials: selected.evaluation_mode === "partials" ? {
                partial1: draft.partials[0], partial2: draft.partials[1], partial3: draft.partials[2]
              } : undefined,
              reason: "Captura desde tablero"
            };
          })
        }
      });
      toast.success("Calificaciones guardadas.");
      await loadRoster(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    if (!selected) return;
    try {
      const updated = await api<Assignment>(`/grades/assignment/${selected.id}/toggle-lock`, { method: "POST" });
      setSelected(updated);
      setRoster((current) => current ? { ...current, assignment: updated } : current);
      toast.success(updated.grade_entry_locked ? "Captura cerrada." : "Captura reabierta.");
      loadAssignments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible cambiar el cierre.");
    }
  }

  async function deleteAssignment() {
    if (!selected) return;
    if (!confirm(`Eliminar la materia ${selected.subject_name} del grupo ${selected.group_name}? Tambien se borraran sus calificaciones capturadas.`)) return;
    setBusy(true);
    try {
      await api(`/grades/assignment/${selected.id}`, { method: "DELETE" });
      toast.success("Materia eliminada de calificaciones.");
      setSelected(null);
      setRoster(null);
      setDrafts({});
      await loadAssignments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar la materia.");
    } finally {
      setBusy(false);
    }
  }

  function defaultWeights() {
    return Object.fromEntries((options.criteria ?? []).map((criterion: Option) => [criterion.id, criterion.default_weight || 0]));
  }

  function openCreateAssignment() {
    setEditingAssignment(null);
    setAssignmentForm({ subjectId: "", groupId: "", teacherId: "", periodId: "", gradingScaleId: "", evaluationMode: "partials" });
    setWeights(defaultWeights());
    setAssignmentOpen(true);
  }

  async function openEditAssignment() {
    if (!selected) return;
    const data = roster ?? await api<Roster>(`/grades/assignment/${selected.id}/roster`);
    setEditingAssignment(selected);
    setAssignmentForm({
      subjectId: String(selected.subject_id),
      groupId: String(selected.group_id),
      teacherId: String(selected.teacher_id),
      periodId: String(selected.period_id),
      gradingScaleId: String(selected.grading_scale_id),
      evaluationMode: selected.evaluation_mode
    });
    setWeights({
      ...defaultWeights(),
      ...Object.fromEntries(data.criteria.map((criterion) => [criterion.criterion_id, criterion.weight]))
    });
    setAssignmentOpen(true);
  }

  async function saveAssignment(event: React.FormEvent) {
    event.preventDefault();
    const criteria = assignmentForm.evaluationMode === "criteria"
      ? Object.entries(weights).filter(([, weight]) => Number(weight) > 0).map(([criterionId, weight]) => ({ criterionId: Number(criterionId), weight: Number(weight) }))
      : [];
    setBusy(true);
    try {
      const saved = await api<Assignment>(editingAssignment ? `/grades/assignments/${editingAssignment.id}` : "/grades/assignments", {
        method: editingAssignment ? "PATCH" : "POST",
        body: { ...assignmentForm, criteria }
      });
      toast.success(editingAssignment ? "Materia actualizada." : "Asignacion academica creada.");
      setAssignmentOpen(false);
      setEditingAssignment(null);
      await loadAssignments();
      if (editingAssignment) await loadRoster(saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar la materia.");
    } finally {
      setBusy(false);
    }
  }
  async function openImport() {
    setBusy(true);
    try {
      const records = await api<ImportOption[]>("/grades/import/options");
      setImportOptions(records);
      setImportGroup(selected ? String(selected.group_id) : "");
      setImportSemesters(selected ? [...new Set(records.filter((a) => a.id === selected.id).map((a) => a.semester))] : []);
      setImportAssignments(selected && records.some((a) => a.id === selected.id) ? [selected.id] : []);
      setImportFormat("acta");
      setPreview(null);
      setImportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible cargar los filtros.");
    } finally { setBusy(false); }
  }

  async function previewImport(file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("format", importFormat);
    if (importFormat === "acta") {
      body.append("groupId", importGroup);
      body.append("semesters", JSON.stringify(importSemesters));
      body.append("assignmentIds", JSON.stringify(importAssignments));
    }
    setBusy(true);
    try {
      setPreview(await api("/grades/import/preview", { method: "POST", body }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible leer el archivo.");
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    setBusy(true);
    try {
      const result = await api<{ created: number; updated: number; ignored: number }>("/grades/import/apply", {
        method: "POST",
        body: { previewId: preview.previewId, existingMode }
      });
      toast.success(`${result.created} calificaciones nuevas y ${result.updated} actualizadas.`);
      setImportOpen(false);
      setPreview(null);
      if (selected) loadRoster(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible importar.");
    } finally {
      setBusy(false);
    }
  }

  async function showHistory(gradeId: number | null) {
    if (!gradeId) return;
    setHistory(await api<any[]>(`/grades/history/${gradeId}`));
    setHistoryOpen(true);
  }

  const filteredStudents = roster?.students.filter((student) =>
    !search || `${student.student_number} ${student.student_name}`.toLowerCase().includes(search.toLowerCase())
  ) ?? [];
  const visibleGroupOptions = user?.roleName === "Docente"
    ? Array.from(new Map(assignments.map((assignment) => [assignment.group_id, { id: assignment.group_id, name: assignment.group_name }])).values())
    : options.groups ?? [];
  const hasEligibleStudents = user?.roleName !== "Docente" || Boolean(roster?.students.some((student) => student.eligibility.eligible));
  const importGroupOptions = [...new Map(importOptions.map((a) => [a.group_id, { id: a.group_id, name: a.group_name }])).values()];
  const groupImportOptions = importOptions.filter((a) => String(a.group_id) === importGroup);
  const semesterOptions = [...new Set(groupImportOptions.map((a) => a.semester))].sort((a, b) => a - b);
  const subjectImportOptions = [...new Map(groupImportOptions.filter((a) => importSemesters.includes(a.semester)).map((a) => [a.id, a])).values()];
  const canUploadActa = importFormat === "legacy" || Boolean(importGroup && importSemesters.length && importAssignments.length);

  return (
    <div className="grades-layout">
      <aside className="assignment-pane">
        <div className="assignment-toolbar">
          <div><span>Asignaciones</span><strong>{assignments.length} materias</strong></div>
          {can("catalogs.manage") && <button className="icon-button primary-icon" onClick={openCreateAssignment} title={"Nueva asignaci\u00f3n"}><Plus size={18} /></button>}
        </div>
        <div className="assignment-filters">
          {can("grades.import") && <Button variant="secondary" icon={<Upload size={17} />} busy={busy} onClick={openImport}>Importar actas</Button>}
          <Select options={visibleGroupOptions} value={filters.groupId} onChange={(event) => { const next = { ...filters, groupId: event.target.value }; setFilters(next); loadAssignments(next); }} placeholder="Todos los grupos" />
          <Select options={options.periods ?? []} value={filters.periodId} onChange={(event) => { const next = { ...filters, periodId: event.target.value }; setFilters(next); loadAssignments(next); }} placeholder="Todos los periodos" />
        </div>
        <div className="assignment-list">
          {assignments.map((assignment) => (
            <button key={assignment.id} className={selected?.id === assignment.id ? "active" : ""} onClick={() => loadRoster(assignment)}>
              <div className="subject-mark">{assignment.subject_code.slice(0, 3)}</div>
              <div><strong>{assignment.subject_name}</strong><span>{assignment.group_name} {"\u00b7"} {assignment.period_name}</span><small>{assignment.teacher_name}</small></div>
              {assignment.grade_entry_locked ? <Lock size={15} /> : <LockOpen size={15} />}
            </button>
          ))}
        </div>
      </aside>

      <section className="grade-workspace">
        {selected && roster ? (
          <>
            <header className="grade-header">
              <div>
                <span>{selected.program_name} {"\u00b7"} {selected.cycle_name}</span>
                <h2>{selected.subject_name}</h2>
                <p>Grupo {selected.group_name} {"\u00b7"} {selected.shift_name} {"\u00b7"} {selected.teacher_name}</p>
              </div>
              <div className="grade-header-actions">
                {can("grades.import") && <Button variant="secondary" icon={<FileSpreadsheet size={17} />} onClick={() => download("/grades/template/import.xlsx", "plantilla-calificaciones.xlsx")}>Formato</Button>}
                {can("grades.import") && <Button variant="secondary" icon={<Upload size={17} />} busy={busy} onClick={openImport}>Importar</Button>}
                {can("grades.export") && (
                  <div className="split-actions">
                    <button title="Exportar Excel" onClick={() => download(`/grades/export/file?format=xlsx&groupId=${selected.group_id}`, "calificaciones.xlsx")}><FileSpreadsheet size={17} /></button>
                    <button title="Exportar CSV" onClick={() => download(`/grades/export/file?format=csv&groupId=${selected.group_id}`, "calificaciones.csv")}><FileDown size={17} /></button>
                    <button title="Exportar PDF" onClick={() => download(`/grades/export/file?format=pdf&groupId=${selected.group_id}`, "calificaciones.pdf")}><FileText size={17} /></button>
                  </div>
                )}
                {can("grades.close") && <Button variant="secondary" icon={selected.grade_entry_locked ? <LockOpen size={17} /> : <Lock size={17} />} onClick={toggleLock}>{selected.grade_entry_locked ? "Reabrir" : "Cerrar"}</Button>}
                {can("catalogs.manage") && <Button variant="secondary" icon={<Pencil size={17} />} onClick={openEditAssignment}>Editar materia</Button>}
                {can("catalogs.manage") && <Button variant="danger" icon={<Trash2 size={17} />} busy={busy} onClick={deleteAssignment}>Eliminar materia</Button>}
                {can("grades.manage") && <Button icon={<Save size={17} />} busy={busy} disabled={Boolean(selected.grade_entry_locked) || !hasEligibleStudents} onClick={saveGrades}>Guardar</Button>}
              </div>
            </header>
            <div className="grade-meta">
              <div><span>Escala</span><strong>{selected.min_score} a {selected.max_score}</strong></div>
              <div><span>{"M\u00ednimo aprobatorio"}</span><strong>{selected.passing_score}</strong></div>
              <div><span>Captura</span><StatusBadge active={!selected.grade_entry_locked} label={selected.grade_entry_locked ? "Cerrada" : "Abierta"} /></div>
              <div className="search-box compact"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar alumno" /></div>
            </div>
            <div className="grade-table-wrap">
              <table className="grade-table">
                <thead><tr><th>#</th><th>Alumno</th>{selected.evaluation_mode === "partials"
                  ? <><th>Parcial 1</th><th>Parcial 2</th><th>Parcial 3</th></>
                  : roster.criteria.map((criterion) => <th key={criterion.id}>{criterion.name}<small>{criterion.weight}%</small></th>)}<th>{selected.evaluation_mode === "final" ? "Calificaci\u00f3n" : "Promedio"}</th><th>Resultado</th><th>Observaciones</th><th aria-label="Historial" /></tr></thead>
                <tbody>
                  {filteredStudents.map((student, index) => {
                    const evaluationBlocked = user?.roleName === "Docente" && !student.eligibility.eligible;
                    const draft = drafts[student.enrollment_id] ?? { score: "", comments: "", components: {}, partials: ["", "", ""] as [string, string, string] };
                    const componentDraft = draft.components ?? {};
                    const hasAnyComponents = roster.criteria.some((criterion) => componentDraft[String(criterion.id)] !== "" && componentDraft[String(criterion.id)] !== undefined);
                    const hasAllComponents = roster.criteria.length > 0 && roster.criteria.every((criterion) => componentDraft[String(criterion.id)] !== "" && componentDraft[String(criterion.id)] !== undefined);
                    const computed = roster.criteria.reduce((sum, criterion) => sum + (Number(componentDraft[String(criterion.id)]) || 0) * Number(criterion.weight) / 100, 0);
                    const capturedPartials = draft.partials.filter((value) => value !== "").map(Number);
                    const partialAverage = capturedPartials.length ? capturedPartials.reduce((sum, value) => sum + value, 0) / capturedPartials.length : 0;
                    const score = selected.evaluation_mode === "partials"
                      ? partialAverage
                      : roster.criteria.length
                        ? hasAllComponents ? computed : !hasAnyComponents && draft.score !== "" ? Number(draft.score) : computed
                        : Number(draft.score);
                    const hasScore = selected.evaluation_mode === "partials"
                      ? capturedPartials.length > 0
                      : roster.criteria.length ? hasAllComponents || (!hasAnyComponents && draft.score !== "") : draft.score !== "";
                    const complete = selected.evaluation_mode === "partials" ? capturedPartials.length === 3 : hasScore;
                    const passed = complete && score >= selected.passing_score;
                    return (
                      <tr key={student.enrollment_id}>
                        <td>{String(index + 1).padStart(2, "0")}</td>
                        <td><div className="person-cell"><div className="mini-avatar">{student.student_name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div><div><strong>{student.student_name}</strong><span>{student.student_number}</span>{evaluationBlocked && <small className="evaluation-blocked">{student.eligibility.reasons.join(" ")}</small>}</div></div></td>
                        {selected.evaluation_mode === "partials"
                          ? draft.partials.map((value, partialIndex) => <td key={partialIndex}><input className="component-input" aria-label={`Parcial ${partialIndex + 1} de ${student.student_name}`} type="number" min={selected.min_score} max={selected.max_score} step="0.1" disabled={Boolean(selected.grade_entry_locked) || evaluationBlocked} value={value} onChange={(event) => { const partials = [...draft.partials] as [string, string, string]; partials[partialIndex] = event.target.value; setDrafts({ ...drafts, [student.enrollment_id]: { ...draft, partials } }); }} /></td>)
                          : roster.criteria.map((criterion) => <td key={criterion.id}><input className="component-input" aria-label={`${criterion.name} de ${student.student_name}`} type="number" min={selected.min_score} max={selected.max_score} step="0.1" disabled={Boolean(selected.grade_entry_locked) || evaluationBlocked} value={componentDraft[String(criterion.id)] ?? ""} onChange={(event) => setDrafts({ ...drafts, [student.enrollment_id]: { ...draft, components: { ...componentDraft, [String(criterion.id)]: event.target.value } } })} /></td>)}
                        <td>{selected.evaluation_mode !== "final"
                          ? <output className={`computed-grade ${complete ? passed ? "grade-pass" : "grade-fail" : ""}`}>{hasScore ? score.toFixed(1) : "-"}</output>
                          : <input className={`grade-input ${hasScore ? passed ? "grade-pass" : "grade-fail" : ""}`} type="number" min={selected.min_score} max={selected.max_score} step="0.1" disabled={Boolean(selected.grade_entry_locked) || evaluationBlocked} value={draft.score} onChange={(event) => setDrafts({ ...drafts, [student.enrollment_id]: { ...draft, score: event.target.value } })} />}
                        </td>
                        <td>{!complete ? <StatusBadge label={hasScore ? "En curso" : "Pendiente"} /> : <StatusBadge active={passed} label={passed ? "Aprobada" : "Reprobada"} />}</td>
                        <td><input className="comments-input" disabled={Boolean(selected.grade_entry_locked) || evaluationBlocked} value={draft.comments} onChange={(event) => setDrafts({ ...drafts, [student.enrollment_id]: { ...draft, comments: event.target.value } })} placeholder={"Agregar observaci\u00f3n"} /></td>
                        <td><button className="icon-button" disabled={!student.grade_id} onClick={() => showHistory(student.grade_id)} title="Ver historial"><History size={17} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <EmptyState icon={<BookOpenCheck size={27} />} title="Selecciona una materia" text={"Elige una asignaci\u00f3n para consultar y capturar calificaciones."} />
        )}
      </section>

      <Modal open={assignmentOpen} onClose={() => { setAssignmentOpen(false); setEditingAssignment(null); }} title={editingAssignment ? "Editar materia asignada" : "Nueva asignaci\u00f3n acad\u00e9mica"} size="large">
        <form onSubmit={saveAssignment}>
          <p className="assignment-scope-note">La materia y el docente quedarán asignados al grupo completo. Los alumnos que se integren después recibirán automáticamente esta misma carga académica.</p>
          <div className="form-grid three">
            <Field label="Materia" required><Select options={options.subjects ?? []} value={assignmentForm.subjectId} onChange={(event) => setAssignmentForm({ ...assignmentForm, subjectId: event.target.value })} required /></Field>
            <Field label="Grupo" required><Select options={options.groups ?? []} value={assignmentForm.groupId} onChange={(event) => setAssignmentForm({ ...assignmentForm, groupId: event.target.value })} required /></Field>
            <Field label="Docente" required><Select options={options.teachers ?? []} value={assignmentForm.teacherId} onChange={(event) => setAssignmentForm({ ...assignmentForm, teacherId: event.target.value })} required /></Field>
            <Field label="Periodo" required><Select options={options.periods ?? []} value={assignmentForm.periodId} onChange={(event) => setAssignmentForm({ ...assignmentForm, periodId: event.target.value })} required /></Field>
            <Field label="Escala" required><Select options={options.scales ?? []} value={assignmentForm.gradingScaleId} onChange={(event) => setAssignmentForm({ ...assignmentForm, gradingScaleId: event.target.value })} required /></Field>
            <Field label={"Tipo de evaluaci\u00f3n"} required><select value={assignmentForm.evaluationMode} onChange={(event) => setAssignmentForm({ ...assignmentForm, evaluationMode: event.target.value })}><option value="partials">Tres parciales</option><option value="criteria">Criterios ponderados</option><option value="final">{"Calificaci\u00f3n final"}</option></select></Field>
          </div>
          {assignmentForm.evaluationMode === "criteria" && <>
            <div className="form-section-title"><Check size={18} /><div><strong>Ponderaciones</strong><span>El total activo debe sumar 100%</span></div><b className="weight-total">{Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0)}%</b></div>
            <div className="criteria-grid">
              {(options.criteria ?? []).map((criterion) => (
                <Field label={criterion.name} key={criterion.id}>
                  <div className="suffix-input"><input type="number" min="0" max="100" value={weights[criterion.id] ?? 0} onChange={(event) => setWeights({ ...weights, [criterion.id]: Number(event.target.value) })} /><span>%</span></div>
                </Field>
              ))}
            </div>
          </>}
          <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => { setAssignmentOpen(false); setEditingAssignment(null); }}>Cancelar</Button><Button type="submit" busy={busy}>{editingAssignment ? "Guardar cambios" : "Crear asignaci\u00f3n"}</Button></div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => { if (!busy) setImportOpen(false); }} title="Importar calificaciones" size="large">
        {!preview ? (
          <div className="import-step">
            <Field label="Formato"><select value={importFormat} disabled={busy} onChange={(event) => setImportFormat(event.target.value)}><option value="acta">Acta de calificaciones por materia</option><option value="legacy">Tabla anterior por matrícula (Excel o CSV)</option></select></Field>
            {importFormat === "acta" && <>
              <Field label="Grupo" required><Select options={importGroupOptions} value={importGroup} disabled={busy} onChange={(event) => { setImportGroup(event.target.value); setImportSemesters([]); setImportAssignments([]); }} /></Field>
              <fieldset className="acta-options" disabled={busy}><legend>Semestres</legend>
                {!semesterOptions.length && <p>Selecciona un grupo con materias asignadas para tres parciales.</p>}
                {semesterOptions.map((semester) => <label key={semester}><input type="checkbox" checked={importSemesters.includes(semester)} onChange={(event) => { setImportSemesters(event.target.checked ? [...importSemesters, semester] : importSemesters.filter((s) => s !== semester)); setImportAssignments([]); }} /> Semestre {semester}</label>)}
              </fieldset>
              <fieldset className="acta-options" disabled={busy}><legend>Materias y ciclo</legend>
                {!subjectImportOptions.length && <p>Selecciona uno o varios semestres.</p>}
                {subjectImportOptions.map((assignment) => <label key={assignment.id}><input type="checkbox" checked={importAssignments.includes(assignment.id)} onChange={(event) => setImportAssignments(event.target.checked ? [...importAssignments, assignment.id] : importAssignments.filter((id) => id !== assignment.id))} /><span>{assignment.subject_code} — {assignment.subject_name}<small>{assignment.cycle_name} · {assignment.period_name}</small></span></label>)}
              </fieldset>
              <p>Completa los nombres de los alumnos y las columnas PRIMERO, SEGUNDO y TERCERO. Puedes escribir la matrícula en lugar del nombre. Para varias materias, usa una copia del acta en cada hoja e indica materia, semestre y ciclo en su encabezado.</p>
              <p>Las celdas vacías conservan el parcial registrado. El cero cuenta como calificación. El promedio se calcula en el sistema.</p>
            </>}
            <Button variant="secondary" icon={<FileSpreadsheet size={24} />} disabled={!canUploadActa} busy={busy} onClick={() => fileRef.current?.click()}>Seleccionar archivo y validar</Button>
            <span>La validación no modifica datos.</span>
            <input ref={fileRef} hidden type="file" accept={importFormat === "acta" ? ".xlsx,.xls" : ".xlsx,.xls,.csv"} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void previewImport(file); }} />
            <button className="template-link" disabled={busy} onClick={() => download(`/grades/template/${importFormat === "acta" ? "import" : "legacy"}.xlsx`, importFormat === "acta" ? "ACTA DE CALIFICACIONES POR MATERIA.xlsx" : "plantilla-calificaciones.xlsx")}><Download size={17} /> Descargar plantilla</button>
          </div>
        ) : (
          <div className="preview-step">
            <div className="import-summary">
              <div><span>Filas</span><strong>{preview.summary.total}</strong></div><div className="summary-valid"><span>{"V\u00e1lidas"}</span><strong>{preview.summary.valid}</strong></div>
              <div className="summary-error"><span>Con error</span><strong>{preview.summary.errors}</strong></div><div><span>Existentes</span><strong>{preview.summary.existing}</strong></div>
            </div>
            {preview.errors.length > 0 && <div className="error-list">{preview.errors.map((error: any, index: number) => <p key={index}><b>{error.sheet ? `${error.sheet}, ` : ""}fila {error.row}: </b>{error.message}</p>)}<p>Las filas con error no se guardarán. Corrige el archivo o confirma únicamente las filas válidas.</p></div>}
            {!preview.summary.total && <p>No se encontraron alumnos con parciales capturados. Completa el acta y vuelve a cargarla.</p>}
            <div className="segmented"><button className={existingMode === "ignore" ? "active" : ""} onClick={() => setExistingMode("ignore")}>Ignorar existentes</button><button className={existingMode === "update" ? "active" : ""} onClick={() => setExistingMode("update")}>Actualizar existentes</button></div>
            <p>Vista previa de hasta 150 filas. Al actualizar, los parciales vacíos conservan sus valores actuales.</p>
            <div className="mini-preview-table"><table><thead><tr><th>Hoja / fila</th><th>Alumno</th><th>Materia / semestre</th><th>Primero</th><th>Segundo</th><th>Tercero</th><th>Promedio</th></tr></thead><tbody>
              {preview.rows.map((row: any, index: number) => <tr key={index}><td>{row.sheet} / {row.row}</td><td>{row.studentName}<br />{row.studentNumber}</td><td>{row.subject}{row.semester ? ` / ${row.semester}°` : ""}</td>{[0, 1, 2].map((i) => <td key={i}>{row.resultingPartials?.[i] ?? "—"}</td>)}<td><strong>{row.score}</strong></td></tr>)}
            </tbody></table></div>
            <div className="modal-actions"><Button variant="ghost" onClick={() => setPreview(null)}>Elegir otro archivo</Button><Button busy={busy} onClick={applyImport} disabled={!preview.summary.valid}>{"Confirmar importaci\u00f3n"}</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title={"Historial de calificaci\u00f3n"}>
        <div className="timeline">
          {history.map((item) => (
            <div key={item.id}><i /><div><strong>{item.old_score ?? "Sin captura"} {"\u2192"} {item.new_score ?? "Pendiente"}</strong><span>{item.reason || "Modificaci\u00f3n"} {"\u00b7"} {item.changed_by_name}</span><small>{new Date(item.changed_at).toLocaleString("es-MX")}</small></div></div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

