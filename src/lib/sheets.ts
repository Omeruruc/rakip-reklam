import { adLibraryAdUrl, adLibraryUrl, instagramProfileUrl } from "./adlibrary";
import { env } from "./env";
import { formatTrDate } from "./slack";

/**
 * Google Sheets entegrasyonu.
 *
 * Kullanıcının istediği yedi sabit kolon (§ konuşması):
 * Reklam Tarihi, Bizdeki hangi bayinin rakibi, Rakip Bayi İsmi, İl, İlçe,
 * URL, İnstagram Adresi.
 *
 * İlçe alanı şu an veri modelinde YOK (yalnızca İl tutuluyor) — bilerek
 * boş bırakılıyor; ileride eklenirse yalnızca `buildSheetRow` değişir.
 */

export const SHEET_HEADERS = [
  "Reklam Tarihi",
  "Bizdeki hangi bayinin rakibi",
  "Rakip Bayi İsmi",
  "İl",
  "İlçe",
  "URL",
  "İnstagram Adresi",
] as const;

export type SheetRowInput = {
  competitorName: string;
  dealerName: string;
  dealerCity: string | null;
  instagramHandle: string | null;
  fbPageId: string | null;
  adArchiveId: string;
  /** Meta'nın bildirdiği kampanya başlangıcı; yoksa ilk görülme anı verilir. */
  adDate: Date | null;
};

export type SheetRow = Record<(typeof SHEET_HEADERS)[number], string>;

/**
 * Satırı oluşturan SAF fonksiyon — ağ çağrısı yapmaz, test edilebilir.
 *
 * URL kolonu: Page ID varsa sayfanın Ad Library adresi (Slack mesajındaki
 * "Ad Library'de Aç" ile aynı bağlantı), yoksa reklamın kendi arşiv adresi.
 */
export function buildSheetRow(input: SheetRowInput): SheetRow {
  return {
    "Reklam Tarihi": formatTrDate(input.adDate),
    "Bizdeki hangi bayinin rakibi": input.dealerName,
    "Rakip Bayi İsmi": input.competitorName,
    İl: input.dealerCity ?? "",
    // Veri modelinde ilçe yok; sonradan eklenirse yalnızca burası değişir.
    İlçe: "",
    URL: input.fbPageId
      ? adLibraryUrl(input.fbPageId)
      : adLibraryAdUrl(input.adArchiveId),
    "İnstagram Adresi": input.instagramHandle
      ? instagramProfileUrl(input.instagramHandle)
      : "",
  };
}

export function sheetsConfigured(): boolean {
  return Boolean(
    env.googleSheetsId &&
      env.googleServiceAccountEmail &&
      env.googleServiceAccountPrivateKey,
  );
}

/**
 * Sheets'e tek satır ekler.
 *
 * Sekme yoksa oluşturulur ve başlık satırı yazılır. Sekme varsa başlık satırı
 * OLDUĞU GİBİ bırakılır — elle eklenmiş ek kolonları silmez; yalnızca sekme
 * tamamen boşsa (başlık satırı hiç yoksa) başlık yazılır.
 */
export async function appendCompetitorAdRow(row: SheetRow): Promise<void> {
  const { GoogleSpreadsheet } = await import("google-spreadsheet");
  const { JWT } = await import("google-auth-library");

  const auth = new JWT({
    email: env.googleServiceAccountEmail,
    key: env.googleServiceAccountPrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(env.googleSheetsId, auth);
  await doc.loadInfo();

  const tabName = env.googleSheetsTabName;
  const existing = doc.sheetsByTitle[tabName];

  const sheet = existing
    ? await ensureHeaderRow(existing)
    : await doc.addSheet({ title: tabName, headerValues: [...SHEET_HEADERS] });

  await sheet.addRow(row);
}

/**
 * Birden çok satırı TEK API çağrısında ekler (backfill için).
 *
 * `appendCompetitorAdRow`'u döngüde çağırmak her satır için ayrı bir
 * `loadInfo` (okuma) isteği ürettiğinden dakikalık Sheets API kotasını
 * hızla aşıyor — bu yüzden yükleme bir kez yapılır, satırlar toplu yazılır.
 */
export async function appendCompetitorAdRows(rows: SheetRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { GoogleSpreadsheet } = await import("google-spreadsheet");
  const { JWT } = await import("google-auth-library");

  const auth = new JWT({
    email: env.googleServiceAccountEmail,
    key: env.googleServiceAccountPrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(env.googleSheetsId, auth);
  await doc.loadInfo();

  const tabName = env.googleSheetsTabName;
  const existing = doc.sheetsByTitle[tabName];

  const sheet = existing
    ? await ensureHeaderRow(existing)
    : await doc.addSheet({ title: tabName, headerValues: [...SHEET_HEADERS] });

  await sheet.addRows(rows);
}

async function ensureHeaderRow<T extends { loadHeaderRow(): Promise<void>; setHeaderRow(values: string[]): Promise<void> }>(
  sheet: T,
): Promise<T> {
  try {
    await sheet.loadHeaderRow();
  } catch {
    // Sekme var ama başlık satırı hiç yok (boş sekme) — oluştur.
    await sheet.setHeaderRow([...SHEET_HEADERS]);
  }
  return sheet;
}
