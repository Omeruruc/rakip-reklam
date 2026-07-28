/** İstemci ve sunucunun paylaştığı Excel içe aktarma tipleri. */

export const IMPORT_FIELDS = [
  "dealerName",
  "city",
  "address",
  "competitorName",
  "instagram",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Alan -> sütun indeksi. Zorunlu alanlar dealerName ve competitorName. */
export type ColumnMapping = Partial<Record<ImportField, number>> & {
  dealerName: number;
  competitorName: number;
};

export const FIELD_LABELS: Record<ImportField, string> = {
  dealerName: "Bayi Adı",
  city: "İl",
  address: "Adres",
  competitorName: "Rakip Mağaza Adı",
  instagram: "Instagram",
};

export const REQUIRED_FIELDS: ImportField[] = ["dealerName", "competitorName"];

export type SheetPreview = {
  sheetNames: string[];
  sheetName: string;
  /** Başlık satırının 0-tabanlı indeksi. */
  headerRowIndex: number;
  headers: string[];
  /** Kolon eşleme ekranında gösterilen ilk veri satırları. */
  sampleRows: (string | null)[][];
  totalRows: number;
  suggestedMapping: Partial<Record<ImportField, number>>;
};

export type ParsedRow = {
  /** Excel'deki 1-tabanlı satır numarası — hata mesajlarında kullanıcıya gösterilir. */
  rowNumber: number;
  dealerName: string;
  city: string | null;
  address: string | null;
  competitorName: string;
  instagramHandle: string | null;
  instagramRaw: string | null;
};

export type RowIssue = {
  rowNumber: number;
  message: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** Satırın atıldığı durumlar (zorunlu alan eksik). */
  errors: RowIssue[];
  /** Satır korunur ama dikkat gerektirir (Instagram adresi çözülemedi vb.). */
  warnings: RowIssue[];
  /** Tamamen boş ayraç satırları. */
  skippedBlankRows: number;
  /** Dosya içinde tekrar eden bayi–rakip çiftleri. */
  duplicateRows: RowIssue[];
};

/** Önizleme özeti — AC-01: bu aşamada veritabanına hiçbir şey yazılmaz. */
export type ImportPreview = {
  token: string;
  fileName: string;
  sheetName: string;
  mapping: ColumnMapping;
  dealers: { create: number; update: number; unchanged: number };
  competitors: {
    create: number;
    update: number;
    unchanged: number;
    /** Onaylı Page ID'si korunacak kayıt sayısı (AC-03). */
    matchPreserved: number;
    /**
     * Instagram adresi değiştiği için eşleştirmesi yeniden onaya düşecek
     * kayıt sayısı. Page ID silinmez, yalnızca durum unverified olur.
     */
    matchNeedsRecheck: number;
  };
  errors: RowIssue[];
  warnings: RowIssue[];
  duplicateRows: RowIssue[];
  skippedBlankRows: number;
  totalDataRows: number;
  /** Dosyada bulunmayan mevcut kayıtlar — otomatik silinmez, kullanıcıya sorulur. */
  missing: {
    dealers: { id: number; name: string }[];
    competitors: { id: number; name: string; dealerName: string }[];
  };
  samples: ParsedRow[];
};
