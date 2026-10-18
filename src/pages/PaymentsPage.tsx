import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, Download, FileSpreadsheet, Pencil, Plus, ReceiptText, Search, Trash2, WalletCards } from "lucide-react";
import { api, download, openDocument } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Modal } from "../components/Modal";
import { Button, EmptyState, Field, Select } from "../components/Ui";

type StudentResult = {
  id: number;
  student_number: string;
  name: string;
  program_name: string;
  group_name: string;
  shift_name: string;
  plan_name: string | null;
  tuition_amount: number | null;
};

type Payment = {
  id: number;
  folio: string;
  amount: number;
  paid_at: string;
  payment_method: string | null;
  concept: string;
  concept_type?: "tuition" | "enrollment" | "reenrollment" | "other";
  covered_month?: string | null;
  covered_through_month?: string | null;
  registration_period_number?: number | null;
  notes: string | null;
};

type AccountData = {
  student: {
    studentId: number;
    student_number: string;
    student_name: string;
    program_name: string;
    group_name: string;
    shift_name: string;
    cycle_name: string;
    plan_name: string | null;
    plan_code: string | null;
    billingStartDate: string | null;
  };
  progress: {
    totalCredits: number;
    earnedCredits: number;
    percentage: number;
    average: number | null;
  };
  billing: {
    summary: {
      tuitionAmount: number;
      expectedPayments: number;
      expectedAmount: number;
      paidAmount: number;
      balance: number;
      paidInstallments: number;
      pendingInstallments: number;
    };
    payments: Payment[];
    schedule: Array<{
      period: number;
      dueDate: string | null;
      expectedAmount: number;
      paidAmount: number;
      pendingAmount: number;
      status: "paid" | "partial" | "pending";
    }>;
  };
  registration: { paid: number; paid_at: string | null; concept: string | null };
  promotion: { eligible: boolean; targetPeriodNumber: number; overdueMonths: number; overdueAmount: number; recentTwoPaymentsCovered: boolean; registrationPaidForTarget: boolean; reasons: string[] };
};

type Overview = {
  month: string;
  summary: { count: number; amount: number };
  groups: Array<{ groupName: string; count: number; amount: number }>;
};

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

const emptyForm = {
  folio: "",
  amount: "",
  paidAt: today,
  paymentMethod: "Transferencia",
  concept: "Colegiatura",
  coveredMonth: month,
  coveredThroughMonth: "",
  registrationPeriodNumber: "",
  notes: ""
};

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function PaymentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState<StudentResult[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [groups, setGroups] = useState<Array<{ id: number; name: string }>>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reportMonth, setReportMonth] = useState(month);
  const [accountMonth, setAccountMonth] = useState(month);
  const [reportGroupId, setReportGroupId] = useState("");
  const [appliedReportGroupId, setAppliedReportGroupId] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  async function searchStudents(query = search) {
    const params = new URLSearchParams({ search: query });
    if (appliedReportGroupId) params.set("groupId", appliedReportGroupId);
    const result = await api<{ records: StudentResult[] }>(`/payments/students?${params}`);
    setStudents(result.records);
  }

  async function loadAccount(studentId: number, throughMonth = accountMonth) {
    const result = await api<AccountData>(`/payments/student/${studentId}?throughMonth=${throughMonth}`);
    setAccount(result);
  }

  async function changeAccountMonth(value: string) {
    const selectedMonth = value || month;
    setAccountMonth(selectedMonth);
    if (account) await loadAccount(account.student.studentId, selectedMonth);
  }

  async function loadOverview() {
    const params = new URLSearchParams({ month: reportMonth });
    if (appliedReportGroupId) params.set("groupId", appliedReportGroupId);
    const result = await api<Overview>(`/payments/overview?${params}`);
    setOverview(result);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => searchStudents(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    api<{ records: Array<{ id: number; name: string; is_active: number }> }>("/catalogs/groups")
      .then((result) => setGroups(result.records.filter((group) => group.is_active)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadOverview().catch(() => undefined);
  }, [reportMonth]);

  function openCreate() {
    setEditing(null);
    const folio = `COB-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    setForm({ ...emptyForm, folio });
    setOpen(true);
  }

  function openEdit(payment: Payment) {
    setEditing(payment);
    setForm({
      folio: payment.folio,
      amount: String(payment.amount),
      paidAt: payment.paid_at,
      paymentMethod: payment.payment_method ?? "",
      concept: payment.concept,
      coveredMonth: payment.covered_month ?? month,
      coveredThroughMonth: payment.covered_through_month ?? "",
      registrationPeriodNumber: payment.registration_period_number == null ? "" : String(payment.registration_period_number),
      notes: payment.notes ?? ""
    });
    setOpen(true);
  }

  async function savePayment(event: React.FormEvent) {
    event.preventDefault();
    if (!account) return;
    setBusy(true);
    try {
      const normalizedConcept = form.concept.toLowerCase();
      const conceptType = normalizedConcept.includes("reinscrip")
        ? "reenrollment"
        : normalizedConcept.includes("inscrip")
          ? "enrollment"
          : normalizedConcept.includes("colegiatura") ? "tuition" : "other";
      const payload = {
        studentId: account.student.studentId,
        folio: form.folio,
        amount: Number(form.amount),
        paidAt: form.paidAt,
        paymentMethod: form.paymentMethod,
        concept: form.concept,
        conceptType,
        coveredMonth: conceptType === "tuition" ? form.coveredMonth : null,
        coveredThroughMonth: conceptType === "tuition" ? form.coveredThroughMonth || form.coveredMonth : null,
        registrationPeriodNumber: conceptType === "enrollment" || conceptType === "reenrollment" ? Number(form.registrationPeriodNumber || (conceptType === "enrollment" ? 1 : 0)) || null : null,
        notes: form.notes
      };
      const updated = await api<AccountData>(editing ? `/payments/${editing.id}` : "/payments", {
        method: editing ? "PATCH" : "POST",
        body: payload
      });
      setAccount(updated);
      setOpen(false);
      setEditing(null);
      toast.success(editing ? "Pago actualizado." : "Pago registrado.");
      await loadOverview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible guardar el pago.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePayment(payment: Payment) {
    if (!account || !window.confirm(`Eliminar el pago con folio físico ${payment.notes || "sin capturar"}?`)) return;
    setBusy(true);
    try {
      await api(`/payments/${payment.id}`, { method: "DELETE" });
      await loadAccount(account.student.studentId);
      await loadOverview();
      toast.success("Pago eliminado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible eliminar el pago.");
    } finally {
      setBusy(false);
    }
  }

  const reportQuery = useMemo(() => {
    const params = new URLSearchParams({ month: reportMonth });
    if (appliedReportGroupId) params.set("groupId", appliedReportGroupId);
    return params.toString();
  }, [reportMonth, appliedReportGroupId]);

  async function applyGroupFilter() {
    setAppliedReportGroupId(reportGroupId);
    const params = new URLSearchParams({ search });
    if (reportGroupId) params.set("groupId", reportGroupId);
    const [studentResult, overviewResult] = await Promise.all([
      api<{ records: StudentResult[] }>(`/payments/students?${params}`),
      api<Overview>(`/payments/overview?month=${reportMonth}${reportGroupId ? `&groupId=${reportGroupId}` : ""}`)
    ]);
    setStudents(studentResult.records);
    setOverview(overviewResult);
    setAccount(null);
  }

  const summary = account?.billing.summary;

  return (
    <div className="payments-page page-stack">
      <section className="toolbar">
        <div className="toolbar-primary">
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar alumno por nombre o matricula" />
          </div>
        </div>
        <div className="toolbar-actions">
          <Field label="Mes"><input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value || month)} /></Field>
          <Field label="Grupo"><Select value={reportGroupId} onChange={(event) => setReportGroupId(event.target.value)} options={groups} placeholder="Todos" /></Field>
          <Button type="button" variant="secondary" onClick={() => applyGroupFilter().catch((error) => toast.error(error instanceof Error ? error.message : "No fue posible filtrar."))}>Filtrar</Button>
          <Button type="button" variant="secondary" icon={<Download size={17} />} onClick={() => openDocument(`/payments/report?${reportQuery}&format=pdf`)}>Estado de cuenta</Button>
          <Button type="button" variant="secondary" icon={<FileSpreadsheet size={17} />} onClick={() => download(`/payments/report?${reportQuery}&format=xlsx`, `estado-de-cuenta-${reportMonth}.xlsx`)}>Excel</Button>
        </div>
      </section>

      <section className="payment-search-results">
        {students.map((student) => (
          <button key={student.id} className={account?.student.studentId === student.id ? "active" : ""} onClick={() => loadAccount(student.id)}>
            <GraduationIcon />
            <div><strong>{student.name}</strong><span>{student.student_number} | {student.program_name} | Grupo {student.group_name}</span></div>
            <b>{money(student.tuition_amount)}</b>
          </button>
        ))}
      </section>

      {overview && (
        <section className="payment-overview">
          <div><ReceiptText size={21} /><span>Cobros del mes</span><strong>{overview.summary.count}</strong></div>
          <div><Banknote size={21} /><span>Total mensual</span><strong>{money(overview.summary.amount)}</strong></div>
          {overview.groups.slice(0, 4).map((group) => <div key={group.groupName}><WalletCards size={21} /><span>{group.groupName}</span><strong>{money(group.amount)}</strong><small>{group.count} pagos</small></div>)}
        </section>
      )}

      {account ? (
        <>
          <section className="payment-account-header">
            <div><span>{account.student.program_name} | {account.student.cycle_name}</span><h2>{account.student.student_name}</h2><p>{account.student.student_number} | Grupo {account.student.group_name} | {account.student.plan_name ?? "Sin plan academico"} | Inicio cobro {account.student.billingStartDate ?? "Sin fecha"}</p></div>
            <div className="payment-account-actions">
              <Field label="Consultar hasta"><input type="month" max={month} value={accountMonth} onChange={(event) => changeAccountMonth(event.target.value).catch((error) => toast.error(error instanceof Error ? error.message : "No fue posible consultar el periodo."))} /></Field>
              {can("payments.export") && <Button type="button" variant="secondary" icon={<Download size={17} />} onClick={() => openDocument(`/payments/student/${account.student.studentId}/statement?format=pdf&throughMonth=${accountMonth}`)}>PDF carta</Button>}
              {can("payments.export") && <Button type="button" variant="secondary" icon={<FileSpreadsheet size={17} />} onClick={() => download(`/payments/student/${account.student.studentId}/statement?format=xlsx&throughMonth=${accountMonth}`, `estado-de-cuenta-${account.student.student_number}-${accountMonth}.xlsx`)}>Excel</Button>}
              {can("payments.manage") && <Button type="button" icon={<Plus size={17} />} onClick={openCreate}>Nuevo pago</Button>}
            </div>
          </section>

          <section className="payment-metrics">
            <div><CalendarDays size={21} /><span>Colegiaturas</span><strong>{summary?.paidInstallments}<small> / {summary?.expectedPayments}</small></strong></div>
            <div><Banknote size={21} /><span>Pagado</span><strong>{money(summary?.paidAmount)}</strong></div>
            <div><CalendarDays size={21} /><span>Inscripción / reinscripción</span><strong>{account.registration.paid ? "PAGADA" : "PENDIENTE"}</strong></div>
            <div><ReceiptText size={21} /><span>Avance curricular</span><strong>{account.progress.percentage}%</strong></div>
          </section>

          <section className="table-section">
            <header className="section-heading"><div><span>Pagos</span><h2>Historial de cobros</h2></div></header>
            <div className="table-wrap"><table><thead><tr><th>Folio físico</th><th>Fecha</th><th>Concepto</th><th>Metodo</th><th>Monto</th><th></th></tr></thead><tbody>
              {account.billing.payments.map((payment) => <tr key={payment.id}>
                <td><strong className="table-main">{payment.notes || "Sin folio físico"}</strong></td>
                <td>{payment.paid_at}</td>
                <td>{payment.concept}</td>
                <td>{payment.payment_method || <span className="muted-cell">Sin metodo</span>}</td>
                <td><strong>{money(payment.amount)}</strong></td>
                <td className="action-cell">{can("payments.manage") && <div className="inline-actions"><button className="icon-button" onClick={() => openEdit(payment)} title="Editar pago"><Pencil size={16} /></button><button className="icon-button" onClick={() => deletePayment(payment)} title="Eliminar pago" disabled={busy}><Trash2 size={16} /></button></div>}</td>
              </tr>)}
            </tbody></table></div>
            {!account.billing.payments.length && <EmptyState icon={<ReceiptText size={25} />} title="Sin pagos registrados" text="Aun no hay cobros vinculados a este alumno." />}
          </section>

        </>
      ) : (
        <EmptyState icon={<WalletCards size={28} />} title="Selecciona un alumno" text="Busca por matricula o nombre para abrir su estado de cuenta." />
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar pago" : "Nuevo pago"} size="small">
        <form onSubmit={savePayment}>
          <div className="form-grid two">
            <Field label="Fecha real de ingreso a caja" required hint="El ingreso se contabiliza solo en esta fecha, aunque cubra otros meses."><input type="date" value={form.paidAt} onChange={(event) => setForm({ ...form, paidAt: event.target.value })} required /></Field>
            <Field label="Monto" required><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></Field>
            <Field label="Metodo"><input value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} /></Field>
            <Field label="Primer mes que cubre"><input type="month" value={form.coveredMonth} onChange={(event) => setForm({ ...form, coveredMonth: event.target.value || month })} /></Field>
            <Field label="Último mes que cubre" hint="Opcional. Un solo recibo puede cubrir varios meses; captura el importe total recibido."><input type="month" min={form.coveredMonth} value={form.coveredThroughMonth} onChange={(event) => setForm({ ...form, coveredThroughMonth: event.target.value })} /></Field>
            {(form.concept.toLowerCase().includes("inscrip")) && <Field label="Semestre que ampara" required><select value={form.registrationPeriodNumber} onChange={(event) => setForm({ ...form, registrationPeriodNumber: event.target.value })} required><option value="">Seleccionar</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}° semestre</option>)}</select></Field>}
          </div>
          <Field label="Concepto" required><input value={form.concept} onChange={(event) => setForm({ ...form, concept: event.target.value })} required /></Field>
          <Field label="NÚMERO DE FOLIO FÍSICO" required hint="Mínimo cuatro dígitos. Después de 9999, continúa con 10000, 10001, etc."><input inputMode="numeric" pattern="0*[1-9][0-9]*" placeholder="0001" title="Ingresa un folio numérico mayor que cero, sin límite de consecutivo." value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value.replace(/\D/g, "") })} required /></Field>
          <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" busy={busy}>{editing ? "Guardar cambios" : "Registrar pago"}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

function GraduationIcon() {
  return <span className="payment-student-icon"><WalletCards size={18} /></span>;
}
