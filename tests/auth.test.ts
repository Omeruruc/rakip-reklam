import { describe, expect, it } from "vitest";

process.env.AUTH_SECRET = "test-secreti-en-az-otuz-iki-karakter-uzunlugunda";
process.env.ALLOWED_EMAILS = "Omer.Uruc@branchsight.com, ikinci@sirket.com";

const { createSessionToken, verifySessionToken, isEmailAllowed } = await import(
  "@/lib/auth"
);

describe("e-posta allowlist (AC-11)", () => {
  it("izinli e-postayı büyük/küçük harf duyarsız kabul eder", () => {
    expect(isEmailAllowed("omer.uruc@branchsight.com")).toBe(true);
    expect(isEmailAllowed("  OMER.URUC@BRANCHSIGHT.COM ")).toBe(true);
    expect(isEmailAllowed("ikinci@sirket.com")).toBe(true);
  });

  it("listede olmayanı reddeder", () => {
    expect(isEmailAllowed("baskasi@sirket.com")).toBe(false);
    expect(isEmailAllowed("")).toBe(false);
  });
});

describe("oturum token'ı", () => {
  it("üretilen token doğrulanır", async () => {
    const token = await createSessionToken("Omer.Uruc@branchsight.com");
    expect(await verifySessionToken(token)).toEqual({
      email: "omer.uruc@branchsight.com",
    });
  });

  it("imzası bozulmuş token reddedilir", async () => {
    const token = await createSessionToken("omer.uruc@branchsight.com");
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}xx`;
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("içeriği değiştirilmiş token reddedilir", async () => {
    const token = await createSessionToken("omer.uruc@branchsight.com");
    const parts = token.split(".");
    const fakePayload = Buffer.from(
      JSON.stringify({
        email: "saldirgan@kotu.com",
        exp: Math.floor(Date.now() / 1000) + 999,
        iat: 0,
      }),
    ).toString("base64url");
    expect(
      await verifySessionToken(`${parts[0]}.${fakePayload}.${parts[2]}`),
    ).toBeNull();
  });

  it("biçimsiz ve boş token reddedilir", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("abc")).toBeNull();
    expect(await verifySessionToken("a.b.c")).toBeNull();
  });
});
