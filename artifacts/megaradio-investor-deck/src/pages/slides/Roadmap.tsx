export default function Roadmap() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Roadmap · Next 12 Months
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.2vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          Where the next year of investment goes.
        </h2>

        <div className="mt-[6vh] flex-1 relative">
          <div className="absolute left-0 right-0 top-[6vh] h-[2px] bg-border" />

          <div className="grid grid-cols-3 gap-[2.5vw] relative">
            <div>
              <div className="w-[1.4vw] h-[1.4vw] rounded-full bg-accent relative -top-[0.5vw]" />
              <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase mt-[2vh]">Q1 – Q2</div>
              <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.8vw] leading-tight">Deeper personalization</div>
              <p className="mt-[1.5vh] font-body text-[1.15vw] text-muted leading-snug">
                Per-listener taste graphs, time-of-day station rotations, and AI-curated &ldquo;your radio&rdquo; channels.
              </p>
            </div>
            <div>
              <div className="w-[1.4vw] h-[1.4vw] rounded-full bg-accent relative -top-[0.5vw]" />
              <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase mt-[2vh]">Q2 – Q3</div>
              <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.8vw] leading-tight">Native mobile</div>
              <p className="mt-[1.5vh] font-body text-[1.15vw] text-muted leading-snug">
                iOS and Android apps with CarPlay, Android Auto, lockscreen controls, and offline favorites.
              </p>
            </div>
            <div>
              <div className="w-[1.4vw] h-[1.4vw] rounded-full bg-accent relative -top-[0.5vw]" />
              <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase mt-[2vh]">Q3 – Q4</div>
              <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.8vw] leading-tight">Broadcaster self-serve</div>
              <p className="mt-[1.5vh] font-body text-[1.15vw] text-muted leading-snug">
                Claim-your-station portal, analytics for broadcasters, and paid placement for verified accounts.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>18</span>
        </div>
      </div>
    </div>
  );
}
