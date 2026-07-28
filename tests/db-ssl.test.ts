import { describe, expect, it } from "vitest";

process.env.DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/postgres";
process.env.AUTH_SECRET = "test";
process.env.AUTH_PASSWORD = "test";

const { shouldUseSsl } = await import("@/db");

/**
 * Bu testin varlık nedeni: TLS kararı yanlış olursa hata yalnızca dağıtımda
 * görünür. Neon şifrelenmemiş bağlantıyı reddeder, yerel PGlite ise TLS
 * sunmaz — aynı kod ikisinde de çalışmak zorunda.
 */
describe("TLS kararı", () => {
  it("yerel bağlantılarda TLS istemez", () => {
    expect(shouldUseSsl("postgresql://u:p@127.0.0.1:5432/postgres")).toBe(false);
    expect(shouldUseSsl("postgresql://u:p@localhost:5432/postgres")).toBe(false);
  });

  it("uzak sunucularda adreste belirtilmese bile TLS ister", () => {
    expect(
      shouldUseSsl(
        "postgresql://u:p@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb",
      ),
    ).toBe("require");
    expect(
      shouldUseSsl(
        "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("require");
  });

  it("adreste sslmode=require varsa onu uygular", () => {
    expect(
      shouldUseSsl("postgresql://u:p@host.neon.tech/db?sslmode=require"),
    ).toBe("require");
  });

  it("sslmode=disable açıkça verilmişse TLS kullanmaz", () => {
    expect(
      shouldUseSsl("postgresql://u:p@host.example.com/db?sslmode=disable"),
    ).toBe(false);
  });

  it("çözümlenemeyen adreste TLS'i zorlamaz (anlaşılır hata için)", () => {
    expect(shouldUseSsl("bozuk-adres")).toBe(false);
  });
});
