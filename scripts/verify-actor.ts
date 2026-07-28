/**
 * İŞ SIRASI #1 — Apify doğrulaması.
 *
 * MVP özetinin tek gerçek belirsizliği: actor Türkiye verisinde ne döndürüyor?
 * Bu betik bir actor'ü gerçek Page ID'lerle çalıştırır ve şunları raporlar:
 *   - hangi girdi biçimi (urls / startUrls / pageIds) kabul edildi
 *   - kaç kayıt döndü, kaçı normalize edilebildi
 *   - hangi alanlar dolu geldi (creative_text, image_url, started_at, …)
 *   - page_id dönüyor mu — dönmüyorsa toplu tarama sonuçları rakiplere
 *     ATANAMAZ ve marka başına tek çalıştırma yapılamaz
 *   - çalıştırma maliyeti
 *
 * Kullanım:
 *   npx tsx scripts/verify-actor.ts --pages 123456789,987654321
 *   npx tsx scripts/verify-actor.ts --actor apify/facebook-ads-scraper --mode startUrls --pages 123
 *
 * Çıktı ayrıca .apify-verify/<actor>-<zaman>.json olarak kaydedilir.
 */

import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const pages = (args.pages ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (pages.length === 0) {
    console.error(
      "Kullanım: npx tsx scripts/verify-actor.ts --pages <pageId1,pageId2> [--actor <id>] [--mode urls|startUrls|pageIds]",
    );
    console.error(
      "\nPage ID bulmak için: facebook.com/ads/library adresinde rakibi arayın,\n" +
        "URL'deki view_all_page_id değerini kullanın.",
    );
    process.exit(1);
  }

  // Ortam değişkenleri okunduktan sonra import edilir.
  const { buildActorInput, runAdLibraryScrape } = await import("@/lib/apify");
  const { fieldCoverage, normalizeDataset } = await import("@/lib/normalize");
  const { adLibraryUrl } = await import("@/lib/adlibrary");

  const actorId = args.actor ?? process.env.APIFY_ACTOR_ID ?? "(tanımsız)";
  const mode = (args.mode ?? process.env.APIFY_INPUT_MODE ?? "urls") as
    | "urls"
    | "startUrls"
    | "pageIds";

  console.log("─".repeat(72));
  console.log(`Actor      : ${actorId}`);
  console.log(`Girdi modu : ${mode}`);
  console.log(`Page ID    : ${pages.join(", ")}`);
  console.log(`Sorgu      : ${adLibraryUrl(pages[0])}`);
  console.log("─".repeat(72));
  console.log("Girdi:", JSON.stringify(buildActorInput(pages, mode), null, 2));
  console.log("\nÇalıştırılıyor… (dakikalar sürebilir)\n");

  const started = Date.now();
  const result = await runAdLibraryScrape(pages, { actorId, inputMode: mode });
  const seconds = Math.round((Date.now() - started) / 1000);

  const { ads, skipped } = normalizeDataset(result.items);
  const coverage = fieldCoverage(ads);

  const withPageId = ads.filter((ad) => ad.pageId !== null).length;
  const unknownPageIds = new Set(
    ads
      .map((ad) => ad.pageId)
      .filter((id): id is string => id !== null && !pages.includes(id)),
  );

  console.log("SONUÇ");
  console.log(`  Apify run        : ${result.runId}`);
  console.log(`  Süre             : ${seconds} sn`);
  console.log(`  Maliyet          : ${result.costUsd ?? "bilinmiyor"} USD`);
  console.log(`  Ham kayıt        : ${result.items.length}`);
  console.log(`  Normalize edilen : ${ads.length} (atlanan: ${skipped})`);
  console.log("");
  console.log("ALAN KAPSAMI (dolu kayıt / toplam)");
  for (const [field, count] of Object.entries(coverage)) {
    const ratio = ads.length > 0 ? Math.round((count / ads.length) * 100) : 0;
    const flag = count === 0 ? "  ← BOŞ" : "";
    console.log(`  ${field.padEnd(16)} ${count}/${ads.length} (%${ratio})${flag}`);
  }
  console.log("");

  console.log("ATAMA KONTROLÜ (marka başına tek toplu çalıştırma için şart)");
  if (ads.length === 0) {
    console.log("  ⚠️  Hiç kayıt dönmedi. Sıfır sonuç arıza varsayılır:");
    console.log("      Page ID doğru mu? Rakibin aktif reklamı var mı?");
    console.log("      Ad Library web arayüzünde elle kontrol edin.");
  } else if (withPageId === 0) {
    console.log("  ❌ Kayıtlarda page_id YOK.");
    console.log("      Toplu çalıştırma sonuçları rakiplere atanamaz.");
    console.log("      Ya normalize.ts'e doğru alan yolu eklenmeli,");
    console.log("      ya da rakip başına ayrı çalıştırma gerekir (maliyet artar).");
  } else if (unknownPageIds.size > 0) {
    console.log(
      `  ⚠️  Beklenmeyen page_id değerleri: ${[...unknownPageIds].join(", ")}`,
    );
  } else {
    console.log(`  ✅ ${withPageId}/${ads.length} kayıtta page_id var, hepsi beklenen listede.`);
  }
  console.log("");

  if (ads.length > 0) {
    console.log("ÖRNEK KAYIT (normalize edilmiş)");
    const sample = ads[0];
    console.log(
      JSON.stringify(
        { ...sample, raw: "(ham kayıt dosyaya yazıldı)" },
        null,
        2,
      ),
    );
    console.log("");
    console.log("HAM KAYIT ANAHTARLARI");
    console.log(
      "  " + Object.keys(result.items[0] as object).sort().join("\n  "),
    );
  }

  const outDir = ".apify-verify";
  mkdirSync(outDir, { recursive: true });
  const outFile = join(
    outDir,
    `${actorId.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.json`,
  );
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        actorId,
        mode,
        pages,
        apifyRunId: result.runId,
        durationSeconds: seconds,
        costUsd: result.costUsd,
        rawCount: result.items.length,
        normalizedCount: ads.length,
        skipped,
        coverage,
        withPageId,
        sampleRaw: result.items.slice(0, 3),
      },
      null,
      2,
    ),
  );
  console.log(`\nRapor kaydedildi: ${outFile}`);
  console.log(
    "\nİki actor'ü de bu betikle deneyip maliyet ve alan kapsamını karşılaştırın;\n" +
      "kazananı APIFY_ACTOR_ID + APIFY_INPUT_MODE olarak .env.local'e yazın.",
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      i++;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

main().catch((error) => {
  console.error("\n❌ Doğrulama başarısız:");
  console.error(error);
  process.exit(1);
});
