import { useEffect, useState } from "react";
import "./study-certificate-editor.css";
import { api, download } from "../lib/api";
import { Button, Field } from "./Ui";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import type { StudyCertificateDraft, StudyCertificatePreview } from "../../shared/study-certificate";

export function StudyCertificateEditor({ studentId, onClose, onIssued }: {
  studentId: number; onClose: () => void; onIssued?: () => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<StudyCertificatePreview | null>(null);
  const [draft, setDraft] = useState<StudyCertificateDraft | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<"pdf" | "docx">("pdf");
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setDraft(null); setError("");
    api<StudyCertificatePreview>(`/reports/study-certificate/draft?studentId=${studentId}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setPreview(result); setDraft(structuredClone(result.draft)); } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [studentId, retry]);
  const update = <K extends keyof StudyCertificateDraft>(key: K, value: StudyCertificateDraft[K]) => setDraft(current => current ? { ...current, [key]: value } : current);
  async function issue(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      await download(`/reports/study-certificate.${format}`, `constancia-${preview?.student.number || studentId}.${format}`, { body: { studentId, draft } });
      toast.success("Constancia emitida y descargada. Su QR conserva los datos de esta emisión.");
      onIssued?.(); onClose();
    } catch (error) { setError(error instanceof Error ? error.message : "No fue posible emitir la constancia."); }
    finally { setBusy(false); }
  }
  return <Modal open className="certificate-editor" title="Revisar y emitir constancia" size="large" onClose={() => { if (!busy) onClose(); }}>
    {error && <p role="alert" className="form-error">{error}</p>}
    {!draft ? error ? <Button onClick={() => setRetry(value => value + 1)}>Reintentar</Button> : <p role="status">Cargando datos de la constancia…</p> : <form onSubmit={issue}>
      <p><strong>{preview?.student.name}</strong> · Matrícula {preview?.student.number}</p>
      <p>Los campos se rellenan con la información actual. Tus ajustes se aplican únicamente a esta constancia; no cambian el expediente ni el calendario general.</p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="form-grid two">
          <Field label="Nombre de los estudios / programa" required><input required maxLength={200} value={draft.programName} onChange={e => update("programName", e.target.value)} /></Field>
          <Field label="Número de RVOE" required><input required maxLength={100} value={draft.rvoe} onChange={e => update("rvoe", e.target.value)} /></Field>
          <Field label="Semestre que se indicará" required><input required maxLength={100} value={draft.semesterName} onChange={e => update("semesterName", e.target.value)} /></Field>
          <Field label="Modalidad" required><input required maxLength={100} value={draft.modality} onChange={e => update("modality", e.target.value)} /></Field>
          <Field label="Horario y días" required><input required maxLength={300} value={draft.schedule} onChange={e => update("schedule", e.target.value)} /></Field>
          <Field label="Nombre del ciclo escolar" required><input required maxLength={100} value={draft.cycleName} onChange={e => update("cycleName", e.target.value)} /></Field>
          <Field label="Inicio de actividades" required><input required type="date" value={draft.startDate} onChange={e => update("startDate", e.target.value)} /></Field>
          <Field label="Fin de actividades" required><input required type="date" min={draft.startDate} value={draft.endDate} onChange={e => update("endDate", e.target.value)} /></Field>
          <Field label="Fecha indicada en la constancia" required hint="El registro del QR conserva también la fecha real de emisión."><input required type="date" value={draft.documentDate} onChange={e => update("documentDate", e.target.value)} /></Field>
          <Field label="Lugar de expedición" required><input required maxLength={200} value={draft.place} onChange={e => update("place", e.target.value)} /></Field>
        </div>
        <p><strong>{preview?.certification.institution}</strong> · CCT {preview?.certification.cct}. {preview?.certification.collaborationAgreement ? "Incluye convenio de colaboración con UNITEN." : "RVOE propio de IFOP."}</p>
        <h3>Periodos vacacionales</h3>
        {draft.vacations.map((vacation, index) => <div className="form-grid two" key={index} style={{ marginBottom: 12 }}>
          <Field label={`Inicio de vacaciones ${index + 1}`} required><input required type="date" min={draft.startDate} max={draft.endDate} value={vacation.start_date} onChange={e => update("vacations", draft.vacations.map((v, i) => i === index ? { ...v, start_date: e.target.value } : v))} /></Field>
          <Field label={`Fin de vacaciones ${index + 1}`} required><input required type="date" min={vacation.start_date || draft.startDate} max={draft.endDate} value={vacation.end_date} onChange={e => update("vacations", draft.vacations.map((v, i) => i === index ? { ...v, end_date: e.target.value } : v))} /></Field>
          <Button type="button" variant="ghost" onClick={() => update("vacations", draft.vacations.filter((_, i) => i !== index))}>Quitar vacaciones {index + 1}</Button>
        </div>)}
        {!draft.vacations.length && <p>Sin periodos vacacionales.</p>}
        <Button type="button" variant="secondary" disabled={draft.vacations.length >= 12} onClick={() => update("vacations", [...draft.vacations, { start_date: "", end_date: "" }])}>Añadir vacaciones</Button>
        <h3>Temario</h3>
        <Field label="Nombre / encabezado del temario" required><input required maxLength={200} value={draft.subjectsTitle} onChange={e => update("subjectsTitle", e.target.value)} /></Field>
        {draft.subjects.map((subject, index) => <div className="form-grid two" key={index} style={{ marginTop: 12 }}>
          <Field label={`Asignatura ${index + 1}`} required><input required maxLength={200} value={subject.name} onChange={e => update("subjects", draft.subjects.map((s, i) => i === index ? { ...s, name: e.target.value } : s))} /></Field>
          <Field label={`Tipo de asignatura ${index + 1}`}><select value={subject.type} onChange={e => update("subjects", draft.subjects.map((s, i) => i === index ? { ...s, type: e.target.value as "mandatory" | "elective" } : s))}><option value="mandatory">Obligatoria</option><option value="elective">Optativa</option></select></Field>
          <Button type="button" variant="ghost" onClick={() => update("subjects", draft.subjects.filter((_, i) => i !== index))}>Quitar asignatura {index + 1}</Button>
        </div>)}
        <Button type="button" variant="secondary" disabled={draft.subjects.length >= 80} onClick={() => update("subjects", [...draft.subjects, { name: "", type: "mandatory" }])}>Añadir asignatura</Button>
        <hr />
        <Field label="Formato de descarga"><select value={format} onChange={e => setFormat(e.target.value as "pdf" | "docx")}><option value="pdf">PDF para imprimir</option><option value="docx">Word editable (.docx)</option></select></Field>
        {format === "docx" && <p>El QR validará los datos emitidos desde esta pantalla. Si modificas el Word después de descargarlo, esos cambios no se reflejarán en la consulta del QR; emite una nueva constancia para registrarlos.</p>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={() => preview && setDraft(structuredClone(preview.draft))}>Restablecer datos</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" busy={busy}>Emitir y descargar {format === "pdf" ? "PDF" : "Word"}</Button>
        </div>
      </fieldset>
    </form>}
  </Modal>;
}
