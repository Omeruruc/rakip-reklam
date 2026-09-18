import { collectWeeklyDigest, markStoppedAdsReported } from "@/server/digest";
import { buildWeeklyDigestMessage, sendSlack } from "@/lib/slack";
import { config } from "@/lib/env";
import { inngest } from "../client";

/**
 * Pazartesi 09:00 (TR) — TÜM markaları kapsayan tek mesaj.
 * Duran reklamlar burada raporlanır; anlık bildirim üretmezler (§7).
 */
export const weeklyDigest = inngest.createFunction(
  { id: "weekly-digest", name: "Haftalık özet", retries: config.retries },
  { cron: "TZ=Europe/Istanbul 0 9 * * 1" },
  async ({ step }) => {
    const data = await step.run("collect", () => collectWeeklyDigest());

    // Aktif marka yoksa (proje pasife alınmışsa) sessizce çık — boş
    // "Aktif marka yok" mesajı her hafta gitmesin.
    if (data.brands.length === 0) {
      return { brands: 0, stoppedReported: 0, skipped: true };
    }

    await step.run("send", () =>
      sendSlack(
        buildWeeklyDigestMessage({
          periodStart: new Date(data.periodStart),
          periodEnd: new Date(data.periodEnd),
          brands: data.brands,
        }),
      ),
    );

    // Mesaj gittikten SONRA işaretlenir; gönderim başarısız olursa duran
    // reklamlar gelecek özette yine görünür.
    await step.run("mark-stopped-reported", () =>
      markStoppedAdsReported(data.stoppedAdIds),
    );

    return {
      brands: data.brands.length,
      stoppedReported: data.stoppedAdIds.length,
    };
  },
);
