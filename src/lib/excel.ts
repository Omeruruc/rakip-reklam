import { extractInstagramHandle } from "./adlibrary";
import {
  type ColumnMapping,
  type ImportField,
  type ParseResult,
  type ParsedRow,
  type RowIssue,
} from "./excel-types";

/** Bir hücreyi temiz metne çevirir; boş/boşluk-only hücreler null olur. */
export function cell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value)
    // Excel'den gelen bölünmez boşluk ve sıfır genişlikli karakterler.
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

/** Satırın tamamı boş mu? Ayraç satırlarını atlamak için (AC-02). */
export function isBlankRow(row: (unknown | null)[] | undefined): boolean {
  if (!row) return true;
  return row.every((c) => cell(c) === null);
}

/* -------------------------------------------------------------------------- */
/* Başlık ve kolon tespiti                                                     */
/* -------------------------------------------------------------------------- */

// Öncelik sırası önemli: "Rakip Mağaza Adı" hücresi hem "rakip" hem "mağaza"
// içerir; rakip kalıpları daha yüksek puan alır ki bayi ile karışmasın.
const FIELD_PATTERNS: Record<ImportField, { re: RegExp; score: number }[]> = {
  competitorName: [
    { re: /rakip/i, score: 100 },
    { re: /competitor/i, score: 90 },
  ],
  dealerName: [
    { re: /bayi\s*ad/i, score: 95 },
    { re: /^bayi$/i, score: 90 },
    { re: /bayi/i, score: 70 },
    { re: /dealer/i, score: 70 },
    { re: /(mağaza|magaza)/i, score: 30 },
  ],
  city: [
    { re: /^il$/i, score: 100 },
    { re: /(şehir|sehir)/i, score: 90 },
    { re: /^city$/i, score: 90 },
    { re: /\bil\b/i, score: 60 },
  ],
  address: [
    { re: /adres/i, score: 100 },
    { re: /address/i, score: 90 },
  ],
  instagram: [
    { re: /instagram/i, score: 100 },
    { re: /\big\b/i, score: 70 },
    { re: /(hesap|profil|link|url)/i, score: 40 },
  ],
};

/**
 * Türkçe'ye duyarlı küçük harfe indirme.
 * JS'in /i bayrağı "İl" ile "il"i eşleştirmez (U+0130 basit kıvrımda i'ye
 * dönmez), bu yüzden başlıklar karşılaştırmadan önce elle normalize edilir.
 */
function normalizeHeader(header: string): string {
  // Yalnızca İ -> i eşlemesi elle yapılır. I -> ı dönüşümü YAPILMAZ:
  // "Instagram" gibi yabancı sözcükler "ınstagram" olup kalıpları kaçırırdı.
  return header.replace(/İ/g, "i").toLowerCase();
}

function scoreHeader(rawHeader: string): Partial<Record<ImportField, number>> {
  const header = normalizeHeader(rawHeader);
  const scores: Partial<Record<ImportField, number>> = {};
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS) as [
    ImportField,
    { re: RegExp; score: number }[],
  ][]) {
    let best = 0;
    for (const { re, score } of patterns) {
      if (re.test(header) && score > best) best = score;
    }
    if (best > 0) scores[field] = best;
  }
  return scores;
}

/**
 * Başlık satırını bulur: ilk 20 satır içinde en çok bilinen kolon adını
 * barındıran satır. Hiçbiri tutmazsa ilk boş olmayan satır kabul edilir.
 */
export function detectHeaderRow(matrix: (unknown | null)[][]): number {
  let bestIndex = -1;
  let bestScore = 0;
  const limit = Math.min(matrix.length, 20);

  for (let i = 0; i < limit; i++) {
    const row = matrix[i];
    if (isBlankRow(row)) continue;
    let score = 0;
    let filled = 0;
    for (const raw of row) {
      const text = cell(raw);
      if (!text) continue;
      filled++;
      const scores = scoreHeader(text);
      score += Math.max(0, ...Object.values(scores));
    }
    // İki dolu hücresi olmayan satır başlık sayılmaz.
    if (filled >= 2 && score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return bestIndex;
  for (let i = 0; i < matrix.length; i++) {
    if (!isBlankRow(matrix[i])) return i;
  }
  return 0;
}

/**
 * Başlıklardan kolon eşlemesi önerir. Her sütun en fazla bir alana,
 * her alan en fazla bir sütuna atanır (en yüksek puan kazanır).
 */
export function suggestMapping(
  headers: (string | null)[],
): Partial<Record<ImportField, number>> {
  const candidates: { field: ImportField; column: number; score: number }[] = [];

  headers.forEach((header, column) => {
    if (!header) return;
    const scores = scoreHeader(header);
    for (const [field, score] of Object.entries(scores) as [
      ImportField,
      number,
    ][]) {
      candidates.push({ field, column, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: Partial<Record<ImportField, number>> = {};
  const usedColumns = new Set<number>();
  for (const candidate of candidates) {
    if (mapping[candidate.field] !== undefined) continue;
    if (usedColumns.has(candidate.column)) continue;
    mapping[candidate.field] = candidate.column;
    usedColumns.add(candidate.column);
  }
  return mapping;
}

/* -------------------------------------------------------------------------- */
/* Aşağı doldurma + doğrulama                                                  */
/* -------------------------------------------------------------------------- */

function get(
  row: (unknown | null)[],
  column: number | undefined,
): string | null {
  if (column === undefined) return null;
  return cell(row[column]);
}

/** Karşılaştırma anahtarı: aynı kaydı iki kez yazmayı önler. */
export function competitorKey(
  dealerName: string,
  competitorName: string,
  handle: string | null,
): string {
  const dealer = dealerName.toLocaleLowerCase("tr");
  return handle
    ? `${dealer}::@${handle}`
    : `${dealer}::${competitorName.toLocaleLowerCase("tr")}`;
}

/**
 * Gruplandırılmış Excel'i düz satır listesine çevirir.
 *
 * Kurallar (MVP özeti §5):
 *  - Aşağı doldurma: boş bayi/il/adres hücreleri bir üstteki dolu değerden gelir.
 *  - Bayi adı dolu bir satır YENİ grup başlatır; il/adres bağlamı sıfırlanır ki
 *    bir önceki bayinin ili yeni bayiye bulaşmasın.
 *  - Tamamen boş satırlar atlanır, aşağı doldurma bağlamını bozmaz.
 *  - Bayi adı ve rakip adı zorunludur; eksikse satır atılır ve hata listelenir.
 */
export function parseRows(
  matrix: (unknown | null)[][],
  mapping: ColumnMapping,
  headerRowIndex: number,
): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const duplicateRows: RowIssue[] = [];
  let skippedBlankRows = 0;

  let currentDealer: string | null = null;
  let currentCity: string | null = null;
  let currentAddress: string | null = null;

  const seen = new Map<string, number>();

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const rowNumber = i + 1; // Excel 1-tabanlı

    if (isBlankRow(row)) {
      skippedBlankRows++;
      continue;
    }

    const rawDealer = get(row, mapping.dealerName);
    const rawCity = get(row, mapping.city);
    const rawAddress = get(row, mapping.address);
    const competitorName = get(row, mapping.competitorName);
    const instagramRaw = get(row, mapping.instagram);

    if (rawDealer) {
      // Yeni bayi grubu — il/adres bu satırdan alınır (boş olsa bile).
      currentDealer = rawDealer;
      currentCity = rawCity;
      currentAddress = rawAddress;
    } else {
      if (rawCity) currentCity = rawCity;
      if (rawAddress) currentAddress = rawAddress;
    }

    const dealerName = currentDealer;

    if (!dealerName) {
      errors.push({
        rowNumber,
        message: "Bayi adı belirlenemedi (üstünde dolu bir bayi satırı yok).",
      });
      continue;
    }
    if (!competitorName) {
      // Yalnızca bayi bilgisi taşıyan başlık satırı olabilir; rakip yoksa
      // yazılacak bir şey yok. Kullanıcı görsün diye hata olarak raporlanır.
      errors.push({ rowNumber, message: "Rakip mağaza adı boş." });
      continue;
    }

    const instagramHandle = extractInstagramHandle(instagramRaw);
    if (instagramRaw && !instagramHandle) {
      warnings.push({
        rowNumber,
        message: `Instagram adresi çözümlenemedi: "${instagramRaw}". Kayıt Instagram'sız oluşturulur.`,
      });
    }

    const key = competitorKey(dealerName, competitorName, instagramHandle);
    const firstSeenRow = seen.get(key);
    if (firstSeenRow !== undefined) {
      duplicateRows.push({
        rowNumber,
        message: `"${competitorName}" bu dosyada ${firstSeenRow}. satırda da var; bir kez işlenecek.`,
      });
      continue;
    }
    seen.set(key, rowNumber);

    rows.push({
      rowNumber,
      dealerName,
      city: currentCity,
      address: currentAddress,
      competitorName,
      instagramHandle,
      instagramRaw,
    });
  }

  return { rows, errors, warnings, skippedBlankRows, duplicateRows };
}

/** Satırlardan tekil bayi listesi çıkarır (ilk görülen il/adres kazanır). */
export function collectDealers(rows: ParsedRow[]) {
  const map = new Map<
    string,
    { name: string; city: string | null; address: string | null }
  >();
  for (const row of rows) {
    const key = row.dealerName.toLocaleLowerCase("tr");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        name: row.dealerName,
        city: row.city,
        address: row.address,
      });
      continue;
    }
    // Eksik alanlar sonraki satırlardan tamamlanabilir.
    if (!existing.city && row.city) existing.city = row.city;
    if (!existing.address && row.address) existing.address = row.address;
  }
  return [...map.values()];
}
