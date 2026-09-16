import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface RecoveryCandidate {
  id: string; slug: string; name: string; country: string; countryCode: string;
  lastCheckOkTime: string; completeLanguageCount: number;
  evidence: { provenance: string; providerUuidPresent: boolean; recentProviderSuccess: boolean; identityPeers: number };
}
interface RecoveryPreview {
  previewId: string; createdAt: string; expiresAt: string; totalScanned: number;
  totalNoIndex: number; totalCandidates: number; reasonCounts: Record<string, number>;
  candidates: RecoveryCandidate[]; candidateLimit: number;
}
interface RecoveryResult { restored: number; restoredIds: string[]; skipped: number; skippedReasons: unknown[] }
const BATCH_LIMIT = 25;

/** Explicit, reversible repair only. Opening this screen never starts a scan or a write. */
export function StationNoindexRecovery() {
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const scan = useMutation<RecoveryPreview, Error>({
    mutationFn: async () => (await apiRequest('POST', '/api/admin/seo-noindex-recovery/preview', { body: {} })).json(),
    onMutate: () => { setSelected([]); setPreview(null); setResult(null); },
    onSuccess: data => { setPreview(data); setExpired(Date.parse(data.expiresAt) <= Date.now()); },
  });
  const apply = useMutation<RecoveryResult, Error>({
    mutationFn: async () => {
      if (!preview || expired || !selected.length || selected.length > BATCH_LIMIT) throw new Error('Refresh preview');
      return (await apiRequest('POST', '/api/admin/seo-noindex-recovery/apply', {
        body: { previewId: preview.previewId, stationIds: selected },
      })).json();
    },
    onSuccess: data => { setResult(data); setSelected([]); setExpired(true); },
    onError: () => { setExpired(true); setSelected([]); },
  });
  useEffect(() => {
    setConfirming(false);
  }, [selected, preview, expired]);
  useEffect(() => {
    if (!preview) return;
    const timeout = setTimeout(() => { setExpired(true); setSelected([]); }, Math.max(0, Date.parse(preview.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [preview]);
  const busy = scan.isPending || apply.isPending;
  return <Card className="border-l-4 border-l-amber-500 bg-white">
    <CardHeader><CardTitle className="text-base">Eski noindex işaretlerini kontrollü onar</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-600">Önce adayları inceleyin, sonra en fazla 25 radyoyu seçin.
        Yalnızca 14 dil içeriği tam, sağlayıcı kontrolü güncel ve başarılı, kimlik kopyası şüphesi bulunmayan kayıtlar aday olur.
        Manuel kararlar, yönlendirmeler ve belirsiz kayıtlar korunur.</p>
      <Button variant="outline" onClick={() => { apply.reset(); scan.mutate(); }} disabled={busy}>
        {scan.isPending ? 'Adaylar inceleniyor…' : 'Onarım adaylarını incele'}
      </Button>
      {scan.isError && <p role="alert" className="text-sm text-rose-700">Aday taraması tamamlanamadı. Hiçbir kayıt değiştirilmedi; yeniden deneyin.</p>}
      {apply.isError && <p role="alert" className="text-sm text-rose-700">Onarım doğrulanamadı. Otomatik yeniden deneme yapılmaz; yeni taramayla güncel durumu kontrol edin.</p>}
      {result && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        {result.restored} radyonun noindex işareti kaldırıldı. İçerikler ve eski kararın kaydı korundu.
        {' '}Diğer adaylar için yeniden tarayın; onarımlar bittikten sonra sitemap’i yenileyin. Google indekslemesi garanti edilmez.
      </div>}
      {preview && <>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>Taranan: <strong>{preview.totalScanned.toLocaleString()}</strong></span>
          <span>Noindex: <strong>{preview.totalNoIndex.toLocaleString()}</strong></span>
          <span>Onarım koşullarını sağlayan: <strong>{preview.totalCandidates.toLocaleString()}</strong></span>
          <span>Gösterilen: <strong>{preview.candidates.length}</strong></span>
        </div>
        <details className="text-sm"><summary className="cursor-pointer">Aday olmayan kayıtların nedenleri</summary>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2">{Object.entries(preview.reasonCounts).map(([reason, count]) =>
            <div key={reason} className="flex justify-between gap-3 pr-4"><dt>{reason}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl>
        </details>
        {expired && !result && <p role="status" className="text-sm text-amber-800">Önizleme artık kullanılamaz. Uygulamadan önce yeniden tarayın.</p>}
        {preview.candidates.length === 0 && <p className="text-sm text-slate-600">Bu korumaları geçen aday bulunamadı. Diğer kayıtları açmak için ek kimlik veya içerik kanıtı gerekir; noindex işaretleri değiştirilmedi.</p>}
        {preview.candidates.length > 0 && <>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={busy || expired} onClick={() => setSelected(preview.candidates.slice(0, BATCH_LIMIT).map(row => row.id))}>İlk {Math.min(BATCH_LIMIT, preview.candidates.length)} adayı seç</Button>
            <Button variant="ghost" size="sm" disabled={busy || !selected.length} onClick={() => setSelected([])}>Seçimi temizle</Button>
            <span className="text-xs text-slate-600">{selected.length}/{BATCH_LIMIT} seçili · Hiçbir kayıt otomatik seçilmez.</span>
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">İnceleme sonuçlarına göre onarılabilecek radyolar</caption>
              <thead className="sticky top-0 bg-slate-50"><tr><th className="p-3">Seç</th><th className="p-3">Radyo</th><th className="p-3">Ülke</th><th className="p-3 whitespace-nowrap">Son başarılı kontrol</th><th className="p-3">İçerik</th></tr></thead>
              <tbody>{preview.candidates.map(row => <tr key={row.id} className="border-t">
                <td className="p-3"><input type="checkbox" aria-label={`${row.name} onarım için seç`} checked={selected.includes(row.id)}
                  disabled={busy || expired || (!selected.includes(row.id) && selected.length >= BATCH_LIMIT)}
                  onChange={event => setSelected(ids => event.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} className="h-4 w-4 accent-amber-600" /></td>
                <td className="p-3"><a className="font-medium underline underline-offset-2" target="_blank" rel="noopener noreferrer" href={`/admin/stations?search=${encodeURIComponent(row.id)}`}>{row.name}</a><div className="max-w-80 truncate text-xs text-slate-500">{row.slug}</div></td>
                <td className="p-3">{row.country || row.countryCode}</td>
                <td className="p-3 whitespace-nowrap">{new Date(row.lastCheckOkTime).toLocaleString()}</td>
                <td className="p-3 whitespace-nowrap">{row.completeLanguageCount}/14 dil</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button disabled={busy || expired || !selected.length || confirming} onClick={() => setConfirming(true)}>{apply.isPending ? 'Kontrol edilip onarılıyor…' : `Seçilen ${selected.length} radyoyu onar`}</Button>
            <p className="max-w-xl text-xs text-slate-500">Uygulama sırasında kimlik ve korumalar tekrar kontrol edilir. Radyo güncellemeleri için en fazla 5 saniyelik kilit kullanılır; sayfa okumaları devam eder. Çakışmada işlem durur.</p>
          </div>
          {confirming && !expired && !busy && <section role="group" aria-label="Seçili radyo onarımını onayla" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>{selected.length} radyonun noindex işareti kaldırılacak. İçerik ve URL değişmez; eski kararın kaydı korunur.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => { setConfirming(false); apply.mutate(); }}>Onarımı uygula</Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>Vazgeç</Button>
            </div>
          </section>}
        </>}
      </>}
    </CardContent>
  </Card>;
}
