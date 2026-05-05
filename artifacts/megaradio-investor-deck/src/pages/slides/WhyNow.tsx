export default function WhyNow() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg-soft to-bg" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50vw] h-[50vw] bg-accent/5 blur-[12vw] rounded-full" />

      <div className="relative z-10 h-full flex flex-col justify-between">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Why Now
        </div>

        <div className="max-w-[75vw]">
          <div className="font-display font-[800] text-accent text-[5vw] leading-none">&ldquo;</div>
          <p className="font-display font-[600] text-text text-[3.2vw] leading-[1.15] tracking-tight text-pretty">
            Smart speakers, in-car streaming, and 5G mobile finally make borderless live radio practical — but no platform has bothered to index, translate, and rank the world&rsquo;s stations for the listener.
          </p>
          <p className="mt-[3vh] font-body text-[1.4vw] text-muted leading-snug max-w-[65vw] text-pretty">
            MegaRadio is the only one architected from day one as a multilingual, server-rendered, search-first catalog of every live station on earth.
          </p>
        </div>

        <div className="flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Muhammed Fatih Geyik · Founder &amp; CEO · themegaradio.com</span>
          <span>14</span>
        </div>
      </div>
    </div>
  );
}
