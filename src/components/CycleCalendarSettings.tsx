import { useEffect, useState } from "react";
import { CalendarRange, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "./Toast";
import { Button, Field, Select } from "./Ui";

export type CycleCalendar = {
  cycle_id: number; cycle_name: string; activity_start: string; activity_end: string;
  vacations: { start_date: string; end_date: string }[];
};

export function CycleCalendarSettings({ cycles, calendars, activeCycleId, onSaved }: {
  cycles: { id: number; name: string }[]; calendars: CycleCalendar[];
  activeCycleId: number | null; onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [cycleId, setCycleId] = useState(String(activeCycleId || cycles[0]?.id || ""));
  const [form, setForm] = useState({ startDate: "", endDate: "", vacations: [] as CycleCalendar["vacations"] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const cycle = calendars.find(item => String(item.cycle_id) === cycleId);
    setForm({ startDate: cycle?.activity_start || "", endDate: cycle?.activity_end || "", vacations: cycle?.vacations.map(vacation => ({ ...vacation })) || [] });
  }, [cycleId, calendars]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!cycleId) return toast.error("Selecciona el ciclo escolar.");
    setBusy(true);
    try {
      await api(`/settings/cycles/${cycleId}/calendar`, { method: "PUT", body: form });
      await onSaved();
      toast.success("Calendario del ciclo guardado. Se utilizará en las nuevas constancias.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No fue posible guardar el calendario."); }
    finally { setBusy(false); }
  }
  return <form className="settings-section cycle-calendar-form" onSubmit={save}>
    <div className="settings-title"><CalendarRange size={20} /><div><h2>Calendario del ciclo escolar</h2><p>Estas fechas se usan en las constancias de todos los grupos que cursan este ciclo, sea cual sea su semestre.</p></div></div>
    <div className="form-grid two">
      <Field label="Ciclo escolar" required><Select options={cycles} value={cycleId} onChange={event => setCycleId(event.target.value)} required /></Field>
      <p className="cycle-calendar-hint">El semestre indica el avance en la carrera. El ciclo escolar indica el periodo de actividades, por ejemplo 2026B – 2027A.</p>
      <Field label="Inicio de actividades" required><input type="date" required value={form.startDate} onChange={event => setForm({ ...form, startDate: event.target.value })} /></Field>
      <Field label="Fin de actividades" required><input type="date" required min={form.startDate} value={form.endDate} onChange={event => setForm({ ...form, endDate: event.target.value })} /></Field>
    </div>
    <h3>Periodos vacacionales</h3>
    {!form.vacations.length && <p className="cycle-calendar-hint">Este ciclo no tiene vacaciones registradas.</p>}
    {form.vacations.map((vacation, index) => <div className="cycle-vacation-row" key={index}>
      <Field label={`Inicio de vacaciones ${index + 1}`} required><input type="date" min={form.startDate} max={form.endDate} required value={vacation.start_date} onChange={event => setForm({ ...form, vacations: form.vacations.map((item, row) => row === index ? { ...item, start_date: event.target.value } : item) })} /></Field>
      <Field label={`Fin de vacaciones ${index + 1}`} required><input type="date" min={vacation.start_date || form.startDate} max={form.endDate} required value={vacation.end_date} onChange={event => setForm({ ...form, vacations: form.vacations.map((item, row) => row === index ? { ...item, end_date: event.target.value } : item) })} /></Field>
      <button type="button" className="icon-button" aria-label={`Eliminar vacaciones ${index + 1}`} onClick={() => setForm({ ...form, vacations: form.vacations.filter((_, row) => row !== index) })}><Trash2 size={17} /></button>
    </div>)}
    <div className="modal-actions"><Button type="button" variant="secondary" icon={<Plus size={16} />} disabled={form.vacations.length >= 12} onClick={() => setForm({ ...form, vacations: [...form.vacations, { start_date: "", end_date: "" }] })}>Agregar vacaciones</Button><Button type="submit" icon={<Save size={16} />} busy={busy}>Guardar calendario del ciclo</Button></div>
  </form>;
}
