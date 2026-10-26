import type { Response } from "express";
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import type ExcelJS from "exceljs";
import { documentBranding, pdfLetterhead, workbookLetterhead } from "./document-branding.js";

export type TabularRow = Record<string, unknown>;

export function parseWorkbook(buffer: Buffer): TabularRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const name=workbook.Workbook?.Names?.find(item=>item.Name === "IFOP_DATA_HEADER" && (item.Ref.startsWith("'"+sheetName.replace(/'/g,"''")+"'!") || item.Ref.startsWith(sheetName+"!")));
  const headerRow=name?.Ref.match(/!\$?[A-Z]+\$?(\d+)$/)?.[1];
  return XLSX.utils.sheet_to_json<TabularRow>(workbook.Sheets[sheetName], {
    defval: "",
    range: headerRow ? Number(headerRow)-1 : 0,
    raw: false
  });
}

export async function sendWorkbook(res: Response, filename: string, sheetName: string, rows: TabularRow[]) {
  const {default: ExcelJS} = await import("exceljs");
  const brand=documentBranding(),workbook=new ExcelJS.Workbook();
  workbook.creator=brand.name;workbook.company=brand.name;workbook.created=new Date();
  const sheet=workbook.addWorksheet(sheetName.slice(0,31),{views:[{state:"frozen",ySplit:7,showGridLines:false}]});
  const headers=Object.keys(rows[0]??{}),last=Math.max(4,headers.length);
  for (let i=1;i<=last;i++) {
    let width=Math.max(i===1?16:22,(headers[i-1]??"").length+2);
    for (const row of rows) {
      if (width>=42) break;
      width=Math.max(width,String(row[headers[i-1]]??"").length+2);
    }
    sheet.getColumn(i).width=Math.min(42,width);
  }
  workbookLetterhead(workbook,sheet,filename.replace(/\.xlsx$/i,"").replace(/[-_]/g," "),last);
  sheet.getRow(7).values=headers.length?headers:["Sin registros"];
  sheet.getRow(7).eachCell(cell=>{cell.font={name:"Arial",bold:true,size:10,color:{argb:"FFFFFFFF"}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF172951"}};cell.alignment={wrapText:true,vertical:"middle"};});sheet.getRow(7).height=30;
  rows.forEach((record,index)=>{const row=sheet.getRow(index+8);row.values=headers.map(key=>record[key] as ExcelJS.CellValue);row.eachCell(cell=>{cell.font={name:"Arial",size:10};cell.alignment={vertical:"middle",wrapText:true};cell.border={bottom:{style:"hair",color:{argb:"FFDDE5F2"}}};});});
  workbook.definedNames.add(`'${sheet.name.replace(/'/g,"''")}'!$A$7`,"IFOP_DATA_HEADER");
  if(rows.length&&headers.length)sheet.autoFilter={from:{row:7,column:1},to:{row:7+rows.length,column:headers.length}};
  sheet.pageSetup.printArea=`A1:${sheet.getColumn(last).letter}${Math.max(8,7+rows.length)}`;
  const buffer=await workbook.xlsx.writeBuffer();
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").setHeader("Content-Disposition",`attachment; filename="${filename}"`).send(Buffer.from(buffer));
}

export function createPdf(res: Response, filename: string, options: PDFKit.PDFDocumentOptions = {}, letterhead = true) {
  const doc = new PDFDocument({ size: "LETTER", margin: 42, ...options });
  if(letterhead){doc.info.Author=documentBranding().name;doc.info.Title=filename.replace(/\.pdf$/i,"").replace(/[-_]/g," ");doc.page.margins.top=134;doc.page.margins.bottom=Math.max(70,doc.page.margins.bottom);doc.y=134;let page=0;
    const header=()=>{doc.page.margins.top=134;doc.page.margins.bottom=Math.max(70,doc.page.margins.bottom);doc.y=134;pdfLetterhead(doc,++page);};
    header();doc.on("pageAdded",header);
  }
  res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

export function pdfTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  widths?: number[]
) {
  const available = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const requestedWidths = widths ?? headers.map(() => available / headers.length);
  const totalWidth = requestedWidths.reduce((sum, width) => sum + width, 0);
  const columnWidths = requestedWidths.map(width => width * available / totalWidth);
  const drawRow = (cells: unknown[], header = false) => {
    const rowHeight = 24;
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (!header) drawRow(headers, true);
    }
    const y = doc.y;
    let x = doc.page.margins.left;
    cells.forEach((cell, index) => {
      if (header) doc.rect(x, y, columnWidths[index], rowHeight).fill("#102a43");
      else doc.rect(x, y, columnWidths[index], rowHeight).stroke("#d9e2ec");
      doc
        .fillColor(header ? "#ffffff" : "#243b53")
        .font(header ? "Helvetica-Bold" : "Helvetica")
        .fontSize(header ? 8 : 8)
        .text(String(cell ?? ""), x + 5, y + 7, {
          width: columnWidths[index] - 10,
          height: rowHeight - 8,
          ellipsis: true
        });
      x += columnWidths[index];
    });
    doc.y = y + rowHeight;
  };
  drawRow(headers, true);
  rows.forEach((row) => drawRow(row));
}
