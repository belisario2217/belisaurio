import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, download } from "../lib/api";
import { Button, Field } from "./Ui";
import { useToast } from "./Toast";
import "./bulk-account-statements.css";

type Options = { studentCount: number; groups: { id: number; name: string; studentCount: number }[] };

export function BulkAccountStatements() {
  const toast = useToast();
  const [options, setOptions] = useState<Options | null>(null);
  const [groupId, setGroupId] = useState("");
  const [throughMonth, setThroughMonth] = useState(() => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City" }).format(new Date()).slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(""); setOptions(null);
    api<Options>("/payments/statement-options", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  const group = options?.groups.find(group => String(group.id) === groupId);
  const count = groupId ? group?.studentCount ?? 0 : options?.studentCount ?? 0;
  async function exportStatements() {
    if (busy || !count || !throughMonth) return;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ throughMonth });
      if (groupId) query.set("groupId", groupId);
      await download(`/payments/statements.pdf?${query}`, `estados-de-cuenta-${groupId ? `grupo-${groupId}` : "todos"}-${throughMonth}.pdf`);
      toast.success("Estados de cuenta descargados.");
    } catch (error) { setError(error instanceof Error ? error.message : "No fue posible descargar los estados de cuenta."); }
    finally { setBusy(false); }
  }
  return <section className="bulk-statements" aria-labelledby="bulk-statements-title">
    <header><span className="bulk-statements-icon"><Download size={23} /></span><div><h2 id="bulk-statements-title">Descargar estados de cuenta por grupo o de todos los alumnos</h2><p>Un solo PDF, con un estado de cuenta individual y su QR de validación por cada alumno.</p></div></header>
    <div className="bulk-statements-controls">
      <Field label="Alumnos incluidos"><select value={groupId} disabled={loading || busy || !options} onChange={event => setGroupId(event.target.value)}><option value="">Todos los alumnos activos</option>{options?.groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.studentCount} alumnos</option>)}</select></Field>
      <Field label="Pagos registrados hasta el mes" hint="Incluye los pagos anteriores y los del mes elegido."><input type="month" required value={throughMonth} disabled={busy} onChange={event => setThroughMonth(event.target.value)} /></Field>
      <Button icon={<Download size={17} />} busy={busy} disabled={loading || !count || !throughMonth || busy} onClick={() => exportStatements()}>Descargar estados de cuenta PDF</Button>
    </div>
    {error && <p role="alert">{error} {!options && <Button variant="ghost" onClick={() => setRetry(value => value + 1)}>Reintentar carga</Button>}</p>}
    <p role="status" aria-live="polite">{busy ? "Preparando los estados de cuenta. La descarga comenzará cuando el PDF esté completo…" : loading ? "Cargando grupos y alumnos…" : options ? `${count} ${count === 1 ? "alumno" : "alumnos"} con inscripción activa${group ? ` · Grupo ${group.name}` : ""}.` : "No se pudo cargar la selección."}</p>
    <p className="bulk-statements-help">Se ordenan por grupo y apellidos. Cada alumno comienza en una hoja nueva y conserva todos sus movimientos hasta el mes elegido. Esta selección es independiente del buscador y del reporte mensual de ingresos.</p>
  </section>;
}
