import { EventSchemas, Inngest } from "inngest";

type Events = {
  /** Bir markanın günlük taramasını başlatır. */
  "brand/scan.requested": {
    data: {
      brandId: number;
      trigger: "cron" | "manual";
      /** Elle tetiklemede kimin başlattığı — /runs ekranında görünür. */
      requestedBy?: string;
    };
  };
  /** Fark analizi bir durum değişikliği bulduğunda yayınlanır. */
  "ad/change.detected": {
    data: {
      adArchiveId: string;
      type: "new_ad";
      brandId: number;
      runId: number;
    };
  };
  /**
   * Bir reklam durduğunda veya yeniden aktifleştiğinde yayınlanır.
   * `ad/change.detected`'tan AYRI tutulur: o olayı dinleyen notify-slack ve
   * sync-sheet-row "yeni reklam" mantığıyla çalışıyor — aynı olay paylaşılsa
   * durmuş bir reklam için yanlışlıkla "yeni reklam bulundu" mesajı giderdi.
   */
  "ad/status.changed": {
    data: {
      adArchiveId: string;
      isActive: boolean;
      brandId: number;
      runId: number;
    };
  };
  /**
   * Yeni bir reklam bulunduğunda Sheets senkronu için yayınlanır.
   * `ad/change.detected`'tan BİLEREK ayrı: o olay Slack'in "ani artış"
   * durumunda (§10 gürültü önlemi) hiç yayınlanmıyor — tek özet mesaj
   * gidiyor, tek tek olay yok. Sheets'in bu mantıktan etkilenmemesi,
   * bir taramada 25'ten fazla yeni reklam bulunsa bile HEPSİNİN Sheets'e
   * eklenmesi gerekir; bu yüzden ayrı bir olayla, burst kontrolünden önce
   * ve koşulsuz yayınlanır (scan-brand.ts).
   */
  "ad/sheet-sync.requested": {
    data: {
      adArchiveId: string;
      brandId: number;
      runId: number;
    };
  };
};

export const inngest = new Inngest({
  id: "rakip-reklam-takip",
  schemas: new EventSchemas().fromRecord<Events>(),
});
