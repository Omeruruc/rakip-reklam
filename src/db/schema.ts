import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Enum'lar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rakibin Facebook Page eşleştirme durumu.
 * YALNIZCA `matched` olanlar taranır (AC-04).
 */
export const matchStatusEnum = pgEnum("match_status", [
  "unverified",
  "matched",
  "no_page",
  "ignored",
]);

export const runStatusEnum = pgEnum("run_status", [
  "running",
  "completed",
  "failed",
]);

/** Bildirim türü. Aynı reklam için her tür yalnızca bir kez gönderilir. */
export const notificationTypeEnum = pgEnum("notification_type", [
  "new_ad",
  "stopped_ad",
]);

/* -------------------------------------------------------------------------- */
/* brands                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Marka (ör. İşbir Yatak). Slack webhook adresi BURADA TUTULMAZ —
 * tüm markalar tek kanala yazar, kanal adresi ortam değişkenindedir (AC-11).
 */
export const brands = pgTable(
  "brands",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("brands_name_unique").on(sql`lower(${t.name})`)],
);

/* -------------------------------------------------------------------------- */
/* dealers                                                                     */
/* -------------------------------------------------------------------------- */

export const dealers = pgTable(
  "dealers",
  {
    id: serial("id").primaryKey(),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 300 }).notNull(),
    city: varchar("city", { length: 100 }),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Excel'in tekrar yüklenmesi yeni kayıt üretmesin diye kimlik anahtarı (AC-03).
    uniqueIndex("dealers_brand_name_unique").on(t.brandId, t.name),
    index("dealers_brand_idx").on(t.brandId),
  ],
);

/* -------------------------------------------------------------------------- */
/* competitors                                                                 */
/* -------------------------------------------------------------------------- */

export const competitors = pgTable(
  "competitors",
  {
    id: serial("id").primaryKey(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 300 }).notNull(),
    /** instagram.com/xyz/ adresinden çıkarılan handle; küçük harfe indirilir. */
    instagramHandle: varchar("instagram_handle", { length: 200 }),
    /** Ad Library sorgusunun anahtarı. İnsan onayı ile doldurulur. */
    fbPageId: varchar("fb_page_id", { length: 64 }),
    /** Eşleştirme sırasında görülen sayfa adı — doğrulama izi. */
    fbPageName: varchar("fb_page_name", { length: 300 }),
    matchStatus: matchStatusEnum("match_status").notNull().default("unverified"),
    /** Eşleştirmeyi kim/ne zaman onayladı — sahte pozitif denetimi için. */
    matchedBy: varchar("matched_by", { length: 200 }),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("competitors_dealer_handle_unique").on(
      t.dealerId,
      t.instagramHandle,
    ),
    // Instagram'ı olmayan rakipler için ikinci kimlik anahtarı (AC-03).
    uniqueIndex("competitors_dealer_name_unique").on(t.dealerId, t.name),
    index("competitors_match_status_idx").on(t.matchStatus),
    index("competitors_fb_page_idx").on(t.fbPageId),
  ],
);

/* -------------------------------------------------------------------------- */
/* ads                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Meta Ad Library kaydı. Birincil anahtar Meta'nın verdiği arşiv kimliğidir —
 * mükerrer kayıt ve mükerrer bildirimi imkânsız kılar (AC-06).
 */
export const ads = pgTable(
  "ads",
  {
    adArchiveId: varchar("ad_archive_id", { length: 64 }).primaryKey(),
    competitorId: integer("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    creativeText: text("creative_text"),
    creativeTitle: text("creative_title"),
    imageUrl: text("image_url"),
    /** Meta CDN linkleri süreli; arşivleme kararı README soru 3. */
    videoUrl: text("video_url"),
    landingUrl: text("landing_url"),
    platforms: text("platforms").array().notNull().default(sql`'{}'::text[]`),
    /** Meta'nın bildirdiği yayın başlangıcı. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Bizim ilk gördüğümüz an — bildirim bu satır oluşurken gider. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
    /** Taramada artık görünmediği an. Veri asla silinmez, yalnızca pasife alınır. */
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** Ham actor çıktısı — actor şeması değişirse geçmişi kurtarır. */
    raw: text("raw"),
  },
  (t) => [
    index("ads_competitor_idx").on(t.competitorId),
    index("ads_active_idx").on(t.isActive),
    index("ads_first_seen_idx").on(t.firstSeenAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* scrape_runs                                                                 */
/* -------------------------------------------------------------------------- */

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: serial("id").primaryKey(),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("running"),
    /** Taramada dönen toplam reklam sayısı. 0 => arıza varsayımı (AC-07). */
    adsFound: integer("ads_found").notNull().default(0),
    newAds: integer("new_ads").notNull().default(0),
    stoppedAds: integer("stopped_ads").notNull().default(0),
    competitorsScanned: integer("competitors_scanned").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    error: text("error"),
    apifyRunId: varchar("apify_run_id", { length: 64 }),
    actorId: varchar("actor_id", { length: 200 }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("scrape_runs_brand_idx").on(t.brandId),
    index("scrape_runs_started_idx").on(t.startedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* notifications                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Gönderilmiş bildirim kaydı.
 * UNIQUE (ad_archive_id, type) => mükerrer bildirim imkânsız (AC-06, AC-08).
 * Satır Slack'e YAZMADAN ÖNCE eklenir (claim); ekleme çakışırsa mesaj gitmez.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    adArchiveId: varchar("ad_archive_id", { length: 64 })
      .notNull()
      .references(() => ads.adArchiveId, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("notifications_ad_type_unique").on(t.adArchiveId, t.type),
    index("notifications_created_idx").on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* sheet_syncs                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Google Sheets'e satır olarak aktarılmış reklam kaydı.
 *
 * `notifications` ile aynı "claim önce, yaz sonra" deseni: satır Sheets'e
 * YAZMADAN ÖNCE eklenir. UNIQUE (ad_archive_id) sayesinde aynı reklam iki kez
 * satır olarak eklenemez — Slack bildirimlerinden AYRI bir tabloda tutulur,
 * çünkü bu iki şey farklı hedeflere gider ve biri başarısız olsa diğerini
 * etkilememelidir.
 */
export const sheetSyncs = pgTable(
  "sheet_syncs",
  {
    id: serial("id").primaryKey(),
    adArchiveId: varchar("ad_archive_id", { length: 64 })
      .notNull()
      .references(() => ads.adArchiveId, { onDelete: "cascade" }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("sheet_syncs_ad_unique").on(t.adArchiveId),
    index("sheet_syncs_created_idx").on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* İlişkiler                                                                   */
/* -------------------------------------------------------------------------- */

export const brandsRelations = relations(brands, ({ many }) => ({
  dealers: many(dealers),
  runs: many(scrapeRuns),
}));

export const dealersRelations = relations(dealers, ({ one, many }) => ({
  brand: one(brands, { fields: [dealers.brandId], references: [brands.id] }),
  competitors: many(competitors),
}));

export const competitorsRelations = relations(competitors, ({ one, many }) => ({
  dealer: one(dealers, {
    fields: [competitors.dealerId],
    references: [dealers.id],
  }),
  ads: many(ads),
}));

export const adsRelations = relations(ads, ({ one, many }) => ({
  competitor: one(competitors, {
    fields: [ads.competitorId],
    references: [competitors.id],
  }),
  notifications: many(notifications),
  sheetSyncs: many(sheetSyncs),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  ad: one(ads, {
    fields: [notifications.adArchiveId],
    references: [ads.adArchiveId],
  }),
}));

export const sheetSyncsRelations = relations(sheetSyncs, ({ one }) => ({
  ad: one(ads, {
    fields: [sheetSyncs.adArchiveId],
    references: [ads.adArchiveId],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Tipler                                                                      */
/* -------------------------------------------------------------------------- */

export type Brand = typeof brands.$inferSelect;
export type Dealer = typeof dealers.$inferSelect;
export type Competitor = typeof competitors.$inferSelect;
export type Ad = typeof ads.$inferSelect;
export type NewAd = typeof ads.$inferInsert;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type SheetSync = typeof sheetSyncs.$inferSelect;
export type MatchStatus = (typeof matchStatusEnum.enumValues)[number];
