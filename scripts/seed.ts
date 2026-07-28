/**
 * Pilot markayı ve birkaç örnek kaydı oluşturur — duman testi için.
 *   npx tsx scripts/seed.ts
 *
 * Not: rakipler `unverified` başlar; eşleştirme yapılmadan hiçbir tarama
 * onları kapsamaz (AC-04). Page ID'leri eşleştirme ekranından girin.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function main() {
  const { db } = await import("@/db");
  const { brands, competitors, dealers } = await import("@/db/schema");

  const [brand] = await db
    .insert(brands)
    .values({ name: "İşbir Yatak" })
    .onConflictDoNothing()
    .returning({ id: brands.id, name: brands.name });

  if (!brand) {
    console.log("İşbir Yatak markası zaten var; seed atlandı.");
    process.exit(0);
  }

  const dealerRows = [
    {
      name: "İşbir Yatak Bandırma",
      city: "Balıkesir",
      address: "Atatürk Cd. No 12, Bandırma",
    },
    {
      name: "İşbir Yatak Bursa Nilüfer",
      city: "Bursa",
      address: "Fethiye Mah. 45. Sk., Nilüfer",
    },
  ];

  const inserted = await db
    .insert(dealers)
    .values(dealerRows.map((d) => ({ ...d, brandId: brand.id })))
    .returning({ id: dealers.id, name: dealers.name });

  const competitorRows = [
    { dealer: 0, name: "Bandırma Lova Yatak", handle: "lovayatak.bandirma" },
    { dealer: 0, name: "Puffy Bandırma", handle: "puffybandirma" },
    { dealer: 1, name: "Yatsan Nilüfer", handle: "yatsan.nilufer" },
  ];

  await db.insert(competitors).values(
    competitorRows.map((c) => ({
      dealerId: inserted[c.dealer].id,
      name: c.name,
      instagramHandle: c.handle,
      matchStatus: "unverified" as const,
    })),
  );

  console.log(`Marka oluşturuldu: ${brand.name} (#${brand.id})`);
  console.log(`  ${inserted.length} bayi, ${competitorRows.length} rakip`);
  console.log(
    "  Hepsi 'unverified' — /brands/" +
      brand.id +
      "/matching ekranından Page ID onaylayın.",
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
