# MegaRadio — Mobil Developer Entegrasyon Gorev Listesi

> Bu dokuman, React Native mobil uygulamadaki mevcut lokal IAP sistemini backend ile senkronize etmek icin yapilmasi gereken tum degisiklikleri adim adim aciklar.

---

## MEVCUT DURUM

Simdi uygulama satin almalari tamamen lokal yonetiyor:
- `premiumStore.setPremiumStatus(plan, expiryDate)` ile AsyncStorage'a yaziyor
- Backend'e hicbir bilgi gondermiyor
- Kullanici cihaz degistirince sadece `restorePurchases()` ile Store'dan geri yukluyor

## HEDEF

Satin alma sonrasi backend'e bildirim gonderilecek. Boylece:
- Admin panelinden kimin premium oldugu gorulebilecek
- Kullanici farkli cihazda oturum actigi zaman plan durumu backend'den cekilecek
- Gelecekte server-side ozellik kilitleme yapilabilecek

---

## BACKEND API BILGILERI

**Base URL:** `https://themegaradio.com`

**Authentication:** Tum subscription endpoint'leri login gerektirir. Her istekte:
```
Authorization: Bearer <kullanicinin_auth_token_i>
```

---

## GOREV 1: Satin Alma Sonrasi Backend'e Bildirim Gonder

### Ne yapilacak?
`handlePurchaseSuccess(purchase)` fonksiyonunda, `premiumStore.setPremiumStatus()` cagrisindan **sonra**, `finishTransaction()` cagrisindan **once** backend'e POST istegi gonderilecek.

### Endpoint
```
POST https://themegaradio.com/api/user/subscription
```

### Gonderilecek Body
```typescript
{
  platform: Platform.OS,                    // "ios" veya "android" — ZORUNLU
  productId: purchase.productId,            // Ornek: "megaradio_premium_monthly1" — ZORUNLU
  transactionId: purchase.transactionId,    // Store'dan gelen transaction ID — ZORUNLU
  plan: PRODUCT_TO_PLAN[purchase.productId], // Asagidaki mapping tablosu — OPSIYONEL (backend otomatik cozumler)
  originalTransactionId: Platform.OS === 'ios'
    ? purchase.originalTransactionIdIOS
    : purchase.transactionId,               // iOS yenileme takibi icin
  receipt: Platform.OS === 'ios'
    ? purchase.transactionReceipt
    : undefined,                            // iOS receipt data
  purchaseToken: Platform.OS === 'android'
    ? purchase.purchaseToken
    : undefined,                            // Android purchase token
  isTrial: false,                           // Deneme suresi ise true
}
```

### Product ID → Plan Esleme Tablosu
Bu tablo zaten uygulamada var, ayni kalacak:
```typescript
const PRODUCT_TO_PLAN: Record<string, string> = {
  'megaradio_remove_ads_yearly1': 'remove_ads',
  'megaradio_premium_monthly1': 'premium_monthly',
  'megaradio_premium_yearly': 'premium_yearly',
  'megaradio_premium_lifetime': 'premium_lifetime',
};
```

### Beklenen Response
```json
{
  "success": true,
  "plan": "premium_monthly",
  "expiryDate": "2026-05-01T00:00:00.000Z",
  "isActive": true,
  "features": ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"]
}
```

### Ornek Kod (handlePurchaseSuccess icine eklenecek)
```typescript
const reportToBackend = async (purchase: Purchase) => {
  try {
    const authToken = await getAuthToken(); // Kullanicinin auth token'ini al
    if (!authToken) {
      console.log('Kullanici giris yapmamis, backend bildirimi atlanıyor');
      return;
    }

    const response = await fetch('https://themegaradio.com/api/user/subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        platform: Platform.OS,
        productId: purchase.productId,
        transactionId: purchase.transactionId,
        originalTransactionId: Platform.OS === 'ios'
          ? purchase.originalTransactionIdIOS || purchase.transactionId
          : purchase.transactionId,
        receipt: Platform.OS === 'ios' ? purchase.transactionReceipt : undefined,
        purchaseToken: Platform.OS === 'android' ? purchase.purchaseToken : undefined,
        isTrial: false,
      }),
    });

    const data = await response.json();
    console.log('Backend subscription response:', data);
  } catch (error) {
    // Backend hatasi satin almayi engellemez — lokal kayit zaten yapildi
    console.warn('Backend subscription bildirimi basarisiz (lokal kayit gecerli):', error);
  }
};
```

### ONEMLI: handlePurchaseSuccess Akisi
Mevcut akis:
```
1. productId → plan esleme
2. Sure hesaplama
3. premiumStore.setPremiumStatus(plan, expiryDate)  ← AsyncStorage'a yaz
4. finishTransaction()                              ← Store'a tamamlandi bilgisi
```

Yeni akis:
```
1. productId → plan esleme
2. Sure hesaplama
3. premiumStore.setPremiumStatus(plan, expiryDate)  ← AsyncStorage'a yaz (DEGISMEZ)
4. await reportToBackend(purchase)                  ← YENI: Backend'e bildir
5. finishTransaction()                              ← Store'a tamamlandi bilgisi
```

**NOT:** `reportToBackend` basarisiz olursa bile `finishTransaction` cagirilmali. Backend bildirimi satin almayi bloklamamali. try/catch icinde kalsin.

---

## GOREV 2: Uygulama Acilisinda Backend'den Plan Durumu Sorgula

### Ne yapilacak?
Uygulama her acildiginda (veya kullanici login olduktan sonra), backend'den guncel abonelik durumunu sor. Eger backend'deki plan daha yuksek rank'ta ise, lokal durumu guncelle.

### Endpoint
```
GET https://themegaradio.com/api/user/subscription
```

### Beklenen Response
```json
{
  "plan": "premium_monthly",
  "expiryDate": "2026-05-01T00:00:00.000Z",
  "isActive": true,
  "features": ["remove_ads", "song_info", "spotify_link", "youtube_link", "hd_stream", "song_history", "stream_record"]
}
```

Eger abonelik yoksa veya suresi dolduysa:
```json
{
  "plan": "none",
  "expiryDate": null,
  "isActive": false,
  "features": []
}
```

### Ornek Kod
```typescript
const syncSubscriptionFromBackend = async () => {
  try {
    const authToken = await getAuthToken();
    if (!authToken) return; // Giris yapilmamis

    const response = await fetch('https://themegaradio.com/api/user/subscription', {
      headers: { 'Authorization': `Bearer ${authToken}` },
    });

    if (!response.ok) return;

    const data = await response.json();

    // Backend'den gelen plan
    const backendPlan = data.plan; // 'none' | 'remove_ads' | 'premium_monthly' | 'premium_yearly' | 'premium_lifetime'
    const backendActive = data.isActive;

    // Lokal plan
    const localPlan = premiumStore.currentPlan;

    // Rank karsilastirmasi — yuksek olan kazanir
    const PLAN_RANK: Record<string, number> = {
      'none': 0, 'remove_ads': 1, 'premium_monthly': 2, 'premium_yearly': 3, 'premium_lifetime': 4,
    };

    const backendRank = PLAN_RANK[backendPlan] || 0;
    const localRank = PLAN_RANK[localPlan] || 0;

    if (backendActive && backendRank > localRank) {
      // Backend'de daha iyi plan var (baska cihazdan alinmis olabilir)
      const expiryDate = data.expiryDate ? new Date(data.expiryDate) : null;
      premiumStore.setPremiumStatus(backendPlan, expiryDate);
      console.log(`Plan backend'den guncellendi: ${backendPlan}`);
    } else if (!backendActive && localRank > 0) {
      // Backend'de aktif degil ama lokalde var — lokal gecerli
      // Lokal plan korunur (Store'dan restore edilmis olabilir)
      console.log('Backend inaktif, lokal plan korunuyor:', localPlan);
    }
  } catch (error) {
    console.warn('Backend subscription sorgulama hatasi:', error);
    // Hata durumunda lokal plan gecerli kalir
  }
};
```

### Nerede cagrilacak?
```
1. App.tsx — useEffect icinde, uygulama ilk acildiginda
2. Login basarili olduktan hemen sonra
3. Kullanici profil sayfasina girdigi zaman (opsiyonel)
```

---

## GOREV 3: Restore Purchases Sonrasi Backend'e Bildir

### Ne yapilacak?
Kullanici "Restore Purchases" yaptiginda, geri yuklenen her satin almayi backend'e de bildir.

### Mevcut restore akisi:
```
1. getAvailablePurchases() → Store'dan tum aktif satin almalar
2. En yuksek rank'li plan secilir
3. premiumStore.setPremiumStatus(plan, expiryDate)
```

### Yeni restore akisi:
```
1. getAvailablePurchases() → Store'dan tum aktif satin almalar
2. En yuksek rank'li plan secilir
3. premiumStore.setPremiumStatus(plan, expiryDate)  ← DEGISMEZ
4. En yuksek rank'li satin almayi reportToBackend(purchase) ile backend'e bildir  ← YENI
```

### Ornek Kod
```typescript
const restorePurchases = async () => {
  try {
    const purchases = await RNIap.getAvailablePurchases();

    if (purchases.length === 0) {
      Alert.alert('Bilgi', 'Geri yuklenecek satin alma bulunamadi.');
      return;
    }

    // En yuksek rank'li satin almayi bul
    let bestPurchase = purchases[0];
    let bestRank = 0;
    const PLAN_RANK: Record<string, number> = {
      'none': 0, 'remove_ads': 1, 'premium_monthly': 2, 'premium_yearly': 3, 'premium_lifetime': 4,
    };

    for (const purchase of purchases) {
      const plan = PRODUCT_TO_PLAN[purchase.productId] || 'none';
      const rank = PLAN_RANK[plan] || 0;
      if (rank > bestRank) {
        bestRank = rank;
        bestPurchase = purchase;
      }
    }

    const bestPlan = PRODUCT_TO_PLAN[bestPurchase.productId] || 'none';
    const expiryDate = bestPlan === 'premium_lifetime' ? null : calculateExpiry(bestPlan);
    premiumStore.setPremiumStatus(bestPlan, expiryDate);

    // Backend'e bildir
    await reportToBackend(bestPurchase);

    Alert.alert('Basarili', `${bestPlan} plani geri yuklendi.`);
  } catch (error) {
    console.error('Restore hatasi:', error);
    Alert.alert('Hata', 'Satin almalar geri yuklenemedi.');
  }
};
```

---

## GOREV 4: Renewal Listener'da Backend'e Bildir

### Ne yapilacak?
`purchaseUpdatedListener` icinde otomatik yenileme gerceklestiginde backend'e bildir.

### Ornek Kod
```typescript
useEffect(() => {
  const purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
    async (purchase: Purchase) => {
      // Mevcut lokal islemler (DEGISMEZ)
      const plan = PRODUCT_TO_PLAN[purchase.productId] || 'premium_monthly';
      const expiryDate = calculateExpiry(plan);
      premiumStore.setPremiumStatus(plan, expiryDate);

      // Backend'e bildir (YENI)
      await reportToBackend(purchase);

      // Store'a tamamlandi bilgisi
      if (Platform.OS === 'ios') {
        await RNIap.finishTransaction({ purchase });
      } else {
        await RNIap.acknowledgePurchaseAndroid({ token: purchase.purchaseToken! });
      }
    }
  );

  const purchaseErrorSubscription = RNIap.purchaseErrorListener(
    (error: PurchaseError) => {
      console.warn('Purchase error:', error);
    }
  );

  return () => {
    purchaseUpdateSubscription.remove();
    purchaseErrorSubscription.remove();
  };
}, []);
```

---

## KONTROL LISTESI (Checklist)

Entegrasyon tamamlaninca asagidaki maddeler test edilmeli:

### Satin Alma Testi
- [ ] iOS'ta `megaradio_premium_monthly1` satin al → Backend'e POST gittigini logla
- [ ] Android'de `megaradio_premium_monthly1` satin al → Backend'e POST gittigini logla
- [ ] `megaradio_remove_ads_yearly1` satin al → Backend response'unda `plan: "remove_ads"` donmeli
- [ ] `megaradio_premium_lifetime` satin al → Backend response'unda `expiryDate: null` donmeli
- [ ] Satin alma basarisiz olsa bile `finishTransaction` cagrilmali
- [ ] Backend'e POST basarisiz olsa bile satin alma islemini BLOKLAMAMALI (lokal kayit gecerli)

### Uygulama Acilis Testi
- [ ] Login sonrasi `GET /api/user/subscription` cagirildigini dogrula
- [ ] Backend'den donen `plan` ve `features` dogru mu kontrol et
- [ ] Eger backend'de plan yoksa (none), lokal plan korunuyor mu?

### Restore Testi
- [ ] "Restore Purchases" butonuna bas → Backend'e bildirim gidiyor mu?
- [ ] Farkli cihazda ayni hesapla login ol → Backend'den plan geldigini dogrula

### Cihazlar Arasi Senkronizasyon
- [ ] iPhone'da satin al → iPad'de login ol → Plan backend'den gelmeli
- [ ] Android'de satin al → iOS'ta login ol → Plan backend'den gelmeli

### Hata Senaryolari
- [ ] Internet yokken satin al → Lokal kayit calismali, backend bildirimi sessizce basarisiz olmali
- [ ] Gecersiz auth token ile istek → 401 hatasi donmeli, uygulama crash olmamali
- [ ] Backend 500 donerse → Uygulama normal calismaya devam etmeli

---

## TEKNIK NOTLAR

1. **Backend adresi:** `https://themegaradio.com`

2. **Plan adlari ASLA degismemeli.** Backend ve mobil uygulama ayni stringleri kullaniyor:
   - `none`, `remove_ads`, `premium_monthly`, `premium_yearly`, `premium_lifetime`

3. **`premium_lifetime` icin `expiryDate` her zaman `null`dur.** Backend bunu sonsuz abonelik olarak degerlendirir.

4. **`remove_ads` planı premium degildir.** Sadece reklam kaldirir, diger premium ozellikleri acmaz.

5. **Backend bildirimi basarisiz olursa satin alma IPTAL EDILMEZ.** Lokal AsyncStorage'daki kayit her zaman gecerlidir. Backend sadece ek senkronizasyon icin kullanilir.

6. **Auth token:** Kullanici login degilse backend cagrilari atlanir (try/catch icinde sessizce basarisiz olur).

7. **Duplicate prevention:** Ayni `transactionId` ile 2 kez POST atilirsa, backend 2. istekte `note: "already_active"` doner. Sorun yaratmaz.

8. **Sandbox testing:** iOS Sandbox ve Android test hesaplari ile gercek para harcamadan test edilebilir.
