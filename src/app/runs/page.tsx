import { AppShell, PageHeader } from "@/components/app-shell";
import { RunStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th, EmptyRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { formatCost, formatDateTime, formatDuration } from "@/lib/utils";
import { listRuns } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  await requireSession();
  const rows = await listRuns();

  const failed = rows.filter((run) => run.status === "failed");

  return (
    <AppShell active="/runs">
      <PageHeader
        title="Tarama geçmişi"
        description="Her tarama kaydı: durum, süre, bulunan reklam, maliyet ve hata. Sıfır sonuç arıza sayılır — böyle bir taramada hiçbir reklam pasife alınmaz ve bildirim gönderilmez."
      />

      {failed.length > 0 ? (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-100">
          Son {rows.length} kayıtta <strong>{failed.length}</strong> başarısız
          tarama var. Sıfır sonuç dönen taramalarda scraper arızası (Meta arayüz
          değişikliği) ilk şüphelidir; yedek actor <code>APIFY_ACTOR_ID</code> ile
          kod değişmeden devreye alınabilir.
        </div>
      ) : null}

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Marka</Th>
              <Th>Durum</Th>
              <Th>Başlangıç</Th>
              <Th>Süre</Th>
              <Th>Rakip</Th>
              <Th>Bulunan</Th>
              <Th>Yeni</Th>
              <Th>Duran</Th>
              <Th>Maliyet</Th>
              <Th>Hata / Actor</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={11}>
                Henüz tarama yapılmadı. Marka sayfasından &quot;Şimdi tara&quot; ile
                elle tetikleyebilirsiniz.
              </EmptyRow>
            ) : (
              rows.map((run) => (
                <tr key={run.id}>
                  <Td className="tabular-nums muted">{run.id}</Td>
                  <Td className="font-medium">{run.brandName}</Td>
                  <Td>
                    <RunStatusBadge status={run.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {formatDateTime(run.startedAt)}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </Td>
                  <Td className="tabular-nums">{run.competitorsScanned}</Td>
                  <Td className="tabular-nums">{run.adsFound}</Td>
                  <Td className="tabular-nums font-medium">{run.newAds}</Td>
                  <Td className="tabular-nums">{run.stoppedAds}</Td>
                  <Td className="tabular-nums">{formatCost(run.costUsd)}</Td>
                  <Td className="max-w-[320px]">
                    {run.error ? (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {run.error}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs muted">
                      {run.actorId ?? "—"}
                      {run.apifyRunId ? ` · run ${run.apifyRunId}` : ""}
                    </p>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>
    </AppShell>
  );
}
