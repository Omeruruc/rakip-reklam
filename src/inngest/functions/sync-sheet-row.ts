import { config } from "@/lib/env";
import {
  buildSheetRow,
  appendCompetitorAdRow,
  sheetsConfigured,
  SHEETS_WRITE_CONCURRENCY,
} from "@/lib/sheets";
import {
  claimSheetSync,
  loadSheetSyncContext,
  markSheetSyncDone,
  releaseSheetSync,
} from "@/server/sheet-sync";
import { inngest } from "../client";

/**
 * Yeni rakip reklamını Google Sheets'e satır olarak ekler.
 *
 * `notify-slack`'in dinlediği `ad/change.detected`'tan BİLEREK AYRI bir olayı
 * (`ad/sheet-sync.requested`) dinler: Slack "ani artış" durumunda (§10
 * gürültü önlemi) o olayı hiç yayınlamıyor, tek özet mesaj gönderiyor — ama
 * Sheets'e HER yeni reklamın eklenmesi gerekiyor, burst sayısından bağımsız.
 * Aksi hâlde büyük bir taramada (örn. 25'ten fazla yeni reklam) hiçbiri
 * Sheets'e gitmezdi (gerçek üretimde yaşandı, bkz. scan-brand.ts).
 *
 * Bu ayrım sayesinde Slack gönderimi başarısız olsa bile Sheets satırı
 * eklenir, tersi de geçerlidir — ayrı tablolarda (notifications /
 * sheet_syncs) sahiplenildiği için birbirini bloklamaz.
 *
 * Google Sheets kurulmamışsa (üç ortam değişkeninden biri eksikse) sessizce
 * atlanır — mevcut tarama/bildirim akışını hiçbir şekilde etkilemez.
 */
export const syncSheetRow = inngest.createFunction(
  {
    id: "sync-sheet-row",
    name: "Google Sheets satırı ekle",
    retries: config.retries,
    concurrency: [
      { limit: 5, key: "event.data.adArchiveId" },
      SHEETS_WRITE_CONCURRENCY,
    ],
  },
  { event: "ad/sheet-sync.requested" },
  async ({ event, step }) => {
    const { adArchiveId } = event.data;

    if (!sheetsConfigured()) {
      return { adArchiveId, synced: false, reason: "sheets-not-configured" };
    }

    const claimed = await step.run("claim-sheet-sync", () =>
      claimSheetSync(adArchiveId),
    );

    if (!claimed) {
      // Daha önce eklenmiş: sessizce çık. Retry'lar buraya düşer.
      return { adArchiveId, synced: false, reason: "already-synced" };
    }

    const context = await step.run("load-context", () =>
      loadSheetSyncContext(adArchiveId),
    );

    if (!context) {
      await step.run("release-missing", () =>
        releaseSheetSync(adArchiveId, "Reklam kaydı bulunamadı."),
      );
      // Reklam kaydı yoksa yeniden denemek sonucu değiştirmez.
      return { adArchiveId, synced: false, reason: "ad-not-found" };
    }

    try {
      await step.run("append-row", () =>
        appendCompetitorAdRow(
          buildSheetRow({
            competitorName: context.competitorName,
            dealerName: context.dealerName,
            dealerCity: context.dealerCity,
            instagramHandle: context.instagramHandle,
            fbPageId: context.fbPageId,
            adArchiveId: context.adArchiveId,
            // step.run sonuçları JSON'dan geçer; Date nesneleri metne
            // dönüşür (bkz. notify-slack.ts'teki aynı desen).
            adDate: new Date(context.startedAt ?? context.firstSeenAt),
            isActive: true,
          }),
        ),
      );
    } catch (error) {
      // Tüm denemeler tükendi: sahiplenmeyi bırak ki satır "eklendi"
      // görünmesin ve elle yeniden tetiklenebilsin.
      await step.run("release-after-failure", () =>
        releaseSheetSync(
          adArchiveId,
          error instanceof Error ? error.message : String(error),
        ),
      );
      throw error;
    }

    await step.run("mark-synced", () => markSheetSyncDone(adArchiveId));

    return { adArchiveId, synced: true };
  },
);
