"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { MatchStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, EmptyRow } from "@/components/ui/table";
import { adLibraryUrl, instagramProfileUrl } from "@/lib/adlibrary";
import { formatDateTime } from "@/lib/utils";
import type { MatchStatus } from "@/db/schema";
import {
  createCompetitor,
  setCompetitorActive,
  updateCompetitor,
} from "@/server/actions";

export type CompetitorRow = {
  id: number;
  name: string;
  instagramHandle: string | null;
  fbPageId: string | null;
  fbPageName: string | null;
  matchStatus: MatchStatus;
  isActive: boolean;
  dealerId: number;
  dealerName: string;
  dealerCity: string | null;
  activeAds: number;
  lastSeenAt: Date | string | null;
};

export function CompetitorsTable({
  brandId,
  rows,
  cities,
  dealers,
  filters,
}: {
  brandId: number;
  rows: CompetitorRow[];
  cities: string[];
  dealers: { id: number; name: string; city: string | null }[];
  filters: { city: string; status: string; active: boolean; search: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<CompetitorRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(filters.search);

  function applyFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/brands/${brandId}/competitors?${next.toString()}`);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="f-city">İl</Label>
            <Select
              id="f-city"
              value={filters.city}
              onChange={(e) => applyFilter("city", e.target.value)}
              className="min-w-[140px]"
            >
              <option value="">Tümü</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-status">Eşleştirme</Label>
            <Select
              id="f-status"
              value={filters.status}
              onChange={(e) => applyFilter("status", e.target.value)}
              className="min-w-[170px]"
            >
              <option value="">Tümü</option>
              <option value="matched">Eşleşti</option>
              <option value="unverified">Eşleştirme bekliyor</option>
              <option value="no_page">Sayfası yok</option>
              <option value="ignored">Yok sayıldı</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="f-search">Ara</Label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                applyFilter("search", search);
              }}
            >
              <Input
                id="f-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rakip, bayi veya handle"
                className="min-w-[200px]"
              />
            </form>
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs">
            <input
              type="checkbox"
              checked={filters.active}
              onChange={(e) => applyFilter("active", e.target.checked ? "1" : "")}
            />
            Yalnızca aktif reklamı olanlar
          </label>
          <span className="pb-2 text-xs muted">{rows.length} rakip</span>
        </div>

        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Rakip</Th>
                <Th>Bayi / İl</Th>
                <Th>Eşleştirme</Th>
                <Th>Aktif reklam</Th>
                <Th>Son görülme</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={6}>
                  Filtreye uyan rakip yok.
                </EmptyRow>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className={row.isActive ? "" : "opacity-50"}>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      {row.instagramHandle ? (
                        <a
                          href={instagramProfileUrl(row.instagramHandle)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand-500 hover:underline"
                        >
                          @{row.instagramHandle}
                        </a>
                      ) : (
                        <span className="text-xs muted">Instagram yok</span>
                      )}
                    </Td>
                    <Td>
                      <div className="text-sm">{row.dealerName}</div>
                      <div className="text-xs muted">{row.dealerCity ?? "—"}</div>
                    </Td>
                    <Td>
                      <MatchStatusBadge status={row.matchStatus} />
                      {row.fbPageId ? (
                        <a
                          href={adLibraryUrl(row.fbPageId)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block text-xs text-brand-500 hover:underline"
                        >
                          Page {row.fbPageId}
                        </a>
                      ) : null}
                    </Td>
                    <Td className="tabular-nums">
                      {row.activeAds > 0 ? (
                        <Link
                          href={`/ads?competitor=${row.id}`}
                          className="hover:underline"
                        >
                          {row.activeAds}
                        </Link>
                      ) : (
                        0
                      )}
                    </Td>
                    <Td className="text-xs muted">
                      {formatDateTime(row.lastSeenAt)}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(row);
                            setError(null);
                          }}
                        >
                          Düzenle
                        </Button>
                        <Link href={`/brands/${brandId}/matching`}>
                          <Button size="sm" variant="ghost">
                            Eşleştir
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              await setCompetitorActive(
                                brandId,
                                row.id,
                                !row.isActive,
                              );
                              router.refresh();
                            })
                          }
                        >
                          {row.isActive ? "Pasife al" : "Aktif et"}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      <div className="card h-fit p-5">
        <h3 className="text-sm font-semibold">
          {editing ? "Rakibi düzenle" : "Rakip ekle"}
        </h3>
        <p className="mt-1 text-xs muted">
          Yeni rakip <strong>eşleştirme bekliyor</strong> durumunda başlar ve
          onaylanana kadar taranmaz.
        </p>
        <form
          key={editing?.id ?? "new"}
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const form = event.currentTarget;
            start(async () => {
              const result = editing
                ? await updateCompetitor(brandId, editing.id, formData)
                : await createCompetitor(brandId, formData);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setError(null);
              setEditing(null);
              form.reset();
              router.refresh();
            });
          }}
        >
          {editing ? (
            <div className="rounded-md bg-ink-50 px-3 py-2 text-xs dark:bg-ink-700">
              Bayi: <strong>{editing.dealerName}</strong>
            </div>
          ) : (
            <div>
              <Label htmlFor="dealerId">Bayi</Label>
              <Select id="dealerId" name="dealerId" required>
                <option value="">Seçin…</option>
                {dealers.map((dealer) => (
                  <option key={dealer.id} value={dealer.id}>
                    {dealer.name}
                    {dealer.city ? ` — ${dealer.city}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="name">Rakip mağaza adı</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              placeholder="Bandırma Lova Yatak"
            />
          </div>
          <div>
            <Label htmlFor="instagram">Instagram (opsiyonel)</Label>
            <Input
              id="instagram"
              name="instagram"
              defaultValue={
                editing?.instagramHandle ? `@${editing.instagramHandle}` : ""
              }
              placeholder="instagram.com/lovayatak.bandirma"
            />
          </div>
          {editing?.matchStatus === "matched" ? (
            <p className="text-xs muted">
              Instagram adresini değiştirirseniz eşleştirme yeniden onaya düşer —
              yanlış Page eşleşmesi sahte bildirim üretir.
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="brand" disabled={pending}>
              {pending ? "Kaydediliyor…" : editing ? "Güncelle" : "Ekle"}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setError(null);
                }}
              >
                Vazgeç
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
