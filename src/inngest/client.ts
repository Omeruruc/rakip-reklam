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
};

export const inngest = new Inngest({
  id: "rakip-reklam-takip",
  schemas: new EventSchemas().fromRecord<Events>(),
});
