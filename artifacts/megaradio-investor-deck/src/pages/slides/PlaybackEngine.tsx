export default function PlaybackEngine() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute top-[12vh] right-[7vw] w-[1px] h-[60vh] bg-border" />

      <div className="relative z-10 grid grid-cols-12 gap-[3vw] h-full">
        <div className="col-span-5 flex flex-col">
          <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
            Product · Playback
          </div>
          <h2 className="mt-[2vh] font-display font-[800] text-[4vw] leading-[1] tracking-tight text-balance">
            Continuous playback, anywhere on the page.
          </h2>
          <p className="mt-[3vh] font-body text-[1.4vw] text-muted leading-snug text-pretty">
            A persistent player powered by HLS.js and Plyr keeps the stream alive while listeners browse stations, read articles, or switch sections — no rebuffering, no interruptions.
          </p>
          <div className="mt-auto font-body text-[0.95vw] text-muted">
            Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com
          </div>
        </div>

        <div className="col-span-7 flex flex-col justify-center gap-[2.5vh]">
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw] flex items-start gap-[1.5vw]">
            <div className="font-display font-[800] text-accent text-[2.4vw] leading-none w-[4vw]">01</div>
            <div>
              <div className="font-display font-[600] text-[1.6vw]">Multi-format streaming</div>
              <p className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
                HLS, Icecast, Shoutcast, MP3, AAC and more, normalized through one adaptive engine.
              </p>
            </div>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw] flex items-start gap-[1.5vw]">
            <div className="font-display font-[800] text-accent text-[2.4vw] leading-none w-[4vw]">02</div>
            <div>
              <div className="font-display font-[600] text-[1.6vw]">Persistent player</div>
              <p className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
                A floating player survives full page navigation — listeners never lose the stream as they explore.
              </p>
            </div>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[2vw] flex items-start gap-[1.5vw]">
            <div className="font-display font-[800] text-accent text-[2.4vw] leading-none w-[4vw]">03</div>
            <div>
              <div className="font-display font-[600] text-[1.6vw]">Stream proxy &amp; healing</div>
              <p className="mt-[1vh] font-body text-[1.2vw] text-muted leading-snug">
                A dedicated proxy normalizes mixed content, retries broken streams, and quarantines dead ones.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
