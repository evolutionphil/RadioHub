export default function SeoInfra() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Moat · SEO Infrastructure
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.2vw] leading-[1] tracking-tight max-w-[65vw] text-balance">
          The engineering behind being found.
        </h2>

        <div className="mt-[5vh] grid grid-cols-4 grid-rows-2 gap-[1.5vw] flex-1">
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">Server-rendered SEO</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Crawlers receive fully rendered HTML for every public route.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">Dynamic sitemaps</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Sharded sitemaps regenerate as the catalog evolves and ping search engines automatically.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">Hreflang &amp; canonicals</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Prefix-all canonicals and per-locale hreflang tags keep duplicate content from cannibalizing rank.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">JSON-LD schema</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              RadioStation, BreadcrumbList, Organization and Article schema on every relevant page.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">Junk-station rules</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Broken or low-quality stations are auto-noindexed and 410-Goned to keep the index clean.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">Indexability gate</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              A single source of truth decides what is crawlable, indexable, or hidden — no conflicting headers.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">IndexNow pipeline</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              New and updated URLs are pushed instantly to Bing and partners as soon as they go live.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[0.8vw] p-[1.5vw]">
            <div className="font-display font-[700] text-accent text-[1.3vw]">Bot rate limiting</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Smart throttling protects origin while keeping legitimate crawlers well-fed.
            </p>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>09</span>
        </div>
      </div>
    </div>
  );
}
