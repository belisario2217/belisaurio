import { Worker } from "node:worker_threads";
import { ApiError } from "../utils.js";

export type PdfPage = {name: string; matrix: unknown[][]};

// One parser at a time on the shared Render instance, plus two waiting uploads.
// This bounds both worker heaps and the buffers retained by pending requests.
let scheduled = 0;
let tail: Promise<void> = Promise.resolve();

export function readPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  if (scheduled >= 3) return Promise.reject(new ApiError(503, "Se están leyendo varios documentos. Espera unos segundos y vuelve a intentarlo."));
  scheduled++;
  const task = tail.then(() => parsePdf(buffer));
  // The queue must not retain the pages from the most recently parsed PDF.
  tail = task.then(() => undefined, () => undefined);
  return task.finally(() => { scheduled--; });
}

async function parsePdf(buffer: Buffer): Promise<PdfPage[]> {
  const worker = new Worker(new URL("./pdf-reader-worker.mjs", import.meta.url), {
    workerData: buffer, execArgv: [], resourceLimits: {maxOldGenerationSizeMb:128, maxYoungGenerationSizeMb:32}
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<PdfPage[]>((resolve, reject) => {
      timer = setTimeout(() => reject(new ApiError(408, "El PDF tardó demasiado en leerse. Divide el documento o usa una hoja de cálculo.")), 15000);
      worker.once("message", result => result.error ? reject(new ApiError(400, result.error)) : resolve(result.pages));
      worker.once("error", () => reject(new ApiError(400, "El PDF excede los límites de lectura o no es válido.")));
      worker.once("exit", () => reject(new ApiError(400, "No se pudo terminar la lectura del PDF.")));
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
