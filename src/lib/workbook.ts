import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { cell, detectHeaderRow, suggestMapping } from "./excel";
import type { SheetPreview } from "./excel-types";

/** SheetJS yalnızca sunucuda çalışır — bu modül istemciye import edilmez. */

export type LoadedSheet = {
  sheetNames: string[];
  sheetName: string;
  matrix: (string | null)[][];
  headerRowIndex: number;
  headers: (string | null)[];
  /** Dosya içeriğinin parmak izi: önizleme ile onay aynı dosya mı? */
  fileHash: string;
};

const MAX_ROWS = 20_000;

export function loadSheet(buffer: Buffer, sheetName?: string): LoadedSheet {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error("Dosyada hiç sayfa (sheet) bulunamadı.");
  }

  const chosen =
    sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const sheet = workbook.Sheets[chosen];

  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: false,
  });

  if (raw.length > MAX_ROWS) {
    throw new Error(
      `Dosya çok büyük (${raw.length} satır). Azami ${MAX_ROWS} satır işlenebilir.`,
    );
  }

  const matrix = raw.map((row) => (row ?? []).map((c) => cell(c)));
  const headerRowIndex = detectHeaderRow(matrix);
  const headers = matrix[headerRowIndex] ?? [];

  return {
    sheetNames,
    sheetName: chosen,
    matrix,
    headerRowIndex,
    headers,
    fileHash: createHash("sha256").update(buffer).digest("hex").slice(0, 16),
  };
}

export function buildSheetPreview(loaded: LoadedSheet): SheetPreview {
  const dataRows = loaded.matrix.slice(loaded.headerRowIndex + 1);
  return {
    sheetNames: loaded.sheetNames,
    sheetName: loaded.sheetName,
    headerRowIndex: loaded.headerRowIndex,
    headers: loaded.headers.map((h, i) => h ?? `Kolon ${i + 1}`),
    sampleRows: dataRows.slice(0, 8),
    totalRows: dataRows.length,
    suggestedMapping: suggestMapping(loaded.headers),
  };
}
