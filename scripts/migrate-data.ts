/**
 * Bir Postgres'ten diğerine veri taşır (yerel PGlite -> Neon/Supabase).
 *
 *   # 1. Dev sunucusunu KAPATIN (PGlite tek bağlantı kabul eder)
 *   # 2. Hedefte şemayı oluşturun:
 *   DATABASE_URL="<neon>" npm run db:migrate
 *   # 3. Veriyi taşıyın:
 *   npm run db:transfer -- --target "postgresql://...neon.tech/neondb?sslmode=require"
 *
 * Kaynak varsayılan olarak .env.local'deki DATABASE_URL'dir; --source ile
 * değiştirilebilir.
 *
 * Kimlikler KORUNUR (yabancı anahtarlar buna bağlı) ve sonunda dizi sayaçları
 * (sequence) doğru değere çekilir. Hedefte veri varsa işlem reddedilir —
 * --force ile üzerine yazılabilir (hedef tablolar önce boşaltılır).
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

/** Yabancı anahtar sırası: ebeveyn önce. */
const TABLES = [
  "brands",
  "dealers",
  "competitors",
  "ads",
  "scrape_runs",
  "notifications",
] as const;

/** Serial birincil anahtarı olan tablolar (ads'in PK'si metin). */
const SEQUENCE_TABLES = [
  "brands",
  "dealers",
  "competitors",
  "scrape_runs",
  "notifications",
] as const;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = args.source ?? process.env.DATABASE_URL;
  const targetUrl = args.target ?? process.env.TARGET_DATABASE_URL;

  if (!sourceUrl || !targetUrl) {
    console.error(
      "Kullanım: npm run db:transfer -- --target <hedef-adres> [--source <kaynak-adres>] [--force]",
    );
    process.exit(1);
  }
  if (sourceUrl === targetUrl) {
    console.error("Kaynak ve hedef aynı adres.");
    process.exit(1);
  }

  const postgres = (await import("postgres")).default;
  const { shouldUseSsl } = await import("@/db");

  const source = postgres(sourceUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    ssl: shouldUseSsl(sourceUrl),
  });
  const target = postgres(targetUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    ssl: shouldUseSsl(targetUrl),
  });

  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return "(bilinmiyor)";
    }
  };
  console.log(`Kaynak : ${host(sourceUrl)}`);
  console.log(`Hedef  : ${host(targetUrl)}`);
  console.log("─".repeat(60));

  // Hedefte şema var mı?
  for (const table of TABLES) {
    const [exists] = await target`
      select to_regclass(${`public.${table}`}) is not null as var`;
    if (!exists.var) {
      console.error(
        `Hedefte "${table}" tablosu yok. Önce şemayı oluşturun:\n` +
          `  DATABASE_URL="${targetUrl.replace(/:[^:@/]+@/, ":***@")}" npm run db:migrate`,
      );
      process.exit(1);
    }
  }

  // Hedef boş mu?
  const doluTablolar: string[] = [];
  for (const table of TABLES) {
    const [row] = await target.unsafe(
      `select count(*)::int as n from "${table}"`,
    );
    if (row.n > 0) doluTablolar.push(`${table}(${row.n})`);
  }

  if (doluTablolar.length > 0 && !args.force) {
    console.error(
      `Hedefte veri var: ${doluTablolar.join(", ")}\n` +
        "Üzerine yazmak için --force ekleyin (hedef tablolar boşaltılır).",
    );
    process.exit(1);
  }

  if (doluTablolar.length > 0) {
    console.log(`--force: hedef boşaltılıyor (${doluTablolar.join(", ")})`);
    await target.unsafe(
      `truncate table ${TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`,
    );
  }

  let toplam = 0;
  for (const table of TABLES) {
    const rows = await source.unsafe(`select * from "${table}" order by 1`);
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(16)} 0 satır`);
      continue;
    }
    // Tek transaction: yarım kalmış aktarım bırakmaz.
    await target.begin(async (tx) => {
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await tx`insert into ${tx(table)} ${tx(chunk as never[])}`;
      }
    });
    toplam += rows.length;
    console.log(`  ${table.padEnd(16)} ${rows.length} satır`);
  }

  // Dizi sayaçlarını en büyük kimliğin üstüne çek; yoksa sonraki insert çakışır.
  for (const table of SEQUENCE_TABLES) {
    await target.unsafe(`
      select setval(
        pg_get_serial_sequence('"${table}"', 'id'),
        greatest((select coalesce(max(id), 0) from "${table}"), 1)
      )`);
  }
  console.log("  dizi sayaçları güncellendi");

  console.log("─".repeat(60));
  console.log(`Aktarılan satır: ${toplam}`);

  // Doğrulama: satır sayıları eşleşiyor mu?
  let hata = false;
  for (const table of TABLES) {
    const [s] = await source.unsafe(`select count(*)::int as n from "${table}"`);
    const [t] = await target.unsafe(`select count(*)::int as n from "${table}"`);
    const ok = s.n === t.n;
    if (!ok) hata = true;
    console.log(
      `  ${ok ? "✅" : "❌"} ${table.padEnd(16)} kaynak=${s.n} hedef=${t.n}`,
    );
  }

  await source.end();
  await target.end();

  if (hata) {
    console.error("\nSatır sayıları eşleşmedi — aktarımı inceleyin.");
    process.exit(1);
  }
  console.log("\nAktarım tamam. .env.local'de DATABASE_URL'i hedefe çevirin.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
