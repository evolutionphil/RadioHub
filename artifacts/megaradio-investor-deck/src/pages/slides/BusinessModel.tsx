export default function BusinessModel() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Business Model
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.5vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          Two revenue lines, one catalog.
        </h2>

        <div className="mt-[6vh] grid grid-cols-2 gap-[2.5vw] flex-1">
          <div className="bg-surface border border-border rounded-[1.2vw] p-[2.5vw] flex flex-col">
            <div className="font-display font-[600] text-accent text-[1.2vw] tracking-widest uppercase">Subscriptions</div>
            <div className="mt-[2vh] font-display font-[800] text-text text-[2.6vw] leading-tight">MegaRadio Pro</div>
            <p className="mt-[2vh] font-body text-[1.2vw] text-muted leading-snug text-pretty">
              Ad-free listening, high-bitrate streams, offline favorites sync, and early access to AI personalization.
            </p>
            <div className="mt-auto pt-[2vh] font-body text-[1.05vw] text-muted/80">
              Billed via Apple, Google Play, and web checkout — unified entitlements.
            </div>
          </div>
          <div className="bg-surface border border-border rounded-[1.2vw] p-[2.5vw] flex flex-col">
            <div className="font-display font-[600] text-accent text-[1.2vw] tracking-widest uppercase">Advertising</div>
            <div className="mt-[2vh] font-display font-[800] text-text text-[2.6vw] leading-tight">Audio &amp; display</div>
            <p className="mt-[2vh] font-body text-[1.2vw] text-muted leading-snug text-pretty">
              Geo-targeted display slots and pre-roll audio inserted only for free-tier listeners, with a clear path to broadcaster self-serve.
            </p>
            <div className="mt-auto pt-[2vh] font-body text-[1.05vw] text-muted/80">
              57-language inventory unlocks high-CPM markets premium platforms ignore.
            </div>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>17</span>
        </div>
      </div>
    </div>
  );
}
