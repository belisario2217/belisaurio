import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Save, Search } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { Button, EmptyState, Field, Select } from "../components/Ui";

type Group = { id: number; name: string; is_active: number };
type TuitionCell = {
  month: string;
  amount: number;
  paid: boolean;
  status: string;
  notes: string;
};
type GridRow = {
  studentId: number;
  student_number: string;
  student_name: string;
  group_name: string;
  tuition_amount: number;
  months: TuitionCell[];
};

const currentMonth = new Date().toISOString().slice(0, 7);

function monthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  return date.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }).replace(".", "");
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function TuitionGridPage() {
  const toast = useToast();
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [groupId, setGroupId] = useState("");
  const [startMonth, setStartMonth] = useState(currentMonth);
  const [monthCount, setMonthCount] = useState(6);
  const [months, setMonths] = useState<string[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [busy, setBusy] = useState(false);

  const allSelected = useMemo(
    () => rows.length > 0 && rows.every((row) => row.months.every((cell) => cell.paid)),
    [rows]
  );

  async function loadGrid() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ startMonth, months: String(monthCount) });
      if (groupId) params.set("groupId", groupId);
      const result = await api<{ months: string[]; records: GridRow[] }>(`/payments/tuition-grid?${params}`);
      setMonths(result.months);
      setRows(result.records);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible cargar colegiaturas.");
    } finally {
      setBusy(false);
    }
  }

  async function saveGrid() {
    setBusy(true);
    try {
      const result = await api<{ updated: number }>("/payments/tuition-grid", {
        method: "PATCH",
        body: { startMonth, months, rows }
      });
      toast.success(`Colegiaturas actualizadas: ${result.updated}.`);
      await loadGrid();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar colegiaturas.");
    } finally {
      setBusy(false);
    }
  }

  function setAllPaid(paid: boolean) {
    setRows((current) => current.map((row) => ({
      ...row,
      months: row.months.map((cell) => ({ ...cell, paid }))
    })));
  }

  function setMonthPaid(month: string, paid: boolean) {
    setRows((current) => current.map((row) => ({
      ...row,
      months: row.months.map((cell) => cell.month === month ? { ...cell, paid } : cell)
    })));
  }

  function setCellPaid(studentId: number, month: string, paid: boolean) {
    setRows((current) => current.map((row) => row.studentId === studentId ? {
      ...row,
      months: row.months.map((cell) => cell.month === month ? { ...cell, paid } : cell)
    } : row));
  }

  function setCellAmount(studentId: number, month: string, amount: number) {
    setRows((current) => current.map((row) => row.studentId === studentId ? {
      ...row,
      months: row.months.map((cell) => cell.month === month ? { ...cell, amount } : cell)
    } : row));
  }

  useEffect(() => {
    api<{ records: Group[] }>("/catalogs/groups")
      .then((result) => setGroups(result.records.filter((group) => group.is_active)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadGrid().catch(() => undefined);
  }, [startMonth, groupId, monthCount]);

  return (
    <div className="page-stack">
      <section className="toolbar">
        <div className="toolbar-primary">
          <Field label="Inicio semestre"><input type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value || currentMonth)} /></Field>
          <Field label="Meses"><input type="number" min="1" max="12" value={monthCount} onChange={(event) => setMonthCount(Math.min(12, Math.max(1, Number(event.target.value) || 6)))} /></Field>
          <Field label="Grupo"><Select value={groupId} onChange={(event) => setGroupId(event.target.value)} options={groups} placeholder="Todos" /></Field>
        </div>
        <div className="toolbar-actions">
          <Button type="button" variant="secondary" icon={<Search size={17} />} onClick={loadGrid} busy={busy}>Actualizar</Button>
          <Button type="button" variant="secondary" onClick={() => setAllPaid(!allSelected)}>{allSelected ? "Quitar todos" : "Seleccionar todos"}</Button>
          <Button type="button" icon={<Save size={17} />} onClick={saveGrid} busy={busy}>Guardar cambios</Button>
        </div>
      </section>

      <section className="table-section">
        <header className="section-heading"><div><span>Colegiaturas</span><h2>Control semestral por alumno</h2></div></header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Matricula</th>
                <th>Alumno</th>
                <th>Grupo</th>
                <th>Monto base</th>
                {months.map((month) => {
                  const monthSelected = rows.length > 0 && rows.every((row) => row.months.find((cell) => cell.month === month)?.paid);
                  return (
                    <th key={month}>
                      <label className="month-check">
                        <input type="checkbox" checked={monthSelected} onChange={(event) => setMonthPaid(month, event.target.checked)} />
                        <span>{monthLabel(month)}</span>
                      </label>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.studentId}>
                  <td><strong className="table-main">{row.student_number}</strong></td>
                  <td>{row.student_name}</td>
                  <td>{row.group_name}</td>
                  <td><strong>{money(row.tuition_amount)}</strong></td>
                  {row.months.map((cell) => (
                    <td key={cell.month}>
                      <div className="tuition-cell">
                        <input type="checkbox" checked={cell.paid} onChange={(event) => setCellPaid(row.studentId, cell.month, event.target.checked)} aria-label={`${row.student_name} ${cell.month}`} />
                        <input type="number" min="0" step="0.01" value={cell.amount} onChange={(event) => setCellAmount(row.studentId, cell.month, Number(event.target.value))} aria-label={`Monto ${row.student_name} ${cell.month}`} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <EmptyState icon={<ReceiptText size={25} />} title="Sin alumnos" text="Selecciona otro grupo o rango de meses para capturar colegiaturas." />}
      </section>
    </div>
  );
}
