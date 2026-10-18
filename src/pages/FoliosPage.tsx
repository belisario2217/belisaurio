import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownAZ, Download, FileDown, ReceiptText, Search, Trash2 } from "lucide-react";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, LoadingState } from "../components/Ui";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type PhysicalFolio = {
  id: number;
  physical_folio: string;
  paid_at: string;
  concept: string;
  amount: number;
  payment_method: string | null;
  internal_folio: string | null;
  student_id: number;
  student_number: string;
  student_name: string;
  group_name: string | null;
  source: "payment" | "registration";
  covered_months?: string;
};
type FoliosResponse = { total: number; folios: PhysicalFolio[]; excludedCoverageCount?:number };

const money = (value: number) => Number(value).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const pageSize = 100;

export function FoliosPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [folios, setFolios] = useState<PhysicalFolio[]>([]);
  const [excludedCoverageCount,setExcludedCoverageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<PhysicalFolio | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const query = appliedFrom ? `?from=${encodeURIComponent(appliedFrom)}` : "";

  useEffect(() => {
    if (!can("payments.view")) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<FoliosResponse>(`/payments/folios${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) {setFolios(result.folios);setExcludedCoverageCount(result.excludedCoverageCount||0);} })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No fue posible cargar los folios."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry,query]);

  const matching = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-MX");
    return folios.filter(row => !term || [row.physical_folio, row.student_number, row.student_name, row.concept, row.group_name ?? ""]
      .some(value => value.toLocaleLowerCase("es-MX").includes(term)));
  }, [folios, search]);
  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  useEffect(() => { setPage(current => Math.min(current, totalPages)); }, [totalPages]);
  const visible = matching.slice((page - 1) * pageSize, page * pageSize);
  const highest = folios.at(-1)?.physical_folio ?? "—";
  const repeated = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of folios) counts.set(row.physical_folio, (counts.get(row.physical_folio) ?? 0) + 1);
    return counts;
  }, [folios]);

  async function deleteFolio() {
    if (!deleting || busy) return;
    const selected = deleting;
    setBusy(true);
    try {
      await api(`/payments/folios/${selected.source}/${Math.abs(selected.id)}`, { method: "DELETE" });
      setFolios(current => current.filter(row => row.id !== selected.id || row.source !== selected.source));
      setDeleting(null);
      setRetry(current => current + 1);
      toast.success("Registro eliminado. El estado de cuenta y el balance se han actualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar el registro.");
    } finally {
      setBusy(false);
    }
  }

  if (!can("payments.view")) return <p>No tienes acceso a los folios de pago.</p>;

  return <div className="page-stack">
    <section className="overview-strip">
      <div><span>Finanzas · Control de recibos</span><h2>Folios</h2>
        <p>Recibos ordenados de menor a mayor. La fecha indica el ingreso real a caja; los meses que cubre el recibo no crean otros ingresos.</p></div>
      <Link className="button button-secondary" to="/cobros">Ir a Cobros</Link>
    </section>
    <section className="metric-grid">
      <article className="metric"><ReceiptText /><div><span>Folios registrados</span><strong>{folios.length.toLocaleString("es-MX")}</strong></div></article>
      <article className="metric"><ArrowDownAZ /><div><span>Folio mayor registrado</span><strong>{highest}</strong></div></article>
    </section>
    <section className="panel page-stack">
      {excludedCoverageCount>0&&<p className="workspace-help">Se conservan {excludedCoverageCount} registros de cobertura de la tabla anterior, fuera de los ingresos de caja. Para registrar un cobro real que solo se había capturado en esa tabla, usa Cobros con su fecha e importe comprobados.</p>}
      <div className="panel-heading">
        <div><span>Consecutivo numérico · Desde 0001, sin límite superior</span><h3>Relación general de folios de pago</h3></div>
        {can("payments.export") && <div className="inline-actions"><Button type="button" variant="secondary" icon={<Download size={17}/>} onClick={() => download(`/payments/folios/export${query}`, "folios-de-pago.csv")}>Exportar CSV</Button><Button type="button" variant="secondary" icon={<FileDown size={17}/>} onClick={() => download(`/payments/folios/export?format=pdf${appliedFrom?`&from=${encodeURIComponent(appliedFrom)}`:""}`, `folios-desde-${appliedFrom||"0001"}.pdf`)}>Descargar PDF</Button><Button type="button" variant="secondary" icon={<FileDown size={17}/>} onClick={() => download("/payments/folios/export?format=pdf&from=460", "folios-desde-0460.pdf")}>PDF desde 0460</Button></div>}
      </div>
      <div className="toolbar">
        <label className="field"><span>Desde el folio (inclusive)</span><input inputMode="numeric" placeholder="Ej. 0460" value={from} onChange={e=>setFrom(e.target.value.replace(/\D/g,""))}/></label>
        <Button type="button" variant="secondary" disabled={busy} onClick={()=>{setAppliedFrom(from);setPage(1);}}>Aplicar rango</Button>
        <label className="field"><span>Buscar folio, matrícula, alumno, grupo o concepto</span>
          <div className="search-box"><Search size={17}/><input type="search" placeholder="Ej. 0001 o nombre de alumno" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/></div>
        </label>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => { setPage(1); setRetry(n => n + 1); }}>Actualizar folios</Button>
      </div>
      {loading && <LoadingState label="Cargando relación de folios"/>}
      {!loading && error && <p role="alert" className="assistant-error">No se pudieron consultar los folios: {error}</p>}
      {!loading && !error && <>
        <p className="workspace-help">Se muestran {visible.length} de {matching.length} registro(s) coincidentes, de {folios.length} en total. Los folios repetidos se señalan para su revisión. Eliminar un registro también quita su cobro asociado y actualiza el estado de cuenta y el balance.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folio físico</th><th>Fecha de ingreso</th><th>Matrícula</th><th>Alumno</th><th>Grupo</th><th>Concepto / cobertura</th><th>Importe recibido</th><th>Folio interno</th>{can("payments.manage") && <th>Acciones</th>}</tr></thead>
            <tbody>{visible.map(row => <tr key={row.source + "-" + row.id}>
              <td><strong className="table-main">{row.physical_folio}</strong>{(repeated.get(row.physical_folio) ?? 0) > 1 && <small className="table-sub">Folio repetido</small>}</td>
              <td>{row.paid_at}</td><td>{row.student_number}</td><td>{row.student_name}</td>
              <td>{row.group_name || "Sin grupo"}</td><td>{row.concept}{row.covered_months&&<small className="table-sub">Cubre: {row.covered_months}</small>}{row.source==="registration"&&<small className="table-sub">Registro manual sin ingreso de caja vinculado</small>}</td>
              <td>{money(row.amount)}</td><td>{row.internal_folio || "—"}</td>
              {can("payments.manage") && <td><Button type="button" variant="ghost" icon={<Trash2 size={16}/>} disabled={busy} onClick={() => setDeleting(row)} aria-label={`Eliminar folio ${row.physical_folio} de ${row.student_name}`}>Eliminar</Button></td>}
            </tr>)}</tbody>
          </table>
        </div>
        {!matching.length && <p className="workspace-help">No hay folios registrados que coincidan con la búsqueda.</p>}
        {totalPages > 1 && <div className="toolbar">
          <Button variant="secondary" type="button" disabled={page === 1} onClick={() => setPage(n => n - 1)}>Anterior</Button>
          <span>Página {page} de {totalPages}</span>
          <Button variant="secondary" type="button" disabled={page >= totalPages} onClick={() => setPage(n => n + 1)}>Siguiente</Button>
        </div>}
      </>}
    </section>
    <Modal open={!!deleting} title="Eliminar registro de folio" size="small" onClose={() => { if (!busy) setDeleting(null); }}>
      {deleting && <div className="page-stack">
        <div><strong>Folio físico {deleting.physical_folio}</strong><p>{deleting.student_name} · {deleting.student_number}</p><p>{deleting.concept} · {deleting.paid_at} · {money(deleting.amount)}</p></div>
        <p>{deleting.source === "payment" ? "Se eliminará este pago y se recalcularán el estado de cuenta, los ingresos y el balance. Si ampara una colegiatura o inscripción, puede volver a quedar pendiente." : "Se eliminará este registro manual de inscripción o reinscripción y se actualizará el estado de pago del alumno."}</p>
        <p>Solo se quitará el registro seleccionado. Los demás pagos se conservarán. Esta acción no se puede deshacer.</p>
        <div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancelar</Button><Button type="button" variant="danger" busy={busy} onClick={() => void deleteFolio()}>Eliminar registro</Button></div>
      </div>}
    </Modal>
  </div>;
}
