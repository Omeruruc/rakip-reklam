/**
 * Apify actor çıktısını tek bir iç şemaya indirir.
 *
 * Projenin tek gerçek belirsizliği actor'ün hangi alan adlarıyla döndüğü
 * (MVP özeti §11 özet). Bu yüzden alanlar TEK TEK aday yol listeleriyle
 * aranır: actor değiştiğinde ya da yedek actor'e geçildiğinde
 * (APIFY_ACTOR_ID) kod değişmeden çalışmaya devam etmesi hedeflenir.
 *
 * Yeni bir actor denendiğinde `scripts/verify-actor.ts` hangi alanların
 * dolduğunu raporlar; eksik kalan alan için buraya aday yol eklenir.
 */

export type NormalizedAd = {
  adArchiveId: string;
  pageId: string | null;
  pageName: string | null;
  creativeText: string | null;
  creativeTitle: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  landingUrl: string | null;
  platforms: string[];
  startedAt: Date | null;
  isActiveOnMeta: boolean;
  raw: unknown;
};

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "snapshot.images.0.original_image_url" gibi yolları güvenle okur. */
function at(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isFinite(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isRec(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = at(source, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

const ID_PATHS = [
  "ad_archive_id",
  "adArchiveID",
  "adArchiveId",
  "adArchiveIdString",
  "archive_id",
  "archiveId",
  "adId",
  "ad_id",
  "snapshot.ad_archive_id",
  "id",
];

const PAGE_ID_PATHS = [
  "page_id",
  "pageId",
  "snapshot.page_id",
  "snapshot.pageId",
  "advertiser.page_id",
  "pageID",
];

const PAGE_NAME_PATHS = [
  "page_name",
  "pageName",
  "snapshot.page_name",
  "snapshot.current_page_name",
  "advertiser.page_name",
];

const TEXT_PATHS = [
  "snapshot.body.text",
  "snapshot.body.markup.__html",
  "snapshot.body",
  "ad_creative_body",
  "adCreativeBody",
  "snapshot.link_description",
  "body",
  "bodyText",
  "text",
  "adText",
  "description",
  "snapshot.cards.0.body",
];

const TITLE_PATHS = [
  "snapshot.title",
  "snapshot.link_title",
  "ad_creative_link_title",
  "title",
  "headline",
  "snapshot.cards.0.title",
];

const IMAGE_PATHS = [
  "snapshot.images.0.original_image_url",
  "snapshot.images.0.resized_image_url",
  "snapshot.cards.0.original_image_url",
  "snapshot.cards.0.resized_image_url",
  "snapshot.videos.0.video_preview_image_url",
  "snapshot.creatives.0.image_url",
  "image_url",
  "imageUrl",
  "thumbnailUrl",
  "thumbnail",
  "images.0.url",
  "images.0",
  "originalImageUrl",
];

const VIDEO_PATHS = [
  "snapshot.videos.0.video_hd_url",
  "snapshot.videos.0.video_sd_url",
  "snapshot.cards.0.video_hd_url",
  "video_url",
  "videoUrl",
  "videos.0.url",
  "videos.0",
];

const LANDING_PATHS = [
  "snapshot.link_url",
  "ad_creative_link_url",
  "link_url",
  "linkUrl",
  "snapshot.cards.0.link_url",
  "url",
];

const PLATFORM_PATHS = [
  "publisher_platform",
  "publisherPlatform",
  "publisher_platforms",
  "platforms",
  "snapshot.publisher_platform",
  "snapshot.platforms",
];

const START_PATHS = [
  "start_date",
  "startDate",
  "ad_delivery_start_time",
  "adDeliveryStartTime",
  "start_date_string",
  "startDateFormatted",
  "snapshot.creation_time",
  "created_time",
];

const ACTIVE_PATHS = ["is_active", "isActive", "active_status", "activeStatus"];

/** Meta platform adlarını sabit sözlüğe indirir. */
const PLATFORM_ALIASES: Record<string, string> = {
  facebook: "facebook",
  fb: "facebook",
  instagram: "instagram",
  ig: "instagram",
  messenger: "messenger",
  audience_network: "audience_network",
  audiencenetwork: "audience_network",
  an: "audience_network",
  whatsapp: "whatsapp",
  threads: "threads",
};

export const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  audience_network: "Audience Network",
  whatsapp: "WhatsApp",
  threads: "Threads",
};

function normalizePlatforms(source: unknown): string[] {
  const found = new Set<string>();
  for (const path of PLATFORM_PATHS) {
    const value = at(source, path);
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const key = candidate.trim().toLowerCase().replace(/[\s-]+/g, "_");
      const canonical = PLATFORM_ALIASES[key];
      if (canonical) found.add(canonical);
    }
  }
  return [...found];
}

/** Unix saniye/milisaniye, ISO metin ve "26.07.2026" biçimini kabul eder. */
export function parseAdDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    // 10 haneli => saniye, 13 haneli => milisaniye.
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  if (/^\d{9,13}$/.test(text)) return parseAdDate(Number.parseInt(text, 10));

  const dotted = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dotted) {
    const [, d, m, y] = dotted;
    const date = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseActive(source: unknown): boolean {
  for (const path of ACTIVE_PATHS) {
    const value = at(source, path);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "active" || text === "true") return true;
      if (text === "inactive" || text === "false") return false;
    }
  }
  // Sorgu active_status=active ile yapıldığı için varsayılan aktiftir.
  return true;
}

function cleanText(value: string | null): string | null {
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n")
    .trim();
  return text || null;
}

/** Tek kaydı normalize eder. Arşiv kimliği yoksa kayıt kullanılamaz -> null. */
export function normalizeAdRecord(raw: unknown): NormalizedAd | null {
  if (!isRec(raw)) return null;

  const adArchiveId = firstString(raw, ID_PATHS);
  if (!adArchiveId) return null;

  return {
    adArchiveId,
    pageId: firstString(raw, PAGE_ID_PATHS),
    pageName: firstString(raw, PAGE_NAME_PATHS),
    creativeText: cleanText(firstString(raw, TEXT_PATHS)),
    creativeTitle: cleanText(firstString(raw, TITLE_PATHS)),
    imageUrl: firstString(raw, IMAGE_PATHS),
    videoUrl: firstString(raw, VIDEO_PATHS),
    landingUrl: firstString(raw, LANDING_PATHS),
    platforms: normalizePlatforms(raw),
    startedAt: parseAdDate(
      START_PATHS.map((p) => at(raw, p)).find(
        (v) => v !== undefined && v !== null && v !== "",
      ),
    ),
    isActiveOnMeta: parseActive(raw),
    raw,
  };
}

/**
 * Dataset'in tamamını normalize eder; arşiv kimliği tekrar eden kayıtlar
 * teke indirilir (actor bazen aynı reklamı birden fazla kez döndürür).
 */
export function normalizeDataset(items: unknown[]): {
  ads: NormalizedAd[];
  skipped: number;
} {
  const byId = new Map<string, NormalizedAd>();
  let skipped = 0;

  for (const item of items) {
    const normalized = normalizeAdRecord(item);
    if (!normalized) {
      skipped++;
      continue;
    }
    const existing = byId.get(normalized.adArchiveId);
    if (!existing) {
      byId.set(normalized.adArchiveId, normalized);
      continue;
    }
    // Daha zengin kayıt kazanır (görseli/metni olan).
    const score = (a: NormalizedAd) =>
      (a.imageUrl ? 2 : 0) + (a.creativeText ? 1 : 0) + a.platforms.length;
    if (score(normalized) > score(existing)) {
      byId.set(normalized.adArchiveId, normalized);
    }
  }

  return { ads: [...byId.values()], skipped };
}

/** Actor çıktısının alan kapsamı — verify-actor betiği ve /runs ekranı için. */
export function fieldCoverage(ads: NormalizedAd[]): Record<string, number> {
  const keys: (keyof NormalizedAd)[] = [
    "adArchiveId",
    "pageId",
    "pageName",
    "creativeText",
    "creativeTitle",
    "imageUrl",
    "videoUrl",
    "landingUrl",
    "startedAt",
  ];
  const coverage: Record<string, number> = {};
  for (const key of keys) {
    coverage[key] = ads.filter((ad) => {
      const value = ad[key];
      return value !== null && value !== undefined && value !== "";
    }).length;
  }
  coverage.platforms = ads.filter((ad) => ad.platforms.length > 0).length;
  return coverage;
}
