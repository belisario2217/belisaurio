import type ExcelJS from "exceljs";
import path from "node:path";
import { get } from "../db.js";
import { institutionLogoFile } from "./institution-logo.js";

export function documentBranding() {
  const settings=get<{institution_name:string;logo_path:string|null;address:string|null;phone:string|null;email:string|null;footer_text:string|null;primary_color:string|null}>("SELECT institution_name,logo_path,address,phone,email,footer_text,primary_color FROM institution_settings WHERE id=1");
  return {name:settings?.institution_name||"Universidad IFOP",campus:"Campus Frontera",logo:institutionLogoFile(settings?.logo_path??null),address:settings?.address||"",contact:[settings?.phone,settings?.email].filter(Boolean).join(" · "),footer:settings?.footer_text||"",color:/^#[0-9a-f]{6}$/i.test(settings?.primary_color??"")?settings!.primary_color!:"#172951"};
}
export function workbookInstitutionLogo(workbook:ExcelJS.Workbook) {
  const logo=documentBranding().logo;
  return logo?workbook.addImage({filename:logo,extension:path.extname(logo).toLowerCase()===".png"?"png":"jpeg"}):null;
}
export function workbookLetterhead(workbook:ExcelJS.Workbook,sheet:ExcelJS.Worksheet,title:string,columns:number) {
  const brand=documentBranding(),last=Math.max(4,columns),argb="FF"+brand.color.slice(1).toUpperCase();
  sheet.mergeCells(1,1,3,1);
  const image=workbookInstitutionLogo(workbook);
  if(image!==null)sheet.addImage(image,{tl:{col:.12,row:.12},ext:{width:64,height:64}});
  for(const [row,text,size] of [[1,brand.name,17],[2,brand.campus,11],[3,[brand.address,brand.contact].filter(Boolean).join(" · "),9]] as const){
    sheet.mergeCells(row,2,row,last);const cell=sheet.getCell(row,2);cell.value=text;cell.font={name:"Arial",size,bold:row!==3,color:{argb}};cell.alignment={vertical:"middle",horizontal:"center",wrapText:true};sheet.getRow(row).height=row===1?30:24;
  }
  sheet.mergeCells(4,1,4,last);sheet.getCell(4,1).value=title;sheet.getCell(4,1).font={name:"Arial",size:13,bold:true,color:{argb:"FFFFFFFF"}};sheet.getCell(4,1).fill={type:"pattern",pattern:"solid",fgColor:{argb}};sheet.getCell(4,1).alignment={horizontal:"center",vertical:"middle"};sheet.getRow(4).height=28;
  sheet.mergeCells(5,1,5,last);sheet.getCell(5,1).value=`Fecha de emisión: ${new Date().toLocaleString("es-MX",{timeZone:"America/Mexico_City"})}`;sheet.getCell(5,1).font={name:"Arial",size:9,color:{argb:"FF5F7088"}};
  sheet.pageSetup={paperSize:1 as ExcelJS.PaperSize,orientation:last>6?"landscape":"portrait",fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:"1:7",margins:{left:.3,right:.3,top:.35,bottom:.5,header:.15,footer:.2}};
  sheet.headerFooter.oddFooter=`&L${brand.name} · ${brand.campus}&R Página &P de &N`;
}

/** Vector accents stay entirely inside the header and footer, clear of printed text. */
export function pdfInstitutionalVectors(doc: PDFKit.PDFDocument, color = documentBranding().color) {
  const width = doc.page.width, height = doc.page.height;
  doc.save();
  doc.moveTo(0, 0).lineTo(width, 0).lineTo(width, 12).lineTo(142, 12).lineTo(126, 5).lineTo(0, 5).closePath().fill(color);
  doc.moveTo(width - 92, 18).lineTo(width - 26, 18).lineTo(width, 44).lineTo(width, 78).closePath().fillOpacity(.07).fill(color);
  doc.fillOpacity(1).moveTo(0, height - 9).lineTo(width - 145, height - 9).lineTo(width - 126, height - 4)
    .lineTo(width, height - 4).lineTo(width, height).lineTo(0, height).closePath().fill(color);
  doc.restore();
}

export function pdfLetterhead(doc:PDFKit.PDFDocument,pageNumber:number) {
  const brand=documentBranding(),width=doc.page.width,left=doc.page.margins.left,right=doc.page.margins.right,available=width-left-right;
  const state={x:doc.x,y:doc.y,font:(doc as any)._font,size:(doc as any)._fontSize,bottom:doc.page.margins.bottom,fill:(doc as any)._fillColor,stroke:(doc as any)._strokeColor};
  doc.save();doc.page.margins.bottom=0;
  pdfInstitutionalVectors(doc, brand.color);
  if(brand.logo)doc.image(brand.logo,left,24,{fit:[64,64]});
  const textLeft=left+80,textWidth=Math.max(100,available-80);
  doc.fillColor(brand.color).font("Helvetica-Bold").fontSize(17).text(brand.name,textLeft,25,{width:textWidth,height:40,align:"center",ellipsis:true});
  doc.fontSize(11).text(brand.campus,textLeft,66,{width:textWidth,lineBreak:false,align:"center"});
  doc.fillColor("#5f7088").font("Helvetica").fontSize(8);
  if(brand.address)doc.text(brand.address,textLeft,83,{width:textWidth,height:12,align:"center",ellipsis:true});
  if(brand.contact)doc.text(brand.contact,textLeft,96,{width:textWidth,height:12,align:"center",ellipsis:true});
  doc.moveTo(left,116).lineTo(width-right,116).strokeColor(brand.color).lineWidth(1.5).stroke();
  doc.font("Helvetica").fontSize(7);
  const footerHeight=brand.footer?doc.heightOfString(brand.footer,{width:available}):0;
  const footerY=doc.page.height-Math.max(53,footerHeight+26);
  doc.moveTo(left,footerY-7).lineTo(width-right,footerY-7).strokeColor("#d6dfeb").lineWidth(.5).stroke();
  doc.fontSize(7).fillColor("#5f7088").text(`${brand.campus} · ${new Date().toLocaleDateString("es-MX",{timeZone:"America/Mexico_City"})}`,left,footerY,{lineBreak:false});
  doc.text(`Página ${pageNumber}`,width-right-75,footerY,{width:75,align:"right",lineBreak:false});
  if(brand.footer)doc.text(brand.footer,left,footerY+12,{width:available,align:"center"});
  doc.restore();doc.page.margins.bottom=Math.max(state.bottom,footerHeight+42);doc.x=state.x;doc.y=state.y;(doc as any)._font=state.font;(doc as any)._fontSize=state.size;(doc as any)._fillColor=state.fill;(doc as any)._strokeColor=state.stroke;
}
