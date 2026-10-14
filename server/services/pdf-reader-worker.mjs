import { parentPort, workerData } from "node:worker_threads";
import { PDFParse } from "pdf-parse";

const parser=new PDFParse({data:new Uint8Array(workerData),isEvalSupported:false});
try{
  const info=await parser.getInfo();
  if(info.total>40)parentPort.postMessage({error:"Divide el PDF en documentos de hasta 40 páginas."});
  else{
    const result=await parser.getText();
    parentPort.postMessage({pages:result.pages.map(page=>({name:`Página ${page.num}`,matrix:page.text.split(/\r?\n/).filter(line=>line.trim()).map(line=>line.split(/\t+| {2,}/))}))});
  }
}catch{
  parentPort.postMessage({error:"No se pudo extraer el texto del PDF. Usa un documento sin protección y con texto seleccionable."});
}finally{
  await parser.destroy();
}
