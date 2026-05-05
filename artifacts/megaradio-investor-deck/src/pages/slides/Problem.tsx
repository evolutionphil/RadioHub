const base = import.meta.env.BASE_URL;

export default function Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute top-0 left-0 w-[24vw] h-[24vw] bg-accent/10 blur-[8vw] rounded-full" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          01 · The Problem
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.5vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          Radio is everywhere — and broken everywhere.
        </h2>
        <p className="mt-[2.5vh] font-body text-[1.6vw] text-muted max-w-[55vw] text-pretty">
          Listeners juggle a dozen apps, broken streams, and language walls just to find a station that fits the moment.
        </p>

        <div className="mt-[6vh] grid grid-cols-3 gap-[2vw]">
          <div className="bg-surface border border-border rounded-[1.2vw] p-[2.2vw]">
            <div className="font-display font-[800] text-accent text-[3.5vw] leading-none">Fragmented</div>
            <p className="mt-[1.5vh] font-body text-[1.3vw] text-muted leading-snug">
              Tens of thousands of stations scattered across regional apps, broadcaster sites, and dead directories.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1.2vw] p-[2.2vw]">
            <div className="font-display font-[800] text-accent text-[3.5vw] leading-none">Unreliable</div>
            <p className="mt-[1.5vh] font-body text-[1.3vw] text-muted leading-snug">
              Streams break, metadata is wrong, and most directories silently rot for years before anyone notices.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1.2vw] p-[2.2vw]">
            <div className="font-display font-[800] text-accent text-[3.5vw] leading-none">Local-only</div>
            <p className="mt-[1.5vh] font-body text-[1.3vw] text-muted leading-snug">
              Discovery stops at language and country borders, leaving a global medium feeling small.
            </p>
          </div>
        </div>

        <div className="mt-auto pt-[4vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>02</span>
        </div>
      </div>
    </div>
  );
}
