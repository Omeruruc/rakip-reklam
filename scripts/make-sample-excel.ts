/**
 * Kabul kriterlerini (AC-01, AC-02, AC-03) elle denemek için gerçekçi bir
 * örnek Excel üretir: gruplandırılmış bayi bilgileri, boş ayraç satırları,
 * eksik Instagram, bozuk Instagram adresi ve mükerrer satır içerir.
 *
 *   npx tsx scripts/make-sample-excel.ts
 *   -> ornek-bayi-rakip.xlsx
 */

import * as XLSX from "xlsx";

const rows: (string | null)[][] = [
  ["Bayi Adı", "İl", "Adres", "Rakip Mağaza Adı", "Instagram"],

  [
    "İşbir Yatak Bandırma",
    "Balıkesir",
    "Atatürk Cd. No 12, Bandırma",
    "Bandırma Lova Yatak",
    "https://www.instagram.com/lovayatak.bandirma/",
  ],
  [null, null, null, "Puffy Bandırma", "instagram.com/puffybandirma/"],
  [null, null, null, "Bambi Yatak Ayna AVM", "…/ayna.bambiyatak/"],

  // Tamamen boş ayraç satırı — atlanmalı.
  [null, null, null, null, null],

  [
    "İşbir Yatak Bursa Nilüfer",
    "Bursa",
    "Fethiye Mah. 45. Sk., Nilüfer",
    "Yatsan Nilüfer",
    "@yatsan.nilufer",
  ],
  // Instagram'ı olmayan rakip — ad ile kimliklenir.
  [null, null, null, "Şehir Mobilya Yatak", null],
  // Çözümlenemeyen adres — uyarı üretir, kayıt Instagram'sız oluşur.
  [null, null, null, "İpek Yatak Bursa", "instagram.com/p/CxYzAbC123/"],
  // Aynı rakip tekrar — bir kez işlenmeli.
  [
    null,
    null,
    null,
    "Yatsan Nilüfer",
    "https://instagram.com/yatsan.nilufer",
  ],

  [null, null, null, null, null],

  [
    "İşbir Yatak İzmir Karşıyaka",
    "İzmir",
    "Bostanlı, Karşıyaka",
    "Yataş Bedding Karşıyaka",
    "instagram.com/yatasbedding.karsiyaka",
  ],
  [null, null, null, "Bellona Karşıyaka", "instagram.com/bellona.karsiyaka/"],
];

const sheet = XLSX.utils.aoa_to_sheet(rows);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Bayi-Rakip");
XLSX.writeFile(workbook, "ornek-bayi-rakip.xlsx");

console.log("ornek-bayi-rakip.xlsx oluşturuldu.");
console.log(`  ${rows.length - 1} veri satırı (2 boş ayraç, 1 mükerrer dahil)`);
console.log("  Beklenen sonuç: 3 bayi, 9 rakip, 1 uyarı, 1 mükerrer.");
