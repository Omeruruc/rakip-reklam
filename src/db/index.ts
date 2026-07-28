import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Tek Postgres bağlantı havuzu.
 *
 * Bağlantı TEMBEL kurulur: `next build` sırasında modüller içe aktarılırken
 * DATABASE_URL aranmasın (dağıtım ortamında değişken yalnızca çalışma
 * zamanında tanımlı olabilir). Next.js dev modunda hot reload her modülü
 * yeniden yüklediği için havuz globalThis üzerinde saklanır.
 */
const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
  __drizzle?: Db;
};

/**
 * TLS kararı bağlantı adresinden çıkarılır.
 *
 * Neon ve Supabase şifrelenmemiş bağlantı kabul etmez; yerel PGlite sunucusu
 * ise TLS sunmaz. Adreste `sslmode` belirtilmemiş olsa bile doğru davranmak
 * için karar burada verilir — aksi halde üretimde "connection is insecure"
 * ya da yerelde el sıkışma hatası alınır.
 *
 * `require`: TLS zorunlu, sertifika zinciri doğrulanmaz. Neon'un ve
 * Supabase'in belgelediği varsayılan mod budur.
 */
export function shouldUseSsl(databaseUrl: string): false | "require" {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return false;
  }

  const explicit = /[?&]sslmode=([a-z-]+)/i.exec(databaseUrl)?.[1];
  if (explicit === "disable") return false;
  if (explicit) return "require";

  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  return local ? false : "require";
}

function createDb(): Db {
  const url = env.databaseUrl;
  const client =
    globalForDb.__pgClient ??
    postgres(url, {
      // Sunucusuz ortamda küçük havuz yeterlidir; yerel PGlite sunucusu tek
      // bağlantı kabul ettiği için orada DB_POOL_MAX=1 verilir.
      max: Number.parseInt(process.env.DB_POOL_MAX ?? "5", 10) || 5,
      idle_timeout: 20,
      connect_timeout: 15,
      // Sunucusuz ortamda prepared statement önbelleği sorun çıkarır.
      // Neon/Supabase'in havuzlanmış (transaction mode) uç noktaları için
      // ayrıca zorunludur.
      prepare: false,
      ssl: shouldUseSsl(url),
    });

  const instance = drizzle(client, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__pgClient = client;
    globalForDb.__drizzle = instance;
  }
  return instance;
}

let cached: Db | null = null;

function getDb(): Db {
  if (globalForDb.__drizzle) return globalForDb.__drizzle;
  if (!cached) cached = createDb();
  return cached;
}

/** Gerçek bağlantı ilk erişimde kurulur. */
export const db = new Proxy({} as Db, {
  get(_target, property) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
/** Transaction içindeki `tx` nesnesi de bu tipi karşılar. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
