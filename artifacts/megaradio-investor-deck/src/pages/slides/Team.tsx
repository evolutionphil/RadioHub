const base = import.meta.env.BASE_URL;

export default function Team() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute -top-[5vw] right-[5vw] w-[30vw] h-[30vw] bg-accent/10 blur-[10vw] rounded-full" />

      <div className="relative z-10 grid grid-cols-12 gap-[3vw] h-full items-center">
        <div className="col-span-7">
          <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
            Team
          </div>
          <h2 className="mt-[2vh] font-display font-[800] text-[4.2vw] leading-[1] tracking-tight text-balance">
            Founder-led, engineering-first.
          </h2>
          <div className="mt-[5vh]">
            <div className="font-display font-[800] text-text text-[3vw] leading-tight">Muhammed Fatih Geyik</div>
            <div className="mt-[1vh] font-display font-[600] text-accent text-[1.6vw]">Founder &amp; CEO</div>
            <p className="mt-[3vh] font-body text-[1.3vw] text-muted leading-snug max-w-[42vw] text-pretty">
              Solo-built the entire MegaRadio platform end to end — backend, frontend, SEO, mobile, and operations — and ships every release.
            </p>
            <div className="mt-[3vh] grid grid-cols-2 gap-[1.5vw] max-w-[42vw]">
              <div className="bg-surface border border-border rounded-[0.8vw] p-[1.4vw]">
                <div className="font-display font-[600] text-accent text-[1vw] tracking-widest uppercase">Engineering</div>
                <div className="mt-[0.8vh] font-body text-[1.1vw] text-text">Full-stack TypeScript, distributed systems, search infrastructure.</div>
              </div>
              <div className="bg-surface border border-border rounded-[0.8vw] p-[1.4vw]">
                <div className="font-display font-[600] text-accent text-[1vw] tracking-widest uppercase">Growth</div>
                <div className="mt-[0.8vh] font-body text-[1.1vw] text-text">Multilingual SEO, content systems, performance marketing.</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-span-5 flex items-center justify-center">
          <div className="bg-surface border border-border rounded-[1.5vw] p-[3vw] flex flex-col items-center justify-center w-full aspect-square">
            <img
              src={`${base}megaradio-logo.webp`}
              crossOrigin="anonymous"
              alt="MegaRadio mark"
              className="w-[18vw] h-auto"
            />
            <div className="mt-[3vh] font-display font-[600] text-text text-[1.4vw] tracking-tight">MegaRadio</div>
            <div className="mt-[0.5vh] font-body text-[1vw] text-muted">themegaradio.com</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[5vh] left-[7vw] right-[7vw] flex items-center justify-between font-body text-[0.95vw] text-muted">
        <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
        <span>19</span>
      </div>
    </div>
  );
}
