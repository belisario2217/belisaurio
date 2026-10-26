import { createHash } from "node:crypto";
import { readPdfPages } from "./pdf-reader.js";
import * as XLSX from "xlsx";
import { all, get, run } from "../db.js";
import { ApiError } from "../utils.js";


import { curpBirthDate, curpMatchesName } from "./curp.js";

type Kind="students"|"grades";
export const importFields=[
  {key:"studentNumber",label:"Matrícula",aliases:["matricula","nocontrol","numerodecontrol","studentnumber"],kinds:["students","grades"]},
  {key:"firstName",label:"Nombre(s)",aliases:["nombres","nombre","firstname"],kinds:["students"]},
  {key:"lastName",label:"Apellido paterno",aliases:["apellidopaterno","paterno","lastname"],kinds:["students"]},
  {key:"secondLastName",label:"Apellido materno",aliases:["apellidomaterno","materno","secondlastname"],kinds:["students"]},
  {key:"fullName",label:"Nombre completo",aliases:["nombrecompleto","nombreyapellidos","alumno","alumnos"],kinds:["students"]},
  {key:"curp",label:"CURP",aliases:["curp","claveunicaderegistrodepoblacion"],kinds:["students"]},
  {key:"birthDate",label:"Fecha de nacimiento",aliases:["fechadenacimiento","fechanacimiento","nacimiento","dob"],kinds:["students"]},
  {key:"phone",label:"Teléfono",aliases:["telefono","telefonocelular","celular","movil","phone"],kinds:["students"]},
  {key:"email",label:"Correo",aliases:["correo","correoelectronico","email"],kinds:["students"]},
  {key:"program",label:"Programa",aliases:["programa","carrera","programadeestudios"],kinds:["students"]},
  {key:"shift",label:"Turno",aliases:["turno","horario"],kinds:["students"]},
  {key:"group",label:"Grupo",aliases:["grupo","grupoacademico"],kinds:["students","grades"]},
  {key:"cycle",label:"Ciclo escolar",aliases:["ciclo","cicloescolar"],kinds:["students"]},
  {key:"plan",label:"Plan académico",aliases:["plan","planacademico","plandeestudios"],kinds:["students"]},
  {key:"period",label:"Periodo del plan",aliases:["cuatrimestre","semestre","periododelplan"],kinds:["students"]},
  {key:"status",label:"Estatus",aliases:["estatus","estatusdealumno","estado"],kinds:["students"]},
  {key:"subject",label:"Materia",aliases:["materia","asignatura","clavemateria","codigomateria"],kinds:["grades"]},
  {key:"evaluation",label:"Periodo",aliases:["periodo","parcial","evaluacion"],kinds:["grades"]},
  {key:"score",label:"Calificación",aliases:["calificacion","calificacionfinal","promedio","nota"],kinds:["grades"]}
];
const normalize=(input:unknown)=>String(input??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
function suggestion(header:string,kind:Kind) {
  const text=normalize(header);if(!text)return {field:"",confidence:0};
  const matches=importFields.filter(f=>f.kinds.includes(kind)).flatMap(f=>f.aliases.map(a=>({field:f.key,confidence:text===a?1:text.includes(a)&&a.length>=5?a.length/text.length*.85:0}))).sort((a,b)=>b.confidence-a.confidence);
  return matches[0]?.confidence>=.55?matches[0]:{field:"",confidence:0};
}
function fingerprint(headers:string[],kind:Kind){return createHash("sha256").update(JSON.stringify({kind,headers:headers.map(normalize)})).digest("hex");}
function table(name:string,matrix:unknown[][],kind:Kind,userId:number) {
  const clean=matrix.filter(row=>row.some(v=>String(v??"").trim())).map(row=>row.slice(0,50).map(v=>v instanceof Date?v.toISOString().slice(0,10):String(v??"").trim()));
  if(!clean.length)return null;
  const possible=clean.slice(0,30).map((row,i)=>({i,score:row.reduce((n,h)=>n+Number(suggestion(h,kind).confidence>.7),0)})).sort((a,b)=>b.score-a.score);
  const headerIndex=possible[0]?.score?possible[0].i:-1;
  const headers=headerIndex>=0?clean[headerIndex]:Array.from({length:Math.max(...clean.slice(0,30).map(r=>r.length))},(_,i)=>`Columna ${i+1}`);
  const rows=clean.slice(headerIndex+1).filter(row=>row.some(Boolean));
  if(rows.length>2000)throw new ApiError(400,"Divide el archivo en cargas de hasta 2,000 filas por tabla.");
  const key=fingerprint(headers,kind),memory=get<any>("SELECT mapping_json,settings_json,uses FROM import_format_memory WHERE user_id=? AND kind=? AND fingerprint=?",userId,kind,key);
  const mapping=memory?JSON.parse(memory.mapping_json):headers.map(h=>suggestion(h,kind).field);
  return {name,headers,rows,fingerprint:key,mapping,confidence:headers.map(h=>suggestion(h,kind).confidence),learned:Boolean(memory),settings:memory?JSON.parse(memory.settings_json):{nameOrder:"none",surnames:2,dateFormat:"dmy",skipRows:0},uses:memory?.uses??0};
}
export async function readLearningFile(buffer:Buffer,filename:string,kind:Kind,userId:number){
  const extension=filename.split(".").at(-1)?.toLowerCase();let raw:Array<{name:string;matrix:unknown[][]}>=[];
  if(["xlsx","xls","csv"].includes(extension??"")){
    let workbook:XLSX.WorkBook;
    try{workbook=XLSX.read(buffer,{type:"buffer",cellDates:true,sheetRows:2030});}catch{throw new ApiError(400,"No se pudo leer la hoja. Guarda una copia de Excel o CSV válida.");}
    if(workbook.SheetNames.length>30)throw new ApiError(400,"El archivo tiene demasiadas pestañas. Divide la carga.");
    raw=workbook.SheetNames.map(name=>{const sheet=workbook.Sheets[name];if(sheet["!fullref"])throw new ApiError(400,"La hoja excede el límite de filas. Divide la carga para conservar todos los registros.");return {name,matrix:XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:""})};});
  }else if(extension==="docx"){
    const mammoth=await import("mammoth"),html=await mammoth.convertToHtml({buffer}),{parseFragment}=await import("parse5");
    const root:any=parseFragment(html.value),tables:any[]=[];
    const text=(node:any):string=>node.nodeName==="#text"?node.value:(node.childNodes??[]).map(text).join("")+(["p","br"].includes(node.tagName)?"\n":"");
    const visit=(node:any)=>{if(node.tagName==="table")tables.push(node);else for(const child of node.childNodes??[])visit(child);};visit(root);
    for(const [index,t]of tables.entries()){
      const matrix:unknown[][]=[];const rows=(node:any)=>{if(node.tagName==="tr")matrix.push((node.childNodes??[]).filter((c:any)=>["td","th"].includes(c.tagName)).map(text));else for(const child of node.childNodes??[])rows(child);};rows(t);raw.push({name:`Tabla ${index+1}`,matrix});
    }
    if(!raw.length)raw=[{name:"Texto del documento",matrix:text(root).split(/\n/).filter(Boolean).map(line=>[line])}];
  }else if(extension==="pdf"){
    if(buffer.subarray(0,5).toString()!=="%PDF-")throw new ApiError(400,"El archivo no contiene un PDF válido.");
    raw=await readPdfPages(buffer);
  }else throw new ApiError(400,"Usa Excel, CSV, Word (.docx) o PDF con texto seleccionable.");
  if(raw.length>40)throw new ApiError(400,"Divide el documento en menos tablas o páginas.");
  const tables=raw.map(t=>table(t.name,t.matrix,kind,userId)).filter(Boolean);
  if(!tables.length)throw new ApiError(400,"No se encontró texto legible. Los archivos escaneados requieren una versión con texto seleccionable.");
  return {tables,fields:importFields.filter(f=>f.kinds.includes(kind)),format:extension,mode:"internal-learning"};
}
function splitName(name:string,settings:any){
  const words=name.trim().split(/\s+/),particles=new Set(["DE","DEL","LA","LAS","LOS","EL","Y"]);
  if(settings.nameOrder==="first"){
    const take=()=>{const part=[words.pop()??""];while(words.length&&particles.has(words.at(-1)!.toUpperCase()))part.unshift(words.pop()!);return part.join(" ");};
    const second=settings.surnames===2?take():"",last=take();return {firstName:words.join(" "),lastName:last,secondLastName:second};
  }
  if(settings.nameOrder==="last"){
    const take=()=>{const part:string[]=[];while(words.length&&particles.has(words[0].toUpperCase()))part.push(words.shift()!);part.push(words.shift()??"");return part.join(" ");};
    const last=take(),second=settings.surnames===2?take():"";return {firstName:words.join(" "),lastName:last,secondLastName:second};
  }
  return {firstName:name,lastName:"",secondLastName:""};
}
export function prepareLearningRows(headers:string[],matrix:unknown[][],mapping:string[],settings:any,kind:Kind){
  if(!Array.isArray(headers)||headers.length>50||!Array.isArray(matrix)||matrix.length>2000||matrix.some(r=>!Array.isArray(r)||r.length>50)||!Array.isArray(mapping)||mapping.length!==headers.length)throw new ApiError(400,"La tabla o sus columnas no son válidas.");
  const fields=importFields.filter(f=>f.kinds.includes(kind));
  if(mapping.some(k=>k!==""&&!fields.some(f=>f.key===k))||new Set(mapping.filter(Boolean)).size!==mapping.filter(Boolean).length)throw new ApiError(400,"Asigna cada campo a una sola columna.");
  if(!["none","first","last"].includes(settings?.nameOrder)||![1,2].includes(settings?.surnames)||!["dmy","mdy","iso"].includes(settings?.dateFormat))throw new ApiError(400,"Las reglas de nombres o fechas no son válidas.");
  if(!Number.isInteger(settings.skipRows??0)||(settings.skipRows??0)<0||(settings.skipRows??0)>30)throw new ApiError(400,"Solo se pueden omitir hasta 30 filas de encabezado.");
  const changes:Array<{row:number;detail:string}>=[],issues:Array<{row:number;detail:string}>=[];
  const rows=matrix.slice(settings.skipRows??0).map((source,index)=>{
    const row:Record<string,string>={};mapping.forEach((field,i)=>{if(field){const value=String(source[i]??"");if(value.length>500)throw new ApiError(400,"Una celda excede el límite de 500 caracteres.");const trimmed=value.trim().replace(/\s+/g," ");row[field]=trimmed;if(trimmed!==value)changes.push({row:index+1,detail:"Se quitaron espacios innecesarios."});}});
    if(row.fullName&&!row.lastName){Object.assign(row,splitName(row.fullName,settings));if(settings.nameOrder!=="none")changes.push({row:index+1,detail:"Se separó el nombre usando el orden confirmado."});}
    if(settings.defaults&&typeof settings.defaults==="object")for(const f of fields)if(!row[f.key]||settings.replaceContext===true&&["program","shift","group","cycle","plan","period","status"].includes(f.key)){const value=String(settings.defaults[f.key]??"").trim();if(value.length>120)throw new ApiError(400,"Un dato del grupo excede el límite permitido.");if(value)row[f.key]=value;}
    if(row.curp){const before=row.curp;row.curp=row.curp.toUpperCase().replace(/\s/g,"");if(row.curp!==before)changes.push({row:index+1,detail:"Se normalizó la escritura de la CURP."});}
    if(row.phone){const before=row.phone;row.phone=row.phone.replace(/[(). -]/g,"");if(before!==row.phone)changes.push({row:index+1,detail:"Se quitaron separadores del teléfono."});if(!/^\+?\d{7,15}$/.test(row.phone))issues.push({row:index+1,detail:"Revisa el teléfono; no se inventaron ni completaron dígitos."});}
    if(row.birthDate&&/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(row.birthDate)&&settings.dateFormat!=="iso"){
      const [a,b,year]=row.birthDate.split(/[/-]/);const date=`${year}-${(settings.dateFormat==="dmy"?b:a).padStart(2,"0")}-${(settings.dateFormat==="dmy"?a:b).padStart(2,"0")}`;
      if(!Number.isNaN(new Date(date).getTime())&&new Date(date).toISOString().slice(0,10)===date){row.birthDate=date;changes.push({row:index+1,detail:"Se convirtió la fecha con el formato confirmado."});}else issues.push({row:index+1,detail:"La fecha de nacimiento no es válida."});
    }
    if(row.curp){const date=curpBirthDate(row.curp),matches=curpMatchesName(row.curp,row.firstName??"",row.lastName??"",row.secondLastName??"");if(date&&matches&&!row.birthDate){row.birthDate=date;changes.push({row:index+1,detail:"Se completó el nacimiento desde una CURP verificada."});}else if(!date||!matches||row.birthDate&&date!==row.birthDate)issues.push({row:index+1,detail:"La CURP o fecha necesita revisión; se conservaron los datos proporcionados."});}
    if(kind==="students"&&(!row.firstName||!row.lastName))issues.push({row:index+1,detail:"Confirma el nombre y apellido paterno antes de importar."});
    if(kind==="grades"&&(!row.studentNumber||!row.subject||!row.score||!/^\d+(\.\d+)?$/.test(row.score.replace(",","."))))issues.push({row:index+1,detail:"Faltan matrícula, materia o una calificación numérica."});
    const output:Record<string,string>={};for(const f of fields)if(f.key!=="fullName"&&row[f.key]!==undefined)output[f.label]=row[f.key];return output;
  });
  return {rows,changes,issues};
}
export function rememberFormat(userId:number,kind:Kind,headers:string[],mapping:string[],settings:any){
  prepareLearningRows(headers,[],mapping,settings,kind);
  const safeSettings={nameOrder:settings.nameOrder,surnames:settings.surnames,dateFormat:settings.dateFormat,skipRows:settings.skipRows??0};
  run("INSERT INTO import_format_memory(user_id,kind,fingerprint,mapping_json,settings_json) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind,fingerprint) DO UPDATE SET mapping_json=excluded.mapping_json,settings_json=excluded.settings_json,uses=import_format_memory.uses+1,confirmed_at=CURRENT_TIMESTAMP",userId,kind,fingerprint(headers,kind),JSON.stringify(mapping),JSON.stringify(safeSettings));
}
export function formatMemories(userId:number){return all("SELECT id,kind,uses,confirmed_at FROM import_format_memory WHERE user_id=? ORDER BY confirmed_at DESC",userId);}
