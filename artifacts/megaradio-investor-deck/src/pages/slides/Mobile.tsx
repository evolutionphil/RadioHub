export default function Mobile() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 grid grid-cols-12 gap-[3vw] h-full">
        <div className="col-span-5 flex flex-col">
          <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
            Mobile · Monetization
          </div>
          <h2 className="mt-[2vh] font-display font-[800] text-[3.6vw] leading-[1] tracking-tight text-balance">
            From listener to subscriber, on every platform.
          </h2>
          <p className="mt-[3vh] font-body text-[1.35vw] text-muted leading-snug text-pretty">
            Apple and Google in-app purchases plus web checkout feed a single subscription matrix — synchronized across web, iOS and Android.
          </p>
          <div className="mt-auto font-body text-[0.95vw] text-muted">
            Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com
          </div>
        </div>

        <div className="col-span-7 grid grid-cols-2 grid-rows-2 gap-[1.5vw]">
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">Apple IAP</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Server-side receipt validation against Apple, including renewal events and refund hooks.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">Google Play billing</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Service-account validation, subscription state sync, and grace-period handling out of the box.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">Subscription matrix</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Plans, entitlements, and feature flags resolved server-side regardless of where the purchase happened.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">Ads &amp; transactional email</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Reserved ad slots for free listeners, SendGrid for receipts, alerts, and re-engagement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
