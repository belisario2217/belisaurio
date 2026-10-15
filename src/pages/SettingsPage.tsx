import { useEffect, useRef, useState } from "react";
import { Building2, CalendarRange, Check, DatabaseBackup, Download, History, ImagePlus, Palette, Pencil, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, Field, Select } from "../components/Ui";
import { InstitutionLogo } from "../components/InstitutionLogo";
import { CycleCalendarSettings, type CycleCalendar } from "../components/CycleCalendarSettings";

type CalendarEvent = {
  id: number;
  school_cycle_id: number | null;
  cycle_name: string | null;
  event_type: string;
  title: string;
  start_date: string;
  end_date: string;
  description: string | null;
  auto_start_subjects: number;
};

const blankCalendarEvent = { cycleId: "", eventType: "evaluation", title: "", startDate: "", endDate: "", description: "", autoStartSubjects: false };
const calendarTypes = [
  { value: "class_start", label: "Inicio de clases" },
  { value: "evaluation", label: "Evaluación parcial" },
  { value: "enrollment", label: "Inscripción" },
  { value: "reenrollment", label: "Reinscripción" },
  { value: "vacation", label: "Vacaciones" },
  { value: "resumption", label: "Reanudación de clases" },
  { value: "cycle_end", label: "Fin de ciclo" },
  { value: "other", label: "Otra fecha importante" }
];

export function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const logoRef = useRef<HTMLInputElement>(null);
  const databaseRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<any>(null);
  const [cycles, setCycles] = useState<any[]>([]);
  const [scales, setScales] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [cycleCalendars, setCycleCalendars] = useState<CycleCalendar[]>([]);
  const [calendarForm, setCalendarForm] = useState(blankCalendarEvent);
  const [editingCalendarId, setEditingCalendarId] = useState<number | null>(null);
  const [tab, setTab] = useState<"institution" | "calendar" | "audit">("institution");
  const [busy, setBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  async function load() {
    const result = await api<any>("/settings");
    setSettings(result.settings);
    setCycles(result.cycles);
    setScales(result.scales);
    setCalendarEvents(result.calendarEvents ?? []);
    setCycleCalendars(result.cycleCalendars ?? []);
    if (can("audit.view")) api<any[]>("/settings/audit").then(setAudit);
  }
  useEffect(() => { load(); }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await api<any>("/settings", {
        method: "PATCH",
        body: {
          institutionName: settings.institution_name,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
          directorName: settings.director_name,
          activeCycleId: settings.active_cycle_id,
          defaultScaleId: settings.default_scale_id,
          footerText: settings.footer_text,
          primaryColor: settings.primary_color,
          secondaryColor: settings.secondary_color,
          publicAppUrl: settings.public_app_url
        }
      });
      setSettings(updated);
      toast.success("Configuración guardada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar.");
    } finally { setBusy(false); }
  }

  async function uploadLogo(file: File) {
    const body = new FormData();
    body.append("logo", file);
    try {
      const result = await api<{ logoPath: string }>("/settings/logo", { method: "POST", body });
      setSettings({ ...settings, logo_path: result.logoPath });
      toast.success("Logo actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible subir el logo.");
    }
  }

  async function saveCalendarEvent(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(editingCalendarId ? `/settings/calendar-events/${editingCalendarId}` : "/settings/calendar-events", {
        method: editingCalendarId ? "PATCH" : "POST",
        body: calendarForm
      });
      toast.success(editingCalendarId ? "Fecha académica actualizada." : "Fecha académica agregada.");
      setCalendarForm(blankCalendarEvent);
      setEditingCalendarId(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar la fecha.");
    } finally {
      setBusy(false);
    }
  }

  function editCalendarEvent(event: CalendarEvent) {
    setEditingCalendarId(event.id);
    setCalendarForm({
      cycleId: event.school_cycle_id ? String(event.school_cycle_id) : "",
      eventType: event.event_type,
      title: event.title,
      startDate: event.start_date,
      endDate: event.end_date,
      description: event.description ?? "",
      autoStartSubjects: Boolean(event.auto_start_subjects)
    });
  }

  async function deleteCalendarEvent(event: CalendarEvent) {
    if (!window.confirm(`¿Eliminar la fecha “${event.title}”?`)) return;
    try {
      await api(`/settings/calendar-events/${event.id}`, { method: "DELETE" });
      toast.success("Fecha académica eliminada.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar la fecha.");
    }
  }

  async function restoreDatabase(file: File) {
    if (!window.confirm("Esta accion reemplazara los datos actuales al reiniciar el servicio. ¿Deseas continuar?")) {
      if (databaseRef.current) databaseRef.current.value = "";
      return;
    }
    const body = new FormData();
    body.append("database", file);
    setRestoreBusy(true);
    try {
      const result = await api<{ message: string; summary: { students: number; grades: number } }>("/settings/restore-database", { method: "POST", body });
      toast.success(`${result.message} ${result.summary.students} alumnos y ${result.summary.grades} calificaciones.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible restaurar la base.");
    } finally {
      setRestoreBusy(false);
      if (databaseRef.current) databaseRef.current.value = "";
    }
  }

  if (!settings) return <div className="loading-panel">Cargando configuración...</div>;
  async function downloadDatabaseBackup() {
    setBackupBusy(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await download("/settings/database-backup", `universidad-ifop-respaldo-${date}.db`);
      toast.success("Respaldo descargado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible descargar el respaldo.");
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-tabs">
        <button className={tab === "institution" ? "active" : ""} onClick={() => setTab("institution")}><Building2 size={18} /> Institución</button>
        <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}><CalendarRange size={18} /> Calendario académico</button>
        {can("audit.view") && <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><History size={18} /> Actividad</button>}
      </div>
      {tab === "institution" ? (
        <form onSubmit={save} className="settings-layout">
          <section className="settings-main">
            <div className="settings-section">
              <div className="settings-title"><Building2 size={20} /><div><h2>Datos institucionales</h2><p>Información usada en boletas y reportes oficiales.</p></div></div>
              <div className="form-grid two">
                <Field label="Nombre de la institución" required><input value={settings.institution_name ?? ""} onChange={(event) => setSettings({ ...settings, institution_name: event.target.value })} required /></Field>
                <Field label="Responsable de Control Escolar"><input value={settings.director_name ?? ""} onChange={(event) => setSettings({ ...settings, director_name: event.target.value })} /></Field>
                <Field label="Correo"><input type="email" value={settings.email ?? ""} onChange={(event) => setSettings({ ...settings, email: event.target.value })} /></Field>
                <Field label="Teléfono"><input value={settings.phone ?? ""} onChange={(event) => setSettings({ ...settings, phone: event.target.value })} /></Field>
                <Field label="Dirección"><input value={settings.address ?? ""} onChange={(event) => setSettings({ ...settings, address: event.target.value })} /></Field>
                <Field label="Pie de página"><input value={settings.footer_text ?? ""} onChange={(event) => setSettings({ ...settings, footer_text: event.target.value })} /></Field>
                <Field label="URL pública de la plataforma" hint="Dominio HTTPS que abrirán los QR de validación. En Render se usa el dominio del servicio si se deja vacío."><input type="url" placeholder="https://escuela.edu.mx" value={settings.public_app_url ?? ""} onChange={event => setSettings({ ...settings, public_app_url: event.target.value })} /></Field>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-title"><ShieldCheck size={20} /><div><h2>Parámetros académicos</h2><p>El ciclo del grupo tiene prioridad; si no está definido, se utiliza el ciclo activo institucional. El semestre de cada alumno se configura por separado.</p></div></div>
              <div className="form-grid two">
                <Field label="Ciclo activo"><Select options={cycles} value={settings.active_cycle_id ?? ""} onChange={(event) => setSettings({ ...settings, active_cycle_id: event.target.value })} /></Field>
                <Field label="Escala predeterminada"><Select options={scales} value={settings.default_scale_id ?? ""} onChange={(event) => setSettings({ ...settings, default_scale_id: event.target.value })} /></Field>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-title"><Palette size={20} /><div><h2>Identidad visual</h2><p>Colores aplicados a documentos académicos.</p></div></div>
              <div className="color-fields">
                <Field label="Color principal"><div className="color-input"><input type="color" value={settings.primary_color} onChange={(event) => setSettings({ ...settings, primary_color: event.target.value })} /><span>{settings.primary_color}</span></div></Field>
                <Field label="Color secundario"><div className="color-input"><input type="color" value={settings.secondary_color} onChange={(event) => setSettings({ ...settings, secondary_color: event.target.value })} /><span>{settings.secondary_color}</span></div></Field>
              </div>
            </div>
            <div className="settings-save"><Button type="submit" busy={busy} icon={<Save size={17} />}>Guardar configuración</Button></div>
          </section>
          <aside className="logo-panel">
            <span>Logo institucional</span>
            <div className="logo-preview"><InstitutionLogo logoPath={settings.logo_path} /></div>
            <Button type="button" variant="secondary" icon={<ImagePlus size={17} />} onClick={() => logoRef.current?.click()}>Cambiar logo</Button>
            <input ref={logoRef} hidden type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => event.target.files?.[0] && uploadLogo(event.target.files[0])} />
            <small>PNG, JPG o WebP. Máximo 2 MB.</small>
            <div className="document-preview">
              <div style={{ backgroundColor: settings.primary_color }} /><InstitutionLogo logoPath={settings.logo_path} /><strong>{settings.institution_name}</strong><i style={{ backgroundColor: settings.secondary_color }} /><p>Vista previa del encabezado</p>
            </div>
            {can("settings.manage") && (
              <div className="database-restore">
                <span>Respaldar informacion</span>
                <Button type="button" variant="secondary" busy={backupBusy} icon={<Download size={17} />} onClick={downloadDatabaseBackup}>Descargar respaldo</Button>
                <small>Copia local de la base SQLite actual.</small>
                <span>Restaurar información</span>
                <Button type="button" variant="secondary" busy={restoreBusy} icon={<DatabaseBackup size={17} />} onClick={() => databaseRef.current?.click()}>Seleccionar respaldo</Button>
                <input ref={databaseRef} hidden type="file" accept=".db,.sqlite,application/x-sqlite3" onChange={(event) => event.target.files?.[0] && restoreDatabase(event.target.files[0])} />
                <small>Archivo SQLite de Universidad IFOP. Máximo 25 MB.</small>
              </div>
            )}
          </aside>
        </form>
      ) : tab === "calendar" ? (
        <><CycleCalendarSettings cycles={cycles} calendars={cycleCalendars} activeCycleId={settings.active_cycle_id} onSaved={load} />
        <div className="calendar-settings-layout">
          <form className="settings-section calendar-event-form" onSubmit={saveCalendarEvent}>
            <div className="settings-title"><CalendarRange size={20} /><div><h2>{editingCalendarId ? "Editar fecha importante" : "Agregar fecha importante"}</h2><p>Configura clases, evaluaciones, inscripciones, vacaciones y cierres.</p></div></div>
            <div className="form-grid two">
              <Field label="Ciclo escolar"><Select options={cycles} value={calendarForm.cycleId} onChange={(event) => setCalendarForm({ ...calendarForm, cycleId: event.target.value })} placeholder="Todos / institucional" /></Field>
              <Field label="Tipo" required><select value={calendarForm.eventType} onChange={(event) => setCalendarForm({ ...calendarForm, eventType: event.target.value, autoStartSubjects: ["class_start", "resumption"].includes(event.target.value) })}>{calendarTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field>
              <Field label="Título" required><input value={calendarForm.title} onChange={(event) => setCalendarForm({ ...calendarForm, title: event.target.value })} placeholder="Primera evaluación parcial" required /></Field>
              <Field label="Descripción"><input value={calendarForm.description} onChange={(event) => setCalendarForm({ ...calendarForm, description: event.target.value })} /></Field>
              <Field label="Fecha inicial" required><input type="date" value={calendarForm.startDate} onChange={(event) => setCalendarForm({ ...calendarForm, startDate: event.target.value, endDate: calendarForm.endDate || event.target.value })} required /></Field>
              <Field label="Fecha final" required><input type="date" min={calendarForm.startDate} value={calendarForm.endDate} onChange={(event) => setCalendarForm({ ...calendarForm, endDate: event.target.value })} required /></Field>
            </div>
            <label className="check-row"><input type="checkbox" checked={calendarForm.autoStartSubjects} onChange={(event) => setCalendarForm({ ...calendarForm, autoStartSubjects: event.target.checked })} /><span>Al llegar esta fecha, cambiar materias pendientes del semestre actual a “En curso”</span></label>
            <div className="modal-actions">{editingCalendarId && <Button type="button" variant="ghost" onClick={() => { setEditingCalendarId(null); setCalendarForm(blankCalendarEvent); }}>Cancelar edición</Button>}<Button type="submit" icon={editingCalendarId ? <Save size={17} /> : <Plus size={17} />} busy={busy}>{editingCalendarId ? "Guardar cambios" : "Agregar fecha"}</Button></div>
          </form>
          <section className="table-section calendar-events-list">
            <header className="section-heading"><div><span>Agenda institucional</span><h2>Fechas configuradas</h2></div></header>
            <div className="table-wrap"><table><thead><tr><th>Evento</th><th>Ciclo</th><th>Periodo</th><th>Automatización</th><th /></tr></thead><tbody>{calendarEvents.map((event) => <tr key={event.id}><td><strong className="table-main">{event.title}</strong><span className="table-sub">{calendarTypes.find((type) => type.value === event.event_type)?.label ?? event.event_type}</span></td><td>{event.cycle_name ?? "Institucional"}</td><td>{event.start_date === event.end_date ? event.start_date : `${event.start_date} al ${event.end_date}`}</td><td>{event.auto_start_subjects ? "Inicia materias" : "Solo informativa"}</td><td><div className="inline-actions"><button type="button" className="icon-button" onClick={() => editCalendarEvent(event)} title="Editar"><Pencil size={16} /></button><button type="button" className="icon-button" onClick={() => deleteCalendarEvent(event)} title="Eliminar"><Trash2 size={16} /></button></div></td></tr>)}</tbody></table></div>
            {!calendarEvents.length && <p className="empty-calendar-copy">Aún no hay fechas académicas configuradas.</p>}
          </section>
        </div></>
      ) : (
        <section className="table-section">
          <header className="section-heading"><div><span>Auditoría</span><h2>Actividad reciente</h2></div></header>
          <div className="audit-list">
            {audit.map((item) => <div key={item.id}><div className="audit-icon"><Check size={16} /></div><div><strong>{item.user_name || "Sistema"}</strong><span>{item.action} · {item.entity_type}{item.entity_id ? ` #${item.entity_id}` : ""}</span></div><time>{new Date(item.created_at).toLocaleString("es-MX")}</time></div>)}
          </div>
        </section>
      )}
    </div>
  );
}
