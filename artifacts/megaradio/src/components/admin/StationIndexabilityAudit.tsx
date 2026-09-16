import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AuditReport {
  snapshotAt: string; total: number; reasons: Record<string, number>; reviewCandidates: Record<string, number>;
  storedNoIndexQualityReasons: Record<string, number>;
  samples: Array<{ id: string; slug: string | null; name: string; reason: string; completeLanguageCount: number }>;
  languages: Array<{ language: string; qualified: boolean; indexable: number; excluded: number;
    localeIneligible: number; missingFull: number; missingMeta: number; incomplete: number; indexableIncomplete: number;
    publishedUrls: number | null; manifestGeneratedAt: string | null; exclusions: Record<string, number> }>;
}
const labels: Record<string, string> = {
  'missing-slug': 'Slug eksik', 'duplicate-redirect': 'Başka radyoya yönlendirme',
  'manual-noindex': 'Manuel noindex', 'automatic-health-noindex': 'Eski otomatik yayın sağlığı noindex',
  'automatic-other-noindex': 'Diğer otomatik noindex', 'legacy-unknown-noindex': 'Kaynağı bilinmeyen eski noindex',
  'numeric-slug': 'Yalnızca sayısal slug', 'passes-station-rules': 'Radyo kurallarını geçiyor',
  'owned-health-policy-retirement': 'Eski sağlık politikasının işaretlediği',
  'automatic-duplicate-needs-identity-review': 'Otomatik duplicate kararı incelenmeli',
  'unknown-flag-without-current-quality-rule': 'Mevcut kalite kuralına uymayan eski noindex',
  'automatic-rule-no-longer-matches': 'Otomatik kural artık eşleşmiyor',
  'no-current-quality-rule': 'Mevcut kalite kuralı eşleşmiyor (ayrıca inceleme gerekir)',
};
const number = (value: number) => value.toLocaleString();

export function StationIndexabilityAudit() {
  const request = useRef<AbortController | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const audit = useMutation<AuditReport, Error>({
    mutationFn: async () => {
      request.current = new AbortController();
      const response = await apiRequest('GET', '/api/admin/seo-indexability-audit', { signal: request.current.signal });
      return response.json();
    },
    onSuccess: setReport,
  });
  const download = useMutation({
    mutationFn: async () => {
      request.current = new AbortController();
      const response = await apiRequest('GET', '/api/admin/seo-indexability-audit?format=csv', { signal: request.current.signal });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'station-indexability-review.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const busy = audit.isPending || download.isPending;
  return <Card className="bg-white">
    <CardHeader><CardTitle className="text-base">Sitemap kapsamı — tüm radyo kayıtları</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-slate-600">Tüm kataloğu tek bir anlık görüntüde sayar. Dışlama nedenleri birbirini tekrar etmez.
        Noindex kayıtları ve dil başına eksik full/meta alanları ayrı gösterilir. İnceleme hiçbir kaydı değiştirmez.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => audit.mutate()} disabled={busy}>{audit.isPending ? 'İnceleniyor…' : 'Tüm kataloğu incele'}</Button>
        <Button variant="outline" onClick={() => download.mutate()} disabled={busy || !report}>
          {download.isPending ? 'CSV hazırlanıyor…' : 'Tüm kayıtları CSV indir'}
        </Button>
      </div>
      {(audit.isError || download.isError) && <p role="alert" className="text-sm text-rose-700">
        İnceleme tamamlanamadı. Lütfen yeniden deneyin. {report ? 'Aşağıda önceki tamamlanmış rapor gösteriliyor.' : ''}
      </p>}
      {report && <>
        <p className="text-sm">{number(report.total)} radyo · {new Date(report.snapshotAt).toLocaleString()} · Global rapor (ülke filtresinden bağımsız).</p>
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          {Object.entries(report.reasons).map(([reason, count]) => <div key={reason} className="flex justify-between gap-4 border-b py-1">
            <dt>{labels[reason] || reason}</dt><dd>{number(count)}</dd>
          </div>)}
        </dl>
        <details className="text-sm"><summary className="cursor-pointer">Kayıtlı noindex için mevcut kalite kuralları (yukarıdaki sayılara eklenmez)</summary>
          {Object.entries(report.storedNoIndexQualityReasons).map(([reason, count]) => <p key={reason}>{labels[reason] || reason}: {number(count)}</p>)}
        </details>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="text-left text-sm text-slate-600 py-2">Her dilde uygun + dışlanan = toplam radyo. Yayındaki sayı manifestin oluşturulduğu zamana aittir.</caption>
            <thead><tr>{['Dil', 'Şimdi uygun', 'Dışlanan', 'Dil uyumsuz', 'Yayındaki manifest', 'Fark', 'Full eksik', 'Meta eksik', 'Eksik full veya meta', 'Uygun ama içeriği eksik'].map(label => <th key={label} className="p-2 whitespace-nowrap">{label}</th>)}</tr></thead>
            <tbody>{report.languages.map(language => <tr key={language.language} className="border-t">
              <th className="p-2">{language.language.toUpperCase()}{!language.qualified ? ' (kapalı)' : ''}</th>
              <td className="p-2">{number(language.indexable)}</td>
              <td className="p-2" title={Object.entries(language.exclusions).map(([reason, count]) => `${labels[reason] || reason}: ${count}`).join('\n')}>{number(language.excluded)}</td>
              <td className="p-2">{number(language.localeIneligible)}</td>
              <td className="p-2" title={language.manifestGeneratedAt || undefined}>{language.publishedUrls === null ? '—' : number(language.publishedUrls)}</td>
              <td className="p-2">{language.publishedUrls === null ? '—' : number(language.indexable - language.publishedUrls)}</td>
              <td className="p-2">{number(language.missingFull)}</td><td className="p-2">{number(language.missingMeta)}</td>
              <td className="p-2">{number(language.incomplete)}</td>
              <td className="p-2">{number(language.indexableIncomplete)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="text-sm space-y-2">
          <p>İnceleme adayları bir noindex kaldırma kararı değildir. Manuel kararlar, yönlendirmeler ve gerçek kalite sorunları korunur.</p>
          {Object.entries(report.reviewCandidates).map(([reason, count]) => <p key={reason}>{labels[reason] || reason}: {number(count)}</p>)}
          {report.samples.length > 0 && <details><summary className="cursor-pointer">Örnek kayıtlar (neden başına en fazla 5)</summary>
            <ul className="mt-2 space-y-1">{report.samples.map(sample => <li key={sample.id}>
              <a className="underline" href={`/admin/stations?search=${encodeURIComponent(sample.id)}`}>{sample.name || sample.slug || sample.id}</a>
              {' — '}{labels[sample.reason] || sample.reason} · {sample.completeLanguageCount}/14 tam dil
            </li>)}</ul>
          </details>}
          <p className="text-xs text-slate-500">CSV ayrı bir güncel anlık görüntü alır; tüm kayıtları, noindex kaynağını ve eksik dilleri içerir. Açıklama metinlerini içermez.</p>
        </div>
      </>}
    </CardContent>
  </Card>;
}
