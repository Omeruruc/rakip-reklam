import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "./env";

/**
 * Basit kimlik doğrulama: e-posta allowlist + tek ortak şifre (§3).
 *
 * Oturum, HttpOnly çerezde taşınan HS256 imzalı bir token'dır. İmza doğrudan
 * Web Crypto ile yapılır — middleware Edge runtime'da çalıştığı için Node'a
 * özgü API kullanan bir kütüphaneye bağlanılmaz.
 */

export const SESSION_COOKIE = "rrt_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 gün

export type Session = { email: string };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  // Tamponu açıkça ArrayBuffer olarak ayır: crypto.subtle BufferSource bekler.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.authSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** E-posta allowlist kontrolü. Liste boşsa hiç kimse giremez. */
export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return env.allowedEmails.includes(normalized);
}

type Payload = { email: string; exp: number; iat: number };

export async function createSessionToken(email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Payload = {
    email: email.trim().toLowerCase(),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const body = `${toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))}.${toBase64Url(
    encoder.encode(JSON.stringify(payload)),
  )}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(),
    encoder.encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Geçersiz/süresi geçmiş token'da null döner — istisna fırlatmaz. */
export async function verifySessionToken(
  token: string | undefined,
): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const body = `${parts[0]}.${parts[1]}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(parts[2]),
      encoder.encode(body),
    );
    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(parts[1])),
    ) as Partial<Payload>;

    if (typeof payload.email !== "string" || !payload.email) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { email: payload.email };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  name: SESSION_COOKIE,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

/** Sunucu bileşenlerinde oturumu okur. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Oturum yoksa /login'e yönlendirir. Middleware zaten engelliyor;
 * bu, server action ve sayfa seviyesinde ikinci savunma hattı (AC-11).
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
