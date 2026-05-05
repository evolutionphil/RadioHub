export default function Discovery() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Product · Discovery
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.5vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          Find any station, the way you actually search.
        </h2>

        <div className="mt-[6vh] grid grid-cols-3 grid-rows-2 gap-[1.8vw] flex-1">
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.5vw]">Genres</div>
            <p className="mt-[1vh] font-body text-[1.15vw] text-muted leading-snug">
              From talk radio to lo-fi, jazz to regional folk — every genre as a first-class browsing surface.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.5vw]">Regions &amp; cities</div>
            <p className="mt-[1vh] font-body text-[1.15vw] text-muted leading-snug">
              Country, region, and city pages give locals their hometown stations and travelers their destination&rsquo;s sound.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.5vw]">Smart search</div>
            <p className="mt-[1vh] font-body text-[1.15vw] text-muted leading-snug">
              Search across station names, frequencies, broadcasters, languages, and metadata in one query.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.5vw]">Favorites</div>
            <p className="mt-[1vh] font-body text-[1.15vw] text-muted leading-snug">
              One-tap saving with synced favorites across web and mobile so a listener&rsquo;s rotation follows them.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.5vw]">Comments</div>
            <p className="mt-[1vh] font-body text-[1.15vw] text-muted leading-snug">
              Per-station comments turn quiet directory pages into living communities around each broadcaster.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw]">
            <div className="font-display font-[700] text-accent text-[1.5vw]">Now playing</div>
            <p className="mt-[1vh] font-body text-[1.15vw] text-muted leading-snug">
              Live track metadata, station status, and listener counts streamed via Server-Sent Events.
            </p>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>06</span>
        </div>
      </div>
    </div>
  );
}
