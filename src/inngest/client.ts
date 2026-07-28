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
};

export const inngest = new Inngest({
  id: "rakip-reklam-takip",
  schemas: new EventSchemas().fromRecord<Events>(),
});
