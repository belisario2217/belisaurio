import type { Response } from "express";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { setImmediate } from "node:timers/promises";
import PDFDocument from "pdfkit";
import { all, get } from "../db.js";
import { ApiError } from "../utils.js";
import { drawAccountStatementPages, type StatementAccountData, type StatementInstitutionSettings } from "./account-statement.js";
import { publicAppUrl, type IssuedDocument } from "./document-verification.js";

export function statementBatchRoster(groupId?: number) {
  if (groupId !== undefined && !get("SELECT id FROM groups WHERE id=?", groupId)) throw new ApiError(404, "No existe el grupo seleccionado.");
  return all<{ id: number; group_id: number; group_name: string }>(`SELECT st.id,g.id AS group_id,g.name AS group_name
    FROM students st JOIN enrollments e ON e.student_id=st.id AND e.is_active=1
    JOIN groups g ON g.id=e.group_id
    WHERE st.is_active=1 AND e.id=(SELECT MAX(latest.id) FROM enrollments latest WHERE latest.student_id=st.id AND latest.is_active=1)
      AND (? IS NULL OR g.id=?)
    ORDER BY spanish_sort(g.name),g.id,spanish_sort(st.last_name),spanish_sort(COALESCE(st.second_last_name,'')),spanish_sort(st.first_name),st.id`,
    groupId ?? null, groupId ?? null);
}

let preparingBatch = false;

/** Generate sequentially into a private temporary file, then send only the completed PDF. */
export async function sendBulkAccountStatements(
  res: Response, studentIds: number[], settings: StatementInstitutionSettings, filename: string,
  statement: (studentId: number) => Promise<{ data: StatementAccountData; official: IssuedDocument }>
) {
  if (preparingBatch) throw new ApiError(503, "Ya se está preparando otra descarga conjunta. Espera un momento y vuelve a intentarlo.");
  publicAppUrl(); // Reject missing public validation settings before issuing any document.
  preparingBatch = true;
  let ownsSlot = true;
  const release = () => { if (ownsSlot) { preparingBatch = false; ownsSlot = false; } };
  const controller = new AbortController();
  const cancel = () => { if (!res.writableFinished) controller.abort(); };
  res.once("close", cancel);
  let directory: string | undefined, doc: PDFKit.PDFDocument | undefined, writing: Promise<void> | undefined;
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), "ifop-statements-"));
    const file = path.join(directory, "estados-de-cuenta.pdf"); // Generated directory and fixed filename; no user-provided path.
    doc = new PDFDocument({ size: "LETTER", autoFirstPage: false, bufferPages: false, margins: { top: 36, bottom: 12, left: 36, right: 36 } });
    doc.info.Author = settings.institution_name; doc.info.Title = "Estados de cuenta de alumnos";
    const output = createWriteStream(file, { flags: "wx", mode: 0o600 });
    writing = pipeline(doc, output, { signal: controller.signal });
    let writeError: unknown;
    void writing.catch(error => { writeError = error; });
    for (const studentId of studentIds) {
      controller.signal.throwIfAborted();
      if (writeError) throw writeError;
      const { data, official } = await statement(studentId);
      controller.signal.throwIfAborted();
      doc.addPage();
      drawAccountStatementPages(doc, data, settings, official);
      await setImmediate(); // Allow regular requests and filesystem backpressure to progress between students.
      if (output.writableNeedDrain) await once(output, "drain", { signal: controller.signal });
    }
    doc.end(); await writing;
    controller.signal.throwIfAborted();
    release(); // The PDF is complete; its transfer does not hold the generation slot.
    await new Promise<void>((resolve, reject) => res.download(file, filename, error => error ? reject(error) : resolve()));
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    controller.abort();
    try {
      await writing?.catch(() => undefined);
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      res.removeListener("close", cancel);
      release();
    }
  }
}
