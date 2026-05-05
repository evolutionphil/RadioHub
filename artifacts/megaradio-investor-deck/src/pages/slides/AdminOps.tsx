export default function AdminOps() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute top-0 right-0 w-[20vw] h-[20vw] bg-accent/10 blur-[8vw] rounded-full" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Operations · Admin Console
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.2vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          A control room for a 50,000-station catalog.
        </h2>
        <p className="mt-[2.5vh] font-body text-[1.4vw] text-muted max-w-[55vw] text-pretty">
          Operators run the platform from a single dashboard — no engineering ticket required.
        </p>

        <div className="mt-[5vh] grid grid-cols-3 gap-[1.8vw]">
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">SEO maintenance</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              One-click junk audits, broken-stream detection, indexability fixes, and IndexNow pushes.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">Logo &amp; metadata backfill</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Background jobs enrich missing logos, tags, and language codes across the entire catalog.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">IAP event log</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Live feed of subscription, renewal, refund, and grace-period events for support and finance.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">Country mapping</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Editable country-to-language overrides drive routing, hreflang, and recommendation defaults.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">IndexNow monitor</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Real-time visibility into URL submissions, search engine acceptance, and retry queues.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.4vw]">User &amp; role management</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Admin roles, audit trails, and session controls for a small operations team.
            </p>
          </div>
        </div>

        <div className="mt-auto pt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>13</span>
        </div>
      </div>
    </div>
  );
}
