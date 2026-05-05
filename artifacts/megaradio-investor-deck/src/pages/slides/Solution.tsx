export default function Solution() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute -top-[10vw] -right-[10vw] w-[40vw] h-[40vw] bg-accent/10 blur-[10vw] rounded-full" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          03 · Solution
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.5vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          One app. Every station. Every language.
        </h2>
        <p className="mt-[2.5vh] font-body text-[1.6vw] text-muted max-w-[58vw] text-pretty">
          MegaRadio turns the entire world of live radio into a single, personalized stream — translated, indexed, and ready in milliseconds.
        </p>

        <div className="mt-[6vh] grid grid-cols-3 gap-[2vw]">
          <div className="border-l-2 border-accent pl-[1.5vw]">
            <div className="font-display font-[700] text-text text-[1.8vw]">Universal player</div>
            <p className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
              HLS, Icecast, Shoutcast, MP3, AAC — every common format in one continuous, gapless playback engine.
            </p>
          </div>
          <div className="border-l-2 border-accent pl-[1.5vw]">
            <div className="font-display font-[700] text-text text-[1.8vw]">Global discovery</div>
            <p className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
              Geolocation, genres, regions, cities, search — surface the right station the moment a listener opens the app.
            </p>
          </div>
          <div className="border-l-2 border-accent pl-[1.5vw]">
            <div className="font-display font-[700] text-text text-[1.8vw]">Built to be found</div>
            <p className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
              Server-rendered SEO across 57 languages so every station ranks in its listener&rsquo;s native search.
            </p>
          </div>
        </div>

        <div className="mt-auto pt-[4vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>04</span>
        </div>
      </div>
    </div>
  );
}
