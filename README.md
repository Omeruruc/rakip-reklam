# Rakip Reklam Takip Sistemi

Rakiplerin Meta reklamlarını her gün tarar, önceki durumla karşılaştırır ve
**yalnızca değişiklikleri** tek bir Slack kanalına bildirir.

`Next.js (App Router) · Postgres + Drizzle · Inngest · Apify · Slack · Vercel`

```
Excel / Arayüz  →  Page eşleştirme  →  Günlük tarama  →  Fark analizi  →  Slack
bayi–rakip listesi   insan onaylı      Inngest + Apify    yeni / duran     tek kanal
```

---

## 1. Hızlı başlangıç

```bash
npm install
cp .env.example .env.local          # değerleri doldurun (bkz. §3)
```

### A) Yerel veritabanı ile (Docker/Postgres kurmadan)

Sırayı bozmayın: veritabanı önce açılır, uygulama sonra bağlanır.

```bash
# 1. terminal — açık kalır, göçleri kendi uygular
npm run db:local

# 2. terminal
npm run db:seed                     # pilot marka + örnek bayi/rakip
npm run dev                         # http://localhost:3000
npm run inngest:dev                 # 3. terminal: cron + fonksiyonlar
```

`.env.local` içinde şu iki satır gerekir:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/postgres"
DB_POOL_MAX="1"
```

> **PGlite tek bağlantı kabul eder.** Bu yüzden `db:local` göçleri açılışta iç
> süreçte uygular — ayrıca `npm run db:migrate` çalıştırmanız **gerekmez**.
> Dev sunucusu açıkken `drizzle-kit` / `db:studio` gibi ikinci bir araçla
> bağlanmaya çalışırsanız `ECONNRESET` alırsınız; önce dev sunucusunu kapatın.
> `npm test` kendi bellek içi veritabanını kullandığı için bundan etkilenmez.

**Veri nerede tutulur:** `~/.local/share/rakip-reklam/pglite`

Proje klasörünün **dışında**, bilinçli olarak. Veri proje içinde olsaydı
`git clean -fdx` (gitignore'lanmış dosyaları da siler) tek komutla tüm
eşleştirme emeğini yok edebilirdi; ayrıca sürekli yazılan WAL dosyası Next ve
vitest izleyicilerini boşuna tetiklerdi. Başka bir yol istiyorsanız
`LOCAL_DB_DIR` ile verin.

Yedek almak = klasörü kopyalamak. PGlite'ın otomatik yedeği yoktur:

```bash
cp -R ~/.local/share/rakip-reklam/pglite \
      ~/.local/share/rakip-reklam/pglite-yedek-$(date +%Y%m%d)
```

### B) Gerçek Postgres ile (Neon / Supabase / kurulu Postgres)

**Pilot için önerilen yol.** PGlite tek bağlantı kabul eder, otomatik yedeği
yoktur ve bilgisayar kapalıyken cron çalışmaz — 14 günlük pilotta günlük tarama
yapılacağı için bunların üçü de sorun olur.

```bash
# .env.local:
#   DATABASE_URL=<neon adresi>      DB_POOL_MAX ve DIRECT_DATABASE_URL satırlarını silin
npm run db:migrate
npm run db:seed        # yeni kurulumda; mevcut veriyi taşıyacaksanız atlayın
npm run dev
```

TLS ayrı bir ayar gerektirmez: `shouldUseSsl()` adresten karar verir —
uzak sunucularda `sslmode` yazılmasa bile TLS zorunlu, yerelde kapalı
(`tests/db-ssl.test.ts`).

**Mevcut yerel veriyi taşımak** (eşleştirmeler dahil, dev sunucusu kapalıyken):

```bash
DATABASE_URL="<neon>" npm run db:migrate        # hedefte şemayı oluştur
npm run db:transfer -- --target "<neon>"        # veriyi taşı ve doğrula
```

Betik kimlikleri korur, yabancı anahtarları bozmaz, dizi sayaçlarını en büyük
kimliğin üstüne çeker ve sonunda tablo tablo satır sayılarını karşılaştırır.
Hedefte veri varsa reddeder (`--force` ile üzerine yazılır).

### Doğrulama

```bash
npm test           # 147 test (birim + gerçek SQL) — veritabanı gerektirmez
npm run typecheck
npm run build
```

## 2. İLK İŞ: Apify doğrulaması

> Projenin tek gerçek belirsizliği Apify actor'ünün Türkiye verisinde ne
> döndürdüğü. Kod bu belirsizliğe dayanacak şekilde yazıldı, ama **veri modelini
> kesinleştirmek için ilk iş bu doğrulama**.

```bash
npm run verify:actor -- --pages 100064812345678,100078912345678
npm run verify:actor -- --actor apify/facebook-ads-scraper --mode startUrls --pages 100064812345678
```

Betik şunları raporlar ve `.apify-verify/` altına JSON olarak yazar:

| Rapor | Neden önemli |
| --- | --- |
| Hangi girdi biçimi kabul edildi | `APIFY_INPUT_MODE` bu değere ayarlanır |
| Dolu gelen alanlar (metin, görsel, tarih…) | Slack mesajında ne gösterilebileceğini belirler |
| **`page_id` dönüyor mu** | Dönmüyorsa marka başına tek toplu çalıştırma sonuçları rakiplere atanamaz |
| Süre ve maliyet | Aylık Apify bütçesi hesabı (soru 4) |

**Page ID nasıl bulunur:** `facebook.com/ads/library` adresinde rakibi arayın,
URL'deki `view_all_page_id` değerini alın.

İki actor'ü de deneyip kazananı `.env.local`'e yazın. Actor bozulduğunda
(Meta arayüz değişikliği) **kod değişmeden** yalnızca `APIFY_ACTOR_ID`
güncellenir.

### Actor değişirse ne yapılır

`src/lib/normalize.ts` alanları tek tek **aday yol listeleriyle** arar
(`snapshot.body.text`, `ad_creative_body`, `body`, …). Yeni actor farklı bir alan
adı kullanıyorsa ilgili listeye tek satır eklemek yeterlidir; başka hiçbir yer
değişmez. `verify:actor` çıktısında bir alan `← BOŞ` görünüyorsa eksik yol budur.

## 3. Ortam değişkenleri

Tamamı `.env.example` içinde açıklamalı. Kritik olanlar:

| Değişken | Not |
| --- | --- |
| `DATABASE_URL` | Neon / Supabase / yerel |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ALLOWED_EMAILS` | Girişe izinli e-postalar (virgüllü) |
| `AUTH_PASSWORD` | Tek ortak giriş şifresi |
| `SLACK_WEBHOOK_URL` | **Tek** bildirim kanalı. Asla DB'ye yazılmaz, arayüzde görünmez (AC-11) |
| `SLACK_ALERT_WEBHOOK_URL` | Teknik alarm kanalı; boşsa ana kanala düşer |
| `APIFY_TOKEN`, `APIFY_ACTOR_ID`, `APIFY_INPUT_MODE` | Veri kaynağı |
| `APIFY_PAGE_SEARCH_ACTOR_ID` | Opsiyonel: eşleştirme ekranına aday sayfa getirir |
| `INNGEST_SIGNING_KEY` | **Üretimde zorunlu** — `/api/inngest` bu imza ile korunur |
| `NOTIFY_BURST_LIMIT` | Tek taramada bundan fazla yeni reklam varsa tek toplu mesaj (varsayılan 25) |
| `DB_POOL_MAX` | Yerel PGlite için `1`; üretimde boş bırakın |
| `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Opsiyonel Sheets senkronu; üçü de boşsa özellik sessizce kapalı kalır (§14) |
| `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` | Yalnızca tek seferlik `slack:pin-sheet` betiği için — tarama akışını etkilemez (§14) |

## 4. Ekranlar

| Rota | İçerik |
| --- | --- |
| `/` | Pano — marka özetleri, son bildirimler, eşleştirme bekleyen sayısı, son tarama |
| `/brands` | Marka listesi + ekleme, aktif/pasif |
| `/brands/[id]/dealers` | Bayi tablosu — tekil ekleme, düzenleme, arama |
| `/brands/[id]/competitors` | Rakip tablosu — il / eşleştirme durumu / aktif reklam filtreleri |
| `/brands/[id]/import` | Excel sihirbazı — yükle → eşle → **önizle** → onayla |
| `/brands/[id]/matching` | Page eşleştirme — aday sayfalar, tek tıkla onay, elle Page ID, "sayfası yok" |
| `/ads` | Reklam akışı — kreatif görselleriyle, marka/il/tarih/durum filtreli |
| `/runs` | Tarama geçmişi — durum, süre, bulunan reklam, maliyet, hata, actor |

Kimlik doğrulama `src/middleware.ts` içinde: oturumsuz istek hiçbir rotaya
erişemez, API istekleri 401 döner. Tek istisna `/api/inngest` — o da Inngest'in
HMAC imzasıyla doğrulanır. Server action'lar ayrıca `requireSession()` çağırır
(ikinci savunma hattı).

## 5. Excel içe aktarma

Gerçek dosyalarda bayi bilgileri **gruplandırılmış**: bayi adı / il / adres
yalnızca grubun ilk satırında dolu, alt satırlar boş, arada boş ayraç satırları
var.

```
Bayi Adı                 İl          Rakip Mağaza Adı        Instagram
İşbir Yatak Bandırma     Balıkesir   Bandırma Lova Yatak     …/lovayatak.bandirma/
(boş)                    (boş)       Puffy Bandırma          …/puffybandirma/
(boş)                    (boş)       Bambi Yatak Ayna AVM    …/ayna.bambiyatak/
```

Kurallar (`src/lib/excel.ts`):

- **Aşağı doldurma:** boş bayi/il/adres hücreleri bir üstteki dolu değerden
  gelir. Bayi adı dolu bir satır **yeni grup** başlatır ve il/adres bağlamını
  sıfırlar — önceki bayinin ili yeni bayiye bulaşmaz.
- **Boş ayraç satırları** atlanır, doldurma bağlamını bozmaz.
- **Doğrulama:** bayi adı ve rakip adı zorunlu. Instagram adresinden handle
  çıkarılır (`instagram.com/xyz/ → xyz`); gönderi/reel linkleri hesap sayılmaz,
  uyarı üretir ve kayıt Instagram'sız oluşur.
- **Eşleştirme korunur:** aynı dosya tekrar yüklendiğinde onaylanmış Page ID'ler
  sıfırlanmaz. Kimlik anahtarı: önce Instagram handle, yoksa rakip adı.
- **Otomatik silme yok:** dosyada olmayan kayıtlar silinmez; onay sonrası
  "pasife alınsın mı?" sorulur.
- Önizleme aşamasında **veritabanına hiçbir şey yazılmaz**; onaydan sonra tek
  transaction içinde upsert yapılır.

Denemek için örnek dosya: `npm run excel:sample` → `ornek-bayi-rakip.xlsx`
(gruplandırılmış satırlar, boş ayraçlar, eksik ve bozuk Instagram, mükerrer
satır içerir).

**Instagram düzeltilirse:** aynı bayi + aynı rakip adı ama farklı handle
görülürse eşleştirme `unverified`'a döner (çünkü onaylanan sayfa artık yanlış
olabilir). `fb_page_id` **silinmez**, öneri olarak kalır — manuel iş çöpe
atılmaz.

## 6. Tarama ve bildirim

| Fonksiyon | Tetikleyici | Görev |
| --- | --- | --- |
| `schedule-scans` | Cron · her gün 08:00 TR | Aktif markalar için tarama olayı yayınlar |
| `scan-brand` | `brand/scan.requested` | Apify'ı başlatır, yoklar, normalize eder, fark analizini yapar |
| `notify-slack` | `ad/change.detected` | Sabit kanala mesajı gönderir, bildirimi kaydeder |
| `weekly-digest` | Cron · Pazartesi 09:00 TR | Tüm markaları kapsayan tek haftalık özet |

Eşzamanlılık 3, retry 3.

**Apify beklenmez, yoklanır.** `scan-brand` actor'ü `start` ile başlatır, sonra
30 saniyelik `step.sleep` aralarıyla durumu yoklar. Böylece her Inngest step'i
kısa kalır ve Vercel'in istek süresi sınırı sorun olmaz. Geçici hatada fonksiyon
yeniden denenir; `attempt` step kimliklerine girdiği için **yeni bir Apify
çalıştırması** başlatılır (eski hatalı run sonsuza dek yoklanmaz).

### Fark analizi

- DB'de olmayan `ad_archive_id` → **yeni reklam** → anlık bildirim
- DB'de aktif, taramada yok → **duran reklam** → haftalık özet
- İkisinde de var → yalnızca `last_seen_at` → **bildirim yok**

### İki değişmez kural

1. **"Hâlâ aktif" bildirimi asla gönderilmez.** Yalnızca durum değişikliği
   bildirilir.
2. **Sıfır sonuç = arıza varsayımı.** Boş dönen tarama "hiçbir rakip reklam
   vermiyor" diye yorumlanmaz: hiçbir reklam pasife alınmaz, hiçbir bildirim
   gitmez, tarama `failed` işaretlenir ve teknik alarm kanalına mesaj düşer.

Ek koruma: **yalnızca başarıyla taranan rakiplerin** reklamları durdurulabilir.
Bir rakip için Apify hata verdiyse o rakibin reklamlarına dokunulmaz — aksi
halde geçici bir hata "tüm reklamlar durdu" bildirimine dönüşürdü.

### Mükerrer bildirim neden imkânsız

`notifications` tablosunda `UNIQUE (ad_archive_id, type)` var ve satır Slack'e
**yazmadan önce** eklenir ("sahiplenme"). İkinci deneme çakışır ve mesaj
gönderilmez. Eşzamanlı iki çalıştırmadan yalnızca biri sahiplenebilir. Slack
kalıcı olarak reddederse sahiplenme geri alınır ve kayıt `/ads` ekranında
"Bildirilmedi" olarak görünür.

**Bilinçli ödünç:** durdurulmuş bir reklam haftalar sonra yeniden başlarsa ikinci
bir "yeni reklam" mesajı gitmez (aynı `ad_archive_id` için `new_ad` bildirimi
zaten var). Yanıp sönen reklamların kanalı doldurmaması bilerek tercih edildi;
reklam `/ads` ekranında yeniden aktif görünür ve haftalık özete girer.

**Ani artış koruması:** tek taramada `NOTIFY_BURST_LIMIT`'ten (varsayılan 25)
fazla yeni reklam bulunursa tek tek mesaj yerine rakip bazında kırılım içeren
**tek** toplu mesaj gönderilir. İlk taramanın kanalı boğmasını engeller;
reklamların hepsi bildirilmiş sayılır, bir daha mesaj üretmezler.

### Slack mesajı

```
🔴 Yeni Rakip Reklamı — İşbir Yatak
Bayi           İşbir Yatak Bandırma · Balıkesir
Rakip          Bandırma Lova Yatak · @lovayatak.bandirma
Başlangıç      16.07.2026 · Instagram, Facebook
Aktif reklam   2 kampanya
  "Yaz indirimi başladı! %40'a varan fırsatlar…"
[ reklam kreatif görseli ]
[ Ad Library'de Aç ]  [ Instagram Profili ]  [ Panelde Gör ]
```

Tüm markalar aynı kanalı kullandığı için **marka adı mesaj başlığında**.

## 7. Kabul kriterleri — durum

Otomatik doğrulananlar `npm test` ile çalışır (147 test). Veritabanına dokunan
testler PGlite üzerinde **gerçek Postgres SQL** çalıştırır — UNIQUE kısıtları,
`ON CONFLICT` davranışı ve transaction taklit edilmez.

| No | Kriter | Durum |
| --- | --- | --- |
| AC-01 | Önizleme doğru sayıları gösterir, hiçbir kayıt yazılmaz | ✅ `tests/import-db.test.ts` |
| AC-02 | Boş bayi hücreli satırlar doğru bayiye bağlanır, ayraçlar atlanır | ✅ `tests/excel.test.ts`, `import-db` |
| AC-03 | Aynı dosya ikinci kez: sıfır yeni kayıt, eşleştirmeler bozulmaz | ✅ `tests/import-db.test.ts` |
| AC-04 | Yeni rakip `unverified` başlar, taranmaz; onayla `matched` olur | ✅ `import-db`, `scan-db` |
| AC-05 | İlk tarama sonrası kayıt oluşur, tam olarak bir bildirim | ✅ `tests/scan-db.test.ts` |
| AC-06 | İkinci taramada ikinci bildirim yok, yalnızca `last_seen_at` | ✅ `tests/scan-db.test.ts` |
| AC-07 | Sıfır sonuçta pasife alma yok, bildirim yok, `failed` + alarm | ✅ `scan-db`, `diff` |
| AC-08 | Geçici hatada yeniden denenir, mükerrer bildirim oluşmaz | ✅ kısıt + sahiplenme testleri |
| AC-09 | İki marka aynı gün taranır, mesaj başlığında marka adı | ✅ `scan-db`, `slack` |
| AC-10 | Mesaj tüm alanları ve üç doğru bağlantıyı içerir | ✅ `tests/slack.test.ts` |
| AC-11 | Oturumsuz istek hiçbir rotaya erişemez; webhook yalnızca env'de | ✅ `tests/auth.test.ts` + canlı istek denemesi |
| AC-12 | Pilotta 14 gün sonunda sahte pozitif < %5 | ⏳ **pilot çalıştırması gerekir** |

AC-12 kod tamamlanmasıyla değil, pilot markanın 14 günlük gözlemiyle kapanır
(§9). Gerçek Apify verisiyle uçtan uca tarama da **`APIFY_TOKEN` ve onaylanmış
Page ID'ler olmadan denenemedi** — bu adım için bkz. §2.

## 8. Kod haritası

```
src/
  middleware.ts              oturum kontrolü — tüm rotalar
  db/schema.ts               7 tablo + kısıtlar (kritik: notifications, sheet_syncs UNIQUE)
  lib/
    excel.ts                 aşağı doldurma, kolon tespiti, doğrulama (saf)
    workbook.ts              SheetJS okuma (yalnızca sunucu)
    normalize.ts             actor çıktısı → iç şema (aday yol listeleri)
    diff.ts                  fark analizi + sıfır sonuç kuralı (saf)
    slack.ts                 mesaj kurucular + gönderim
    sheets.ts                Sheets satır kurucu (saf) + Google Sheets yazıcı
    apify.ts                 başlat / yokla / dataset çek
    adlibrary.ts             kanonik URL, handle & Page ID çıkarma
    auth.ts                  allowlist + Web Crypto imzalı oturum
  server/
    import.ts                önizleme (yazma yok) + tek transaction upsert
    scan.ts                  tarama kayıtları, uygulama, bildirim sahiplenme
    sheet-sync.ts            Sheets senkron sahiplenme (notifications'tan bağımsız)
    digest.ts                haftalık özet verisi
    queries.ts               arayüz okumaları
    actions.ts               tüm mutasyonlar (server actions)
  inngest/functions/         schedule-scans, scan-brand, notify-slack, sync-sheet-row, weekly-digest
scripts/
  verify-actor.ts            İŞ #1: actor doğrulaması ve alan kapsamı raporu
  local-db.ts                Docker'sız yerel Postgres
  make-sample-excel.ts       gerçekçi örnek dosya
  seed.ts                    pilot marka
  pin-sheet-link.ts          Sheets linkini Slack'e gönder + pinle (§14, tek seferlik)
```

## 9. Pilot kontrol listesi

1. `npm run verify:actor` ile actor'ü doğrula, `APIFY_ACTOR_ID` /
   `APIFY_INPUT_MODE` değerlerini sabitle.
2. Excel'i içe aktar, `/brands/[id]/matching` ekranından **tüm** rakipleri
   eşleştir. Eşleşmeyen rakip taranmaz — panoda "eşleştirme bekleyen" sayısı 0
   olmalı.
3. `/brands` → "Şimdi tara" ile elle bir tarama çalıştır; `/runs` ekranında
   bulunan reklam, maliyet ve süreyi kontrol et.
4. Slack'e düşen ilk mesajları Ad Library'de tek tek doğrula (yanlış Page
   eşleşmesi sahte bildirim üretir).
5. 14 gün boyunca günlük bildirimleri işaretle; sahte pozitif oranını ölç
   (AC-12).

## 10. Riskler ve alınan önlemler

| Risk | Önlem |
| --- | --- |
| Actor bozulur (Meta arayüz değişikliği) | Sıfır sonuçta teknik alarm; yedek actor `APIFY_ACTOR_ID` ile kod değişmeden devreye; normalize katmanı aday yol listeleriyle çalışır; **veri asla otomatik silinmez** |
| Yanlış Page eşleşmesi → sahte bildirim | İnsan onayı zorunlu; onaylayan kişi ve zaman kaydedilir (`matched_by`, `matched_at`); Instagram değişirse onay geri alınır; eşleştirme geri alınabilir |
| Bildirim gürültüsü | Yalnızca durum değişikliği; ani artışta tek toplu mesaj; "reklam durdu" haftalık özete |
| Apify maliyeti | Reklam başına ücretlendirme; her run'ın maliyeti `scrape_runs.cost_usd` içinde loglanır, `/runs` ve panoda görünür (bkz. §13) |
| Actor `page_id` döndürmez | Atanamayan kayıtlar yazılmaz, sayılır ve teknik alarm düşer; `verify:actor` bunu baştan raporlar |
| Reklam görseli linkleri geçersizleşir | Meta CDN linkleri süreli. **MVP'de görseller kopyalanmıyor**, yalnızca link tutuluyor (soru 3 cevaplanınca `ads.image_url` yanına depolama eklenir) |

## 11. Cevaplanması gereken sorular

Kod bu soruların hiçbirini bloke etmiyor; cevaplar operasyonel ayarları
değiştirir.

| No | Soru | Kodda karşılığı |
| --- | --- | --- |
| 1 | Toplam marka / bayi / rakip sayısı? | Apify maliyeti doğrudan buna bağlı: dönen her reklam için ücret ödenir (bkz. §13) |
| 2 | Page eşleştirmesini kim yapacak? | `/brands/[id]/matching` ekranı hazır; `matched_by` alanı kimin onayladığını tutar. **Sahiplenilmezse pilot başlamaz** |
| 3 | Reklam görselleri arşivlensin mi? | Şu an yalnızca CDN linki tutuluyor. Arşiv gerekirse `ads.image_url` yanına kopyalama adımı eklenir |
| 4 | Aylık Apify bütçe sınırı? | Maliyet loglanıyor; sınır Apify hesabından + tarama sıklığından ayarlanır |

Ek karar önerisi: `NOTIFY_BURST_LIMIT` varsayılanı 25. İlk tarama yüzlerce
reklam bulacaksa bu değeri düşük tutmak kanalı korur.

## 12. Neon mu Supabase mi

İkisi de düz Postgres; kodda hiçbir değişiklik gerekmez, yalnızca
`DATABASE_URL` değişir. Seçimi belirleyen iki nokta var.

### Supabase seçilirse: RLS zorunlu

Supabase, `public` şemasındaki tabloları otomatik olarak PostgREST üzerinden
HTTP'ye yayınlar ve projenin `anon` anahtarı tasarım gereği herkese açıktır.
Drizzle'ın oluşturduğu tablolarda RLS varsayılan olarak **kapalıdır** — yani
o anahtarı bilen biri `competitors`, `ads`, `dealers` tablolarını REST API'den
okuyabilir, hatta yazabilir. Bu **AC-11'i doğrudan ihlal eder**; istek
uygulamaya hiç gelmediği için `src/middleware.ts` bu kapıyı korumaz.

Göçlerden sonra bir kez çalıştırın — politikasız RLS herkese kapalı demektir,
uygulama doğrudan Postgres bağlantısıyla geldiği için etkilenmez:

```sql
alter table brands        enable row level security;
alter table dealers       enable row level security;
alter table competitors   enable row level security;
alter table ads           enable row level security;
alter table scrape_runs   enable row level security;
alter table notifications enable row level security;
```

Neon'da böyle bir yüzey yoktur; yalnızca Postgres protokolü vardır.

### Bağlantı adresleri

| | Uygulama (`DATABASE_URL`) | Göçler (`DIRECT_DATABASE_URL`) |
| --- | --- | --- |
| **Neon** | Verdiği adres | boş bırakın |
| **Supabase** | Pooler, port **6543** (transaction mode) | Direct, port **5432** |

Transaction mode prepared statement desteklemez; `src/db/index.ts` içinde
`prepare: false` zaten bu yüzden ayarlı. Kodda oturum düzeyi özellik
(LISTEN/NOTIFY, advisory lock) kullanılmıyor, `db.transaction()` çağrıları
transaction mode ile uyumludur.

### Diğer farklar

| | Neon | Supabase |
| --- | --- | --- |
| Boşta kalma | Otomatik askıya alır, ilk istekte kendiliğinden kalkar | Ücretsiz planda bir haftalık hareketsizlikte **projeyi duraklatır**, elle geri almak gerekir |
| Bu projeye ekstra faydası | — | Görsel arşivlemeye karar verilirse (soru 3) Storage aynı projede hazır |
| Kurulum yükü | Daha az (sadece Postgres) | RLS adımı zorunlu |

Günlük tarama çalıştığı sürece Supabase duraklatma sorunu çıkarmaz; pilot
bittikten sonra bir hafta dokunulmazsa duraklar. Depolama tahminleri için §13.

## 13. Apify maliyeti — ölçülmüş

Actor `curious_coder/facebook-ads-library-scraper` **PAY_PER_EVENT** modelinde:
**dönen her reklam kaydı için $0.00075**. Süre, çalıştırma sayısı ve taranan
sayfa sayısı faturayı etkilemez — yalnızca kaç reklam döndüğü etkiler.

Gerçek ölçümler (bu kurulumdan):

| Tarama | Rakip | Dönen reklam | Maliyet | Süre |
| --- | --- | --- | --- | --- |
| #1 | 1 | 5 | $0.0038 | 32 sn |
| #2 | 2 | 15 | $0.0113 | 32 sn |

İkisi de reklam başına $0.00075'e denk geliyor.

### Bunun anlamı

- **Toplu çalıştırma para kazandırmaz** (run başına ücret yok), ama gecikmeyi ve
  hız sınırı riskini azaltır. Marka başına tek run yine doğru tercih.
- **Tarama sıklığını azaltmak** maliyeti doğrudan düşürür: her tarama tüm aktif
  reklamları yeniden çeker. Günde bir yerine iki günde bir tarama, maliyeti
  yarıya indirir — bildirim gecikmesi karşılığında.
- **`APIFY_LIMIT_PER_SOURCE`'u düşürmek** yalnızca çok reklamı olan rakiplerde
  fark yaratır ve risklidir (aşağıya bakın). Az reklamı olan rakipte 100 yazmak
  fazladan ödeme getirmez.

### Aylık tahmin

Rakip başına ortalama **N** aktif reklam, **R** taranan rakip, günde bir tarama:

```
aylık maliyet ≈ R × N × 30 × $0.00075
```

| Taranan rakip | Rakip başına reklam | Aylık |
| --- | --- | --- |
| 56 | 5 | ~$6.3 |
| 56 | 10 | ~$12.6 |
| 200 | 5 | ~$22.5 |
| 200 | 10 | ~$45 |

Bu, pilot ölçeğinde önemsiz bir tutar. Asıl maliyet kalemi Apify değil, Page
eşleştirmesinin insan emeği.

### Sınır alanı — dikkat

Actor'ün iki farklı sınır alanı var ve karıştırılması sessiz veri kaybına
yol açar:

| Alan | Anlamı | Kullanıyor muyuz |
| --- | --- | --- |
| `count` | **Tüm çalıştırma** için toplam kayıt sınırı | ❌ asla |
| `limitPerSource` | **Her URL** (yani her rakip) için sınır | ✅ evet |

`count` kullanılsaydı: 56 rakip taranırken sınıra ilk ulaşan rakiplerden
sonrakilerin reklamları hiç gelmez, fark analizi onları "taramada yok" sanıp
**DURMUŞ** işaretler ve yanlış "reklam durdu" raporu üretirdi. Maliyet düşük
görünür, veri yanlış olurdu. `tests/apify.test.ts` bu tercihi kilitliyor.

Aynı mantıkla sıralama `most_recent`: sınıra takılan bir rakipte en yeni
reklamlar korunur. Actor'ün varsayılanı `impressions_desc` olsaydı, yeni
başlamış ve az gösterim almış bir kampanya sınırın dışında kalabilirdi — tam
olarak kaçırmak istemediğimiz şey.

`scrapeAdDetails` kapalı: yalnızca AB erişim bilgisi ekliyor, bu sistemde
kullanılmıyor. Kapatmak veri kalitesini düşürmedi (canlı doğrulamada 5/5 kayıtta
metin, görsel, tarih ve platform yine dolu geldi).

### Maliyeti nereden izlersiniz

- `/runs` ekranı — her taramanın maliyeti ve dönen reklam sayısı
- Pano — son 7 günün toplamı
- Apify hesabında aylık harcama limiti koymak son güvence

## 14. Google Sheets senkronu ve Slack pinleme

Slack'teki tek tek bildirimlerin yanında, her yeni rakip reklamı otomatik
olarak bir Google Sheets tablosuna satır olarak da eklenir. Bu, Slack
bildirimlerinden **tamamen bağımsız** çalışır: biri başarısız olsa diğerini
etkilemez (`sheet_syncs` tablosu `notifications`'tan ayrı tutulur, aynı
"önce sahiplen, sonra yaz" deseniyle — bkz. §6).

Kolonlar (sabit, bu sırayla):

| Reklam Tarihi | Rakip Bayi İsmi | URL | İnstagram Adresi | Bizdeki hangi bayinin rakibi | İl | İlçe |
| --- | --- | --- | --- | --- | --- | --- |

**İlçe kolonu şimdilik her zaman boştur.** Veri modelinde yalnızca İl
tutuluyor; ilçe hiç toplanmıyor. İleride eklenmek istenirse yalnızca
`src/lib/sheets.ts` içindeki `buildSheetRow` değişir, başka hiçbir yer
etkilenmez.

Üç ortam değişkeninden biri eksikse (`GOOGLE_SHEETS_ID`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) özellik
sessizce devre dışı kalır — mevcut tarama ve Slack akışı hiçbir şekilde
etkilenmez, hata da üretmez.

### A) Google Cloud servis hesabı (bir kerelik)

**A1. Proje oluşturun.**
[console.cloud.google.com](https://console.cloud.google.com) adresine gidin.
Google hesabınızla giriş yapılı değilseniz önce giriş isteyecek. Sayfanın
üstünde, logonun yanında bir proje seçici bulunur ("Select a project" ya da
zaten seçili bir proje adı). Ona tıklayın → sağ üstte **New Project** →
**Project name** alanına örneğin `rakip-reklam-takip` yazın → **Create**.
Oluşturma birkaç saniye sürer; üstteki bildirim zilinden takip edebilirsiniz.
Oluştuktan sonra üstteki proje seçiciden bu projeyi seçili hâle getirin
(yanlış proje seçiliyken sonraki adımlar farklı bir projede ilerler).

**A2. Sheets API'yi etkinleştirin.**
Sol üstteki ☰ (hamburger menü) → **APIs & Services → Library**
(veya arama çubuğuna "API Library" yazıp Enter). Açılan sayfanın arama
kutusuna `Google Sheets API` yazın, çıkan tek sonuca tıklayın, mavi
**Enable** düğmesine basın. Düğme "Manage" yazısına dönüşürse zaten etkin
demektir, tekrar tıklamanıza gerek yok.

**A3. Servis hesabı oluşturun.**
☰ → **APIs & Services → Credentials**. Üstte **+ CREATE CREDENTIALS** →
açılan listeden **Service account** seçin.
  - *Service account name:* `rakip-reklam-sheets` (istediğiniz bir ad olur,
    Google otomatik bir e-posta türetecek)
  - **CREATE AND CONTINUE**
  - "Grant this service account access to project" ekranı çıkar — rol
    seçmeden **CONTINUE** (bu servis hesabı yalnızca paylaştığınız TEK
    Sheet'e erişecek, proje geneline rol vermeye gerek yok)
  - Üçüncü adımı da boş geçip **DONE**

**A4. JSON anahtarını indirin.**
Az önce oluşan servis hesabının satırına (Credentials sayfasındaki listede)
tıklayın. Üstteki sekmelerden **KEYS**'e geçin → **ADD KEY** → **Create new
key** → tür olarak **JSON** işaretli kalsın → **CREATE**. Tarayıcı otomatik
olarak `<proje-adı>-xxxxxxx.json` gibi bir dosya indirir — bu dosyayı bir
daha indiremezsiniz, kaybederseniz yeni anahtar oluşturmanız gerekir.

**A5. İki değeri `.env.local`'e taşıyın.**
İndirilen JSON dosyasını bir metin editöründe açın. İçinde şuna benzer bir
yapı görürsünüz:

```json
{
  "type": "service_account",
  "client_email": "rakip-reklam-sheets@proje-adi.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n",
  ...
}
```

`.env.local`'e şu şekilde yapıştırın:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL="rakip-reklam-sheets@proje-adi.iam.gserviceaccount.com"
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
```

**En sık yapılan hata burada olur — dikkat:**
`private_key` değerini JSON'daki gibi, **çift tırnak içinde, `\n`
karakterlerini SİLMEDEN, gerçek satır sonuna dönüştürmeden** yapıştırın.
Yani JSON'da gördüğünüz `\n` yazısını olduğu gibi (ters eğik çizgi + n harfi
olarak) bırakın — kendiniz Enter'a basıp çok satırlı hâle getirmeyin,
`\n` yazılarını elle silmeyin. Kod bu kaçış karakterlerini kendisi çözer
(`src/lib/env.ts`); yerelde ayrıca `dotenv` paketi çift tırnaklı değerlerde
`\n`'i otomatik gerçek satır sonuna çevirir — ikisi de aynı sonuca varır,
siz sadece JSON'dan kopyaladığınız hâliyle yapıştırın, başka bir şey
yapmayın.

### B) Google Sheets'i hazırlama

1. [sheets.google.com](https://sheets.google.com) → yeni bir e-tablo açın
   (adı önemli değil, örn. "Rakip Reklam Takip").
2. Adres çubuğundaki `.../spreadsheets/d/`**`BU_KISIM`**`/edit` kısmını
   `GOOGLE_SHEETS_ID`'ye yazın.
3. **Paylaş** düğmesi → servis hesabının e-postasını
   (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) **Düzenleyen (Editor)** yetkisiyle ekleyin.
   Bu adım atlanırsa yazma işlemi "The caller does not have permission"
   hatasıyla başarısız olur.

Sekme adı boş bırakılırsa `GOOGLE_SHEETS_TAB_NAME` varsayılanı olan
"Rakip Reklamlar" kullanılır; sekme yoksa otomatik oluşturulur ve başlık
satırı yazılır. Sekme zaten varsa mevcut başlıkları bozmaz.

### C) Slack'e pinleme yetkisi ekleme

Incoming Webhook (zaten kurulu) yalnızca mesaj gönderir, **pinleyemez**.
Pinlemek için aynı Slack uygulamanıza Bot Token yetkisi ekleyin — yeni
uygulama gerekmez.

1. [api.slack.com/apps](https://api.slack.com/apps) → daha önce oluşturduğunuz
   uygulama ("Rakip Reklam Takip") → sol menüde **OAuth & Permissions**.
2. **Scopes → Bot Token Scopes** → **Add an OAuth Scope** ile ekleyin:
   - `chat:write`
   - `pins:write`
3. Sayfanın üstüne dönüp **Reinstall to Workspace** (veya ilk kurulumsa
   **Install to Workspace**) → izinleri onaylayın.
4. Oluşan **Bot User OAuth Token** (`xoxb-...` ile başlar) →
   `SLACK_BOT_TOKEN`'a yazın.
5. Kanalda (`#rakip-reklam`) yazın: `/invite @Rakip Reklam Takip` — bot
   kanala üye olmadan ne mesaj atabilir ne pinleyebilir.
6. Kanal detaylarının altındaki **"Copy channel ID"** ile kanal kimliğini
   (`C...` ile başlar) alın → `SLACK_CHANNEL_ID`'ye yazın.

### D) Pinleme betiğini çalıştırma

```bash
npm run slack:pin-sheet
```

Kanala Sheets linkini içeren bir mesaj atar ve pinler. **İdempotenttir** —
tekrar çalıştırırsanız, bu Sheet'e linkleyen bir pin zaten varsa hiçbir şey
yapmadan çıkar. Yalnızca bir kez çalıştırmanız yeterli; otomatik tarama
akışının bir parçası değildir.

Yaygın hatalar ve anlamları betiğin çıktısında Türkçe açıklanır:
`not_in_channel` (bot davet edilmemiş), `missing_scope` (yetki eksik/uygulama
yeniden yüklenmemiş), `channel_not_found` (yanlış kanal ID'si).

### E) Doğrulama

```bash
npm test                    # tests/sheets.test.ts + tests/sheet-sync-db.test.ts
```

`tests/sheets.test.ts` satır oluşturma mantığını (saf fonksiyon, ağ çağrısı
yok) ve üç değişkenin hepsi tanımlı olmadan özelliğin kapalı kaldığını
doğrular. `tests/sheet-sync-db.test.ts` gerçek SQL ile mükerrer satır
imkânsızlığını ve Slack'ten bağımsızlığını doğrular. Google Sheets'in
kendisine ağ çağrısı içeren bir test yoktur — bu, gerçek kurulumla
`npm run inngest:dev` + elle bir tarama tetikleyerek denenir.
