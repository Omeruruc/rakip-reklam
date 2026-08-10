"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, MatchStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adLibraryUrl, instagramProfileUrl } from "@/lib/adlibrary";
import type { MatchStatus } from "@/db/schema";
import type { PageCandidate } from "@/lib/apify";
import {
  confirmMatch,
  findPageCandidates,
  setMatchStatus,
} from "@/server/actions";

export type MatchingRow = {
  id: number;
  name: string;
  instagramHandle: string | null;
  fbPageId: string | null;
  fbPageName: string | null;
  matchStatus: MatchStatus;
  dealerName: string;
  dealerCity: string | null;
};

/** Facebook sayfa arama — arama actor'ü yoksa elle bakmak için hazır link. */
function facebookSearchUrl(query: string) {
  return `https://www.facebook.com/search/pages/?q=${encodeURIComponent(query)}`;
}

/** Ad Library'de anahtar kelimeyle arama — reklam veren sayfayı bulmanın en hızlı yolu. */
function adLibraryKeywordUrl(query: string) {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: "TR",
    q: query,
    search_type: "keyword_unordered",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

type StatusFilter = "all" | "unverified" | "no_page";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "unverified", label: "Eşleşmeyi bekliyor" },
  { value: "no_page", label: "Sayfası yok" },
];

export function MatchingList({
  brandId,
  rows,
  pageSearchEnabled,
}: {
  brandId: number;
  rows: MatchingRow[];
  pageSearchEnabled: boolean;
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");

  if (rows.length === 0) {
    return (
      <div className="card px-5 py-12 text-center">
        <p className="text-sm font-medium">Eşleştirme kuyruğu boş.</p>
        <p className="mt-1 text-sm muted">
          Tüm rakipler ya eşleştirilmiş ya da yok sayılmış durumda.
        </p>
      </div>
    );
  }

  const filteredRows =
    filter === "all" ? rows : rows.filter((row) => row.matchStatus === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count =
            f.value === "all"
              ? rows.length
              : rows.filter((row) => row.matchStatus === f.value).length;
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-[var(--border)] muted hover:text-[var(--fg)]"
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {filteredRows.length === 0 ? (
        <div className="card px-5 py-12 text-center">
          <p className="text-sm font-medium">Bu filtrede kayıt yok.</p>
        </div>
      ) : (
        filteredRows.map((row) => (
          <MatchingCard
            key={row.id}
            brandId={brandId}
            row={row}
            pageSearchEnabled={pageSearchEnabled}
          />
        ))
      )}
    </div>
  );
}

function MatchingCard({
  brandId,
  row,
  pageSearchEnabled,
}: {
  brandId: number;
  row: MatchingRow;
  pageSearchEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [candidates, setCandidates] = useState<PageCandidate[] | null>(null);
  const [manualId, setManualId] = useState(row.fbPageId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  function approve(pageId: string, pageName?: string | null) {
    start(async () => {
      const result = await confirmMatch({
        brandId,
        competitorId: row.id,
        pageId,
        pageName: pageName ?? null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  function mark(status: "no_page" | "ignored" | "unverified") {
    start(async () => {
      const result = await setMatchStatus({
        brandId,
        competitorId: row.id,
        status,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  }

  const searchTerm = row.name;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{row.name}</h3>
            <MatchStatusBadge status={row.matchStatus} />
          </div>
          <p className="mt-0.5 text-xs muted">
            {row.dealerName}
            {row.dealerCity ? ` · ${row.dealerCity}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {row.instagramHandle ? (
              <a
                href={instagramProfileUrl(row.instagramHandle)}
                target="_blank"
                rel="noreferrer"
                className="text-brand-500 hover:underline"
              >
                @{row.instagramHandle}
              </a>
            ) : (
              <Badge tone="neutral">Instagram yok</Badge>
            )}
            <a
              href={adLibraryKeywordUrl(searchTerm)}
              target="_blank"
              rel="noreferrer"
              className="text-brand-500 hover:underline"
            >
              Ad Library&apos;de ara
            </a>
            <a
              href={facebookSearchUrl(searchTerm)}
              target="_blank"
              rel="noreferrer"
              className="text-brand-500 hover:underline"
            >
              Facebook sayfa ara
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pageSearchEnabled ? (
            <Button
              size="sm"
              variant="outline"
              disabled={searching}
              onClick={async () => {
                setSearching(true);
                setError(null);
                const result = await findPageCandidates(row.id);
                setSearching(false);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setCandidates(result.data);
              }}
            >
              {searching ? "Aranıyor…" : "Aday sayfaları getir"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => mark("no_page")}
          >
            Sayfası yok
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => mark("ignored")}
          >
            Yok say
          </Button>
        </div>
      </div>

      {candidates !== null ? (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {candidates.length === 0 ? (
            <p className="text-xs muted">
              Aday sayfa bulunamadı. Page ID&apos;yi elle girin.
            </p>
          ) : (
            candidates.map((candidate) => (
              <div
                key={candidate.pageId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-ink-50 px-3 py-2 dark:bg-ink-700"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {candidate.name}
                  </div>
                  <div className="text-xs muted">
                    Page {candidate.pageId}
                    {candidate.category ? ` · ${candidate.category}` : ""}
                    {candidate.likes ? ` · ${candidate.likes} beğeni` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={adLibraryUrl(candidate.pageId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand-500 hover:underline"
                  >
                    Reklamlarına bak
                  </a>
                  <Button
                    size="sm"
                    variant="brand"
                    disabled={pending}
                    onClick={() => approve(candidate.pageId, candidate.name)}
                  >
                    Onayla
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      <form
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          approve(manualId, row.fbPageName);
        }}
      >
        <div className="min-w-[260px] flex-1">
          <label className="mb-1.5 block text-xs font-medium muted">
            Page ID veya sayfanın Ad Library adresi
          </label>
          <Input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="123456789012345 veya …view_all_page_id=123456789012345"
          />
          <p className="mt-1 text-xs muted">
            Adreste <code>view_all_page_id</code> bulunmalı. Reklam kartındaki
            &quot;Kütüphane Kodu&quot; reklam kimliğidir, Page ID değildir.
          </p>
        </div>
        <Button type="submit" variant="brand" disabled={pending || !manualId}>
          {pending ? "Kaydediliyor…" : "Eşleştirmeyi onayla"}
        </Button>
        {manualId ? (
          <a
            href={adLibraryUrl(manualId.replace(/\D/g, "") || "0")}
            target="_blank"
            rel="noreferrer"
            className="pb-2 text-xs text-brand-500 hover:underline"
          >
            Önce kontrol et
          </a>
        ) : null}
      </form>

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
