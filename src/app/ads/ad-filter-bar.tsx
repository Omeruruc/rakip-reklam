"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input, Label, Select } from "@/components/ui/input";

export function AdFilterBar({
  brands,
  cities,
  current,
}: {
  brands: { id: number; name: string }[];
  cities: string[];
  current: {
    brand: string;
    city: string;
    range: string;
    state: string;
    search: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(current.search);

  function apply(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("ad");
    router.push(`/ads?${next.toString()}`);
  }

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="f-brand">Marka</Label>
        <Select
          id="f-brand"
          value={current.brand}
          onChange={(e) => apply("brand", e.target.value)}
          className="min-w-[160px]"
        >
          <option value="">Tümü</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-city">İl</Label>
        <Select
          id="f-city"
          value={current.city}
          onChange={(e) => apply("city", e.target.value)}
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
        <Label htmlFor="f-range">Tarih</Label>
        <Select
          id="f-range"
          value={current.range}
          onChange={(e) => apply("range", e.target.value)}
          className="min-w-[140px]"
        >
          <option value="">Tüm zamanlar</option>
          <option value="7">Son 7 gün</option>
          <option value="30">Son 30 gün</option>
          <option value="90">Son 90 gün</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="f-state">Durum</Label>
        <Select
          id="f-state"
          value={current.state}
          onChange={(e) => apply("state", e.target.value)}
          className="min-w-[130px]"
        >
          <option value="active">Aktif</option>
          <option value="all">Aktif + durmuş</option>
        </Select>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply("search", search);
        }}
      >
        <Label htmlFor="f-search">Ara</Label>
        <Input
          id="f-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rakip adı veya reklam metni"
          className="min-w-[220px]"
        />
      </form>
    </div>
  );
}
