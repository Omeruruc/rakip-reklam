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
 * Sheets'e tek satır ekler — başlığın hemen ALTINA (en üste).
 *
 * Kullanıcı en yeni reklamı en üstte görmek istiyor; bu yüzden alta eklemek
 * yerine başlığın altına bir satır açılıp oraya yazılıyor (bkz.
 * `appendCompetitorAdRows`, asıl mantık orada).
 */
export async function appendCompetitorAdRow(row: SheetRow): Promise<void> {
  await appendCompetitorAdRows([row]);
}

/**
 * Birden çok satırı TEK API çağrısında, tablonun EN ÜSTÜNE (başlığın hemen
 * altına) ekler — backfill'de olduğu kadar tekil eklemede de kullanılır.
 *
 * Neden "insert at top" ve neden ayrı bir istekle: google-spreadsheet'in
 * `addRow`/`addRows` fonksiyonu her zaman verinin ALTINA ekler; en yeni
 * satırı en üstte tutmak için önce boş satır(lar) açılır (`insertDimension`),
 * sonra o satırlara ham Sheets API'siyle yazılır — kolon eşlemesi sekmenin
 * GERÇEK başlık sırasına (`headerValues`) göre yapılır, kod içindeki
 * `SHEET_HEADERS` sırasına değil (ikisi farklıysa bile doğru çalışır).
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

  const headerValues = sheet.headerValues;
  const grid = rows.map((row) =>
    headerValues.map((header) => (row as Record<string, string>)[header] ?? ""),
  );

  // Başlığın (0. satır) hemen altına `rows.length` boş satır aç.
  await sheet.insertDimension(
    "ROWS",
    { startIndex: 1, endIndex: 1 + rows.length },
    false,
  );

  const lastColumn = columnLetter(headerValues.length);
  const writeRange = `${tabName}!A2:${lastColumn}${1 + rows.length}`;
  await auth.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetsId}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`,
    method: "PUT",
    data: { values: grid },
  });
}

function columnLetter(count: number): string {
  let n = count;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
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
