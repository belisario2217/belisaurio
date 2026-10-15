import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, IdCard, LoaderCircle, RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { api, publicFileUrl } from "../lib/api";
import { InstitutionLogo } from "../components/InstitutionLogo";
import { credentialDate } from "../components/CredentialPreview";
import type { CredentialVerification } from "../../shared/credentials";
import "../document-verification.css";
import "../credentials.css";

export function CredentialVerificationPage() {
  const { token } = useParams();
  const [result, setResult] = useState<CredentialVerification | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setResult(null); setError("");
    api<CredentialVerification>(`/credentials/verify/${encodeURIComponent(token || "")}`, { signal: controller.signal }).then(setResult)
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [token, attempt]);
  useEffect(() => {
    const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "noindex, noarchive"; document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  const record = result?.document, valid = result?.status === "active";
  return <main className="verification-page"><header className="verification-brand"><InstitutionLogo logoPath={record?.student.logoPath} /><div><strong>{record?.template.institution || "Validación institucional"}</strong><span>{record?.template.campus || "Control Escolar"}</span></div><Link to="/">Ir a la plataforma <ArrowRight size={15} /></Link></header>
    <div className="verification-content">{!result && !error ? <section className="verification-loading" role="status"><LoaderCircle className="spin" size={32} /><h1>Verificando la credencial</h1><p>Consultando su activación y vigencia en Control Escolar.</p></section>
      : error ? <section className="verification-status verification-invalid" role="alert"><ShieldX size={36} /><div><h1>No se pudo validar la credencial</h1><p>{error}</p><button className="button button-secondary" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16} />Volver a consultar</button></div></section>
      : <><section className={`verification-status verification-${valid ? "valid" : "invalid"}`} role="status">{valid ? <ShieldCheck size={40} /> : <ShieldX size={40} />}<div><span>REGISTRO DE CONTROL ESCOLAR</span><h1>{valid ? "Credencial oficial vigente" : result?.status === "expired" ? "Credencial vencida" : result?.status === "revoked" ? "Credencial desactivada" : "Credencial sin validez actual"}</h1><p>{result?.message}</p></div></section>
        {record && <article className="verification-document"><div className="verification-document-title"><IdCard size={24} /><div><span>IDENTIDAD ESTUDIANTIL</span><h2>Credencial de estudiante</h2></div></div>
          {result?.photoUrl && <img className="cred-verification-photo" src={publicFileUrl(result.photoUrl)} alt={`Fotografía autorizada de ${record.student.name}`} />}
          <dl className="verification-fields"><div className="verification-wide"><dt>Alumno</dt><dd>{record.student.name}</dd></div><div><dt>Matrícula</dt><dd>{record.student.number}</dd></div><div><dt>Fecha de emisión</dt><dd>{credentialDate(new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City" }).format(new Date(record.issuedAt)))}</dd></div><div className="verification-wide"><dt>Programa académico</dt><dd>{record.student.program}</dd></div><div><dt>Ciclo escolar</dt><dd>{record.validity?.cycle || record.student.cycle}</dd></div><div><dt>Grupo</dt><dd>{record.student.group || "Sin grupo"}</dd></div><div><dt>Válida desde</dt><dd>{record.validity ? credentialDate(record.validity.validFrom) : "Sin registro"}</dd></div><div><dt>Válida hasta</dt><dd><strong>{record.validity ? credentialDate(record.validity.validUntil) : "Sin registro"}</strong></dd></div><div className="verification-wide"><dt>Folio de la credencial</dt><dd className="verification-folio">{record.folio}</dd></div></dl>
          <p className="verification-instructions">Compara el nombre, la matrícula, la fotografía y el vencimiento con la credencial presentada. Su vigencia está ligada al ciclo escolar activo, con un máximo de seis meses desde la emisión.</p><button className="button button-secondary" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16} />Consultar validez de nuevo</button>
        </article>}</>}
      <p className="verification-footer">{record?.template.address}<br />Consulta en línea del registro de Control Escolar.</p>
    </div></main>;
}
