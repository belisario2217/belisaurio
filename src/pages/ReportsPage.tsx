import { useEffect, useState } from "react";
import {
  Award, Check, ClipboardCheck, FileSpreadsheet, FileText, GraduationCap, ListFilter, Printer,
  Save, Sheet, ShieldCheck, SlidersHorizontal, Trash2, UserRoundX, UsersRound
} from "lucide-react";
import { api, download, openDocument } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, Field, Select } from "../components/Ui";
import { Modal } from "../components/Modal";
import type { OfficialDocumentSnapshot } from "../../shared/official-document";

type Option = { id: number; name: string; active_cycle_id?: number; plan_id?: number };
type Plan = { id: number; code: string; name: string; is_active: number };
type PlanSubject = { subject_id: number; code: string; name: string; recommended_period: number };
type IssuedDocumentRow = { id: string; folio: string; document_type: string; issued_at: string; verification_url: string; revoked_at: string | null };
type CurricularSubject = {
  id: number;
  semester_number: number;
  subject_type: "mandatory" | "elective";
  credits: number;
  status: "pending" | "in_progress" | "completed";
  final_score: number | null;
  notes: string | null;
  student_number: string;
  student_name: string;
  subject_code: string;
  subject_name: string;
  group_name: string | null;
  cycle_name: string | null;
  teacher_name: string | null;
};

type CurricularDraft = {
  semester: string;
  status: CurricularSubject["status"];
  finalScore: string;
  notes: string;
};

const reports = [
  { type: "students", title: "Lista general de alumnos", description: "Directorio limpio por grupo con campos seleccionables.", icon: UsersRound },
  { type: "attendance", title: "Lista de asistencia", description: "Una lista por grupo para registrar cada día, válida para todas las materias.", icon: ClipboardCheck },
  { type: "gradebook", title: "Concentrado de calificaciones", description: "Resultados por alumno, materia y periodo.", icon: Sheet },
  { type: "subjects", title: "Reporte por materia", description: "Promedio, evaluaciones e indice de reprobacion.", icon: FileText },
  { type: "teachers", title: "Reporte por docente", description: "Materias, grupos asignados y promedio general.", icon: GraduationCap },
  { type: "failed", title: "Alumnos reprobados", description: "Resultados bajo el minimo aprobatorio.", icon: UserRoundX },
  { type: "outstanding", title: "Alumnos destacados", description: "Promedios generales iguales o superiores a 9.", icon: Award }
];

const studentListFields = [
  ["matricula", "Matrícula"], ["nombre_completo", "Nombre completo"], ["nombre", "Nombre"],
  ["apellido_paterno", "Apellido paterno"], ["apellido_materno", "Apellido materno"], ["curp", "CURP"],
  ["fecha_nacimiento", "Fecha de nacimiento"], ["correo", "Correo"], ["telefono", "Teléfono"],
  ["programa", "Programa"], ["turno", "Turno"], ["grupo", "Grupo"], ["ciclo", "Ciclo"],
  ["periodo", "Periodo"], ["estatus", "Estatus"]
] as const;
const defaultStudentListFields = ["matricula", "nombre_completo", "programa", "turno", "grupo", "estatus"];

export function ReportsPage({ view = "reports" }: { view?: "reports" | "documents" }) {
  const { can } = useAuth();
  const toast = useToast();
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planSubjects, setPlanSubjects] = useState<PlanSubject[]>([]);
  const [curricularRows, setCurricularRows] = useState<CurricularSubject[]>([]);
  const [drafts, setDrafts] = useState<Record<number, CurricularDraft>>({});
  const [groupId, setGroupId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [documentBusy, setDocumentBusy] = useState(false);
  const [issuedDocuments, setIssuedDocuments] = useState<IssuedDocumentRow[]>([]);
  const [academicContext, setAcademicContext] = useState<OfficialDocumentSnapshot["student"] | null>(null);
  const [contextError, setContextError] = useState("");
  const [revoking, setRevoking] = useState<IssuedDocumentRow | null>(null);
  const [revocationReason, setRevocationReason] = useState("");
  const [planId, setPlanId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [semester, setSemester] = useState("1");
  const [initialStatus, setInitialStatus] = useState<CurricularSubject["status"]>("in_progress");
  const [busy, setBusy] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [attendanceMode, setAttendanceMode] = useState("escolarizado");
  const [attendanceMonth, setAttendanceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [studentListOpen, setStudentListOpen] = useState(false);
  const [selectedStudentFields, setSelectedStudentFields] = useState<string[]>(defaultStudentListFields);

  function selectGroup(value: string) {
    setGroupId(value);
    const group = (options.groups ?? []).find((item) => String(item.id) === value);
    if (group?.active_cycle_id) setCycleId(String(group.active_cycle_id));
  }

  function openStudentListCustomizer() {
    setSelectedStudentFields(defaultStudentListFields);
    setStudentListOpen(true);
  }

  function toggleStudentField(field: string) {
    setSelectedStudentFields((current) => current.includes(field)
      ? current.filter((item) => item !== field)
      : current.length >= 8 ? current : [...current, field]);
  }

  function exportStudentList(format: "pdf" | "xlsx") {
    const query = new URLSearchParams({ format, fields: selectedStudentFields.join(",") });
    if (groupId) query.set("groupId", groupId);
    if (format === "pdf") openDocument(`/reports/student-list?${query}`);
    else download(`/reports/student-list?${query}`, "lista-alumnos.xlsx");
    setStudentListOpen(false);
  }

  function draftFromRow(row: CurricularSubject): CurricularDraft {
    return {
      semester: String(row.semester_number),
      status: row.status,
      finalScore: row.final_score == null ? "" : String(row.final_score),
      notes: row.notes ?? ""
    };
  }

  function isDraftChanged(row: CurricularSubject, draft = drafts[row.id]) {
    if (!draft) return false;
    const original = draftFromRow(row);
    return draft.semester !== original.semester
      || draft.status !== original.status
      || draft.finalScore !== original.finalScore
      || draft.notes !== original.notes;
  }

  function updateSavedRow(rowId: number, draft: CurricularDraft) {
    setCurricularRows((current) => current.map((row) => row.id === rowId ? {
      ...row,
      semester_number: Number(draft.semester),
      status: draft.status,
      final_score: draft.finalScore === "" ? null : Number(draft.finalScore),
      notes: draft.notes || null
    } : row));
  }

  function curricularPayload(draft: CurricularDraft) {
    return {
      semester: draft.semester,
      status: draft.status,
      finalScore: draft.finalScore,
      notes: draft.notes
    };
  }

  async function loadCurricularRows() {
    const query = new URLSearchParams();
    if (groupId) query.set("groupId", groupId);
    if (studentId) query.set("studentId", studentId);
    if (semester) query.set("semester", semester);
    if (cycleId) query.set("cycleId", cycleId);
    const rows = await api<CurricularSubject[]>(`/reports/curricular-subjects?${query}`);
    setCurricularRows(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.id, draftFromRow(row)])));
  }

  useEffect(() => {
    Promise.all(["groups", "cycles"].map(async (type) => {
      const result = await api<{ records: any[] }>(`/catalogs/${type}`);
      return [type, result.records.filter((item) => item.is_active).map((item) => ({
        id: item.id,
        name: item.name,
        active_cycle_id: item.active_cycle_id,
        plan_id: item.plan_id
      }))] as const;
    })).then((entries) => setOptions(Object.fromEntries(entries)));
    api<{ records: any[] }>("/students?pageSize=100").then((result) =>
      setOptions((current) => ({ ...current, students: result.records.map((student) => ({ id: student.id, name: `${student.student_number} - ${student.full_name}` })) }))
    );
    api<Plan[]>("/plans").then((records) => setPlans(records.filter((plan) => plan.is_active))).catch(() => undefined);
  }, []);

  useEffect(() => {
    setAcademicContext(null); setContextError(""); setIssuedDocuments([]);
    if (view !== "documents" || !studentId) return;
    const controller = new AbortController();
    api<{student: OfficialDocumentSnapshot["student"]}>(`/reports/academic-context?studentId=${studentId}`, { signal: controller.signal })
      .then(result => setAcademicContext(result.student))
      .catch(error => { if (!controller.signal.aborted) setContextError(error.message); });
    api<IssuedDocumentRow[]>(`/reports/issued-documents?studentId=${studentId}`, { signal: controller.signal })
      .then(setIssuedDocuments).catch(error => { if (!controller.signal.aborted) toast.error(error.message); });
    return () => controller.abort();
  }, [view, studentId]);

  useEffect(() => {
    if (!planId) {
      setPlanSubjects([]);
      return;
    }
    api<{ subjects: PlanSubject[] }>(`/plans/${planId}`)
      .then((detail) => setPlanSubjects(detail.subjects))
      .catch(() => setPlanSubjects([]));
  }, [planId]);

  useEffect(() => {
    loadCurricularRows().catch(() => undefined);
  }, [groupId, studentId, semester, cycleId]);

  function reportPath(type: string, format: string) {
    const query = new URLSearchParams({ format });
    if (groupId) query.set("groupId", groupId);
    if (type === "attendance") {
      query.set("mode", attendanceMode);
      query.set("month", attendanceMonth);
    }
    return `/reports/data/${type}?${query}`;
  }

  async function emitDocument(path: string) {
    setDocumentBusy(true);
    try {
      await openDocument(path);
      if (studentId) setIssuedDocuments(await api<IssuedDocumentRow[]>(`/reports/issued-documents?studentId=${studentId}`));
    } catch (error) { toast.error(error instanceof Error ? error.message : "No fue posible emitir el documento."); }
    finally { setDocumentBusy(false); }
  }

  function reportCard(mode: "student" | "group") {
    const query = new URLSearchParams();
    if (mode === "student" && studentId) query.set("studentId", studentId);
    if (mode === "group" && groupId) query.set("groupId", groupId);
    if (!query.has(mode === "student" ? "studentId" : "groupId")) {
      toast.error(`Selecciona un ${mode === "student" ? "alumno" : "grupo"}.`);
      return;
    }
    emitDocument(`/reports/report-card.pdf?${query}`);
  }

  function studentDocument(type: "study-certificate" | "academic-history") {
    if (!studentId) {
      toast.error("Selecciona un alumno.");
      return;
    }
    emitDocument(`/reports/${type}.pdf?studentId=${studentId}`);
  }

  async function revokeDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!revoking) return;
    setDocumentBusy(true);
    try {
      await api(`/reports/issued-documents/${revoking.id}/revoke`, { method: "POST", body: { reason: revocationReason } });
      setIssuedDocuments(await api<IssuedDocumentRow[]>(`/reports/issued-documents?studentId=${studentId}`));
      setRevoking(null); setRevocationReason("");
      toast.success("Documento revocado. Su QR mostrará que ya no es válido.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No fue posible revocar el documento."); }
    finally { setDocumentBusy(false); }
  }

  async function assignSemesterSubjects() {
    if (!groupId) return toast.error("Selecciona un grupo.");
    if (!planId) return toast.error("Selecciona el plan academico.");
    const subjectIds = planSubjects.filter((subject) => String(subject.recommended_period) === semester).map((subject) => subject.subject_id);
    if (!subjectIds.length) return toast.error("Ese semestre no tiene materias en el plan seleccionado.");
    const group = (options.groups ?? []).find((item) => String(item.id) === groupId);
    const effectiveCycleId = group?.active_cycle_id ? String(group.active_cycle_id) : cycleId;
    if (!effectiveCycleId) return toast.error("El grupo seleccionado no tiene un ciclo escolar activo.");
    if (effectiveCycleId !== cycleId) setCycleId(effectiveCycleId);
    setBusy(true);
    try {
      const result = await api<{ count: number }>("/reports/curricular-subjects/bulk", {
        method: "POST",
        body: { groupId, planId, cycleId: effectiveCycleId, semester, subjectIds, status: initialStatus }
      });
      toast.success(`Materias aplicadas al grupo. Registros actualizados: ${result.count}.`);
      await loadCurricularRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible aplicar las materias.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCurricularSubject(row: CurricularSubject) {
    const draft = drafts[row.id];
    if (!draft) return;
    try {
      await api(`/reports/curricular-subjects/${row.id}`, {
        method: "PATCH",
        body: curricularPayload(draft)
      });
      updateSavedRow(row.id, draft);
      toast.success("Avance del alumno actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar la materia.");
    }
  }

  async function saveAllCurricularSubjects() {
    const changedRows = curricularRows.filter((row) => isDraftChanged(row));
    if (!changedRows.length) return toast.error("No hay cambios pendientes por guardar.");
    setSavingAll(true);
    try {
      const results = await Promise.allSettled(changedRows.map(async (row) => {
        const draft = drafts[row.id];
        if (!draft) return;
        await api(`/reports/curricular-subjects/${row.id}`, {
          method: "PATCH",
          body: curricularPayload(draft)
        });
        updateSavedRow(row.id, draft);
      }));
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const saved = results.length - failed.length;
      if (saved) toast.success(`${saved} ${saved === 1 ? "registro guardado" : "registros guardados"}.`);
      if (failed.length) {
        const firstError = failed[0].reason;
        toast.error(firstError instanceof Error ? `${failed.length} registros no se guardaron: ${firstError.message}` : `${failed.length} registros no se guardaron.`);
      }
    } finally {
      setSavingAll(false);
    }
  }

  async function applyGroupStatus() {
    if (!groupId) return toast.error("Selecciona un grupo.");
    setBusy(true);
    try {
      const result = await api<{ count: number }>("/reports/curricular-subjects/status-group", {
        method: "PATCH",
        body: { groupId, cycleId: cycleId || undefined, semester, status: initialStatus }
      });
      toast.success(`${result.count} materia(s) del grupo cambiadas a ${initialStatus === "in_progress" ? "En curso" : initialStatus === "completed" ? "Cursada" : "Pendiente"}.`);
      await loadCurricularRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible cambiar el estado del grupo.");
    } finally {
      setBusy(false);
    }
  }

  async function clearGroupCurricularSubjects() {
    if (!groupId) return toast.error("Selecciona un grupo.");
    if (!confirm("Esto borrara TODAS las materias colocadas a los alumnos del grupo seleccionado. Deseas continuar?")) return;
    const confirmation = prompt("Para confirmar, escribe LIMPIAR");
    if (confirmation !== "LIMPIAR") return toast.error("Operacion cancelada.");
    setBusy(true);
    try {
      const result = await api<{ count: number }>("/reports/curricular-subjects/clear-group", {
        method: "POST",
        body: { groupId, confirmation }
      });
      toast.success(`Se limpiaron ${result.count} materias del grupo.`);
      await loadCurricularRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible limpiar el grupo.");
    } finally {
      setBusy(false);
    }
  }

  const semesterSubjects = planSubjects.filter((subject) => String(subject.recommended_period) === semester);
  const changedRowsCount = curricularRows.filter((row) => isDraftChanged(row)).length;
  const listReports = reports.filter((report) => report.type === "students" || report.type === "attendance");
  const academicReports = reports.filter((report) => report.type !== "students" && report.type !== "attendance");

  function renderReportItem(report: (typeof reports)[number]) {
    return (
      <article className="report-item" key={report.type}>
        <div className="report-item-icon"><report.icon size={23} /></div>
        <div>
          <h3>{report.title}</h3><p>{report.description}</p>
          {report.type === "attendance" && <div className="attendance-report-options">
            <label>Modalidad<select value={attendanceMode} onChange={(event) => setAttendanceMode(event.target.value)}><option value="escolarizado">Escolarizado</option><option value="semiescolarizado">Semiescolarizado</option><option value="complementario">Complementario</option><option value="en_linea">En Línea</option></select></label>
            <label>Mes<input type="month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)} /></label>
          </div>}
        </div>
        <div className="report-actions">
          {report.type === "students" ? <>
            <button title="Abrir lista limpia" onClick={() => exportStudentList("pdf")}><ListFilter size={17} /><span>Lista limpia</span></button>
            <button title="Descargar Excel" onClick={() => exportStudentList("xlsx")}><FileSpreadsheet size={17} /><span>Excel</span></button>
            <button title="Personalizar campos" onClick={openStudentListCustomizer}><SlidersHorizontal size={17} /><span>Personalizar</span></button>
          </> : <>
            <button title="Abrir PDF" onClick={() => openDocument(reportPath(report.type, "pdf"))}><FileText size={17} /><span>PDF</span></button>
            <button title="Descargar Excel" onClick={() => download(reportPath(report.type, "xlsx"), `${report.type}.xlsx`)}><FileSpreadsheet size={17} /><span>Excel</span></button>
          </>}
        </div>
      </article>
    );
  }

  return (
    <div className="page-stack">
      {view === "documents" && <><section className="report-card-builder">
        <div className="report-builder-intro">
          <div className="report-builder-icon"><GraduationCap size={28} /></div>
          <div><span>Control Escolar</span><h2>Documentos escolares</h2><p>Emisión institucional con firma, sello y QR de validación.</p></div>
        </div>
        <div className="report-builder-controls">
          <Field label="Alumno"><Select options={options.students ?? []} value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="Seleccionar alumno" /></Field>
          <Field label="Grupo"><Select options={options.groups ?? []} value={groupId} onChange={(event) => selectGroup(event.target.value)} placeholder="Seleccionar grupo" /></Field>
          <Button variant="secondary" icon={<Sheet size={17} />} busy={documentBusy} onClick={() => reportCard("group")}>Boletas por grupo</Button>
        </div>
        {academicContext && <p className="document-context"><strong>{academicContext.name}</strong><span>{academicContext.semesterName} · Ciclo escolar {academicContext.cycle} · Grupo {academicContext.group}</span></p>}
        {contextError && <p className="document-context" role="alert">{contextError}</p>}
        <div className="official-document-options">
          <article><Printer size={24} /><h3>Boleta de calificaciones</h3><p>Solo las asignaturas del semestre actual. Incluye parciales, calificación final y espacios para firma.</p><Button variant="secondary" busy={documentBusy} onClick={() => reportCard("student")}>Emitir boleta</Button></article>
          <article><GraduationCap size={24} /><h3>Historial académico</h3><p>Asignaturas cursadas de semestres anteriores y las del semestre actual, sin materias futuras.</p><Button variant="secondary" busy={documentBusy} onClick={() => studentDocument("academic-history")}>Emitir historial</Button></article>
          <article><FileText size={24} /><h3>Constancia de estudios</h3><p>Inscripción vigente, semestre actual y calendario del ciclo escolar: inicio, vacaciones y fin.</p><Button variant="secondary" busy={documentBusy} onClick={() => studentDocument("study-certificate")}>Emitir constancia</Button></article>
        </div>
      </section>
      {studentId && <section className="table-section"><header className="section-heading"><div><span>Validación institucional</span><h2>Documentos emitidos</h2><p>El QR conserva los datos de cada emisión. Revoca un documento cuando deba sustituirse.</p></div></header>
        <div className="table-wrap"><table><thead><tr><th>Documento / folio</th><th>Emisión</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{issuedDocuments.map(document => <tr key={document.id}><td><strong>{{ report_card: "Boleta", academic_history: "Historial académico", study_certificate: "Constancia", account_statement: "Estado de cuenta" }[document.document_type] || document.document_type}</strong><span className="table-sub">{document.folio}</span></td><td>{new Date(document.issued_at).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</td><td>{document.revoked_at ? "Revocado" : "Vigente"}</td><td><div className="inline-actions"><a className="button button-secondary" href={document.verification_url} target="_blank" rel="noreferrer"><ShieldCheck size={16} /> Verificar</a>{!document.revoked_at && <Button variant="ghost" onClick={() => { setRevoking(document); setRevocationReason(""); }}>Revocar</Button>}</div></td></tr>)}</tbody></table></div>
        {!issuedDocuments.length && <p className="empty-calendar-copy">Aún no hay documentos emitidos para este alumno.</p>}
      </section>}
      <Modal open={!!revoking} title="Revocar documento" onClose={() => setRevoking(null)} size="small"><form onSubmit={revokeDocument}><p>El folio {revoking?.folio} quedará sin validez en la consulta del QR.</p><Field label="Motivo" required><textarea value={revocationReason} onChange={event => setRevocationReason(event.target.value)} maxLength={300} required /></Field><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setRevoking(null)}>Cancelar</Button><Button type="submit" variant="danger" busy={documentBusy}>Revocar documento</Button></div></form></Modal>
      </>}

      {view === "reports" && <><section className="curricular-admin">
        <div className="section-heading standalone">
          <div><span>Carga académica por grupo</span><h2>Materias asignadas al grupo</h2><p>La materia y el docente se asignan al grupo; cada alumno nuevo recibe automáticamente esta carga.</p></div>
        </div>
        <div className="curricular-controls">
          <Field label="Grupo"><Select options={options.groups ?? []} value={groupId} onChange={(event) => selectGroup(event.target.value)} placeholder="Seleccionar grupo" /></Field>
          <Field label="Alumno"><Select options={options.students ?? []} value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="Todos" /></Field>
          <Field label="Plan"><Select options={plans.map((plan) => ({ id: plan.id, name: `${plan.code} - ${plan.name}` }))} value={planId} onChange={(event) => setPlanId(event.target.value)} placeholder="Seleccionar plan" /></Field>
          <Field label="Semestre"><input type="number" min="1" value={semester} onChange={(event) => setSemester(event.target.value || "1")} /></Field>
          <Field label="Ciclo"><Select options={options.cycles ?? []} value={cycleId} onChange={(event) => setCycleId(event.target.value)} placeholder="Ciclo del grupo" /></Field>
          <Field label="Estado inicial"><select value={initialStatus} onChange={(event) => setInitialStatus(event.target.value as CurricularSubject["status"])}><option value="pending">Pendiente</option><option value="in_progress">En curso</option><option value="completed">CURSADA</option></select></Field>
          {can("reports.generate") && <Button icon={<GraduationCap size={17} />} busy={busy} onClick={assignSemesterSubjects}>Asignar materias del plan al grupo</Button>}
        </div>
        {can("reports.generate") && <div className="bulk-toolbar">
          <Button variant="secondary" icon={<GraduationCap size={17} />} busy={busy} onClick={applyGroupStatus}>Aplicar estado al grupo</Button>
          <Button icon={<Save size={17} />} busy={savingAll} disabled={!changedRowsCount} onClick={saveAllCurricularSubjects}>Guardar avances{changedRowsCount ? ` (${changedRowsCount})` : ""}</Button>
          <Button variant="danger" icon={<Trash2 size={17} />} busy={busy} onClick={clearGroupCurricularSubjects}>Limpiar grupo</Button>
        </div>}
        <div className="semester-subject-strip">
          {semesterSubjects.length
            ? semesterSubjects.map((subject) => <span key={subject.subject_id}>{subject.code} - {subject.name}</span>)
            : <small>Selecciona un plan para ver las materias configuradas en este semestre.</small>}
        </div>
        <div className="table-wrap curricular-table">
          <table>
            <thead><tr><th>Alumno</th><th>Materia</th><th>Docente</th><th>Semestre</th><th>Estado</th><th>Promedio</th><th>Notas</th><th>Acciones</th></tr></thead>
            <tbody>
              {curricularRows.map((row) => {
                const draft = drafts[row.id] ?? draftFromRow(row);
                return (
                  <tr key={row.id}>
                    <td><strong className="table-main">{row.student_name}</strong><span className="table-sub">{row.student_number} - {row.group_name ?? "Sin grupo"}</span></td>
                    <td><strong className="table-main">{row.subject_name}</strong><span className="table-sub">{row.subject_code} - {row.cycle_name ?? "Sin ciclo"}</span></td>
                    <td>{row.teacher_name ?? <span className="muted-cell">Por asignar</span>}</td>
                    <td><input className="compact-input" type="number" min="1" value={draft.semester} onChange={(event) => setDrafts({ ...drafts, [row.id]: { ...draft, semester: event.target.value } })} /></td>
                    <td><select value={draft.status} onChange={(event) => setDrafts({ ...drafts, [row.id]: { ...draft, status: event.target.value as CurricularSubject["status"] } })}><option value="pending">Pendiente</option><option value="in_progress">Cursando</option><option value="completed">CURSADA</option></select></td>
                    <td><input className="compact-input" type="number" min="0" max="10" step="0.1" value={draft.finalScore} onChange={(event) => setDrafts({ ...drafts, [row.id]: { ...draft, finalScore: event.target.value } })} /></td>
                    <td><input value={draft.notes} onChange={(event) => setDrafts({ ...drafts, [row.id]: { ...draft, notes: event.target.value } })} /></td>
                    <td><div className="inline-actions"><button title="Guardar avance" disabled={!isDraftChanged(row)} onClick={() => saveCurricularSubject(row)}><Save size={16} /></button></div></td>
                  </tr>
                );
              })}
              {!curricularRows.length && <tr><td colSpan={8}><div className="empty-row">No hay materias asignadas al grupo con esos filtros.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reports-section">
        <div className="section-heading standalone">
          <div><span>Listas operativas</span><h2>Listas y controles</h2><p>Formatos rápidos para consulta, asistencia y trabajo diario.</p></div>
          <Field label="Filtrar por grupo"><Select options={options.groups ?? []} value={groupId} onChange={(event) => selectGroup(event.target.value)} placeholder="Todos los grupos" /></Field>
        </div>
        <div className="report-grid">{listReports.map(renderReportItem)}</div>
      </section>

      <section className="reports-section">
        <div className="section-heading standalone">
          <div><span>Formatos académicos</span><h2>Reportes disponibles</h2><p>Resultados, promedios y seguimiento académico.</p></div>
          <Field label="Filtrar por grupo"><Select options={options.groups ?? []} value={groupId} onChange={(event) => selectGroup(event.target.value)} placeholder="Todos los grupos" /></Field>
        </div>
        <div className="report-grid">{academicReports.map(renderReportItem)}</div>
      </section>

      </>}
      <Modal open={studentListOpen} onClose={() => setStudentListOpen(false)} title="Personalizar lista de alumnos" size="small">
        <div className="custom-list-intro"><SlidersHorizontal size={20} /><p>Elige hasta 8 campos para generar una lista clara y útil. El grupo seleccionado se conservará como filtro.</p></div>
        <div className="student-list-field-grid">
          {studentListFields.map(([value, label]) => {
            const selected = selectedStudentFields.includes(value);
            return <button type="button" className={`student-list-field ${selected ? "selected" : ""}`} key={value} onClick={() => toggleStudentField(value)}><span>{label}</span>{selected && <Check size={16} />}</button>;
          })}
        </div>
        <p className="form-hint">{selectedStudentFields.length} de 8 campos seleccionados.</p>
        <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setStudentListOpen(false)}>Cancelar</Button><Button type="button" icon={<FileText size={17} />} onClick={() => exportStudentList("pdf")} disabled={!selectedStudentFields.length}>Generar PDF</Button><Button type="button" icon={<FileSpreadsheet size={17} />} onClick={() => exportStudentList("xlsx")} disabled={!selectedStudentFields.length}>Descargar Excel</Button></div>
      </Modal>
    </div>
  );
}
