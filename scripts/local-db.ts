/**
 * Yalnızca YEREL GELİŞTİRME için tek dosyalık Postgres.
 *
 * Docker ya da kurulu bir Postgres olmadan uygulamayı çalıştırmayı sağlar:
 * PGlite'ı Postgres tel protokolüyle yayınlar, veriyi .pglite/ klasöründe
 * tutar. Üretimde Neon/Supabase kullanılır — bu betik dağıtıma dahil değildir.
 *
 *   npm run db:local     # ayrı bir terminalde açık kalır
 *   npm run dev
 *
 * ÖNEMLİ: PGlite'ın tel protokol sunucusu aynı anda YALNIZCA BİR bağlantı
 * kabul eder. Bu yüzden:
 *   - göçler (migrations) sunucu açılırken İÇ SÜREÇTE uygulanır; ayrıca
 *     `drizzle-kit migrate` çalıştırmak gerekmez (çalıştırılırsa, uygulama
 *     bağlıyken ECONNRESET verir),
 *   - uygulamanın havuzu tek bağlantıya sabitlenmelidir: DB_POOL_MAX="1",
 *   - dev sunucusu açıkken `npm test` dışında başka bir araçla bağlanmayın.
 */

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Veri dizini PROJE KLASÖRÜNÜN DIŞINDA tutulur. Nedenleri:
 *
 *  - `git clean -fdx` gitignore'lanmış dosyaları da siler; veri proje içinde
 *    olsa tek komutla yok olurdu (eşleştirme emeği dahil).
 *  - Postgres WAL dosyası sürekli yazılır; kod ağacının içinde olduğunda
 *    Next dev ve vitest izleyicilerini boşuna tetikler.
 *  - Proje klasörü git'ten yeniden üretilebilir olmalı; veri üretilemez.
 *
 * LOCAL_DB_DIR ile başka bir yol verilebilir.
 */
const DEFAULT_DATA_DIR = join(
  homedir(),
  ".local",
  "share",
  "rakip-reklam",
  "pglite",
);

async function main() {
  const port = Number.parseInt(process.env.LOCAL_DB_PORT ?? "5432", 10);
  const dataDir = process.env.LOCAL_DB_DIR ?? DEFAULT_DATA_DIR;

  const db = await PGlite.create({ dataDir });

  // Göçler soket açılmadan önce uygulanır: dış bir araç tek bağlantı için
  // uygulamayla yarışmak zorunda kalmaz.
  await migrate(drizzle(db), { migrationsFolder: "drizzle" });

  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();

  console.log(
    `PGlite dinliyor : postgresql://postgres@127.0.0.1:${port}/postgres`,
  );
  console.log(`Veri klasörü    : ${dataDir}`);
  console.log("Göçler          : uygulandı");
  console.log("Uyarı           : tek bağlantı — .env.local'de DB_POOL_MAX=\"1\"");
  console.log("Kapatmak için Ctrl+C");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await server.stop();
      await db.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
