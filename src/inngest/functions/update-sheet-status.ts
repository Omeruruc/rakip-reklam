import { config } from "@/lib/env";
import { sheetsConfigured, updateSheetRowStatus } from "@/lib/sheets";
import { inngest } from "../client";

/**
 * Bir reklam durduğunda/yeniden aktifleştiğinde Sheets'teki "Durum" hücresini
 * günceller. `sync-sheet-row` ile AYNI dosyaya yazar ama TAMAMEN BAĞIMSIZ
 * bir olayı (`ad/status.changed`) dinler — bkz. client.ts'teki açıklama.
 *
 * Eşzamanlılık kasıtlı düşük tutuldu: bir taramada onlarca reklam birden
 * durursa Sheets API'nin dakikalık kotasına takılmamak için (bkz. backfill
 * script'inde yaşanan 429 hatası).
 */
export const updateSheetStatus = inngest.createFunction(
  {
    id: "update-sheet-status",
    name: "Sheets durumunu güncelle",
    retries: config.retries,
    concurrency: { limit: 2 },
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
