import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, CheckCircle2, Clock3, ImagePlus, RefreshCw, Send, ShieldCheck, Sun, X } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./Ui";
import { Modal } from "./Modal";
import { CredentialCropControls, CredentialPortrait, SelfieGuide } from "./CredentialPhotoTools";
import type { CredentialFraming, CredentialState } from "../../shared/credentials";

type Candidate={file:File;url:string;width:number;height:number};
const center:CredentialFraming={cropX:.5,cropY:.5,zoom:1};
const message=(error:unknown)=>error instanceof Error?error.message:"No se pudo preparar la fotografía. Intenta con otra imagen.";

export function StudentCredentialPhoto({state,onChange,onRefresh}:{state:CredentialState;onChange:(value:CredentialState)=>void;onRefresh:()=>void}) {
  const gallery=useRef<HTMLInputElement>(null),nativeCamera=useRef<HTMLInputElement>(null),video=useRef<HTMLVideoElement>(null);
  const photoDetails=useRef<HTMLDetailsElement>(null);
  const stream=useRef<MediaStream|null>(null),requestNumber=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const mounted=useRef(true),loadingNumber=useRef(0),objectUrl=useRef<string|null>(null),capturing=useRef(false);
  const [candidate,setCandidate]=useState<Candidate|null>(null),[framing,setFraming]=useState(center);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
  const [cameraOpen,setCameraOpen]=useState(false),[cameraReady,setCameraReady]=useState(false),[cameraError,setCameraError]=useState("");
  const [requirements,setRequirements]=useState(false),[improve,setImprove]=useState(true),[sentPhoto,setSentPhoto]=useState<string|null>(null);
  const submission=state.submission;
  function stopCamera() {
    requestNumber.current++;
    if(timer.current){clearTimeout(timer.current);timer.current=null;}
    stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
    if(video.current)video.current.srcObject=null;
    if(mounted.current){setCameraOpen(false);setCameraReady(false);}
  }
  useEffect(()=>{
    mounted.current=true;
    const hidden=()=>{if(document.visibilityState==="hidden")stopCamera();};
    document.addEventListener("visibilitychange",hidden);
    return ()=>{mounted.current=false;loadingNumber.current++;stopCamera();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);document.removeEventListener("visibilitychange",hidden);};
  },[]);
  useEffect(()=>{
    setSentPhoto(null);if(!submission)return;
    const controller=new AbortController();
    api<{dataUrl:string}>("/portal/credential/photo-submission/photo",{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setSentPhoto(value.dataUrl);}).catch(()=>undefined);
    return ()=>controller.abort();
  },[submission?.id]);
  async function chooseFile(file:File) {
    const request=++loadingNumber.current;setError("");setLoading(true);setRequirements(false);
    let url:string|null=null;
    try{
      if(file.size>10*1024*1024)throw new Error("La foto debe pesar como máximo 10 MB. Puedes tomar una nueva desde la cámara.");
      url=URL.createObjectURL(file);const img=new Image();
      await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("No fue posible abrir esta imagen. Usa una foto JPG, PNG o WebP.")),12000);img.onload=()=>{clearTimeout(timeout);resolve();};img.onerror=()=>{clearTimeout(timeout);reject(new Error("No fue posible abrir esta imagen. Elige JPG, PNG o WebP, o toma una foto nueva."));};img.src=url!;});
      if(img.naturalWidth<320||img.naturalHeight<320)throw new Error("Usa una foto de al menos 320 × 320 píxeles.");
      if(img.naturalWidth*img.naturalHeight>40_000_000)throw new Error("La imagen es demasiado grande. Toma una nueva con la cámara del portal.");
      let uploadFile=file;
      if(/image\/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name)){
        const canvas=document.createElement("canvas");canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        const context=canvas.getContext("2d");if(!context)throw new Error("Usa una foto JPG o toma una nueva con la cámara.");context.drawImage(img,0,0);
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("No fue posible convertir esta foto. Usa JPG o toma una nueva.")),"image/jpeg",.97));
        if(blob.size>10*1024*1024)throw new Error("La imagen convertida supera 10 MB. Toma una nueva con la cámara del portal.");
        uploadFile=new File([blob],"foto-credencial.jpg",{type:"image/jpeg"});
      }
      if(!mounted.current||request!==loadingNumber.current){URL.revokeObjectURL(url);return;}
      if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=url;
      setCandidate({file:uploadFile,url,width:img.naturalWidth,height:img.naturalHeight});setFraming(center);setRequirements(false);
      if(photoDetails.current)photoDetails.current.open=true;
    }catch(reason){if(url)URL.revokeObjectURL(url);if(mounted.current&&request===loadingNumber.current)setError(message(reason));}
    finally{if(mounted.current&&request===loadingNumber.current)setLoading(false);}
  }
  function fileChanged(event:ChangeEvent<HTMLInputElement>){const file=event.target.files?.[0];event.target.value="";if(file)void chooseFile(file);}
  async function openCamera(){
    stopCamera();setCameraError("");setCameraOpen(true);setCameraReady(false);
    const request=++requestNumber.current;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){setCameraError("Este navegador no permite la cámara en vivo. Usa «Abrir cámara del dispositivo» o carga una foto de tu galería.");return;}
    timer.current=setTimeout(()=>{if(request!==requestNumber.current)return;requestNumber.current++;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(mounted.current)setCameraError("La cámara tardó en responder. Puedes usar la cámara del dispositivo o volver a intentarlo.");},15000);
    try{
      let media:MediaStream;
      try{media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"user"},width:{ideal:1920},height:{ideal:2560}}});}
      catch(reason){if((reason as DOMException).name!=="OverconstrainedError")throw reason;media=await navigator.mediaDevices.getUserMedia({audio:false,video:true});}
      if(!mounted.current||request!==requestNumber.current){media.getTracks().forEach(track=>track.stop());return;}
      stream.current=media;
      media.getVideoTracks().forEach(track=>{track.onended=()=>{if(mounted.current&&request===requestNumber.current){setCameraReady(false);setCameraError("La cámara se desconectó. Puedes volver a abrirla o usar la cámara del dispositivo.");}};});
      if(!video.current){media.getTracks().forEach(track=>track.stop());throw new Error("La vista de cámara no está disponible. Vuelve a intentarlo.");}
      video.current.srcObject=media;await video.current.play();
      if(request!==requestNumber.current)return;
      if(timer.current){clearTimeout(timer.current);timer.current=null;}
      setCameraReady(video.current.videoWidth>0&&video.current.videoHeight>0);
    }catch(reason){
      if(!mounted.current||request!==requestNumber.current)return;
      if(timer.current){clearTimeout(timer.current);timer.current=null;}
      stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
      const name=(reason as DOMException).name;
      setCameraError(name==="NotAllowedError"||name==="SecurityError"?"No se autorizó el acceso a la cámara. Puedes habilitarlo en tu navegador o usar la cámara del dispositivo."
        :name==="NotFoundError"?"No se encontró una cámara. Puedes cargar una fotografía desde tu galería."
        :"No fue posible iniciar la cámara. Cierra otras aplicaciones que la usen o utiliza la cámara del dispositivo.");
    }
  }
  async function takePhoto(){
    const source=video.current;if(!source||!cameraReady||capturing.current)return;
    const cameraRequest=requestNumber.current;
    capturing.current=true;
    try{
      const vw=source.videoWidth,vh=source.videoHeight;if(!vw||!vh)throw new Error("La cámara aún no está lista. Espera un momento.");
      const width=Math.floor(Math.min(vw,vh*.75)),height=Math.floor(width/.75),canvas=document.createElement("canvas");
      canvas.width=width;canvas.height=height;
      const context=canvas.getContext("2d");if(!context)throw new Error("No fue posible capturar la foto. Usa la cámara del dispositivo.");
      context.drawImage(source,(vw-width)/2,(vh-height)/2,width,height,0,0,width,height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error("No se pudo guardar la foto. Vuelve a intentarlo.")),"image/jpeg",.97));
      if(!mounted.current||cameraRequest!==requestNumber.current)return;
      stopCamera();await chooseFile(new File([blob],"selfie-credencial.jpg",{type:"image/jpeg"}));
    }catch(reason){setCameraError(message(reason));}finally{capturing.current=false;}
  }
  async function send(){
    if(!candidate||!requirements||busy)return;setBusy(true);setError("");
    try{
      const body=new FormData();body.set("photo",candidate.file);body.set("previousId",submission?.id||"");body.set("requirementsAccepted","true");body.set("improveBackground",String(improve));
      for(const [key,value] of Object.entries(framing))body.set(key,String(value));
      const value=await api<CredentialState>("/portal/credential/photo-submission",{method:"POST",body});
      if(!mounted.current)return;onChange(value);setCandidate(null);setRequirements(false);
      if(objectUrl.current){URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;}
    }catch(reason){if(mounted.current)setError(message(reason));}finally{if(mounted.current)setBusy(false);}
  }
  return <section className="cred-selfie-panel">
    <div className="cred-panel-title"><Camera size={24}/><div><h3>Tu fotografía para la credencial</h3><p>Tómala con tu teléfono o elige una foto de tu galería.</p></div></div>
    <details ref={photoDetails} className="cred-photo-details" open={!state.canDownload||submission?.status==="pending"||submission?.status==="rejected"}><summary>{submission?.status==="pending"?"Consultar foto pendiente de revisión":"Tomar o cargar mi fotografía"}</summary>
    <div className="cred-selfie-intro"><figure className="cred-selfie-example"><img src="/assets/credential-selfie-example.png" alt="Ejemplo ilustrado: estudiante con uniforme blanco, de frente, rostro centrado y fondo blanco"/><SelfieGuide example/><figcaption>Así debe verse tu fotografía</figcaption></figure>
      <div className="cred-selfie-instructions"><span className="cred-eyebrow">ANTES DE TOMARLA</span><h4>De frente, con luz y fondo blanco</h4><ol><li><strong>Fondo totalmente blanco y uniforme.</strong> Sin objetos, texturas ni sombras marcadas.</li><li><strong>Usa tu uniforme escolar.</strong> Deben verse la cara completa y los hombros.</li><li><strong>Cámara a la altura de los ojos.</strong> Mira al frente y centra tu rostro en la guía.</li><li><strong>Luz frontal y foto nítida.</strong> Sin filtros que cambien tu rostro.</li></ol></div>
    </div>
    {submission&&!candidate&&<div className={`cred-submission-status cred-submission-${submission.status}`} role="status">{submission.status==="pending"?<Clock3 size={21}/>:submission.status==="approved"?<CheckCircle2 size={21}/>:<RefreshCw size={21}/>}<div><strong>{submission.status==="pending"?"Foto enviada · pendiente de revisión":submission.status==="approved"?"Fotografía aprobada por administración":"Tu foto necesita una corrección"}</strong><p>{submission.status==="pending"?"Administración revisará el fondo, el uniforme y el encuadre antes de publicar tu nueva credencial.":submission.status==="approved"?"La versión autorizada se muestra en tu credencial.":submission.reviewNote||"Envía una nueva fotografía que cumpla los requisitos."}</p>{submission.status==="pending"&&<button type="button" className="cred-text-button" onClick={onRefresh}>Consultar revisión</button>}</div>{sentPhoto&&<CredentialPortrait photo={sentPhoto} info={submission.photo} framing={submission.framing}/>}</div>}
    {error&&<div className="cred-error" role="alert">{error}</div>}
    <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={fileChanged} aria-label="Seleccionar fotografía de la galería"/>
    <input ref={nativeCamera} type="file" accept="image/*" capture="user" hidden onChange={fileChanged} aria-label="Tomar foto con la cámara del dispositivo"/>
    <div className="cred-selfie-actions"><Button variant="secondary" icon={<ImagePlus size={18}/>} disabled={busy||loading} onClick={()=>gallery.current?.click()}>Cargar desde galería</Button><Button icon={<Camera size={18}/>} disabled={busy||loading} onClick={()=>void openCamera()}>Tomar foto</Button></div>
    {loading&&<p className="cred-help" role="status">Preparando tu fotografía…</p>}
    {candidate&&<div className="cred-selfie-candidate"><div><CredentialPortrait photo={candidate.url} info={{width:candidate.width,height:candidate.height,sha256:""}} framing={framing}/><p className="cred-help">Este es el encuadre circular que llevará tu credencial. Tu rostro debe quedar al centro y sin recortar la cabeza.</p></div><div><CredentialCropControls value={framing} onChange={setFraming} disabled={busy}/><label className="cred-photo-check"><input type="checkbox" checked={improve} disabled={busy} onChange={e=>setImprove(e.target.checked)}/><span><Sun size={15}/> Aclarar automáticamente las zonas claras del fondo</span></label><p className="cred-help">La mejora no sustituye una pared blanca. Administración podrá comparar ambas versiones. Conservamos la resolución y el archivo que enviaste.</p><label className="cred-photo-check"><input type="checkbox" checked={requirements} disabled={busy} onChange={e=>setRequirements(e.target.checked)}/><span>Confirmo que la foto tiene fondo totalmente blanco, llevo uniforme y mi rostro está de frente y centrado.</span></label><div className="cred-action-row"><Button icon={<Send size={17}/>} busy={busy} disabled={!requirements||busy} onClick={()=>void send()}>Enviar a revisión</Button><Button variant="ghost" disabled={busy} icon={<X size={16}/>} onClick={()=>{setCandidate(null);if(objectUrl.current){URL.revokeObjectURL(objectUrl.current);objectUrl.current=null;}}}>Descartar</Button></div></div></div>}
    <p className="cred-selfie-review-note"><ShieldCheck size={17}/>La fotografía se aplicará y publicará cuando administración la apruebe. {state.canDownload?"Tu credencial actual sigue disponible durante la revisión.":"Podrás descargar tu credencial después de la aprobación."}</p>
    </details>
    <Modal open={cameraOpen} onClose={stopCamera} title="Toma tu foto para la credencial" size="small"><div className="cred-camera-stage"><video ref={video} autoPlay playsInline muted onLoadedData={()=>{if(video.current?.videoWidth&&stream.current)setCameraReady(true);}}/><SelfieGuide/>{!cameraReady&&!cameraError&&<div className="cred-camera-wait" role="status">Abriendo cámara… Autoriza el acceso si tu navegador lo solicita.</div>}</div><p className="cred-help">Coloca tu cara dentro del óvalo, alinea los ojos y mantén el teléfono a la altura de tu rostro. La guía no se imprime en tu foto.</p>{cameraError&&<div className="cred-error" role="alert">{cameraError}</div>}<div className="cred-camera-actions"><Button icon={<Camera size={17}/>} disabled={!cameraReady||Boolean(cameraError)} onClick={()=>void takePhoto()}>Capturar fotografía</Button><Button variant="secondary" onClick={()=>{stopCamera();nativeCamera.current?.click();}}>Abrir cámara del dispositivo</Button>{cameraError&&<button type="button" className="cred-text-button" onClick={()=>void openCamera()}>Reintentar cámara en vivo</button>}</div></Modal>
  </section>;
}
