import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  isEmailAllowed,
  sessionCookieOptions,
} from "@/lib/auth";
import { env } from "@/lib/env";

const schema = z.object({
  email: z.string().email("Geçerli bir e-posta girin."),
  password: z.string().min(1, "Şifre gerekli."),
});

/**
 * Basit kimlik doğrulama: e-posta allowlist + tek ortak şifre (§3).
 * Şifre ve allowlist yalnızca ortam değişkeninde tutulur (AC-11).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
      { status: 400 },
    );
  }

  const { email, password } = parsed.data;

  // Sabit mesaj: hangi bilginin yanlış olduğu sızdırılmaz.
  const invalid = NextResponse.json(
    { error: "E-posta veya şifre hatalı." },
    { status: 401 },
  );

  if (!isEmailAllowed(email)) return invalid;
  if (password !== env.authPassword) return invalid;

  const token = await createSessionToken(email);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ ...sessionCookieOptions, value: token });
  return response;
}
