/**
 * Ortam değişkenlerine tek giriş noktası.
 *
 * Kural: Slack webhook adresi ve Apify token'ı YALNIZCA burada okunur.
 * Veritabanına yazılmaz, istemciye (client component) hiçbir şekilde sızmaz.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Zorunlu ortam değişkeni eksik: ${name}. .env.example dosyasına bakın.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get authSecret() {
    return required("AUTH_SECRET");
  },
  get allowedEmails(): string[] {
    return optional("ALLOWED_EMAILS")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get authPassword() {
    return required("AUTH_PASSWORD");
  },
  get slackWebhookUrl() {
    return required("SLACK_WEBHOOK_URL");
  },
  /** Teknik alarm kanalı; tanımlı değilse ana kanala düşer. */
  get slackAlertWebhookUrl() {
    return optional("SLACK_ALERT_WEBHOOK_URL") || required("SLACK_WEBHOOK_URL");
  },
  get apifyToken() {
    return required("APIFY_TOKEN");
  },
  get apifyActorId() {
    return optional(
      "APIFY_ACTOR_ID",
      "curious_coder/facebook-ads-library-scraper",
    );
  },
  get apifyInputMode() {
    return optional("APIFY_INPUT_MODE", "urls");
  },
  /**
   * RAKİP BAŞINA azami reklam sayısı (actor girdisinde `limitPerSource`).
   *
   * Toplam sınır DEĞİLDİR. Toplam sınır kullanılırsa sıraya sonradan giren
   * rakiplerin reklamları hiç gelmez, fark analizi onları "taramada yok"
   * sanar ve yanlışlıkla DURMUŞ işaretler.
   *
   * Değeri düşürmek maliyeti düşürür; ama bu sayıdan fazla aktif reklamı olan
   * bir rakipte aynı yanlış "durdu" riskini doğurur. Maliyet reklam başına
   * ücretlendirildiği için sınır zaten yalnızca üst tavan görevi görür:
   * 5 reklamı olan rakip için 100 yazmak fazladan para ödetmez.
   */
  get apifyLimitPerSource() {
    return int("APIFY_LIMIT_PER_SOURCE", 100);
  },
  get apifyTimeoutSecs() {
    return int("APIFY_TIMEOUT_SECS", 900);
  },
  get appUrl() {
    return optional("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  /**
   * Tek taramada bu sayıdan fazla yeni reklam bulunursa tek tek mesaj yerine
   * tek bir toplu mesaj gönderilir. İlk taramanın kanalı boğmasını engeller
   * (§10 "bildirim gürültüsü" önlemi).
   */
  get notifyBurstLimit() {
    return int("NOTIFY_BURST_LIMIT", 25);
  },
  /**
   * Google Sheets entegrasyonu — TAMAMEN OPSİYONEL.
   *
   * Üçü de tanımlı değilse `sheetsConfigured()` false döner ve senkron
   * fonksiyonu sessizce atlanır (skipped); mevcut tarama/bildirim akışı
   * hiçbir şekilde etkilenmez. Kurulum adımları README §14'te.
   */
  get googleSheetsId() {
    return optional("GOOGLE_SHEETS_ID");
  },
  get googleServiceAccountEmail() {
    return optional("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  },
  /** Google Cloud Console'dan kopyalanan anahtardaki \n kaçışları çözülür. */
  get googleServiceAccountPrivateKey() {
    return optional("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");
  },
  get googleSheetsTabName() {
    return optional("GOOGLE_SHEETS_TAB_NAME", "Rakip Reklamlar");
  },
  /**
   * Slack pinleme betiği için — Incoming Webhook'tan AYRI bir mekanizma.
   * Webhook mesaj gönderir ama pinleyemez; pinlemek Bot Token (xoxb-...)
   * ve `chat:write` + `pins:write` kapsamı ister.
   */
  get slackBotToken() {
    return optional("SLACK_BOT_TOKEN");
  },
  get slackChannelId() {
    return optional("SLACK_CHANNEL_ID");
  },
} as const;

/** Sabit iş kuralları. */
export const config = {
  /** Yalnızca Türkiye reklamları taranır. */
  country: "TR",
  /** Ad Library sorgusu: tüm reklam türleri. */
  adType: "all",
  /** Bir markanın taramasında eşzamanlı Apify çalıştırma sayısı. */
  concurrency: 3,
  /** Apify hata verirse kaç kez denenir. */
  retries: 3,
} as const;
