import { config } from "@/lib/env";
import {
  sheetsConfigured,
  updateSheetRowStatus,
  SHEETS_WRITE_CONCURRENCY,
} from "@/lib/sheets";
import { inngest } from "../client";

/**
 * Bir reklam durduğunda/yeniden aktifleştiğinde Sheets'teki "Durum" hücresini
 * günceller. `sync-sheet-row` ile AYNI dosyaya yazar ama TAMAMEN BAĞIMSIZ
 * bir olayı (`ad/status.changed`) dinler — bkz. client.ts'teki açıklama.
 *
 * `SHEETS_WRITE_CONCURRENCY` limiti 1'e sabitlediği için hem Sheets API'nin
 * dakikalık kotasına takılmayı hem de `sync-sheet-row` ile aynı anda çalışıp
 * satırları birbirine karıştırmayı önlüyor (bkz. sheets.ts'teki açıklama).
 */
export const updateSheetStatus = inngest.createFunction(
  {
    id: "update-sheet-status",
    name: "Sheets durumunu güncelle",
    retries: config.retries,
    concurrency: [SHEETS_WRITE_CONCURRENCY],
  },
  { event: "ad/status.changed" },
  async ({ event, step }) => {
    const { adArchiveId, isActive } = event.data;

    if (!sheetsConfigured()) {
      return { adArchiveId, updated: false, reason: "sheets-not-configured" };
    }

    const updated = await step.run("update-row", () =>
      updateSheetRowStatus(adArchiveId, isActive),
    );

    return { adArchiveId, updated };
  },
);
