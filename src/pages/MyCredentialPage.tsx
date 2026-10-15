import { useEffect, useState } from "react";
import { Download, IdCard, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { api, download, openDocument } from "../lib/api";
import { Button, LoadingState } from "../components/Ui";
import { CredentialPreview, CredentialStatusPill, CredentialValidityPanel } from "../components/CredentialPreview";
import type { CredentialState } from "../../shared/credentials";
import "../credentials.css";

export function MyCredentialPage() {
  const [state, setState] = useState<CredentialState | null>(null), [photo, setPhoto] = useState<string | null>(null), [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setError(""); setState(null); setPhoto(null); setSignature(null);
    api<CredentialState>("/portal/credential", { signal: controller.signal }).then(async value => {
      setState(value);
      if (value.canDownload) {
        const [portrait, autograph] = await Promise.all([
          api<{ dataUrl: string }>("/portal/credential/photo", { signal: controller.signal }),
          value.issue?.snapshot.template.signatureFile ? api<{ dataUrl: string }>("/portal/credential/signature", { signal: controller.signal }) : null
        ]);
        if (!controller.signal.aborted) { setPhoto(portrait.dataUrl); setSignature(autograph?.dataUrl || null); }
      }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh);
  }, []);
  async function file(layout: "card" | "letter") {
    setBusy(layout); setError("");
    try {
      if (layout === "letter") await openDocument("/portal/credential.pdf?layout=letter");
      else await download("/portal/credential.pdf", `mi-credencial-${state?.student.number || "estudiante"}.pdf`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo descargar la credencial."); setAttempt(n => n + 1); }
    finally { setBusy(""); }
  }
  return <div className="page-stack cred-page">
    <header className="cred-header"><div className="cred-heading-icon"><IdCard size={28} /></div><div><span className="cred-eyebrow">TU IDENTIDAD ESTUDIANTIL</span><h2>Mi credencial</h2><p>Tu credencial oficial, siempre a la mano.</p></div></header>
    {error && <div className="cred-error" role="alert">{error}<Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => setAttempt(n => n + 1)}>Volver a consultar</Button></div>}
    {!state && !error ? <LoadingState label="Consultando tu credencial" /> : state && <div className="cred-portal-layout"><section className="cred-portal-info">
      <CredentialStatusPill status={state.status} /><h3>{state.student.name}</h3><p className="cred-portal-number">Matrícula {state.student.number}</p><p>{state.student.program}</p>
      {state.canDownload && state.issue ? <><CredentialValidityPanel validity={state.issue.snapshot.validity} /><div className="cred-portal-downloads"><Button busy={busy === "card"} disabled={Boolean(busy)} icon={<Download size={17} />} onClick={() => file("card")}>Descargar mi credencial</Button><Button variant="secondary" busy={busy === "letter"} disabled={Boolean(busy)} icon={<Printer size={17} />} onClick={() => file("letter")}>Imprimir en hoja carta</Button></div><p className="cred-help">El PDF incluye frente y reverso. Para imprimir, usa tamaño real (100%). La hoja carta incluye guías de corte.</p><div className="cred-portal-seal"><ShieldCheck size={20} /><div><strong>Autorizada por Control Escolar</strong><small>{state.issue.folio}</small></div></div></>
      : <div className="cred-pending"><IdCard size={32} /><h4>{state.status === "expired" ? "Tu credencial ha vencido" : state.status === "revoked" ? "Tu credencial está desactivada" : "Tu credencial está en preparación"}</h4><p>{state.status === "missing_photo" ? "Control Escolar necesita cargar tu fotografía y activar la credencial. Cuando esté lista, podrás descargarla aquí." : "Solicita a Control Escolar que revise tu fotografía, el ciclo vigente y la activación de tu credencial."}</p><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => setAttempt(n => n + 1)}>Consultar estado</Button></div>}
    </section>{state.canDownload && state.issue ? <CredentialPreview snapshot={state.issue.snapshot} photo={photo} signature={signature} qr={state.issue.qr} draft={false} /> : <div className="cred-portal-placeholder" aria-hidden="true"><div><IdCard size={80} strokeWidth={1} /><span>MI CREDENCIAL</span><small>Disponible después de su activación</small></div></div>}</div>}
  </div>;
}
