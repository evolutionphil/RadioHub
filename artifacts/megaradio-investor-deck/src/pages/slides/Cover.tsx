const base = import.meta.env.BASE_URL;

export default function Cover() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body">
      <img
        src={`${base}hero-soundwave.png`}
        crossOrigin="anonymous"
        alt="Sound wave background"
        className="absolute inset-0 w-full h-full object-cover opacity-70"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/85 to-bg/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-transparent" />

      <div className="relative z-10 w-full h-full flex flex-col justify-between px-[7vw] py-[6vh]">
        <div className="flex items-center gap-[1.2vw]">
          <img
            src={`${base}megaradio-logo.webp`}
            crossOrigin="anonymous"
            alt="MegaRadio logo"
            className="h-[5vh] w-auto"
          />
          <span className="font-display font-[600] text-[1.6vw] tracking-tight text-text">
            MegaRadio
          </span>
        </div>

        <div className="max-w-[55vw]">
          <div className="text-accent font-display font-[600] text-[1.5vw] tracking-[0.3em] uppercase mb-[2.5vh]">
            Investor Deck · 2026
          </div>
          <h1 className="font-display font-[800] text-[7vw] leading-[0.95] tracking-tight text-text text-balance">
            Global radio, <span className="text-accent">personalized.</span>
          </h1>
          <p className="mt-[3vh] font-body font-[400] text-[1.8vw] text-muted leading-snug max-w-[42vw] text-pretty">
            Every station, every language, one tap away — the streaming radio platform built for the next billion listeners.
          </p>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="font-display font-[600] text-[1.4vw] text-text leading-tight">
              Muhammed Fatih Geyik
            </div>
            <div className="font-body font-[400] text-[1.1vw] text-muted">
              Founder &amp; CEO · themegaradio.com
            </div>
          </div>
          <div className="font-body font-[400] text-[1vw] text-muted tracking-widest uppercase">
            MegaRadio · 2026
          </div>
        </div>
      </div>
    </div>
  );
}
