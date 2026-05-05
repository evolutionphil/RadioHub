export default function Traction() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Traction
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.2vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          What we&rsquo;ve built so far.
        </h2>
        <p className="mt-[2vh] font-body text-[1.3vw] text-muted max-w-[55vw]">
          Concrete numbers below are placeholders to be replaced from the live admin dashboard before any investor meeting.
        </p>

        <div className="mt-[5vh] grid grid-cols-4 gap-[1.8vw] flex-1">
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[700] text-accent text-[3.5vw] leading-none">[stations]</div>
            <div className="mt-[1.5vh] font-display font-[600] text-text text-[1.3vw]">Live stations indexed</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Curated, deduplicated, with logos, language codes, and tags backfilled.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[700] text-accent text-[3.5vw] leading-none">57</div>
            <div className="mt-[1.5vh] font-display font-[600] text-text text-[1.3vw]">UI &amp; SEO languages</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Every public page rendered server-side with native-language metadata.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[700] text-accent text-[3.5vw] leading-none">[regions]</div>
            <div className="mt-[1.5vh] font-display font-[600] text-text text-[1.3vw]">Countries &amp; regions</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Country, region, and city pages with localized listings and broadcaster details.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[700] text-accent text-[3.5vw] leading-none">[MAU]</div>
            <div className="mt-[1.5vh] font-display font-[600] text-text text-[1.3vw]">Monthly listeners</div>
            <p className="mt-[1vh] font-body text-[1.05vw] text-muted leading-snug">
              Tracked via Google Analytics and internal session metrics.
            </p>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>16</span>
        </div>
      </div>
    </div>
  );
}
