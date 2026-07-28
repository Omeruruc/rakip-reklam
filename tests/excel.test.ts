import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  cell,
  collectDealers,
  competitorKey,
  detectHeaderRow,
  isBlankRow,
  parseRows,
  suggestMapping,
} from "@/lib/excel";
import { extractInstagramHandle, extractPageId } from "@/lib/adlibrary";
import { loadSheet, buildSheetPreview } from "@/lib/workbook";
import type { ColumnMapping } from "@/lib/excel-types";

/** MVP özeti §5'teki gerçek dosya yapısı. */
const GROUPED_SHEET: (string | null)[][] = [
  ["Bayi Adı", "İl", "Adres", "Rakip Mağaza Adı", "Instagram"],
  [
    "İşbir Yatak Bandırma",
    "Balıkesir",
    "Atatürk Cd. 12",
    "Bandırma Lova Yatak",
    "https://www.instagram.com/lovayatak.bandirma/",
  ],
  [null, null, null, "Puffy Bandırma", "instagram.com/puffybandirma/"],
  [null, null, null, "Bambi Yatak Ayna AVM", "…/ayna.bambiyatak/"],
  [null, null, null, null, null],
  [
    "İşbir Yatak Bursa",
    "Bursa",
    "Nilüfer",
    "Yatsan Nilüfer",
    "@yatsan.nilufer",
  ],
  [null, null, null, "Şehir Mobilya", null],
];

const MAPPING: ColumnMapping = {
  dealerName: 0,
  city: 1,
  address: 2,
  competitorName: 3,
  instagram: 4,
};

describe("hücre temizleme", () => {
  it("boş ve boşluk-only hücreleri null yapar", () => {
    expect(cell(null)).toBeNull();
    expect(cell("")).toBeNull();
    expect(cell("   ")).toBeNull();
    expect(cell(" ")).toBeNull();
  });

  it("çoklu boşlukları teke indirir", () => {
    expect(cell("  Lova   Yatak ")).toBe("Lova Yatak");
  });

  it("sıfır genişlikli karakterleri temizler", () => {
    expect(cell("Puffy​Bandırma")).toBe("Puffy Bandırma");
  });

  it("tamamen boş satırı tanır", () => {
    expect(isBlankRow([null, null, "", "   "])).toBe(true);
    expect(isBlankRow([null, "x"])).toBe(false);
    expect(isBlankRow(undefined)).toBe(true);
  });
});

describe("başlık ve kolon tespiti", () => {
  it("başlık satırını bulur", () => {
    expect(detectHeaderRow(GROUPED_SHEET)).toBe(0);
  });

  it("başlıktan önce açıklama satırları olsa da bulur", () => {
    const withPreamble = [
      ["İşbir Yatak — Marmara Bölgesi Rakip Listesi", null, null, null, null],
      [null, null, null, null, null],
      ...GROUPED_SHEET,
    ];
    expect(detectHeaderRow(withPreamble)).toBe(2);
  });

  it("kolonları doğru alanlara eşler", () => {
    const mapping = suggestMapping(GROUPED_SHEET[0]);
    expect(mapping).toEqual({
      dealerName: 0,
      city: 1,
      address: 2,
      competitorName: 3,
      instagram: 4,
    });
  });

  it("'Rakip Mağaza Adı'yı bayi kolonu ile karıştırmaz", () => {
    const mapping = suggestMapping([
      "Bayi",
      "Şehir",
      "Rakip Mağaza Adı",
      "Instagram Linki",
    ]);
    expect(mapping.dealerName).toBe(0);
    expect(mapping.competitorName).toBe(2);
    expect(mapping.city).toBe(1);
    expect(mapping.instagram).toBe(3);
  });
});

describe("Instagram handle çıkarma", () => {
  it("tam URL'den handle çıkarır", () => {
    expect(extractInstagramHandle("https://www.instagram.com/lovayatak.bandirma/")).toBe(
      "lovayatak.bandirma",
    );
  });

  it("protokolsüz, @'li ve kısaltılmış biçimleri kabul eder", () => {
    expect(extractInstagramHandle("instagram.com/puffybandirma/")).toBe(
      "puffybandirma",
    );
    expect(extractInstagramHandle("@yatsan.nilufer")).toBe("yatsan.nilufer");
    expect(extractInstagramHandle("…/ayna.bambiyatak/")).toBe("ayna.bambiyatak");
  });

  it("sorgu parametrelerini atar ve küçük harfe indirir", () => {
    expect(
      extractInstagramHandle("https://instagram.com/LovaYatak?igshid=123"),
    ).toBe("lovayatak");
  });

  it("gönderi/reel linklerini hesap sanmaz", () => {
    expect(extractInstagramHandle("https://instagram.com/p/CxYzAbC123/")).toBeNull();
    expect(extractInstagramHandle("instagram.com/reel/AbC/")).toBeNull();
  });

  it("boş ve geçersiz girdide null döner", () => {
    expect(extractInstagramHandle(null)).toBeNull();
    expect(extractInstagramHandle("")).toBeNull();
    expect(extractInstagramHandle("bir açıklama metni")).toBeNull();
  });
});

describe("Page ID çıkarma", () => {
  it("sayısal kimliği doğrudan kabul eder", () => {
    expect(extractPageId("123456789012345")).toBe("123456789012345");
  });

  it("Ad Library adresinden çıkarır", () => {
    expect(
      extractPageId(
        "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&view_all_page_id=987654321098765",
      ),
    ).toBe("987654321098765");
  });

  it("vanity adreste null döner (elle giriş şart)", () => {
    expect(extractPageId("https://facebook.com/lovayatak")).toBeNull();
  });

  it("profile.php adresinden çıkarır", () => {
    expect(
      extractPageId("https://www.facebook.com/profile.php?id=100064812345678"),
    ).toBe("100064812345678");
  });

  it("TEK REKLAM adresini Page ID sanmaz", () => {
    // Bu sayı "Kütüphane Kodu", yani ad_archive_id — Page ID değil.
    // Kabul edilse sessizce yanlış sayfa onaylanır ve tarama hep boş döner.
    expect(
      extractPageId(
        "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&id=2258064311689863",
      ),
    ).toBeNull();
  });

  it("anahtar kelime arama adresini reddeder", () => {
    expect(
      extractPageId(
        "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&q=Bambi%20Yatak%20Maltepe&search_type=keyword_unordered",
      ),
    ).toBeNull();
  });

  it("yeni biçim sayfa adresinden çıkarır (/people/Ad/<id>/)", () => {
    expect(
      extractPageId(
        "https://www.facebook.com/people/Bambi-Yatak-Maltepe/100092524512123/#",
      ),
    ).toBe("100092524512123");
    expect(
      extractPageId("facebook.com/people/Bambi-Yatak-Maltepe/100092524512123/"),
    ).toBe("100092524512123");
  });

  it("sayısal kısayol adresinden çıkarır", () => {
    expect(extractPageId("https://facebook.com/100092524512123")).toBe(
      "100092524512123",
    );
    expect(extractPageId("https://facebook.com/100092524512123/?ref=x")).toBe(
      "100092524512123",
    );
  });

  it("sayfa adresi (view_all_page_id) kabul edilir", () => {
    expect(
      extractPageId(
        "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=TR&view_all_page_id=100064812345678&search_type=page",
      ),
    ).toBe("100064812345678");
  });
});

describe("aşağı doldurma (AC-02)", () => {
  const result = parseRows(GROUPED_SHEET, MAPPING, 0);

  it("boş bayi hücreli satırları doğru bayiye bağlar", () => {
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((r) => r.dealerName)).toEqual([
      "İşbir Yatak Bandırma",
      "İşbir Yatak Bandırma",
      "İşbir Yatak Bandırma",
      "İşbir Yatak Bursa",
      "İşbir Yatak Bursa",
    ]);
  });

  it("il ve adresi de aşağı doldurur", () => {
    expect(result.rows.map((r) => r.city)).toEqual([
      "Balıkesir",
      "Balıkesir",
      "Balıkesir",
      "Bursa",
      "Bursa",
    ]);
    expect(result.rows[2].address).toBe("Atatürk Cd. 12");
  });

  it("boş ayraç satırlarını hatasız atlar", () => {
    expect(result.skippedBlankRows).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("Instagram handle'larını çıkarır, olmayanı null bırakır", () => {
    expect(result.rows.map((r) => r.instagramHandle)).toEqual([
      "lovayatak.bandirma",
      "puffybandirma",
      "ayna.bambiyatak",
      "yatsan.nilufer",
      null,
    ]);
  });

  it("Excel satır numaralarını korur", () => {
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 6, 7]);
  });
});

describe("aşağı doldurma sınır durumları", () => {
  it("yeni bayi grubu başlarken önceki ili taşımaz", () => {
    const sheet = [
      ["Bayi", "İl", "Rakip"],
      ["Bayi A", "Balıkesir", "Rakip 1"],
      ["Bayi B", null, "Rakip 2"],
    ];
    const result = parseRows(
      sheet,
      { dealerName: 0, city: 1, competitorName: 2 },
      0,
    );
    expect(result.rows[1].dealerName).toBe("Bayi B");
    // Bayi B'nin ili boş; Bayi A'nın ili bulaşmamalı.
    expect(result.rows[1].city).toBeNull();
  });

  it("üstünde bayi olmayan satırı hata olarak raporlar", () => {
    const sheet = [
      ["Bayi", "Rakip"],
      [null, "Sahipsiz Rakip"],
    ];
    const result = parseRows(sheet, { dealerName: 0, competitorName: 1 }, 0);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toMatchObject({ rowNumber: 2 });
  });

  it("rakip adı boş satırı hata sayar ve atar", () => {
    const sheet = [
      ["Bayi", "Rakip"],
      ["Bayi A", null],
      ["Bayi A", "Rakip 1"],
    ];
    const result = parseRows(sheet, { dealerName: 0, competitorName: 1 }, 0);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it("çözümlenemeyen Instagram adresinde uyarı verir ama satırı korur", () => {
    const sheet = [
      ["Bayi", "Rakip", "Instagram"],
      ["Bayi A", "Rakip 1", "https://instagram.com/p/AbC/"],
    ];
    const result = parseRows(
      sheet,
      { dealerName: 0, competitorName: 1, instagram: 2 },
      0,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].instagramHandle).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });

  it("dosya içindeki mükerrer satırı bir kez işler", () => {
    const sheet = [
      ["Bayi", "Rakip", "Instagram"],
      ["Bayi A", "Lova Yatak", "instagram.com/lova"],
      ["Bayi A", "Lova Yatak", "https://www.instagram.com/lova/"],
      ["Bayi A", "Başka Rakip", null],
    ];
    const result = parseRows(
      sheet,
      { dealerName: 0, competitorName: 1, instagram: 2 },
      0,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.duplicateRows).toHaveLength(1);
    expect(result.duplicateRows[0].rowNumber).toBe(3);
  });

  it("Instagram'ı olmayan aynı adlı rakibi de mükerrer sayar", () => {
    const sheet = [
      ["Bayi", "Rakip"],
      ["Bayi A", "Şehir Mobilya"],
      ["Bayi A", "şehir mobilya"],
    ];
    const result = parseRows(sheet, { dealerName: 0, competitorName: 1 }, 0);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicateRows).toHaveLength(1);
  });
});

describe("kimlik anahtarı", () => {
  it("handle varsa handle'a, yoksa ada dayanır", () => {
    expect(competitorKey("Bayi A", "Lova", "lova")).toBe("bayi a::@lova");
    expect(competitorKey("Bayi A", "Lova", null)).toBe("bayi a::lova");
  });

  it("Türkçe büyük/küçük harf farkını yok sayar", () => {
    expect(competitorKey("İŞBİR", "Rakip", null)).toBe(
      competitorKey("işbir", "rakip", null),
    );
  });
});

describe("bayi listesi çıkarma", () => {
  it("tekil bayiler döner ve eksik alanları sonraki satırdan tamamlar", () => {
    const rows = parseRows(
      [
        ["Bayi", "İl", "Adres", "Rakip"],
        ["Bayi A", null, null, "Rakip 1"],
        ["Bayi A", "Bursa", "Adres 1", "Rakip 2"],
      ],
      { dealerName: 0, city: 1, address: 2, competitorName: 3 },
      0,
    ).rows;

    const dealers = collectDealers(rows);
    expect(dealers).toHaveLength(1);
    expect(dealers[0]).toEqual({
      name: "Bayi A",
      city: "Bursa",
      address: "Adres 1",
    });
  });
});

describe("gerçek .xlsx dosyası okuma", () => {
  function makeWorkbook(rows: (string | null)[][]): Buffer {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Bayi-Rakip");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }

  it("SheetJS ile okunan dosya aynı sonucu verir", () => {
    const loaded = loadSheet(makeWorkbook(GROUPED_SHEET));
    expect(loaded.sheetName).toBe("Bayi-Rakip");
    expect(loaded.headerRowIndex).toBe(0);

    const result = parseRows(loaded.matrix, MAPPING, loaded.headerRowIndex);
    expect(result.rows).toHaveLength(5);
    expect(result.rows[4].dealerName).toBe("İşbir Yatak Bursa");
  });

  it("önizleme başlıkları ve önerilen eşlemeyi döndürür", () => {
    const preview = buildSheetPreview(loadSheet(makeWorkbook(GROUPED_SHEET)));
    expect(preview.headers[3]).toBe("Rakip Mağaza Adı");
    expect(preview.suggestedMapping.competitorName).toBe(3);
    expect(preview.totalRows).toBe(6);
  });

  it("aynı dosyanın parmak izi sabittir (AC-03 önkoşulu)", () => {
    const buffer = makeWorkbook(GROUPED_SHEET);
    expect(loadSheet(buffer).fileHash).toBe(loadSheet(buffer).fileHash);
  });
});
