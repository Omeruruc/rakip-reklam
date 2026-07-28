import { config } from "./env";

/**
 * Kanonik Ad Library sorgusu (MVP özeti §2).
 * Resmî API ticari reklam döndürmediği için tarama bu URL üzerinden yapılır.
 */
export function adLibraryUrl(pageId: string): string {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: config.adType,
    country: config.country,
    view_all_page_id: pageId,
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

/** Tek bir reklamın Ad Library sayfası — Slack mesajındaki birinci bağlantı. */
export function adLibraryAdUrl(adArchiveId: string): string {
  const params = new URLSearchParams({
    id: adArchiveId,
    country: config.country,
    view_all_page_id: "",
  });
  params.delete("view_all_page_id");
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

export function instagramProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "")}/`;
}

/**
 * Instagram adresinden handle çıkarır: instagram.com/xyz/ -> xyz
 *
 * Kabul edilen girdiler: tam URL, protokolsüz URL, "@xyz", düz "xyz".
 * Profil olmayan yollar (/p/, /reel/, /explore/ ...) reddedilir — bunlar
 * gönderi linkidir, hesap linki değil.
 */
const NON_PROFILE_SEGMENTS = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "stories",
  "tv",
  "accounts",
  "direct",
  "s",
]);

export function extractInstagramHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = String(input).trim();
  if (!value) return null;

  // Excel hücresinde "…/lovayatak.bandirma/" gibi kısaltılmış gösterim olabilir.
  value = value.replace(/^…+/, "").replace(/^\.\.\./, "");

  if (value.startsWith("@")) value = value.slice(1);

  if (/instagram\.com/i.test(value)) {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    let pathname: string;
    try {
      pathname = new URL(withProtocol).pathname;
    } catch {
      return null;
    }
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const first = segments[0].toLowerCase();
    if (NON_PROFILE_SEGMENTS.has(first)) return null;
    value = segments[0];
  } else if (value.includes("/")) {
    // "…/lovayatak.bandirma/" gibi alan adı olmayan yol parçası.
    const segments = value.split("/").filter(Boolean);
    value = segments[segments.length - 1] ?? "";
  }

  value = value.split("?")[0].split("#")[0].trim();
  if (!value) return null;

  // Instagram handle kuralı: harf, rakam, alt çizgi, nokta.
  if (!/^[A-Za-z0-9._]{1,30}$/.test(value)) return null;
  return value.toLowerCase();
}

/**
 * Facebook sayfa adresinden numeric page id çıkarır (elle giriş yardımcısı).
 * Sayısal olmayan vanity adres (facebook.com/lovayatak) page id vermez —
 * bu durumda null döner ve kullanıcı Page ID'yi elle girmek zorundadır.
 */
export function extractPageId(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = String(input).trim();
  if (!value) return null;

  if (/^\d{5,}$/.test(value)) return value;

  // Ad Library'de tek bir reklamın adresi ?id=<ad_archive_id> biçimindedir.
  // Bu sayı REKLAM kimliğidir, Page ID değildir ("Kütüphane Kodu" olarak
  // görünür) ve uzunluğu Page ID'den ayırt edilemez. Sessizce yanlış sayfayı
  // onaylamamak için bu adres açıkça reddedilir; kullanıcı sayfanın kendi
  // adresini (view_all_page_id) getirmek zorunda kalır.
  if (/\/ads\/library/i.test(value) && !/view_all_page_id=/i.test(value)) {
    return null;
  }

  const patterns = [
    /view_all_page_id=(\d+)/i,
    /profile\.php\?id=(\d+)/i,
    // Yeni biçim sayfa adresi: facebook.com/people/Sayfa-Adi/100092524512123/
    // Reklam kartındaki sayfa adına tıklandığında bu adrese düşülür.
    /facebook\.com\/people\/[^/?#]*\/(\d{5,})/i,
    /facebook\.com\/(\d{5,})(?:[/?#]|$)/i,
    /page_id[=:"']+(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}
