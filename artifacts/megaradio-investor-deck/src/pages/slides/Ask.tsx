export default function Ask() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-bg-soft" />
      <div className="absolute top-[15vh] right-[10vw] w-[35vw] h-[35vw] bg-accent/10 blur-[12vw] rounded-full" />

      <div className="relative z-10 h-full flex flex-col justify-between">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          The Ask
        </div>

        <div className="grid grid-cols-12 gap-[3vw] items-center">
          <div className="col-span-7">
            <h2 className="font-display font-[800] text-[4.5vw] leading-[1] tracking-tight text-balance">
              We&rsquo;re raising to take MegaRadio global.
            </h2>
            <p className="mt-[3vh] font-body text-[1.4vw] text-muted leading-snug max-w-[45vw] text-pretty">
              Capital fuels native mobile, deeper AI personalization, broadcaster self-serve, and the marketing engine to convert SEO traffic into a daily habit.
            </p>
          </div>
          <div className="col-span-5">
            <div className="bg-surface border border-border rounded-[1.2vw] p-[2.5vw]">
              <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase">Round size</div>
              <div className="mt-[1vh] font-display font-[800] text-text text-[3.5vw] leading-tight">[Amount]</div>
              <div className="mt-[2vh] grid grid-cols-2 gap-y-[1.5vh] font-body text-[1.1vw]">
                <div className="text-muted">Stage</div><div className="text-text">[Seed / Series A]</div>
                <div className="text-muted">Use of funds</div><div className="text-text">Mobile · AI · Growth</div>
                <div className="text-muted">Runway</div><div className="text-text">[18–24 months]</div>
                <div className="text-muted">Lead</div><div className="text-text">Open</div>
              </div>
              <div className="mt-[2vh] font-body text-[0.95vw] text-muted/70">
                Bracketed figures are placeholders to be filled per investor conversation.
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>20</span>
        </div>
      </div>
    </div>
  );
}
