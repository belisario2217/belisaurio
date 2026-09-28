import { useEffect, useRef, useState } from "react";
import { CalendarCheck, CheckCheck, Save, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, EmptyState, Field, StatusBadge } from "../components/Ui";

type Group = { id: number; group_name: string; program_name: string; study_modality: string | null; cycle_name: string };
type Mark = "present" | "absent" | "";
type AttendanceData = {
  group: Group; date: string;
  day: { status: "draft" | "confirmed"; revision: number; confirmed_at: string | null };
  days: Array<{ attendance_date: string; status: "draft" | "confirmed" }>;
  students: Array<{ enrollment_id: number; student_number: string; student_name: string; status: Mark | null; notes: string | null;
    summary: { scheduled_days: number; attended_days: number; percentage: number } }>;
  legacy: Array<{ month: string; subject_name: string; student_number: string; student_name: string; scheduled_classes: number; attended_classes: number; status: string }>;
};

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function AttendancePage() {
  const toast = useToast();
  const { can } = useAuth();
  const canManage = can("attendance.manage");
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Group | null>(null);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AttendanceData | null>(null);
  const [records, setRecords] = useState<Record<number, { status: Mark; notes: string }>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const requestId = useRef(0);

  async function loadAttendance(group: Group, targetDate: string) {
    const id = ++requestId.current;
    setSelected(group);
    setDate(targetDate);
    setData(null);
    setBusy(true);
    try {
      const result = await api<AttendanceData>(`/attendance/group/${group.id}?date=${targetDate}`);
      if (id !== requestId.current) return;
      setData(result);
      setDirty(false);
      setRecords(Object.fromEntries(result.students.map((student) => [student.enrollment_id, { status: student.status ?? "", notes: student.notes ?? "" }])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible cargar la asistencia.");
    } finally { if (id === requestId.current) setBusy(false); }
  }

  useEffect(() => {
    api<Group[]>("/attendance/groups").then((rows) => { setGroups(rows); if (rows[0]) void loadAttendance(rows[0], date); })
      .catch((error) => toast.error(error.message));
  }, []);

  function changeSelection(group: Group, targetDate: string) {
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres cambiar de lista y descartarlos?")) return;
    void loadAttendance(group, targetDate);
  }

  function updateRecord(id: number, patch: Partial<{ status: Mark; notes: string }>) {
    setRecords((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setDirty(true);
  }

  async function save(confirm: boolean) {
    if (!selected || !data || !canManage) return;
    setBusy(true);
    try {
      const result = await api<{ message: string }>(`/attendance/group/${selected.id}`, {
        method: "PUT", body: { date: data.date, revision: data.day.revision, confirm,
          records: data.students.map((student) => ({ enrollmentId: student.enrollment_id, ...records[student.enrollment_id] })) }
      });
      toast.success(result.message);
      await loadAttendance(selected, data.date);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No fue posible guardar la asistencia."); }
    finally { setBusy(false); }
  }

  const pending = data?.students.filter((student) => !records[student.enrollment_id]?.status).length ?? 0;
  return <div className="attendance-page page-stack">
    <section className="toolbar">
      <div className="toolbar-primary"><CalendarCheck size={21} /><div><strong>Asistencia diaria por alumno</strong><span className="table-sub">Pasa lista una vez al día. El registro aplica a todas las materias del alumno.</span></div></div>
      <div className="toolbar-actions"><Field label="Fecha"><input type="date" value={date} disabled={busy} onChange={(event) => { if (event.target.value && selected) changeSelection(selected, event.target.value); }} /></Field></div>
    </section>
    <section className="attendance-layout">
      <aside className="assignment-pane">
        <div className="assignment-toolbar"><div><span>Grupos</span><strong>{groups.length} grupos</strong></div></div>
        <div className="assignment-list">{groups.map((group) => <button key={group.id} disabled={busy} className={selected?.id === group.id ? "active" : ""} onClick={() => changeSelection(group, date)}>
          <Users size={21} /><div><strong>{group.group_name}</strong><span>{group.program_name}</span><small>{group.cycle_name}</small></div>
        </button>)}</div>
      </aside>
      <main className="attendance-main">
        {data && selected ? <>
          <header className="attendance-heading"><div><span>{selected.cycle_name} · {data.date}</span><h2>Grupo {selected.group_name}</h2><p>{selected.study_modality || "Todas las materias"} · Una lista por día</p></div><StatusBadge active={data.day.status === "confirmed"} label={dirty ? "CAMBIOS SIN GUARDAR" : data.day.status === "confirmed" ? "DÍA CONFIRMADO" : "BORRADOR"} /></header>
          <div className="attendance-controls">
            {canManage && <>
              <Button variant="secondary" disabled={busy || !data.students.length} icon={<CheckCheck size={17} />} onClick={() => { setRecords((current) => Object.fromEntries(data.students.map((s) => [s.enrollment_id, { ...current[s.enrollment_id], status: "present" }]))); setDirty(true); }}>Todos presentes</Button>
              <Button variant="secondary" disabled={!data.students.length} icon={<Save size={17} />} busy={busy} onClick={() => save(false)}>Guardar borrador</Button>
              <Button disabled={pending > 0 || !data.students.length} icon={<CalendarCheck size={17} />} busy={busy} onClick={() => save(true)}>Confirmar día</Button>
            </>}
            <Button variant="ghost" disabled={busy} onClick={() => changeSelection(selected, date)}>Recargar lista</Button>
            <span>{pending ? `${pending} alumnos sin marcar` : "Lista completa"}</span>
          </div>
          <p>El resumen mensual cuenta únicamente días confirmados. Un día sin lista no se cuenta como falta.</p>
          <div className="table-wrap"><table><thead><tr><th>Matrícula</th><th>Alumno</th><th>Asistencia del día</th><th>Días presentes / registrados en el mes</th><th>Porcentaje mensual</th><th>Observaciones</th></tr></thead><tbody>
            {data.students.map((student) => <tr key={student.enrollment_id}>
              <td><strong>{student.student_number}</strong></td><td><strong className="table-main">{student.student_name}</strong></td>
              <td><select aria-label={`Asistencia de ${student.student_name}`} disabled={busy || !canManage} value={records[student.enrollment_id]?.status ?? ""} onChange={(event) => updateRecord(student.enrollment_id, { status: event.target.value as Mark })}><option value="">Sin registrar</option><option value="present">Presente</option><option value="absent">Falta</option></select></td>
              <td>{student.summary.attended_days} / {student.summary.scheduled_days}</td>
              <td><strong className={student.summary.percentage >= 80 ? "grade-pass-text" : "grade-fail-text"}>{student.summary.scheduled_days ? `${student.summary.percentage.toFixed(1)}%` : "Sin registro"}</strong></td>
              <td><input aria-label={`Observaciones de ${student.student_name}`} disabled={busy || !canManage} value={records[student.enrollment_id]?.notes ?? ""} maxLength={500} onChange={(event) => updateRecord(student.enrollment_id, { notes: event.target.value })} placeholder="Opcional" /></td>
            </tr>)}
          </tbody></table></div>
          {!data.students.length && <p>Este grupo no tiene alumnos inscritos.</p>}
          <details><summary>Días registrados en {date.slice(0, 7)} ({data.days.length})</summary><div className="attendance-controls">{data.days.map((day) => <Button key={day.attendance_date} variant="secondary" disabled={busy} onClick={() => changeSelection(selected, day.attendance_date)}>{day.attendance_date} · {day.status === "confirmed" ? "Confirmado" : "Borrador"}</Button>)}</div></details>
          {data.legacy.length > 0 && <details><summary>Historial anterior por materia de este mes (solo consulta)</summary><p>Estos totales se conservan como historial. No contienen fechas individuales y no se suman a la asistencia diaria.</p><div className="table-wrap"><table><thead><tr><th>Alumno</th><th>Materia anterior</th><th>Asistencias / clases</th><th>Estado</th></tr></thead><tbody>{data.legacy.map((row, index) => <tr key={index}><td>{row.student_name} ({row.student_number})</td><td>{row.subject_name}</td><td>{row.attended_classes} / {row.scheduled_classes}</td><td>{row.status === "confirmed" ? "Confirmado" : "Borrador"}</td></tr>)}</tbody></table></div></details>}
        </> : <EmptyState icon={<Users size={28} />} title={busy ? "Cargando lista" : "Selecciona un grupo"} text="La asistencia es diaria y común a todas las materias. Los docentes ven únicamente sus grupos asignados." />}
      </main>
    </section>
  </div>;
}
