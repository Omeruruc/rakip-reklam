import { adLibraryAdUrl, adLibraryUrl, instagramProfileUrl } from "./adlibrary";
import { env } from "./env";
import { formatTrDate } from "./slack";

/**
 * Google Sheets entegrasyonu.
 *
 * Sabit kolonlar (§ konuşması): Reklam Tarihi, Durum, Bizdeki hangi bayinin
 * rakibi, Rakip Bayi İsmi, İl, İlçe, URL, İnstagram Adresi, Reklam ID.
 *
 * İlçe alanı şu an veri modelinde YOK (yalnızca İl tutuluyor) — bilerek
 * boş bırakılıyor; ileride eklenirse yalnızca `buildSheetRow` değişir.
 *
 * "Reklam ID" teknik bir kolon: bir reklam sonradan durduğunda/yeniden
 * aktifleştiğinde `updateSheetRowStatus`'un doğru satırı bulabilmesi için
 * gerekli — URL kolonu bu iş için kullanılamaz çünkü sayfa linki (Page ID
 * varsa) birden fazla reklamda aynı olabiliyor.
 */

export const SHEET_HEADERS = [
  "Reklam Tarihi",
  "Durum",
  "Bizdeki hangi bayinin rakibi",
  "Rakip Bayi İsmi",
  "İl",
  "İlçe",
  "URL",
  "İnstagram Adresi",
  "Reklam ID",
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
  isActive: boolean;
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
    Durum: input.isActive ? "Aktif" : "Durduruldu",
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
    "Reklam ID": input.adArchiveId,
  };
}

/**
 * Sheets'e yazan TÜM Inngest fonksiyonlarının (sync-sheet-row,
 * update-sheet-status) paylaştığı eşzamanlılık kilidi — aynı anda yalnızca
 * BİR tanesi çalışabilir. `appendCompetitorAdRows` artık tek `batchUpdate`
 * ile atomik yazsa da, bir satır EKLEME (insertDimension) ile bir DURUM
 * GÜNCELLEME (satırı bul, tek hücre yaz) aynı anda çalışırsa güncelleme
 * hâlâ yanlış satıra yazabilir (satır numarası okunduktan sonra kaymışsa) —
 * bu kilit iki farklı fonksiyon türü arasındaki bu riski de kapatır.
 * `scope: "env"` limiti fonksiyon bazında değil, tüm ortamda uygular.
 */
export const SHEETS_WRITE_CONCURRENCY = {
  limit: 1,
  key: '"sheets-write"',
  scope: "env",
} as const;

export function sheetsConfigured(): boolean {
  return Boolean(
    env.googleSheetsId &&
      env.googleServiceAccountEmail &&
      env.googleServiceAccountPrivateKey,
  );
}

async function getAuth() {
  const { JWT } = await import("google-auth-library");
  return new JWT({
    email: env.googleServiceAccountEmail,
    key: env.googleServiceAccountPrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
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
 * Neden "insert at top": google-spreadsheet'in `addRow`/`addRows` fonksiyonu
 * her zaman verinin ALTINA ekler; en yeni satırı en üstte tutmak için önce
 * boş satır(lar) açılıp oraya yazılıyor. Kolon eşlemesi sekmenin GERÇEK
 * başlık sırasına (`headerValues`) göre yapılır, kod içindeki `SHEET_HEADERS`
 * sırasına değil (ikisi farklıysa bile doğru çalışır).
 *
 * Neden TEK `batchUpdate` isteği (satır açma + yazma AYRI çağrılar DEĞİL):
 * bu iki adım önceden iki ayrı HTTP isteğiydi. Aynı anda birden fazla yeni
 * reklam Sheets'e ekleniyorsa (bir taramada birkaç reklam birden bulunduğunda
 * olağan), araya giren başka bir çağrının kendi satır açma isteği ikisinin
 * arasına girip satırları kaydırabiliyordu — gözlemlenen boş satırlar ve
 * karışık tarih sırasının gerçek nedeni buydu. Google, TEK `batchUpdate`
 * içindeki istekleri atomik uygular; araya başka bir isteğin girmesi
 * mümkün değil. Ayrıca bkz. `syncSheetWrites` (Inngest tarafında ek kilit).
 */
export async function appendCompetitorAdRows(rows: SheetRow[]): Promise<void> {
  if (rows.length === 0) return;

  const { GoogleSpreadsheet } = await import("google-spreadsheet");
  const auth = await getAuth();

  const doc = new GoogleSpreadsheet(env.googleSheetsId, auth);
  await doc.loadInfo();

  const tabName = env.googleSheetsTabName;
  const existing = doc.sheetsByTitle[tabName];

  let sheet;
  if (existing) {
    sheet = await ensureHeaderRow(existing);
  } else {
    sheet = await doc.addSheet({ title: tabName, headerValues: [...SHEET_HEADERS] });
    await hideAdIdColumn(sheet);
  }

  const headerValues = sheet.headerValues;
  const grid = rows.map((row) =>
    headerValues.map((header) => (row as Record<string, string>)[header] ?? ""),
  );

  await auth.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetsId}:batchUpdate`,
    method: "POST",
    data: {
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: sheet.sheetId,
              dimension: "ROWS",
              startIndex: 1,
              endIndex: 1 + rows.length,
            },
            inheritFromBefore: false,
          },
        },
        {
          updateCells: {
            range: {
              sheetId: sheet.sheetId,
              startRowIndex: 1,
              endRowIndex: 1 + rows.length,
              startColumnIndex: 0,
              endColumnIndex: headerValues.length,
            },
            rows: grid.map((rowValues) => ({
              values: rowValues.map((value) => ({
                userEnteredValue: { stringValue: value },
              })),
            })),
            fields: "userEnteredValue",
          },
        },
      ],
    },
  });
}

/**
 * Bir reklam durduğunda/yeniden aktifleştiğinde ilgili satırın "Durum"
 * hücresini günceller. Satır, "Reklam ID" kolonundaki değerle bulunur.
 *
 * Sheets'te "belirli bir değere göre satır bul" diye bir uç nokta yok; bu
 * yüzden önce ID kolonunun TAMAMI tek istekle okunur (birkaç yüz satırda
 * önemsiz maliyet), eşleşen satır bulunur, sonra yalnızca o hücreye yazılır.
 *
 * Satır bulunamazsa (reklam hiç Sheets'e yazılmamışsa, örn. özellik sonradan
 * açıldıysa) sessizce `false` döner — düzeltmek için `sheets:backfill`
 * yeniden çalıştırılabilir.
 */
export async function updateSheetRowStatus(
  adArchiveId: string,
  isActive: boolean,
): Promise<boolean> {
  const { GoogleSpreadsheet } = await import("google-spreadsheet");
  const auth = await getAuth();

  const doc = new GoogleSpreadsheet(env.googleSheetsId, auth);
  await doc.loadInfo();

  const tabName = env.googleSheetsTabName;
  const sheet = doc.sheetsByTitle[tabName];
  if (!sheet) return false;

  await ensureHeaderRow(sheet);
  const headerValues = sheet.headerValues;
  const idColIndex = headerValues.indexOf("Reklam ID");
  const statusColIndex = headerValues.indexOf("Durum");
  if (idColIndex === -1 || statusColIndex === -1) return false;

  const idColLetter = columnLetter(idColIndex + 1);
  const idRange = `${tabName}!${idColLetter}2:${idColLetter}${sheet.rowCount}`;
  const idRes = await auth.request<{ values?: string[][] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetsId}/values/${encodeURIComponent(idRange)}`,
  });
  const ids = idRes.data.values ?? [];
  const rowOffset = ids.findIndex((row) => row[0] === adArchiveId);
  if (rowOffset === -1) return false;

  const targetRow = rowOffset + 2; // veri 2. satırdan başlıyor
  const statusColLetter = columnLetter(statusColIndex + 1);
  await auth.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${env.googleSheetsId}/values/${encodeURIComponent(`${tabName}!${statusColLetter}${targetRow}`)}?valueInputOption=RAW`,
    method: "PUT",
    data: { values: [[isActive ? "Aktif" : "Durduruldu"]] },
  });

  return true;
}

/**
 * "Reklam ID" kolonu teknik bir alan — kullanıcıya görünmesine gerek yok,
 * yalnızca `updateSheetRowStatus`'un satırı bulması için var. Sekme İLK
 * oluşturulduğunda bir kez gizlenir; sonraki her ekleme bu adımı tekrarlamaz.
 */
async function hideAdIdColumn(sheet: {
  headerValues: string[];
  updateDimensionProperties(
    dimension: "COLUMNS",
    properties: { hiddenByUser: boolean },
    bounds: { startIndex: number; endIndex: number },
  ): Promise<unknown>;
}): Promise<void> {
  const idIndex = sheet.headerValues.indexOf("Reklam ID");
  if (idIndex === -1) return;
  await sheet.updateDimensionProperties(
    "COLUMNS",
    { hiddenByUser: true },
    { startIndex: idIndex, endIndex: idIndex + 1 },
  );
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
