import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, ShieldCheck, X } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./Ui";
import { CredentialPreview } from "./CredentialPreview";
import { CredentialCropControls } from "./CredentialPhotoTools";
import type { CredentialFraming, CredentialSnapshot, CredentialState } from "../../shared/credentials";

export function CredentialPhotoReview({state,signature,onReviewed}:{state:CredentialState;signature:string|null;onReviewed:(value:CredentialState)=>void}) {
  const submission=state.submission;
  const [original,setOriginal]=useState<string|null>(null),[prepared,setPrepared]=useState<string|null>(null);
  const [variant,setVariant]=useState<"original"|"prepared">("prepared"),[framing,setFraming]=useState<CredentialFraming>({cropX:.5,cropY:.5,zoom:1});
  const [accepted,setAccepted]=useState(false),[reason,setReason]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState("");
  useEffect(()=>{
    setOriginal(null);setPrepared(null);setAccepted(false);setReason("");setError("");setVariant("prepared");
    if(!submission||submission.status!=="pending")return;
    setFraming(submission.framing);const controller=new AbortController();
    const path=`/credentials/students/${state.student.id}/submissions/${submission.id}/photo`;
    Promise.all([api<{dataUrl:string}>(`${path}?variant=original`,{signal:controller.signal}),api<{dataUrl:string}>(`${path}?variant=prepared`,{signal:controller.signal})])
      .then(([source,improved])=>{if(!controller.signal.aborted){setOriginal(source.dataUrl);setPrepared(improved.dataUrl);}})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[state.student.id,submission?.id]);
  if(!submission||submission.status!=="pending")return null;
  async function review(action:"approve"|"reject"){
    setBusy(action);setError("");
    try{const value=await api<CredentialState>(`/credentials/students/${state.student.id}/submissions/${submission!.id}/${action}`,{method:"POST",body:action==="approve"
      ?{revision:state.revision,templateVersion:state.template.version,requirementsAccepted:accepted,variant,...framing}:{reason}});onReviewed(value);}
    catch(e){setError(e instanceof Error?e.message:"No fue posible completar la revisión.");}finally{setBusy("");}
  }
  const snapshot:CredentialSnapshot={student:state.student,template:state.template,photo:submission.photo,framing,validity:state.validity,issuedAt:"",folio:"FOTO EN REVISIÓN"};
  return <section className="cred-photo-review">
    <div className="cred-panel-title"><ClipboardCheck size={25}/><div><h3>Fotografía enviada por el alumno</h3><p>Revisa el fondo blanco, uniforme y rostro centrado antes de publicar.</p></div></div>
    {error&&<div className="cred-error" role="alert">{error}</div>}
    <div className="cred-photo-review-grid"><div className="cred-photo-review-controls"><div className="cred-photo-variants">{([["original","Foto original",original],["prepared","Fondo aclarado",prepared]] as const).map(([key,label,src])=><button key={key} type="button" aria-pressed={variant===key} disabled={Boolean(busy)||!src} onClick={()=>{setVariant(key);setAccepted(false);}}>{src?<img src={src} alt={label}/>:<span>Cargando…</span>}<strong>{label}{variant===key&&<CheckCircle2 size={15}/>}</strong></button>)}</div><p className="cred-help">{submission.processing.note} La resolución es de {submission.photo.width} × {submission.photo.height} px.</p>
      <CredentialCropControls value={framing} onChange={value=>{setFraming(value);setAccepted(false);}} disabled={Boolean(busy)}/>
      <label className="cred-photo-check"><input type="checkbox" checked={accepted} disabled={Boolean(busy)} onChange={event=>setAccepted(event.target.checked)}/><span>Revisé el fondo totalmente blanco, el uniforme y el rostro centrado en la credencial.</span></label>
      <Button icon={<ShieldCheck size={17}/>} busy={busy==="approve"} disabled={!accepted||!original||!prepared||Boolean(busy)||!state.validity||!state.student.active||!state.student.enrolled} onClick={()=>void review("approve")}>Aprobar foto y publicar credencial</Button>
      <p className="cred-help">La aprobación aplica la foto y publica los PDF autorizados para el alumno y la administración en un solo paso.</p>
      <label className="field"><span>Correcciones que necesita el alumno</span><textarea rows={3} maxLength={500} value={reason} disabled={Boolean(busy)} onChange={event=>setReason(event.target.value)} placeholder="Por ejemplo: toma otra foto frente a una pared blanca y usa tu uniforme."/></label>
      <Button variant="secondary" icon={<X size={16}/>} busy={busy==="reject"} disabled={reason.trim().length<5||Boolean(busy)} onClick={()=>void review("reject")}>Solicitar otra fotografía</Button>
    </div><CredentialPreview snapshot={snapshot} photo={variant==="original"?original:prepared} signature={signature}/></div>
  </section>;
}
