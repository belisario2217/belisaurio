import { useId } from "react";
import { SlidersHorizontal } from "lucide-react";
import { credentialImageLayout } from "../../shared/credential-artwork";
import type { CredentialFraming, CredentialPhoto } from "../../shared/credentials";

export function CredentialPortrait({ photo, info, framing }: { photo: string; info: CredentialPhoto; framing: CredentialFraming }) {
  const id=useId().replace(/:/g,""),layout=credentialImageLayout({photo:info,framing}).photo;
  return <svg className="cred-photo-circle" viewBox="412 262 420 420" role="img" aria-label="Encuadre de la foto en el centro de la credencial">
    <defs><clipPath id={id}><circle cx="622" cy="472" r="210" /></clipPath></defs>
    <circle cx="622" cy="472" r="210" fill="white" />
    <image href={photo} {...layout.image} preserveAspectRatio="none" clipPath={`url(#${id})`} />
  </svg>;
}
export function CredentialCropControls({ value, onChange, disabled=false }: { value: CredentialFraming; onChange: (value:CredentialFraming)=>void; disabled?:boolean }) {
  return <fieldset className="cred-framing" disabled={disabled}><legend><SlidersHorizontal size={14} /> Centra tu fotografía</legend>
    {([["zoom","Acercamiento",1,3],["cropX","Posición horizontal",0,1],["cropY","Posición vertical",0,1]] as const).map(([key,label,min,max])=><label key={key}><span>{label}</span><input aria-label={label} type="range" min={min} max={max} step="0.01" value={value[key]} onChange={event=>onChange({...value,[key]:Number(event.target.value)})} /></label>)}
    <button type="button" className="cred-text-button" onClick={()=>onChange({cropX:.5,cropY:.5,zoom:1})}>Centrar fotografía</button>
  </fieldset>;
}
export function SelfieGuide({ example=false }: {example?:boolean}) {
  return <div className={`cred-selfie-guide ${example?"cred-selfie-guide-example":""}`} aria-hidden="true"><div className="cred-selfie-oval" /><div className="cred-selfie-eyes" /><div className="cred-selfie-center" /><span>Ojos en la línea horizontal</span></div>;
}
