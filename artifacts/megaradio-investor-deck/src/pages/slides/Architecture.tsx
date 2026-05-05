export default function Architecture() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg text-text font-body px-[7vw] py-[7vh]">
      <div className="relative z-10 flex flex-col h-full">
        <div className="text-accent font-display font-[600] text-[1.1vw] tracking-[0.3em] uppercase">
          Engineering · Architecture
        </div>
        <h2 className="mt-[2vh] font-display font-[800] text-[4vw] leading-[1] tracking-tight max-w-[60vw] text-balance">
          A microservice platform built for scale day one.
        </h2>

        <div className="mt-[5vh] flex-1 grid grid-cols-3 gap-[1.8vw]">
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase">Edge</div>
            <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.7vw] leading-tight">Cloudflare CDN</div>
            <p className="mt-[1.5vh] font-body text-[1.1vw] text-muted leading-snug">
              Global caching, geolocation, bot management, and TLS termination at the edge.
            </p>
            <div className="mt-auto font-body text-[1vw] text-muted/70">DNS · WAF · Cache · Geo IP</div>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase">App</div>
            <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.7vw] leading-tight">Express + TypeScript</div>
            <p className="mt-[1.5vh] font-body text-[1.1vw] text-muted leading-snug">
              SSR frontend, REST and SSE APIs, WebSockets, Passport auth, and a dedicated stream proxy service.
            </p>
            <div className="mt-auto font-body text-[1vw] text-muted/70">React · Vite · Tailwind</div>
          </div>
          <div className="bg-surface border border-border rounded-[1vw] p-[1.8vw] flex flex-col">
            <div className="font-display font-[600] text-accent text-[1.1vw] tracking-widest uppercase">Data</div>
            <div className="mt-[1.5vh] font-display font-[700] text-text text-[1.7vw] leading-tight">MongoDB Atlas</div>
            <p className="mt-[1.5vh] font-body text-[1.1vw] text-muted leading-snug">
              Catalog, sessions, comments, and event streams — backed by Redis cache and AWS S3 media storage.
            </p>
            <div className="mt-auto font-body text-[1vw] text-muted/70">Mongoose · Redis · S3</div>
          </div>
        </div>

        <div className="mt-[3vh] flex items-center justify-between font-body text-[0.95vw] text-muted">
          <span>Containerized · pnpm monorepo · API server, web frontend, stream proxy</span>
          <span>11</span>
        </div>
      </div>
    </div>
  );
}
