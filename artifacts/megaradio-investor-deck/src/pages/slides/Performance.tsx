export default function Performance() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute -bottom-[10vw] -left-[10vw] w-[40vw] h-[40vw] bg-accent/10 blur-[10vw] rounded-full" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Engineering · Performance
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.5vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          Built to stay up under traffic spikes and crawler floods.
        </h2>

        <div className="mt-[6vh] grid grid-cols-2 gap-[2.5vw]">
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw]">
            <div className="font-display font-[800] text-accent text-[2vw]">Multi-layer caching</div>
            <p className="mt-[1.5vh] font-body text-[1.25vw] text-muted leading-snug">
              In-process NodeCache fronts a Redis tier, fronted by Cloudflare CDN — three layers tuned per route family.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw]">
            <div className="font-display font-[800] text-accent text-[2vw]">MongoDB circuit breaker</div>
            <p className="mt-[1.5vh] font-body text-[1.25vw] text-muted leading-snug">
              Database failures degrade gracefully to cached responses instead of cascading into a full outage.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw]">
            <div className="font-display font-[800] text-accent text-[2vw]">OOM protection</div>
            <p className="mt-[1.5vh] font-body text-[1.25vw] text-muted leading-snug">
              Memory budgets, response streaming, and a self-watchdog restart any process that drifts out of bounds.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw]">
            <div className="font-display font-[800] text-accent text-[2vw]">SSR protection</div>
            <p className="mt-[1.5vh] font-body text-[1.25vw] text-muted leading-snug">
              Bot detection and rate limits keep crawlers from overwhelming the server-rendered HTML pipeline.
            </p>
          </div>
        </div>

        <div className="mt-auto pt-[4vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>10</span>
        </div>
      </div>
    </div>
  );
}
