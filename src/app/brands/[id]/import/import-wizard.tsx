"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, Stat } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  type ImportField,
  type ImportPreview,
  type SheetPreview,
} from "@/lib/excel-types";
import {
  commitImportAction,
  deactivateMissingAction,
  inspectWorkbook,
  previewImportAction,
} from "@/server/actions";

type Step = "upload" | "map" | "preview" | "done";

type CommitSummary = {
  dealersCreated: number;
  dealersUpdated: number;
  competitorsCreated: number;
  competitorsUpdated: number;
  matchNeedsRecheck: number;
  rowsProcessed: number;
};

const STEP_LABELS: Record<Step, string> = {
  upload: "1 · Yükle",
  map: "2 · Kolonları eşle",
  preview: "3 · Önizle",
  done: "4 · Sonuç",
};

export function ImportWizard({ brandId }: { brandId: number }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("upload");
    setFile(null);
    setSheet(null);
    setMapping({});
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  async function handleUpload(selected: File, sheetName?: string) {
    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", selected);
    if (sheetName) formData.set("sheetName", sheetName);
    const result = await inspectWorkbook(formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFile(selected);
    setSheet(result.data);
    setMapping(result.data.suggestedMapping);
    setStep("map");
  }

  async function handlePreview() {
    if (!file || !sheet) return;
    const missingRequired = REQUIRED_FIELDS.filter(
      (field) => mapping[field] === undefined,
    );
    if (missingRequired.length > 0) {
      setError(
        `Zorunlu kolonlar eşlenmedi: ${missingRequired
          .map((f) => FIELD_LABELS[f])
          .join(", ")}`,
      );
      return;
    }

    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("sheetName", sheet.sheetName);
    formData.set("mapping", JSON.stringify(mapping));
    const result = await previewImportAction(brandId, formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview(result.data);
    setStep("preview");
  }

  async function handleCommit() {
    if (!file || !sheet || !preview) return;
    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("sheetName", sheet.sheetName);
    formData.set("mapping", JSON.stringify(mapping));
    formData.set("token", preview.token);
    const result = await commitImportAction(brandId, formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSummary(result.data);
    setStep("done");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(STEP_LABELS) as Step[]).map((key) => (
          <span
            key={key}
            className={
              key === step
                ? "rounded-md bg-ink-800 px-3 py-1 text-xs font-medium text-white dark:bg-ink-600"
                : "rounded-md bg-ink-100 px-3 py-1 text-xs muted dark:bg-ink-700"
            }
          >
            {STEP_LABELS[key]}
          </span>
        ))}
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {step === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Excel dosyasını yükleyin</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void handleUpload(selected);
              }}
              className="block w-full cursor-pointer rounded-md border border-dashed border-[var(--border)] px-4 py-8 text-sm"
            />
            <div className="text-xs muted">
              <p className="font-medium">Beklenen yapı</p>
              <p className="mt-1">
                Bayi adı / il / adres yalnızca grubun ilk satırında dolu olabilir;
                alt satırlar boş bırakılabilir. Boş ayraç satırları atlanır.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "map" && sheet ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              Kolonları eşleyin — {sheet.totalRows} veri satırı
            </CardTitle>
            {sheet.sheetNames.length > 1 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs muted">Sayfa:</span>
                <Select
                  value={sheet.sheetName}
                  onChange={(e) => {
                    if (file) void handleUpload(file, e.target.value);
                  }}
                  className="w-auto"
                >
                  {sheet.sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <div key={field}>
                  <Label htmlFor={`map-${field}`}>
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) ? (
                      <span className="text-red-500"> *</span>
                    ) : null}
                  </Label>
                  <Select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setMapping((current) => ({
                        ...current,
                        [field]: value === "" ? undefined : Number(value),
                      }));
                    }}
                  >
                    <option value="">— yok —</option>
                    {sheet.headers.map((header, index) => (
                      <option key={`${header}-${index}`} value={index}>
                        {header}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-xs font-medium muted">
                Dosyadan ilk satırlar
              </p>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      {sheet.headers.map((header, index) => (
                        <Th key={`${header}-${index}`}>{header}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.sampleRows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {sheet.headers.map((_, columnIndex) => (
                          <Td key={columnIndex} className="text-xs">
                            {row[columnIndex] ?? (
                              <span className="muted">(boş)</span>
                            )}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </div>

            <div className="flex gap-2">
              <Button variant="brand" disabled={busy} onClick={handlePreview}>
                {busy ? "Hesaplanıyor…" : "Önizlemeyi oluştur"}
              </Button>
              <Button variant="ghost" onClick={reset}>
                Baştan başla
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "preview" && preview ? (
        <PreviewStep
          preview={preview}
          busy={busy}
          onConfirm={handleCommit}
          onBack={() => setStep("map")}
        />
      ) : null}

      {step === "done" && summary && preview ? (
        <DoneStep
          brandId={brandId}
          summary={summary}
          preview={preview}
          onReset={reset}
        />
      ) : null}
    </div>
  );
}

function PreviewStep({
  preview,
  busy,
  onConfirm,
  onBack,
}: {
  preview: ImportPreview;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
        Bu bir <strong>önizlemedir</strong>: veritabanına henüz hiçbir şey
        yazılmadı. Onaylarsanız tüm değişiklikler tek transaction içinde
        uygulanır.
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Yeni bayi" value={preview.dealers.create} />
        <Stat label="Güncellenen bayi" value={preview.dealers.update} />
        <Stat label="Yeni rakip" value={preview.competitors.create} tone="ok" />
        <Stat label="Güncellenen rakip" value={preview.competitors.update} />
        <Stat
          label="Değişmeyen rakip"
          value={preview.competitors.unchanged}
          hint="Dokunulmaz"
        />
        <Stat
          label="Hatalı satır"
          value={preview.errors.length}
          tone={preview.errors.length > 0 ? "danger" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Eşleştirme durumu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Onaylı Page ID&apos;si korunacak kayıt:{" "}
              <strong>{preview.competitors.matchPreserved}</strong>
            </p>
            {preview.competitors.matchNeedsRecheck > 0 ? (
              <p className="text-amber-700 dark:text-amber-300">
                {preview.competitors.matchNeedsRecheck} kaydın Instagram adresi
                değişmiş — bu kayıtlar yeniden onaya düşecek. Page ID silinmez,
                öneri olarak kalır.
              </p>
            ) : (
              <p className="muted">
                Hiçbir onaylı eşleştirme bozulmayacak.
              </p>
            )}
            <p className="muted">
              Yeni rakipler <strong>eşleştirme bekliyor</strong> durumunda
              oluşturulur ve onaylanana kadar taranmaz.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dosya okuma özeti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              Dosya: <strong>{preview.fileName}</strong> · sayfa{" "}
              <strong>{preview.sheetName}</strong>
            </p>
            <p>
              İşlenecek satır: <strong>{preview.totalDataRows}</strong>
            </p>
            <p className="muted">
              Atlanan boş ayraç satırı: {preview.skippedBlankRows}
            </p>
            <p className="muted">
              Dosya içinde tekrar eden satır: {preview.duplicateRows.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {preview.errors.length > 0 || preview.warnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Uyarılar ve hatalar ({preview.errors.length} hata,{" "}
              {preview.warnings.length} uyarı)
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {preview.errors.slice(0, 100).map((issue) => (
              <p key={`e-${issue.rowNumber}-${issue.message}`} className="text-red-600 dark:text-red-400">
                Satır {issue.rowNumber}: {issue.message}
              </p>
            ))}
            {preview.warnings.slice(0, 100).map((issue) => (
              <p
                key={`w-${issue.rowNumber}-${issue.message}`}
                className="text-amber-700 dark:text-amber-300"
              >
                Satır {issue.rowNumber}: {issue.message}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Aşağı doldurma sonucu (ilk satırlar)</CardTitle>
        </CardHeader>
        <TableWrap className="rounded-none border-0">
          <Table>
            <thead>
              <tr>
                <Th>Satır</Th>
                <Th>Bayi</Th>
                <Th>İl</Th>
                <Th>Rakip</Th>
                <Th>Instagram</Th>
              </tr>
            </thead>
            <tbody>
              {preview.samples.map((row) => (
                <tr key={row.rowNumber}>
                  <Td className="tabular-nums muted">{row.rowNumber}</Td>
                  <Td>{row.dealerName}</Td>
                  <Td>{row.city ?? "—"}</Td>
                  <Td>{row.competitorName}</Td>
                  <Td className="text-xs">
                    {row.instagramHandle ? `@${row.instagramHandle}` : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {preview.missing.dealers.length > 0 ||
      preview.missing.competitors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dosyada bulunmayan mevcut kayıtlar</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="muted">
              Bu kayıtlar <strong>silinmez</strong>. Onaydan sonra isterseniz
              pasife alabilirsiniz.
            </p>
            <p className="mt-2">
              {preview.missing.dealers.length} bayi ·{" "}
              {preview.missing.competitors.length} rakip
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Button variant="brand" disabled={busy} onClick={onConfirm}>
          {busy ? "Uygulanıyor…" : "Onayla ve uygula"}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Kolon eşlemesine dön
        </Button>
      </div>
    </div>
  );
}

function DoneStep({
  brandId,
  summary,
  preview,
  onReset,
}: {
  brandId: number;
  summary: CommitSummary;
  preview: ImportPreview;
  onReset: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [deactivated, setDeactivated] = useState<{
    dealers: number;
    competitors: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasMissing =
    preview.missing.dealers.length > 0 || preview.missing.competitors.length > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100">
        İçe aktarma tamamlandı.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Oluşan bayi" value={summary.dealersCreated} />
        <Stat label="Güncellenen bayi" value={summary.dealersUpdated} />
        <Stat label="Oluşan rakip" value={summary.competitorsCreated} tone="ok" />
        <Stat label="Güncellenen rakip" value={summary.competitorsUpdated} />
        <Stat
          label="Yeniden onay gerekecek"
          value={summary.matchNeedsRecheck}
          tone={summary.matchNeedsRecheck > 0 ? "warn" : "default"}
        />
      </div>

      {summary.competitorsCreated > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
          {summary.competitorsCreated} yeni rakip <strong>taranmıyor</strong>.
          Taramaya dahil olmaları için Page eşleştirmesi gerekiyor.{" "}
          <Link
            href={`/brands/${brandId}/matching`}
            className="font-medium underline"
          >
            Eşleştirme ekranına git →
          </Link>
        </div>
      ) : null}

      {hasMissing ? (
        <Card>
          <CardHeader>
            <CardTitle>Dosyada olmayan kayıtlar pasife alınsın mı?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="muted">
              {preview.missing.dealers.length} bayi ve{" "}
              {preview.missing.competitors.length} rakip bu dosyada yoktu.
              Otomatik silme yapılmaz; karar sizde.
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
              {preview.missing.dealers.map((dealer) => (
                <p key={`d-${dealer.id}`}>Bayi: {dealer.name}</p>
              ))}
              {preview.missing.competitors.map((competitor) => (
                <p key={`c-${competitor.id}`} className="muted">
                  Rakip: {competitor.name} — {competitor.dealerName}
                </p>
              ))}
            </div>
            {deactivated ? (
              <p className="text-emerald-700 dark:text-emerald-300">
                {deactivated.dealers} bayi, {deactivated.competitors} rakip pasife
                alındı.
              </p>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  const result = await deactivateMissingAction({
                    brandId,
                    dealerIds: preview.missing.dealers.map((d) => d.id),
                    competitorIds: preview.missing.competitors.map((c) => c.id),
                  });
                  setBusy(false);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setDeactivated(result.data);
                  router.refresh();
                }}
              >
                {busy ? "Uygulanıyor…" : "Hepsini pasife al"}
              </Button>
            )}
            {error ? (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Link href={`/brands/${brandId}/competitors`}>
          <Button variant="outline">Rakip listesine git</Button>
        </Link>
        <Button variant="ghost" onClick={onReset}>
          Yeni dosya yükle
        </Button>
      </div>
    </div>
  );
}
