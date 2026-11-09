import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { api, download } from "../lib/api";
import { Button, Field } from "./Ui";
import { useToast } from "./Toast";
import type { AttendanceListOptions } from "../../shared/attendance-list";
import "./attendance-list-downloads.css";

type Group = { id: number; name: string; is_active: number; curricular_period_number: number | null };
type Period = { id: number; name: string; sequence: number };

export function AttendanceListDownloads({ groups, periods, defaultGroupId }: { groups: Group[]; periods: Period[]; defaultGroupId: number | null }) {
  const toast = useToast();
  const [groupId, setGroupId] = useState("");
  const [semester, setSemester] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [options, setOptions] = useState<AttendanceListOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  function chooseGroup(id: string) {
    setGroupId(id); setSubjectId(""); setOptions(null);
    const group = groups.find(group => String(group.id) === id);
    setSemester(group?.curricular_period_number ? String(group.curricular_period_number) : "");
  }
  const defaultSemester = groups.find(group => group.id === defaultGroupId)?.curricular_period_number;
  useEffect(() => { if (defaultGroupId !== null) chooseGroup(String(defaultGroupId)); }, [defaultGroupId, defaultSemester]);
  useEffect(() => {
    setOptions(null); setError("");
    if (!groupId || !semester) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true);
    const query = new URLSearchParams({ semester });
    if (subjectId) query.set("subjectId", subjectId);
    api<AttendanceListOptions>(`/group-management/${groupId}/attendance-list?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [groupId, semester, subjectId, retry]);
  async function exportList(format: "pdf" | "xlsx") {
    if (!options?.studentCount || busy || loading) return;
    setBusy(format);
    try {
      const query = new URLSearchParams({ semester });
      if (subjectId) query.set("subjectId", subjectId);
      await download(`/group-management/${groupId}/attendance-list.${format}?${query}`, `lista-asistencia-grupo-${groupId}-semestre-${semester}.${format}`);
      toast.success("Lista de asistencia descargada.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No fue posible descargar la lista."); }
    finally { setBusy(null); }
  }
  return <section className="attendance-list-downloads" aria-labelledby="attendance-lists-title">
    <header><span className="attendance-list-icon"><Download size={23} /></span><div><h2 id="attendance-lists-title">Descargar listas de asistencia</h2><p>Elige grupo, semestre y materia. Descarga una lista con espacios para registrar fechas y asistencia.</p></div></header>
    <div className="attendance-list-filters">
      <Field label="Grupo para la lista"><select value={groupId} disabled={busy !== null} onChange={event => chooseGroup(event.target.value)}><option value="">Seleccionar grupo</option>{groups.filter(group => group.is_active).map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></Field>
      <Field label="Semestre para la lista"><select value={semester} disabled={!groupId || busy !== null} onChange={event => { setSemester(event.target.value); setSubjectId(""); setOptions(null); }}><option value="">Seleccionar semestre</option>{periods.map(period => <option value={period.sequence} key={period.id}>{period.name}</option>)}</select></Field>
      <Field label="Materia para la lista"><select value={subjectId} disabled={!options || loading || busy !== null} onChange={event => { setSubjectId(event.target.value); setOptions(null); }}><option value="">Lista general del grupo</option>{options?.subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.code} · {subject.name}</option>)}</select></Field>
    </div>
    <div className="attendance-list-summary" role="status" aria-live="polite">
      {loading ? "Cargando alumnos y materias…" : error ? error : options ? `${options.group.name} · ${options.group.semesterName} · Ciclo ${options.group.cycle} · ${options.studentCount} alumno(s)` : "Selecciona un grupo y semestre para preparar la lista."}
      {error && <Button variant="ghost" onClick={() => setRetry(value => value + 1)}>Reintentar</Button>}
    </div>
    {options && !options.studentCount && <p>No hay alumnos activos inscritos en este grupo y semestre. Prueba con otro filtro.</p>}
    {options?.studentCount ? !options.subjects.length && <p>Sin materias cargadas o registradas en el plan para este semestre. Puedes descargar la lista general.</p> : null}
    <div className="attendance-list-actions">
      <Button icon={<Printer size={17} />} busy={busy === "pdf"} disabled={loading || !options?.studentCount || busy !== null} onClick={() => exportList("pdf")}>Descargar PDF</Button>
      <Button icon={<FileSpreadsheet size={17} />} variant="secondary" busy={busy === "xlsx"} disabled={loading || !options?.studentCount || busy !== null} onClick={() => exportList("xlsx")}>Descargar Excel</Button>
    </div>
    <p className="attendance-list-help">Incluye alumnos activos del semestre elegido, ordenados por apellidos, y 16 columnas para pasar lista. La materia utiliza la carga registrada o, cuando aún no existe, las materias obligatorias del plan.</p>
  </section>;
}
