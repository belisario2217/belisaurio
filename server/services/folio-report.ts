import type { Response } from "express";
import { createPdf } from "./files.js";

type FolioRow = { physical_folio:string; paid_at:string; student_name:string; student_number:string;
  concept:string; amount:number; source:string; covered_months?:string };
export function sendFolioReport(res:Response, rows:FolioRow[], from:string|null) {
  const doc=createPdf(res,`folios-desde-${from||"0001"}.pdf`,{layout:"landscape"});
  const width=doc.page.width-84, money=(value:number)=>value.toLocaleString("es-MX",{style:"currency",currency:"MXN"});
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#172951").text(`Relación de folios${from?` desde ${from}`:""}`);
  doc.moveDown(.35).font("Helvetica").fontSize(9).fillColor("#50617A")
    .text(`Orden numérico ascendente · ${rows.length} registros · ${new Set(rows.map(row=>row.physical_folio)).size} folios distintos`);
  doc.text(`Ingresos registrados: ${money(rows.filter(row=>row.source==="payment").reduce((total,row)=>total+Number(row.amount),0))}. Las coberturas administrativas no se contabilizan como ingresos.`);
  doc.moveDown(.6);
  const widths=[55,75,85,178,236,79], headers=["Folio físico","Ingreso / fecha","Matrícula","Alumno","Concepto / meses cubiertos","Importe"];
  const tableRow=(cells:string[],header=false)=>{
    doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(8.5);
    const height=Math.max(27,...cells.map((value,index)=>doc.heightOfString(value,{width:widths[index]-12})+14));
    if(doc.y+height>doc.page.height-doc.page.margins.bottom){doc.addPage();tableRow(headers,true);}
    const top=doc.y;let x=42;
    cells.forEach((value,index)=>{
      if(header)doc.rect(x,top,widths[index],height).fill("#172951");
      else doc.rect(x,top,widths[index],height).fillAndStroke("#F5F7FB","#DEE5EF");
      doc.font(header?"Helvetica-Bold":"Helvetica").fontSize(8.5).fillColor(header?"#FFFFFF":"#263650")
        .text(value,x+6,top+7,{width:widths[index]-12});x+=widths[index];
    });doc.x=42;doc.y=top+height;
  };
  tableRow(headers,true);
  for(const row of rows){
    const months=row.covered_months?.split(", ")||[];
    const coverage=months.length>2?`${months[0]} a ${months.at(-1)} (${months.length} meses)`:months.join(", ");
    tableRow([row.physical_folio,row.paid_at,row.student_number,row.student_name,
    `${row.concept}${coverage?`\nCubre: ${coverage}`:""}${row.source!=="payment"?"\nRegistro manual, sin ingreso de caja vinculado":""}`,money(Number(row.amount))]);
  }
  if(!rows.length)doc.moveDown().font("Helvetica").fillColor("#263650").text("No hay folios registrados en el rango solicitado.",{width});
  doc.end();
}
