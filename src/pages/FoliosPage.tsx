import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownAZ, Download, ReceiptText, Search } from "lucide-react";
import { api, download } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, LoadingState } from "../components/Ui";

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
  source: string;
};
type FoliosResponse = { total: number; folios: PhysicalFolio[] };

const money = (value: number) => Number(value).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const pageSize = 100;

export function FoliosPage() {
  const { can } = useAuth();
  const [folios, setFolios] = useState<PhysicalFolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!can("payments.view")) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<FoliosResponse>("/payments/folios", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setFolios(result.folios); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No fue posible cargar los folios."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  const matching = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-MX");
    return folios.filter(row => !term || [row.physical_folio, row.student_number, row.student_name, row.concept, row.group_name ?? ""]
      .some(value => value.toLocaleLowerCase("es-MX").includes(term)));
  }, [folios, search]);
  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  const visible = matching.slice((page - 1) * pageSize, page * pageSize);
  const highest = folios.at(-1)?.physical_folio ?? "—";
  const repeated = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of folios) counts.set(row.physical_folio, (counts.get(row.physical_folio) ?? 0) + 1);
    return counts;
  }, [folios]);

  if (!can("payments.view")) return <p>No tienes acceso a los folios de pago.</p>;

  return <div className="page-stack">
    <section className="overview-strip">
      <div><span>Finanzas · Control de recibos</span><h2>Folios</h2>
        <p>Todos los folios físicos de pagos registrados, ordenados por su valor numérico de menor a mayor.</p></div>
      <Link className="button button-secondary" to="/cobros">Ir a Cobros</Link>
    </section>
    <section className="metric-grid">
      <article className="metric"><ReceiptText /><div><span>Folios registrados</span><strong>{folios.length.toLocaleString("es-MX")}</strong></div></article>
      <article className="metric"><ArrowDownAZ /><div><span>Folio mayor registrado</span><strong>{highest}</strong></div></article>
    </section>
    <section className="panel page-stack">
      <div className="panel-heading">
        <div><span>Consecutivo numérico · Desde 0001, sin límite superior</span><h3>Relación general de folios de pago</h3></div>
        {can("payments.export") && <Button type="button" variant="secondary" icon={<Download size={17}/>} onClick={() => download("/payments/folios/export", "folios-de-pago.csv")}>Exportar todos a CSV</Button>}
      </div>
      <div className="toolbar">
        <label className="field"><span>Buscar folio, matrícula, alumno, grupo o concepto</span>
          <div className="search-box"><Search size={17}/><input type="search" placeholder="Ej. 0001 o nombre de alumno" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}/></div>
        </label>
        <Button type="button" variant="secondary" onClick={() => { setPage(1); setRetry(n => n + 1); }}>Actualizar folios</Button>
      </div>
      {loading && <LoadingState label="Cargando relación de folios"/>}
      {!loading && error && <p role="alert" className="assistant-error">No se pudieron consultar los folios: {error}</p>}
      {!loading && !error && <>
        <p className="workspace-help">Se muestran {visible.length} de {matching.length} registro(s) coincidentes, de {folios.length} en total. Los folios repetidos se señalan para su revisión; el listado no modifica los cobros.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Folio físico</th><th>Fecha</th><th>Matrícula</th><th>Alumno</th><th>Grupo</th><th>Concepto</th><th>Monto</th><th>Folio interno</th></tr></thead>
            <tbody>{visible.map(row => <tr key={row.source + "-" + row.id}>
              <td><strong className="table-main">{row.physical_folio}</strong>{(repeated.get(row.physical_folio) ?? 0) > 1 && <small className="table-sub">Folio repetido</small>}</td>
              <td>{row.paid_at}</td><td>{row.student_number}</td><td>{row.student_name}</td>
              <td>{row.group_name || "Sin grupo"}</td><td>{row.concept}</td>
              <td>{money(row.amount)}</td><td>{row.internal_folio || "—"}</td>
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
  </div>;
}
