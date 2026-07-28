import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * AC-11: kimliği doğrulanmamış istek hiçbir rotaya erişemez.
 *
 * Tek istisna /api/inngest — Inngest kendi HMAC imzasıyla doğrulanır
 * (INNGEST_SIGNING_KEY). Üretimde bu anahtar tanımlı olmak zorundadır.
 */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/inngest"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const session = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
  );

  // Girişli kullanıcı login sayfasında oyalanmasın.
  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (isPublic || session) return NextResponse.next();

  // API isteklerine yönlendirme değil 401 döner.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // _next/static, _next/image ve favicon dışındaki her şey.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
