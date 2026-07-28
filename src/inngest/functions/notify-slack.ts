import { NonRetriableError } from "inngest";
import { config } from "@/lib/env";
import { buildNewAdMessage, sendSlack } from "@/lib/slack";
import {
  claimNotification,
  loadNotificationContext,
  markNotificationSent,
  releaseNotification,
} from "@/server/scan";
import { inngest } from "../client";

/**
 * Tek reklam bildirimi.
 *
 * Sıra önemlidir: bildirim satırı Slack'e YAZMADAN ÖNCE "sahiplenilir".
 * UNIQUE (ad_archive_id, type) kısıtı ikinci sahiplenmeyi reddeder, böylece
 * aynı reklam için ikinci mesaj gönderilmesi imkânsız hale gelir (AC-06).
 * Eşzamanlı iki çalıştırma da yalnızca birini sahiplenebilir.
 */
export const notifySlack = inngest.createFunction(
  {
    id: "notify-slack",
    name: "Slack bildirimi gönder",
    retries: config.retries,
    // Aynı reklam için paralel çalıştırma olmasın.
    concurrency: { limit: 5, key: "event.data.adArchiveId" },
  },
  { event: "ad/change.detected" },
  async ({ event, step }) => {
    const { adArchiveId, type } = event.data;

    const claimed = await step.run("claim-notification", () =>
      claimNotification(adArchiveId, type),
    );

    if (!claimed) {
      // Daha önce bildirilmiş: sessizce çık. Retry'lar buraya düşer (AC-08).
      return { adArchiveId, sent: false, reason: "already-notified" };
    }

    const context = await step.run("load-context", () =>
      loadNotificationContext(adArchiveId),
    );

    if (!context) {
      await step.run("release-missing", () =>
        releaseNotification(adArchiveId, type, "Reklam kaydı bulunamadı."),
      );
      throw new NonRetriableError(
        `Bildirilecek reklam bulunamadı: ${adArchiveId}`,
      );
    }

    try {
      await step.run("send-slack", () =>
        sendSlack(
          buildNewAdMessage({
            brandName: context.brandName,
            dealerName: context.dealerName,
            dealerCity: context.dealerCity,
            competitorName: context.competitorName,
            instagramHandle: context.instagramHandle,
            fbPageId: context.fbPageId,
            adArchiveId: context.adArchiveId,
            startedAt: context.startedAt ? new Date(context.startedAt) : null,
            platforms: context.platforms,
            activeAdCount: context.activeAdCount,
            creativeText: context.creativeText,
            creativeTitle: context.creativeTitle,
            imageUrl: context.imageUrl,
          }),
        ),
      );
    } catch (error) {
      // Tüm denemeler tükendi: sahiplenmeyi bırak ki kayıt "gönderildi"
      // görünmesin ve elle yeniden tetiklenebilsin.
      await step.run("release-after-failure", () =>
        releaseNotification(
          adArchiveId,
          type,
          error instanceof Error ? error.message : String(error),
        ),
      );
      throw error;
    }

    await step.run("mark-sent", () => markNotificationSent(adArchiveId, type));

    return { adArchiveId, sent: true, brand: context.brandName };
  },
);
