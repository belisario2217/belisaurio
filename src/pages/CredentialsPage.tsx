import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, Download, IdCard, ImagePlus, Palette, Printer, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Upload, UserRound, X } from "lucide-react";
import { api, download, openDocument } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, EmptyState, Field, LoadingState } from "../components/Ui";
import { CredentialPreview, CredentialStatusPill, CredentialValidityPanel } from "../components/CredentialPreview";
import { defaultCredentialTemplate, type CredentialFraming, type CredentialSnapshot, type CredentialState, type CredentialTemplate } from "../../shared/credentials";
import "../credentials.css";

type Roster = { records: Array<{ id: number; name: string; student_number: string; is_active: number; has_photo: number }>; page: number; pages: number; total: number };
const message = (error: unknown) => error instanceof Error ? error.message : "No fue posible completar la solicitud.";
const templateFields: Array<{ key: keyof CredentialTemplate; label: string; max: number; multiline?: boolean }> = [
  { key: "institution", label: "Institución", max: 160 }, { key: "campus", label: "Campus", max: 90 },
  { key: "sideLabel", label: "Franja lateral", max: 45 }, { key: "title", label: "Título de la credencial", max: 32 },
  { key: "website", label: "Sitio web", max: 160 }, { key: "phone", label: "Teléfono", max: 50 },
  { key: "email", label: "Correo institucional", max: 180 }, { key: "address", label: "Dirección", max: 240, multiline: true },
  { key: "directorName", label: "Nombre de quien autoriza", max: 140 }, { key: "directorTitle", label: "Cargo / área", max: 120, multiline: true },
  { key: "backText", label: "Texto del reverso", max: 650, multiline: true }
];

export function CredentialsPage() {
  const { can } = useAuth(), toast = useToast();
  const [tab, setTab] = useState<"issue" | "design">("issue");
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [roster, setRoster] = useState<Roster | null>(null), [rosterLoading, setRosterLoading] = useState(true);
  const [id, setId] = useState<number | null>(null), [state, setState] = useState<CredentialState | null>(null);
  const [framing, setFraming] = useState<CredentialFraming>({ cropX: .5, cropY: .5, zoom: 1 });
  const [template, setTemplate] = useState<CredentialTemplate | null>(null), [photo, setPhoto] = useState<string | null>(null), [signature, setSignature] = useState<string | null>(null);
  const [savedTemplate, setSavedTemplate] = useState<CredentialTemplate | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(""), [reload, setReload] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null), signatureInput = useRef<HTMLInputElement>(null);
  const allowed = can("credentials.manage");
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    api<CredentialTemplate>("/credentials/template", { signal: controller.signal }).then(acceptTemplate).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController(); setRosterLoading(true);
    const timer = window.setTimeout(() => api<Roster>(`/credentials/students?search=${encodeURIComponent(search)}&page=${page}`, { signal: controller.signal })
      .then(setRoster).catch(e => { if (!controller.signal.aborted) setError(message(e)); }).finally(() => { if (!controller.signal.aborted) setRosterLoading(false); }), 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [allowed, search, page, reload]);
  useEffect(() => {
    if (!id || !allowed) return;
    const controller = new AbortController(); setState(null); setPhoto(null); setError("");
    api<CredentialState>(`/credentials/students/${id}`, { signal: controller.signal }).then(value => { setState(value); setFraming(value.framing); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [id, reload, allowed]);
  useEffect(() => {
    setPhoto(null);
    if (!id || !state?.photo) return;
    const controller = new AbortController();
    api<{ dataUrl: string }>(`/credentials/students/${id}/photo`, { signal: controller.signal }).then(value => setPhoto(value.dataUrl))
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [id, state?.photo?.sha256]);
  useEffect(() => {
    setSignature(null);
    if (!template?.signatureFile) return;
    const controller = new AbortController();
    api<{ dataUrl: string }>("/credentials/template/signature", { signal: controller.signal }).then(value => setSignature(value.dataUrl))
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [template?.signatureFile]);

  async function perform(key: string, action: () => Promise<void>) {
    setBusy(key); setError("");
    try { await action(); } catch (e) { setError(message(e)); toast.error(message(e)); } finally { setBusy(""); }
  }
  function acceptState(value: CredentialState) { setState(value); setFraming(value.framing); }
  function acceptTemplate(value: CredentialTemplate) { setTemplate(value); setSavedTemplate(value); }
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !state) return;
    await perform("photo", async () => {
      const body = new FormData(); body.set("photo", file); body.set("revision", String(state.revision));
      acceptState(await api<CredentialState>(`/credentials/students/${id}/photo`, { method: "POST", body }));
      toast.success("Fotografía guardada. Revisa el encuadre y activa la credencial.");
    });
  }
  const dirty = state && JSON.stringify(framing) !== JSON.stringify(state.framing);
  const designDirty = JSON.stringify(template) !== JSON.stringify(savedTemplate);
  const design = (tab === "design" ? template : savedTemplate) || defaultCredentialTemplate;
  const snapshot: CredentialSnapshot = {
    student: state?.student || { id: 0, name: "Nombre completo del estudiante", number: "MATRÍCULA", program: "Programa de estudios", group: "", cycle: "", active: true, enrolled: true, logoPath: null, cycleId: null, cycleStart: null, cycleEnd: null },
    template: design, framing, photo: state?.photo || { width: 600, height: 600, sha256: "" }, validity: state?.validity || null, issuedAt: "", folio: "VISTA PREVIA"
  };
  if (!allowed) return <EmptyState icon={<IdCard size={28} />} title="Credenciales" text="Tu cuenta no tiene permiso para administrar credenciales." />;
  return <div className="page-stack cred-page">
    <header className="cred-header"><div className="cred-heading-icon"><IdCard size={28} /></div><div><span className="cred-eyebrow">IDENTIDAD ESTUDIANTIL</span><h2>Credenciales</h2><p>Una identidad oficial, lista para acompañar a cada estudiante.</p></div></header>
    <div className="cred-tabs" role="tablist" aria-label="Administración de credenciales">
      <button role="tab" aria-selected={tab === "issue"} onClick={() => setTab("issue")}><IdCard size={17} /> Emitir credencial</button>
      <button role="tab" aria-selected={tab === "design"} onClick={() => setTab("design")}><Palette size={17} /> Personalizar diseño</button>
    </div>
    {error && <div className="cred-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setError("")}><X size={17} /></button></div>}
    {tab === "issue" ? <div className="cred-workspace">
      <aside className="cred-roster"><div className="cred-panel-title"><span className="cred-step">1</span><div><h3>Selecciona al alumno</h3><p>Busca en el padrón completo.</p></div></div>
        <label className="cred-search"><Search size={17} /><input aria-label="Buscar por nombre o matrícula" value={search} placeholder="Nombre o matrícula" onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <div className="cred-roster-meta" aria-live="polite">{rosterLoading ? "Buscando…" : `${roster?.total || 0} alumnos`}</div>
        <div className="cred-students" aria-busy={rosterLoading}>{!rosterLoading && roster?.records.map(student => <button key={student.id} disabled={Boolean(busy)} className={id === student.id ? "selected" : ""} onClick={() => setId(student.id)}>
          <span className="cred-student-avatar"><UserRound size={18} /></span><span><strong>{student.name}</strong><small>{student.student_number}{!student.is_active ? " · Inactivo" : ""}</small></span>{id === student.id && <Check size={16} />}
        </button>)}{!rosterLoading && !roster?.records.length && <p className="cred-help">No se encontraron alumnos. Prueba otro nombre o matrícula.</p>}</div>
        {Boolean(roster?.pages) && <div className="cred-pagination"><button aria-label="Página anterior" disabled={page <= 1 || rosterLoading} onClick={() => setPage(p => p - 1)}><ChevronLeft size={17} /></button><span>{page} / {roster?.pages}</span><button aria-label="Página siguiente" disabled={page >= (roster?.pages || 1) || rosterLoading} onClick={() => setPage(p => p + 1)}><ChevronRight size={17} /></button></div>}
      </aside>
      {!id ? <section className="cred-welcome"><div className="cred-welcome-art"><IdCard size={62} strokeWidth={1} /><span><ShieldCheck size={22} /></span></div><span className="cred-eyebrow">DEL PADRÓN A SU PORTAL</span><h3>Su credencial empieza aquí</h3><p>Selecciona un alumno, carga su fotografía y revisa ambas caras. Al activarla, estará disponible en su portal.</p><div className="cred-welcome-steps"><span>01 · Selecciona</span><span>02 · Fotografía</span><span>03 · Activa</span></div></section>
      : !state ? <LoadingState label="Preparando la credencial" /> : <section className="cred-editor">
        <div className="cred-editor-top"><div><span className="cred-eyebrow">EXPEDIENTE ESTUDIANTIL</span><h3>{state.student.name}</h3><small>Los datos se completan automáticamente desde el padrón.</small></div><div className="cred-state-actions"><CredentialStatusPill status={state.status} /><button className="icon-button" disabled={Boolean(busy)} title="Actualizar datos" aria-label="Actualizar datos de la credencial" onClick={() => setReload(n => n + 1)}><RefreshCw size={16} /></button></div></div>
        <div className="cred-editor-body"><div className="cred-controls">
          <dl className="cred-student-fields"><div><dt>Matrícula</dt><dd>{state.student.number}</dd></div><div><dt>Programa académico</dt><dd>{state.student.program}</dd></div><div><dt>Grupo</dt><dd>{state.student.group || "Sin grupo"}</dd></div></dl>
          <div className="cred-panel-title"><span className="cred-step">2</span><div><h3>Fotografía y encuadre</h3><p>Revisa su posición en la vista previa.</p></div></div>
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={uploadPhoto} />
          <button className="cred-upload" disabled={Boolean(busy)} onClick={() => photoInput.current?.click()}><ImagePlus size={25} /><strong>{busy === "photo" ? "Guardando fotografía…" : state.photo ? "Cambiar fotografía" : "Cargar fotografía"}</strong><span>JPG, PNG o WebP · hasta 10 MB</span></button>
          <p className="cred-help">Se recomienda una fotografía tipo infantil, de frente y con fondo blanco. Puedes elegir la imagen; se conserva su resolución original.</p>
          {state.photo && <><div className="cred-photo-resolution"><Camera size={14} />{state.photo.width} × {state.photo.height} px · original conservado</div>
            <fieldset className="cred-framing" disabled={Boolean(busy)}><legend><SlidersHorizontal size={14} /> Encuadre de la fotografía</legend>
              {([ ["zoom", "Acercamiento", 1, 3], ["cropX", "Posición horizontal", 0, 1], ["cropY", "Posición vertical", 0, 1] ] as const).map(([key, label, min, max]) => <label key={key}><span>{label}<small>{key === "zoom" ? `${framing[key].toFixed(2)}×` : `${Math.round(framing[key] * 100)}%`}</small></span><input aria-label={label} type="range" min={min} max={max} step="0.01" value={framing[key]} onChange={e => setFraming(f => ({ ...f, [key]: Number(e.target.value) }))} /></label>)}
              <button className="cred-text-button" type="button" onClick={() => setFraming({ cropX: .5, cropY: .5, zoom: 1 })}>Centrar fotografía</button>
            </fieldset>
            <Button variant="secondary" disabled={!dirty || Boolean(busy)} busy={busy === "framing"} onClick={() => perform("framing", async () => { acceptState(await api<CredentialState>(`/credentials/students/${id}`, { method: "PATCH", body: { revision: state.revision, ...framing } })); toast.success("Encuadre guardado. Activa la credencial para publicarlo."); })}>Guardar encuadre</Button>
            {state.canDownload && dirty && <p className="cred-help">Guardar este cambio desactivará la versión anterior hasta que vuelvas a autorizarla.</p>}</>}
        </div><CredentialPreview snapshot={snapshot} photo={photo} signature={signature} /></div>
        <div className="cred-publish"><div className="cred-panel-title"><span className="cred-step">3</span><div><h3>Autoriza y publica</h3><p>El alumno la verá en «Mi credencial» cuando esté activada.</p></div></div>
          <CredentialValidityPanel validity={state.validity} />
          <div className="cred-action-row"><Button busy={busy === "activate"} disabled={!state.photo || !state.student.active || !state.student.enrolled || !state.validity || Boolean(busy)} icon={<ShieldCheck size={17} />} onClick={() => perform("activate", async () => { acceptState(await api<CredentialState>(`/credentials/students/${id}/activate`, { method: "POST", body: { revision: state.revision, templateVersion: design.version, ...framing } })); toast.success("Credencial activada y publicada en el portal del alumno."); })}>{state.canDownload ? "Actualizar y volver a activar" : "Activar y publicar"}</Button>
            <Button variant="secondary" disabled={Boolean(busy)} icon={<Printer size={16} />} onClick={() => perform("preview", () => openDocument(`/credentials/students/${id}/preview.pdf?${new URLSearchParams({ layout: "letter", cropX: String(framing.cropX), cropY: String(framing.cropY), zoom: String(framing.zoom) })}`))}>Prueba de impresión</Button>
            {state.canDownload && <button className="cred-text-button cred-danger" disabled={Boolean(busy)} onClick={() => perform("deactivate", async () => { acceptState(await api<CredentialState>(`/credentials/students/${id}/deactivate`, { method: "POST", body: { revision: state.revision } })); toast.success("Credencial desactivada. Ya no se puede descargar ni validar como vigente."); })}>Desactivar credencial</button>}
          </div>
          {state.canDownload && <div className="cred-approved"><div><ShieldCheck size={21} /><div><strong>Versión activada disponible</strong><small>{state.issue?.folio} · Se descarga la versión autorizada.</small></div></div><div className="cred-action-row"><Button variant="secondary" disabled={Boolean(busy)} icon={<Download size={16} />} onClick={() => perform("download", () => download(`/credentials/students/${id}/pdf`, `credencial-${state.student.number}.pdf`))}>PDF · dos caras</Button><Button variant="secondary" disabled={Boolean(busy)} icon={<Printer size={16} />} onClick={() => perform("print", () => openDocument(`/credentials/students/${id}/pdf?layout=letter`))}>Imprimir en carta</Button></div></div>}
        </div>
      </section>}
    </div> : <div className="cred-design-workspace"><section className="cred-design-form">
      <div className="cred-panel-title"><Palette size={23} /><div><h3>Diseño institucional</h3><p>Los cambios se aplican a las próximas activaciones.</p></div></div>
      <form onSubmit={event => { event.preventDefault(); if (template) perform("template", async () => { acceptTemplate(await api<CredentialTemplate>("/credentials/template", { method: "PATCH", body: { ...template } })); toast.success("Diseño institucional guardado."); }); }}>
        <fieldset disabled={Boolean(busy) || !template}><Field label="Formato de impresión"><select value={design.size} onChange={e => setTemplate(t => t && ({ ...t, size: e.target.value as CredentialTemplate["size"] }))}><option value="reference">Referencia · 50 × 75 mm</option><option value="standard">Tarjeta vertical · 54 × 85.6 mm</option></select></Field>
          <div className="cred-colors">{([ ["primaryColor", "Azul principal"], ["lightColor", "Fondo claro"], ["accentColor", "Detalles"] ] as const).map(([key, label]) => <Field key={key} label={label}><div><input type="color" aria-label={label} value={design[key]} onChange={e => setTemplate(t => t && ({ ...t, [key]: e.target.value }))} /><span>{design[key]}</span></div></Field>)}</div>
          <div className="cred-template-fields">{templateFields.map(field => <Field key={field.key} label={field.label}>{field.multiline ? <textarea rows={field.key === "backText" ? 5 : 2} maxLength={field.max} value={String(design[field.key] || "")} onChange={e => setTemplate(t => t && ({ ...t, [field.key]: e.target.value }))} /> : <input maxLength={field.max} value={String(design[field.key] || "")} onChange={e => setTemplate(t => t && ({ ...t, [field.key]: e.target.value }))} />}</Field>)}</div>
        </fieldset><Button type="submit" busy={busy === "template"} disabled={Boolean(busy) || !template} icon={<Check size={16} />}>Guardar diseño</Button>
      </form>
      <div className="cred-signature">{designDirty && <p className="cred-help">Guarda los cambios del diseño antes de modificar la firma.</p>}<h3>Firma autorizada <small>Opcional</small></h3><p className="cred-help">Carga una firma autorizada para el reverso. Se recomienda PNG con fondo transparente. Sin imagen, se conserva el espacio para firma y sello.</p>
        {signature && <img src={signature} alt="Firma institucional configurada" />}
        <input ref={signatureInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file && template) perform("signature", async () => { const body = new FormData(); body.set("signature", file); body.set("version", String(template.version)); acceptTemplate(await api<CredentialTemplate>("/credentials/template/signature", { method: "POST", body })); toast.success("Firma institucional guardada."); }); }} />
        <div className="cred-action-row"><Button variant="secondary" disabled={Boolean(busy) || !template || designDirty} icon={<Upload size={16} />} onClick={() => signatureInput.current?.click()}>{signature ? "Cambiar firma" : "Cargar firma"}</Button>{signature && <button className="cred-text-button cred-danger" disabled={Boolean(busy) || designDirty} onClick={() => perform("signature", async () => acceptTemplate(await api<CredentialTemplate>("/credentials/template/signature", { method: "DELETE", body: { version: template!.version } })))}>Quitar firma</button>}</div>
      </div>
    </section><div className="cred-design-preview"><CredentialPreview snapshot={snapshot} photo={photo} signature={signature} /><p className="cred-help">El logo se toma de Configuración institucional. Las credenciales ya activadas conservan el diseño autorizado hasta que vuelvas a emitirlas.</p></div></div>}
  </div>;
}
