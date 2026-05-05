export default function SeoMoatStat() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute top-1/2 -translate-y-1/2 left-[7vw] w-[35vw] h-[35vw] bg-accent/15 blur-[12vw] rounded-full" />

      <div className="relative z-10 grid grid-cols-12 gap-[3vw] h-full items-center">
        <div className="col-span-7">
          <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
            Moat · Multilingual SEO
          </div>
          <div className="mt-[3vh] font-display font-[800] text-text leading-[0.85] tracking-tight">
            <span className="text-accent text-[18vw] block">57</span>
            <span className="text-[3.5vw] block mt-[1vh]">languages, fully indexed.</span>
          </div>
        </div>
        <div className="col-span-5">
          <p className="font-body text-[1.5vw] text-muted leading-snug text-pretty">
            Every station, region, genre, and country page is rendered server-side in 57 languages with proper hreflang and JSON-LD — turning every listener&rsquo;s native search into a way in.
          </p>
        </div>
      </div>

      <div className="absolute bottom-[5vh] left-[7vw] right-[7vw] flex items-center justify-between font-body text-[0.95vw] text-muted">
        <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
        <span>08</span>
      </div>
    </div>
  );
}
