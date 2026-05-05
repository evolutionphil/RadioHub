export default function Competition() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Landscape
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4.2vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          Where MegaRadio sits in the streaming landscape.
        </h2>

        <div className="mt-[5vh] flex-1 grid grid-cols-3 gap-[2vw]">
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[600] text-muted text-[1.1vw] tracking-widest uppercase">On-demand audio</div>
            <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.6vw]">Spotify · Apple Music</div>
            <p className="mt-[2vh] font-body text-[1.15vw] text-muted leading-snug">
              Owns playlists and licensed catalogs. Live radio is an afterthought, not a product.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[600] text-muted text-[1.1vw] tracking-widest uppercase">Legacy directories</div>
            <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.6vw]">TuneIn · iHeart · Radio Garden</div>
            <p className="mt-[2vh] font-body text-[1.15vw] text-muted leading-snug">
              Wide catalogs but stale metadata, weak SEO, and almost no localization beyond English.
            </p>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col border-accent">
            <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase">MegaRadio</div>
            <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.6vw]">Live radio · multilingual · indexed</div>
            <p className="mt-[2vh] font-body text-[1.15vw] text-muted leading-snug">
              Built around discovery in 57 languages, server-rendered SEO, and a curated catalog that heals itself.
            </p>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>15</span>
        </div>
      </div>
    </div>
  );
}
