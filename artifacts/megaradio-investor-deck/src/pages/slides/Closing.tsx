const base = import.meta.env.BASE_URL;

export default function Closing() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body">
      <img
        src={`${base}hero-soundwave.png`}
        crossOrigin="anonymous"
        alt="Sound wave"
        className="absolute inset-0 w-full h-full object-cover opacity-50"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-bg/50" />

      <div className="relative z-10 h-full flex flex-col justify-between px-[7vw] py-[7vh]">
        <div className="flex items-center gap-[1.2vw]">
          <img
            src={`${base}megaradio-logo.webp`}
            crossOrigin="anonymous"
            alt="MegaRadio logo"
            className="h-[5vh] w-auto"
          />
          <span className="font-display font-[600] text-[1.6vw] tracking-tight">MegaRadio</span>
        </div>

        <div className="max-w-[70vw]">
          <div className="text-accent font-display font-[600] text-[1.5vw] tracking-[0.3em] uppercase mb-[2.5vh]">
            Thank you
          </div>
          <h2 className="font-display font-[800] text-[6.5vw] leading-[0.95] tracking-tight text-balance">
            Let&rsquo;s build the world&rsquo;s <span className="text-accent">radio.</span>
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-[3vw]">
          <div>
            <div className="font-display font-[600] text-accent text-[1vw] tracking-widest uppercase">Founder</div>
            <div className="mt-[1vh] font-display font-[700] text-text text-[1.5vw]">Muhammed Fatih Geyik</div>
            <div className="font-body text-[1.1vw] text-muted">Founder &amp; CEO</div>
          </div>
          <div>
            <div className="font-display font-[600] text-accent text-[1vw] tracking-widest uppercase">Web</div>
            <a
              href="https://themegaradio.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-[1vh] block font-display font-[700] text-text text-[1.5vw] underline decoration-accent underline-offset-4"
            >
              themegaradio.com
            </a>
            <div className="font-body text-[1.1vw] text-muted">Live in 57 languages</div>
          </div>
          <div>
            <div className="font-display font-[600] text-accent text-[1vw] tracking-widest uppercase">Deck</div>
            <div className="mt-[1vh] font-display font-[700] text-text text-[1.5vw]">Investor Edition</div>
            <div className="font-body text-[1.1vw] text-muted">2026</div>
          </div>
        </div>
      </div>
    </div>
  );
}
