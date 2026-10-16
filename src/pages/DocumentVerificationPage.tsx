import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, FileCheck2, LoaderCircle, RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { api } from "../lib/api";
import { InstitutionLogo } from "../components/InstitutionLogo";
import type { PublicDocumentVerification } from "../../shared/official-document";
import { displayProgramName } from "../../shared/program-name";
import "../document-verification.css";

function issuedDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}
function calendarDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", dateStyle: "long" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}
const money = (value: number) => value.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const score = (value: number | null) => value == null ? "—" : value.toFixed(1);

export function DocumentVerificationPage() {
  const { token } = useParams();
  const [result, setResult] = useState<PublicDocumentVerification | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    api<PublicDocumentVerification>(`/documents/verify/${encodeURIComponent(token || "")}`, { signal: controller.signal })
      .then(setResult).catch(reason => { if (!controller.signal.aborted) setError(reason.message || "No fue posible consultar el documento."); });
    return () => controller.abort();
  }, [token, attempt]);
  useEffect(() => {
    const meta = window.document.createElement("meta"); meta.name = "robots"; meta.content = "noindex, noarchive";
    window.document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  const document = result?.document;
  const certification = document?.content.certification;
  const valid = result?.status === "valid";
  const studentCopy = document?.content.purpose === "student_copy";
  return <main className="verification-page">
    <header className="verification-brand">
      <InstitutionLogo logoPath={document?.institution.logoPath} />
      <div><strong>{document?.institution.name || "Validación institucional"}</strong><span>{document?.institution.campus || "Control Escolar"}</span></div>
      <Link to="/">Ir a la plataforma <ArrowRight size={15} /></Link>
    </header>
    <div className="verification-content">
      {!result && !error ? <section className="verification-loading" role="status"><LoaderCircle className="spin" size={32} /><h1>Consultando el registro institucional</h1><p>Estamos verificando el documento.</p></section>
        : error ? <section className="verification-status verification-invalid" role="alert"><ShieldX size={36} /><div><h1>No se pudo validar el documento</h1><p>{error}</p><button className="button button-secondary" onClick={() => setAttempt(attempt + 1)}><RefreshCw size={16} /> Volver a consultar</button></div></section>
        : <>
          <section className={`verification-status verification-${valid ? "valid" : "invalid"}`} role="status">
            {valid ? <ShieldCheck size={40} /> : <ShieldX size={40} />}
            <div><span>REGISTRO DE CONTROL ESCOLAR</span><h1>{valid ? studentCopy ? "Boleta informativa verificada" : "Documento oficial verificado" : result?.status === "revoked" ? "Documento revocado" : "Documento sin validación"}</h1><p>{result?.message}</p>{result?.revokedAt && <p>Revocado el {issuedDate(result.revokedAt)}.</p>}</div>
          </section>
          {document && <article className="verification-document">
            <div className="verification-document-title"><FileCheck2 size={23} /><div><span>DOCUMENTO EMITIDO</span><h2>{document.title}</h2></div></div>
            <dl className="verification-fields">
              <div className="verification-wide"><dt>Alumno</dt><dd>{document.student.name}</dd></div>
              <div><dt>Matrícula</dt><dd>{document.student.number}</dd></div>
              <div><dt>Fecha de emisión · Ciudad de México</dt><dd>{issuedDate(document.issuedAt)}</dd></div>
              <div className="verification-wide"><dt>Programa académico</dt><dd>{displayProgramName(document.student.program)}</dd></div>
              <div><dt>Semestre al emitir</dt><dd>{document.student.semesterName}</dd></div>
              <div><dt>Ciclo escolar al emitir</dt><dd>{document.student.cycle}</dd></div>
              <div><dt>Grupo / turno</dt><dd>{document.student.group} · {document.student.shift}</dd></div>
              <div><dt>Folio institucional</dt><dd className="verification-folio">{document.folio}</dd></div>
            </dl>
            <p className="verification-instructions">Compara estos datos con el documento impreso, incluido su folio. Esta consulta conserva la información registrada en la fecha de emisión.</p>
            {certification && <section className="verification-calendar"><h3>{certification.collaborationAgreement ? "Convenio de colaboración con UNITEN" : "RVOE propio de IFOP"}</h3><dl className="verification-fields"><div className="verification-wide"><dt>Institución del plan</dt><dd>{certification.institution}</dd></div><div><dt>Clave de Centro de Trabajo (CCT)</dt><dd>{certification.cct}</dd></div><div><dt>RVOE del plan</dt><dd>{certification.rvoe || "No registrado"}</dd></div></dl></section>}
            {document.content.calendar && <section className="verification-calendar"><h3>Calendario del ciclo escolar</h3><p>Actividades del {calendarDate(document.content.calendar.start)} al {calendarDate(document.content.calendar.end)}.</p>{document.content.calendar.vacations.length ? document.content.calendar.vacations.map((vacation, index) => <p key={index}>Vacaciones del {calendarDate(vacation.start_date)} al {calendarDate(vacation.end_date)}.</p>) : <p>Sin periodos vacacionales registrados para este ciclo.</p>}</section>}
            {document.content.subjects && <>
              <h3>{document.type === "academic_history" ? "Asignaturas cursadas y del semestre actual" : "Asignaturas del semestre actual"}</h3>
              <div className="table-wrap"><table><thead><tr><th>Semestre</th><th>Clave / asignatura</th>{document.type === "academic_history" && <th>Créditos</th>}{document.type === "study_certificate" && <th>Tipo</th>}{document.type === "report_card" && <><th>P1</th><th>P2</th><th>P3</th></>}{document.type !== "study_certificate" && <><th>Final</th><th>Estado</th></>}</tr></thead><tbody>{document.content.subjects.map((subject, index) => <tr key={index}><td>{subject.semester}</td><td><span className="table-sub">{subject.code}</span><strong>{subject.name}</strong></td>{document.type === "academic_history" && <td>{subject.credits}</td>}{document.type === "study_certificate" && <td>{subject.subjectType === "elective" ? "Optativa" : "Obligatoria"}</td>}{document.type === "report_card" && <><td>{score(subject.partial1)}</td><td>{score(subject.partial2)}</td><td>{score(subject.partial3)}</td></>}{document.type !== "study_certificate" && <><td>{score(subject.score)}</td><td>{subject.status}</td></>}</tr>)}</tbody></table></div>
              {!document.content.subjects.length && <p>Sin asignaturas registradas.</p>}
              {document.content.average !== undefined && <p className="verification-total">{document.type === "report_card" ? "Promedio del semestre" : "Promedio acumulado"}: {score(document.content.average)}</p>}
            </>}
            {document.content.payments && <><h3>Movimientos registrados</h3><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Folio físico</th><th>Importe</th><th>Estado</th></tr></thead><tbody>{document.content.payments.map((payment, index) => <tr key={index}><td>{calendarDate(payment.date)}</td><td>{payment.concept}</td><td>{payment.folio}</td><td>{money(payment.amount)}</td><td>Pagado</td></tr>)}</tbody></table></div><p className="verification-total">Total pagado: {money(document.content.totalPaid || 0)}</p></>}
            {document.content.notes?.map((note, index) => <p key={index}>{note}</p>)}
            <footer>{!studentCopy && <><strong>{document.institution.directorName}</strong><span>Control Escolar</span></>}<small>{document.type === "account_statement" ? "Código de verificación SHA-256" : "Huella del registro SHA-256"}</small><code>{document.type === "account_statement" ? `EC-${result?.fingerprint?.toUpperCase()}` : result?.fingerprint}</code></footer>
          </article>}
        </>}
      <p className="verification-footer">{document?.institution.address}<br />{document?.institution.footer}</p>
    </div>
  </main>;
}
