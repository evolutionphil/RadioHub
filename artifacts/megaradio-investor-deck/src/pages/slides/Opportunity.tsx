const base = import.meta.env.BASE_URL;

export default function Opportunity() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body">
      <img
        src={`${base}global-map.png`}
        crossOrigin="anonymous"
        alt="Global coverage"
        className="absolute right-0 top-0 h-full w-[55vw] object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/95 to-transparent" />

      <div className="relative z-10 h-full flex flex-col justify-between px-[7vw] py-[7vh]">
        <div>
          <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
            02 · Opportunity
          </div>
          <h2 className="mt-[2vh] font-display font-[800] text-[4.5vw] leading-[1] tracking-tight max-w-[55vw] text-balance">
            A century-old habit, still waiting for its modern home.
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-[2.5vw] max-w-[70vw]">
          <div>
            <div className="font-display font-[800] text-text text-[5.5vw] leading-none">2.5B+</div>
            <div className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
              People worldwide who still listen to radio every week.
            </div>
          </div>
          <div>
            <div className="font-display font-[800] text-accent text-[5.5vw] leading-none">50k+</div>
            <div className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
              Live internet radio stations broadcasting at any moment.
            </div>
          </div>
          <div>
            <div className="font-display font-[800] text-text text-[5.5vw] leading-none">200+</div>
            <div className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
              Countries with active broadcasters and untapped global audiences.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>03</span>
        </div>
      </div>
    </div>
  );
}
