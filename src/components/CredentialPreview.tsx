import { useMemo } from "react";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { credentialSvg, type CredentialArtworkAssets } from "../../shared/credential-artwork";
import { credentialDimensions, credentialStatusLabels, type CredentialSnapshot, type CredentialStatus, type CredentialValidity } from "../../shared/credentials";
import { institutionLogoUrl } from "./InstitutionLogo";
import "../credentials.css";

export function credentialDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-MX", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}
export function CredentialStatusPill({ status }: { status: CredentialStatus }) {
  return <span className={`cred-status cred-status-${status}`}><span />{credentialStatusLabels[status]}</span>;
}
export function CredentialValidityPanel({ validity }: { validity: CredentialValidity | null }) {
  return <div className="cred-validity"><CalendarDays size={19} /><div><strong>{validity ? `Ciclo ${validity.cycle}` : "Configura el calendario del ciclo activo"}</strong>
    <p>{validity ? <>Vigencia hasta el <b>{credentialDate(validity.validUntil)}</b>.</> : "El ciclo necesita fechas de inicio y término para emitir credenciales."}</p>
    <small>Máximo seis meses desde la emisión, sin exceder el cierre del ciclo escolar. La validez se consulta en el QR.</small></div></div>;
}

export function CredentialPreview({ snapshot, photo, signature, qr, draft = true }: {
  snapshot: CredentialSnapshot; photo?: string | null; signature?: string | null;
  qr?: CredentialArtworkAssets["qr"]; draft?: boolean;
}) {
  const artwork = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    const measure = (text: string, size: number, bold: boolean) => {
      context.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
      return context.measureText(text).width;
    };
    const assets = { logo: institutionLogoUrl(snapshot.student.logoPath), photo, signature, qr };
    return (["front", "back"] as const).map(side => credentialSvg(snapshot, side, assets, measure, draft));
  }, [snapshot, photo, signature, qr, draft]);
  const size = credentialDimensions(snapshot.template.size);
  return <div className="cred-preview-wrap">
    <div className="cred-preview-heading"><span>{draft ? "VISTA PREVIA" : "CREDENCIAL AUTORIZADA"}</span><small>{size.width} × {size.height} mm · dos caras</small></div>
    <div className="cred-faces">{artwork.map((svg, index) => <figure key={index}>
      <div className="cred-face" style={{ aspectRatio: `${size.width} / ${size.height}` }} dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>{index ? "Reverso" : "Frente"}</figcaption>
    </figure>)}</div>
    <p className="cred-preview-note"><ShieldCheck size={15} />{draft ? "La vista previa no activa ni publica la credencial." : "Versión aprobada por Control Escolar. El QR permite comprobar su vigencia."}</p>
  </div>;
}
