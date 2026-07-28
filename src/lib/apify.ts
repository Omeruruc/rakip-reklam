import { ApifyClient } from "apify-client";
import { config, env } from "./env";
import { adLibraryUrl } from "./adlibrary";

/**
 * Apify sarmalayıcı.
 *
 * Resmî Meta Ad Library API ticari reklam döndürmediği için tek veri kaynağı
 * budur (MVP özeti §2). Actor kimliği ortam değişkeninde tutulur: Meta arayüzü
 * değişip actor bozulduğunda yedek actor KOD DEĞİŞMEDEN devreye alınır.
 */

let client: ApifyClient | null = null;

function getClient(): ApifyClient {
  if (!client) client = new ApifyClient({ token: env.apifyToken });
  return client;
}

/** Actor'ün beklediği girdi biçimi. verify-actor betiği ile tespit edilir. */
export type InputMode = "urls" | "startUrls" | "pageIds";

/**
 * Actor girdisi.
 *
 * DİKKAT — sınır alanı seçimi kritik:
 *   `count`          = TÜM çalıştırma için toplam kayıt sınırı
 *   `limitPerSource` = her URL (yani her rakip) için sınır
 *
 * Toplu çalıştırmada `count` kullanılırsa, sınıra ilk ulaşan rakiplerden
 * sonrakilerin reklamları hiç gelmez; fark analizi onları "taramada yok"
 * sanıp DURMUŞ işaretler ve yanlış "reklam durdu" raporu üretir. Bu yüzden
 * rakip başına sınır (`limitPerSource`) kullanılır, toplam sınır KULLANILMAZ.
 *
 * Sıralama `most_recent`: sınıra takılan durumda en yeni reklamlar korunur.
 * Varsayılan `impressions_desc` olsaydı, yeni başlamış ve az gösterim almış
 * bir kampanya sınırın dışında kalabilir — tam olarak kaçırmak istemediğimiz
 * şey.
 *
 * `scrapeAdDetails` kapalı: yalnızca AB erişim (EU reach) bilgisi ekliyor,
 * bu sistemde kullanılmıyor; açık olması süreyi ve hata yüzeyini büyütür.
 */
export function buildActorInput(
  pageIds: string[],
  mode: InputMode = env.apifyInputMode as InputMode,
): Record<string, unknown> {
  const urls = pageIds.map((id) => adLibraryUrl(id));

  // Ülke ve aktiflik filtresi zaten Ad Library adresinin içinde; buradaki
  // alanlar actor'ün kendi arayüzü için ikinci bir güvence.
  const common = {
    limitPerSource: env.apifyLimitPerSource,
    scrapeAdDetails: false,
    "scrapePageAds.activeStatus": "active",
    "scrapePageAds.sortBy": "most_recent",
    "scrapePageAds.countryCode": config.country,
    "scrapePageAds.period": "",
  };

  switch (mode) {
    case "startUrls":
      return { ...common, startUrls: urls.map((url) => ({ url })) };
    case "pageIds":
      return { ...common, pageIds, country: config.country };
    case "urls":
    default:
      return { ...common, urls: urls.map((url) => ({ url })) };
  }
}

export type ApifyRunResult = {
  runId: string;
  actorId: string;
  items: unknown[];
  costUsd: number | null;
  status: string;
};

/**
 * Actor'ü çalıştırır ve dataset'in tamamını döndürür.
 * Marka başına tek toplu çalıştırma yapılır — maliyet kontrolü için.
 */
export async function runAdLibraryScrape(
  pageIds: string[],
  options: { actorId?: string; inputMode?: InputMode } = {},
): Promise<ApifyRunResult> {
  if (pageIds.length === 0) {
    throw new Error("Taranacak Page ID listesi boş.");
  }

  const actorId = options.actorId ?? env.apifyActorId;
  const input = buildActorInput(pageIds, options.inputMode);

  const run = await getClient()
    .actor(actorId)
    .call(input, { timeout: env.apifyTimeoutSecs, waitSecs: env.apifyTimeoutSecs });

  if (run.status !== "SUCCEEDED") {
    throw new Error(
      `Apify çalıştırması ${run.status} durumunda bitti (run ${run.id}).`,
    );
  }

  const { items } = await getClient().dataset(run.defaultDatasetId).listItems({
    clean: true,
  });

  return {
    runId: run.id,
    actorId,
    items,
    costUsd:
      typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null,
    status: run.status,
  };
}

/* -------------------------------------------------------------------------- */
/* Uzun süren çalıştırmalar: başlat + yokla                                    */
/* -------------------------------------------------------------------------- */

/**
 * Actor'ü başlatır ve BEKLEMEDEN döner.
 *
 * Inngest her step'i ayrı bir HTTP çağrısında yürüttüğü için Apify'ı
 * beklemek yerine başlatıp yoklamak gerekir; aksi halde tek step Vercel'in
 * istek süresi sınırını aşar.
 */
export async function startAdLibraryScrape(
  pageIds: string[],
  options: { actorId?: string; inputMode?: InputMode } = {},
): Promise<{ runId: string; actorId: string; input: Record<string, unknown> }> {
  if (pageIds.length === 0) {
    throw new Error("Taranacak Page ID listesi boş.");
  }
  const actorId = options.actorId ?? env.apifyActorId;
  const input = buildActorInput(pageIds, options.inputMode);
  const run = await getClient()
    .actor(actorId)
    .start(input, { timeout: env.apifyTimeoutSecs });
  return { runId: run.id, actorId, input };
}

export type ApifyRunStatus = {
  status: string;
  isTerminal: boolean;
  datasetId: string | null;
  costUsd: number | null;
};

const TERMINAL_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED-OUT",
  "ABORTED",
]);

export async function getApifyRunStatus(
  runId: string,
): Promise<ApifyRunStatus> {
  const run = await getClient().run(runId).get();
  if (!run) throw new Error(`Apify çalıştırması bulunamadı: ${runId}`);
  return {
    status: run.status,
    isTerminal: TERMINAL_STATUSES.has(run.status),
    datasetId: run.defaultDatasetId ?? null,
    costUsd: typeof run.usageTotalUsd === "number" ? run.usageTotalUsd : null,
  };
}

export async function fetchDatasetItems(datasetId: string): Promise<unknown[]> {
  const { items } = await getClient()
    .dataset(datasetId)
    .listItems({ clean: true });
  return items;
}

export async function abortApifyRun(runId: string): Promise<void> {
  try {
    await getClient().run(runId).abort();
  } catch {
    // Çalıştırma çoktan bitmişse hata yutulur.
  }
}

/**
 * Facebook sayfa adayları — eşleştirme ekranını beslemek için.
 *
 * Ayrı bir "page search" actor'ü kullanılabilir; tanımlı değilse boş liste
 * döner ve kullanıcı Page ID'yi elle girer. Eşleştirme insan onaylı olduğu
 * için bu aramanın eksik kalması sistemi durdurmaz (yalnızca yavaşlatır).
 */
export type PageCandidate = {
  pageId: string;
  name: string;
  category: string | null;
  likes: number | null;
  profilePicture: string | null;
  url: string | null;
  /** Son reklam tarihi — adaylar buna göre sıralanır (reklam vereni öne al). */
  lastAdAt: Date | null;
};

export function pageSearchActorId(): string | null {
  return process.env.APIFY_PAGE_SEARCH_ACTOR_ID || null;
}

export async function searchFacebookPages(
  query: string,
): Promise<PageCandidate[]> {
  const actorId = pageSearchActorId();
  if (!actorId) return [];

  const run = await getClient()
    .actor(actorId)
    .call({ query, searchQueries: [query], maxItems: 10, countryCode: "TR" }, {
      timeout: 180,
      waitSecs: 180,
    });

  if (run.status !== "SUCCEEDED") return [];

  const { items } = await getClient()
    .dataset(run.defaultDatasetId)
    .listItems({ clean: true, limit: 10 });

  const candidates: PageCandidate[] = [];
  for (const item of items) {
    const record = item as Record<string, unknown>;
    const pageId = pick(record, ["pageId", "page_id", "id"]);
    const name = pick(record, ["name", "pageName", "title"]);
    if (!pageId || !name) continue;
    const likesRaw = record.likes ?? record.followers ?? record.fanCount;
    candidates.push({
      pageId,
      name,
      category: pick(record, ["category", "categories"]),
      likes: typeof likesRaw === "number" ? likesRaw : null,
      profilePicture: pick(record, ["profilePictureUrl", "profilePic", "image"]),
      url: pick(record, ["url", "pageUrl", "link"]),
      lastAdAt: null,
    });
  }
  return candidates;
}

function pick(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}
