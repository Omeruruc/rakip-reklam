"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Table, TableWrap, Td, Th, EmptyRow } from "@/components/ui/table";
import { createDealer, setDealerActive, updateDealer } from "@/server/actions";

export type DealerRow = {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
  competitorCount: number;
  matchedCount: number;
};

export function DealersTable({
  brandId,
  rows,
}: {
  brandId: number;
  rows: DealerRow[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const [editing, setEditing] = useState<DealerRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const columns = useMemo<ColumnDef<DealerRow>[]>(
    () => [
      { accessorKey: "name", header: "Bayi" },
      { accessorKey: "city", header: "İl" },
      { accessorKey: "address", header: "Adres" },
      { accessorKey: "competitorCount", header: "Rakip" },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visible = table.getRowModel().rows;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-3 flex items-center gap-3">
          <Input
            placeholder="Bayi, il veya adres ara…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
          <span className="text-xs muted">
            {visible.length} / {rows.length} bayi
          </span>
        </div>

        <TableWrap>
          <Table>
            <thead>
              <tr>
                {table.getHeaderGroups()[0]?.headers.map((header) => (
                  <Th
                    key={header.id}
                    className="cursor-pointer select-none"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {String(header.column.columnDef.header)}
                    {header.column.getIsSorted() === "asc"
                      ? " ↑"
                      : header.column.getIsSorted() === "desc"
                        ? " ↓"
                        : ""}
                  </Th>
                ))}
                <Th>Eşleşen</Th>
                <Th>Durum</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <EmptyRow colSpan={7}>
                  Bayi yok. Excel içe aktarma ile toplu ekleyebilir ya da sağdaki
                  formu kullanabilirsiniz.
                </EmptyRow>
              ) : (
                visible.map(({ original: dealer }) => (
                  <tr key={dealer.id}>
                    <Td className="font-medium">{dealer.name}</Td>
                    <Td>{dealer.city ?? "—"}</Td>
                    <Td className="max-w-[280px] text-xs muted">
                      {dealer.address ?? "—"}
                    </Td>
                    <Td className="tabular-nums">
                      <Link
                        href={`/brands/${brandId}/competitors?search=${encodeURIComponent(dealer.name)}`}
                        className="hover:underline"
                      >
                        {dealer.competitorCount}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{dealer.matchedCount}</Td>
                    <Td>
                      {dealer.isActive ? (
                        <Badge tone="ok">Aktif</Badge>
                      ) : (
                        <Badge tone="neutral">Pasif</Badge>
                      )}
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(dealer);
                            setError(null);
                          }}
                        >
                          Düzenle
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              await setDealerActive(dealer.id, !dealer.isActive);
                              router.refresh();
                            })
                          }
                        >
                          {dealer.isActive ? "Pasife al" : "Aktif et"}
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
          {editing ? "Bayiyi düzenle" : "Bayi ekle"}
        </h3>
        <p className="mt-1 text-xs muted">
          Aynı markada aynı isimli iki bayi olamaz.
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
                ? await updateDealer(editing.id, formData)
                : await createDealer(brandId, formData);
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
          <div>
            <Label htmlFor="name">Bayi adı</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              placeholder="İşbir Yatak Bandırma"
            />
          </div>
          <div>
            <Label htmlFor="city">İl</Label>
            <Input
              id="city"
              name="city"
              defaultValue={editing?.city ?? ""}
              placeholder="Balıkesir"
            />
          </div>
          <div>
            <Label htmlFor="address">Adres</Label>
            <Input
              id="address"
              name="address"
              defaultValue={editing?.address ?? ""}
            />
          </div>
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
