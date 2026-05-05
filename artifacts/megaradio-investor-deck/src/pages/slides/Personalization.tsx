const base = import.meta.env.BASE_URL;

export default function Personalization() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body">
      <img
        src={`${base}listener-headphones.png`}
        crossOrigin="anonymous"
        alt="Listener with headphones"
        className="absolute inset-0 w-full h-full object-cover opacity-55"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-bg/30" />

      <div className="relative z-10 h-full flex flex-col justify-between px-[7vw] py-[7vh]">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Product · Personalization
        </div>

        <div className="max-w-[55vw]">
          <h2 className="font-display font-[800] text-[5vw] leading-[1] tracking-tight text-balance">
            The right station, before they know to ask.
          </h2>
          <p className="mt-[3vh] font-body text-[1.5vw] text-muted leading-snug max-w-[45vw] text-pretty">
            MegaRadio infers location from Cloudflare and GPS, blends it with listening trends, and surfaces stations tuned to language, region, time of day, and taste.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-[2vw] max-w-[70vw]">
          <div>
            <div className="font-display font-[700] text-accent text-[1.4vw]">Geolocation</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Cloudflare edge signals plus optional GPS for a sharp local default.
            </p>
          </div>
          <div>
            <div className="font-display font-[700] text-accent text-[1.4vw]">Trend analysis</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              Aggregated listening patterns surface what is actually being tuned in right now.
            </p>
          </div>
          <div>
            <div className="font-display font-[700] text-accent text-[1.4vw]">AI recommendations</div>
            <p className="mt-[1vh] font-body text-[1.1vw] text-muted leading-snug">
              OpenAI-powered taste graph suggests the next station before the current one ends.
            </p>
          </div>
        </div>

        <div className="font-body text-[0.95vw] text-muted">
          Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com
        </div>
      </div>
    </div>
  );
}
