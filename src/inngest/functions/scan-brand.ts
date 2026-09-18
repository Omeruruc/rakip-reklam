import { NonRetriableError } from "inngest";
import {
  abortApifyRun,
  fetchDatasetItems,
  getApifyRunStatus,
  startAdLibraryScrape,
} from "@/lib/apify";
import { config, env } from "@/lib/env";
import {
  buildBurstMessage,
  buildTechAlertMessage,
  sendSlack,
  sendSlackAlert,
} from "@/lib/slack";
import {
  applyScanResults,
  attachApifyRun,
  claimNotifications,
  createRun,
  failRun,
  loadBurstSummary,
  loadScanTargets,
  markNotificationsSent,
} from "@/server/scan";
import { inngest } from "../client";

const POLL_INTERVAL_SECONDS = 30;

/**
 * Bir markanın taraması.
 *
 * Adımlar Apify'ı BEKLEMEZ; başlatır ve yoklar. Böylece her Inngest step'i
 * kısa kalır ve Vercel'in istek süresi sınırı sorun olmaz (MVP özeti §4).
 *
 * Geçici Apify hatasında fonksiyon yeniden denenir. Yeniden denemede
 * `attempt` değiştiği için step kimlikleri de değişir ve YENİ bir Apify
 * çalıştırması başlatılır — eski hatalı çalıştırma sonsuza dek yoklanmaz.
 * Mükerrer bildirim, notifications tablosundaki UNIQUE kısıtı ile
 * imkânsızdır (AC-08).
 */
export const scanBrand = inngest.createFunction(
  {
    id: "scan-brand",
    name: "Marka taraması",
    concurrency: { limit: config.concurrency },
    retries: config.retries,
    onFailure: async ({ event }) => {
      // Tüm denemeler tükendi: taramayı failed işaretle ve alarm gönder.
      const brandId = event.data.event.data.brandId as number;
      const { markBrandRunsFailed } = await import("@/server/scan-recovery");
      const detail =
        event.data.error?.message ?? "Bilinmeyen hata (tüm denemeler tükendi).";
      const runId = await markBrandRunsFailed(brandId, detail);
      await sendSlackAlert(
        buildTechAlertMessage({
          title: "Tarama başarısız — tüm denemeler tükendi",
          runId: runId ?? undefined,
          detail: `Marka #${brandId}: ${detail}\nHiçbir reklam pasife alınmadı, bildirim gönderilmedi.`,
        }),
      );
    },
  },
  { event: "brand/scan.requested" },
  async ({ event, step, attempt }) => {
    const { brandId } = event.data;

    const scanTargets = await step.run("load-targets", () =>
      loadScanTargets(brandId),
    );

    /* --- Marka pasif: sessizce çık, Apify'a HİÇ gidilmez -------------------
     * `triggerScan` zaten pasif markada reddediyor; bu ikinci katman, olay
     * başka bir yoldan (ör. ileride eklenecek bir entegrasyon) gönderilirse
     * de maliyetli bir çağrı yapılmasını engeller. Run kaydı bile açılmaz,
     * Slack'e de bir şey gitmez — bu bir arıza değil, kasıtlı bir duraklama.
     */
    if (!scanTargets.brandActive) {
      return {
        skipped: true,
        reason: `${scanTargets.brandName} pasif — tarama yapılmadı.`,
      };
    }

    const runId = await step.run("create-run", () =>
      createRun(brandId, env.apifyActorId),
    );

    /* --- Taranacak rakip yok: bu bir arıza değil, eksik eşleştirmedir ------ */
    if (scanTargets.targets.length === 0) {
      const detail =
        `${scanTargets.brandName} için eşleştirilmiş (matched) rakip yok. ` +
        `Eşleştirme bekleyen: ${scanTargets.pendingMatch}.`;
      await step.run("fail-no-targets", () => failRun(runId, detail));
      await step.run("alert-no-targets", () =>
        sendSlackAlert(
          buildTechAlertMessage({
            title: "Taranacak rakip yok",
            brandName: scanTargets.brandName,
            runId,
            detail,
          }),
        ),
      );
      return { runId, skipped: true, reason: detail };
    }

    const pageIds = scanTargets.targets.map((t) => t.fbPageId);

    /* --- Apify: başlat ----------------------------------------------------- */
    const started = await step.run(`start-apify-${attempt}`, async () => {
      const result = await startAdLibraryScrape(pageIds);
      await attachApifyRun(runId, result.runId);
      return { runId: result.runId, actorId: result.actorId };
    });

    /* --- Apify: yokla ------------------------------------------------------ */
    const maxPolls = Math.min(
      Math.ceil(env.apifyTimeoutSecs / POLL_INTERVAL_SECONDS) + 2,
      60,
    );

    let status = await step.run(`poll-apify-${attempt}-0`, () =>
      getApifyRunStatus(started.runId),
    );

    for (let i = 1; i < maxPolls && !status.isTerminal; i++) {
      await step.sleep(
        `wait-apify-${attempt}-${i}`,
        `${POLL_INTERVAL_SECONDS}s`,
      );
      status = await step.run(`poll-apify-${attempt}-${i}`, () =>
        getApifyRunStatus(started.runId),
      );
    }

    if (!status.isTerminal) {
      await step.run(`abort-apify-${attempt}`, () =>
        abortApifyRun(started.runId),
      );
      // Zaman aşımı geçici bir arıza sayılır: yeniden denenir.
      throw new Error(
        `Apify çalıştırması ${started.runId} zaman aşımına uğradı (durum: ${status.status}).`,
      );
    }

    if (status.status !== "SUCCEEDED") {
      throw new Error(
        `Apify çalıştırması ${started.runId} ${status.status} ile bitti.`,
      );
    }

    if (!status.datasetId) {
      throw new NonRetriableError(
        `Apify çalıştırması ${started.runId} dataset döndürmedi.`,
      );
    }

    /* --- Maliyetin kesinleşmesini bekle -------------------------------------
     * Apify, çalıştırma SUCCEEDED olduğu anda usageTotalUsd'yi henüz
     * kesinleştirmemiş olabiliyor (faturalama kısa bir gecikmeyle oturuyor).
     * Terminal algılandığı andaki `status.costUsd` bu yüzden güvenilir değil
     * — gözlemlenen fark birkaç kat olabiliyor. Kısa bir bekleme sonrası
     * yeniden okumak gerçek (kesinleşmiş) maliyeti yakalar.
     */
    await step.sleep(`settle-cost-${attempt}`, "10s");
    const settledCost = await step.run(`refetch-cost-${attempt}`, () =>
      getApifyRunStatus(started.runId),
    );

    /* --- Normalize + fark analizi + yazma (tek step) ----------------------- */
    // Dataset step çıktısı olarak taşınmaz: büyük veri step sınırlarını aşar.
    const result = await step.run(`apply-results-${attempt}`, async () => {
      const items = await fetchDatasetItems(status.datasetId!);
      return applyScanResults({
        brandId,
        runId,
        items,
        targets: scanTargets.targets,
        scannedPageIds: pageIds,
        costUsd: settledCost.costUsd ?? status.costUsd,
      });
    });

    /* --- KURAL 2: sıfır sonuç = arıza (AC-07) ------------------------------ */
    if (!result.ok) {
      const detail = result.reason ?? "Tarama sonucu geçersiz.";
      await step.run("fail-zero-result", () =>
        failRun(runId, detail, {
          adsFound: 0,
          costUsd: settledCost.costUsd ?? status.costUsd,
        }),
      );
      await step.run("alert-zero-result", () =>
        sendSlackAlert(
          buildTechAlertMessage({
            title: "Sıfır sonuç — scraper arızası varsayıldı",
            brandName: scanTargets.brandName,
            runId,
            detail:
              `${detail}\n` +
              `Actor: ${started.actorId}\nApify run: ${started.runId}\n` +
              "Hiçbir reklam pasife alınmadı, hiçbir bildirim gönderilmedi.",
          }),
        ),
      );
      return { runId, ok: false, reason: detail };
    }

    /* --- Atanamayan kayıt uyarısı ----------------------------------------- */
    if (result.unattributed > 0) {
      await step.run("alert-unattributed", () =>
        sendSlackAlert(
          buildTechAlertMessage({
            title: "Bazı reklamlar bir rakibe atanamadı",
            brandName: scanTargets.brandName,
            runId,
            detail:
              `${result.unattributed} kayıt page_id ile eşleşmedi ve yok sayıldı. ` +
              "Actor page_id döndürmüyorsa APIFY_INPUT_MODE / actor değişikliği gerekir.",
          }),
        ),
      );
    }

    /* --- Sheets durum güncellemesi (durdu / yeniden aktif) ------------------
     * Slack bildirimlerinden AYRI bir olay üzerinden yürür (bkz. client.ts) —
     * yalnızca Sheets kurulu ise `update-sheet-status` bir şey yapar.
     */
    const statusChanges = [
      ...result.stoppedAdIds.map((adArchiveId) => ({
        adArchiveId,
        isActive: false as const,
      })),
      ...result.reactivatedAdIds.map((adArchiveId) => ({
        adArchiveId,
        isActive: true as const,
      })),
    ];
    if (statusChanges.length > 0) {
      await step.sendEvent(
        "emit-status-changes",
        statusChanges.map(({ adArchiveId, isActive }) => ({
          name: "ad/status.changed" as const,
          data: { adArchiveId, isActive, brandId, runId },
        })),
      );
    }

    /* --- Bildirimler ------------------------------------------------------- */
    const newAdIds = result.newAdIds;

    if (newAdIds.length === 0) {
      return { runId, ok: true, ...summary(result) };
    }

    /* --- Sheets senkronu: burst'ten BAĞIMSIZ, HER zaman ---------------------
     * Aşağıdaki burst kontrolü yalnızca Slack bildirimini tek özet mesaja
     * indirger (§10) — Sheets'in bundan etkilenip reklamları atlaması hatalı
     * olur (gerçek üretimde yaşandı: 264 yeni reklamlık bir tarama burst
     * eşiğini aştı, Slack özet mesajı gitti ama hiçbiri Sheets'e eklenmedi).
     * Bu yüzden Sheets olayı burst dalından ÖNCE ve koşulsuz gönderilir.
     */
    await step.sendEvent(
      "emit-sheet-sync",
      newAdIds.map((adArchiveId) => ({
        name: "ad/sheet-sync.requested" as const,
        data: { adArchiveId, brandId, runId },
      })),
    );

    // Ani artış: tek tek mesaj yerine tek toplu mesaj (§10 gürültü önlemi).
    if (newAdIds.length > env.notifyBurstLimit) {
      await step.run("notify-burst", async () => {
        const claimed = await claimNotifications(newAdIds, "new_ad");
        if (claimed.length === 0) return { sent: 0 };
        const byCompetitor = await loadBurstSummary(claimed);
        await sendSlack(
          buildBurstMessage({
            brandName: scanTargets.brandName,
            totalNewAds: claimed.length,
            byCompetitor,
          }),
        );
        await markNotificationsSent(claimed, "new_ad");
        return { sent: claimed.length };
      });
      return { runId, ok: true, burst: true, ...summary(result) };
    }

    await step.sendEvent(
      "emit-ad-changes",
      newAdIds.map((adArchiveId) => ({
        name: "ad/change.detected" as const,
        data: { adArchiveId, type: "new_ad" as const, brandId, runId },
      })),
    );

    return { runId, ok: true, ...summary(result) };
  },
);

function summary(result: {
  adsFound: number;
  newAdIds: string[];
  stoppedCount: number;
  unchangedCount: number;
  competitorsScanned: number;
  coverage: Record<string, number>;
}) {
  return {
    adsFound: result.adsFound,
    newAds: result.newAdIds.length,
    stoppedAds: result.stoppedCount,
    unchanged: result.unchangedCount,
    competitorsScanned: result.competitorsScanned,
    coverage: result.coverage,
  };
}
