import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Home, Radio, Music, Globe, ArrowRight, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { getImageUrl } from "@/lib/utils";

function SignalBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-[3px] h-5">
      {[3, 5, 8, 11, 14].map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm transition-all duration-300"
          style={{
            height: `${h}px`,
            backgroundColor: active
              ? i < 2
                ? "#FF4199"
                : "rgba(255,65,153,0.3)"
              : "rgba(255,255,255,0.15)",
            animation: active ? `pulse-bar ${0.6 + i * 0.15}s ease-in-out infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

function WaveAnimation() {
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-[#FF4199]"
          style={{
            animation: `wave-bar ${0.8 + (i % 5) * 0.2}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.07}s`,
            opacity: 0.3 + (i % 3) * 0.25,
          }}
        />
      ))}
    </div>
  );
}

function StaticNoise() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;

    const draw = () => {
      const { width, height } = canvas;
      const imageData = ctx.createImageData(width, height);
      for (let i = 0; i < imageData.data.length; i += 4) {
        const v = Math.random() > 0.85 ? Math.floor(Math.random() * 80) : 0;
        imageData.data[i] = v;
        imageData.data[i + 1] = v;
        imageData.data[i + 2] = v;
        imageData.data[i + 3] = v > 0 ? 180 : 0;
      }
      ctx.putImageData(imageData, 0, 0);
      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={120}
      className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
    />
  );
}

export default function NotFound() {
  const [searchQuery, setSearchQuery] = useState("");
  const [glitching, setGlitching] = useState(false);
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const { getLocalizedUrl } = useSeoRouting();

  useEffect(() => {
    const glitch = () => {
      setGlitching(true);
      setTimeout(() => setGlitching(false), 200);
    };
    const interval = setInterval(glitch, 3000 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, []);

  const { data: popularStations } = useQuery({
    queryKey: ["/api/stations/popular"],
    retry: false,
  });

  const { data: genres } = useQuery({
    queryKey: ["/api/genres/discoverable"],
    retry: false,
  });

  const stationsArray = Array.isArray(popularStations) ? popularStations.slice(0, 6) : [];
  const genresArray = Array.isArray(genres) ? genres.slice(0, 6) : [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(getLocalizedUrl(`/?search=${encodeURIComponent(searchQuery.trim())}`));
    }
  };

  const quickLinks = [
    { label: "Home", icon: Home, href: "/", color: "#FF4199" },
    { label: "Genres", icon: Music, href: "/genres", color: "#a855f7" },
    { label: "Countries", icon: Globe, href: "/regions", color: "#3b82f6" },
    { label: "Popular", icon: Radio, href: "/?tab=popular", color: "#10b981" },
  ];

  return (
    <>
      <style>{`
        @keyframes wave-bar {
          from { height: 4px; }
          to { height: 32px; }
        }
        @keyframes pulse-bar {
          from { opacity: 0.4; }
          to { opacity: 1; }
        }
        @keyframes glitch-clip-1 {
          0%   { clip-path: inset(20% 0 60% 0); transform: translate(-4px, 0); }
          50%  { clip-path: inset(50% 0 20% 0); transform: translate(4px, 0); }
          100% { clip-path: inset(10% 0 70% 0); transform: translate(-2px, 0); }
        }
        @keyframes glitch-clip-2 {
          0%   { clip-path: inset(60% 0 10% 0); transform: translate(4px, 0); color: #FF4199; }
          50%  { clip-path: inset(30% 0 50% 0); transform: translate(-4px, 0); color: #00f0ff; }
          100% { clip-path: inset(70% 0 5%  0); transform: translate(2px, 0);  color: #FF4199; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-8px); }
        }
        @keyframes scan-line {
          0%   { top: -4px; }
          100% { top: 100%; }
        }
        .glitch-text { position: relative; display: inline-block; }
        .glitch-text::before,
        .glitch-text::after {
          content: attr(data-text);
          position: absolute;
          inset: 0;
          font-size: inherit;
          font-weight: inherit;
          line-height: inherit;
          letter-spacing: inherit;
        }
        .glitch-active::before {
          animation: glitch-clip-1 0.2s steps(1) infinite;
          color: #00f0ff;
          text-shadow: -2px 0 #00f0ff;
        }
        .glitch-active::after {
          animation: glitch-clip-2 0.2s steps(1) infinite;
          text-shadow: 2px 0 #FF4199;
        }
      `}</style>

      <div className="min-h-screen bg-[#0A0A0A] text-white overflow-x-hidden">

        {/* Top frequency bar */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#FF4199] to-transparent opacity-60" />

        <div className="container mx-auto px-4 pt-24 pb-20 max-w-5xl">

          {/* ── HERO ── */}
          <div className="text-center mb-16 relative">

            {/* Outer glow ring */}
            <div className="absolute left-1/2 top-10 -translate-x-1/2 w-72 h-72 rounded-full bg-[#FF4199] opacity-5 blur-[80px] pointer-events-none" />

            {/* Radio icon + ring */}
            <div className="flex justify-center mb-8">
              <div className="relative" style={{ animation: "float 4s ease-in-out infinite" }}>
                <div className="absolute inset-0 rounded-full border-2 border-[#FF4199] opacity-20"
                  style={{ animation: "spin-slow 8s linear infinite" }} />
                <div className="absolute inset-[-8px] rounded-full border border-[#FF4199] opacity-10"
                  style={{ animation: "spin-slow 12s linear infinite reverse" }} />
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF4199]/20 to-[#FF4199]/5 border border-[#FF4199]/30 flex items-center justify-center backdrop-blur-sm">
                  <WifiOff className="w-9 h-9 text-[#FF4199]" />
                </div>
              </div>
            </div>

            {/* 404 glitch number */}
            <div className="relative inline-block mb-2">
              <div
                data-text="404"
                className={`glitch-text text-[100px] md:text-[140px] font-black leading-none tracking-tighter select-none ${glitching ? "glitch-active" : ""}`}
                style={{
                  background: "linear-gradient(135deg, #ffffff 0%, #FF4199 50%, #ffffff 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  textShadow: "none",
                }}
              >
                404
              </div>
            </div>

            {/* Static noise overlay on 404 */}
            <div className="relative mx-auto w-72 h-1 mb-6">
              <div className="absolute inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-[#FF4199]/60 to-transparent" />
            </div>

            {/* Signal status badge */}
            <div className="inline-flex items-center gap-2 bg-[#FF4199]/10 border border-[#FF4199]/30 rounded-full px-4 py-1.5 mb-6">
              <SignalBars active />
              <span className="text-[#FF4199] text-xs font-bold tracking-[0.2em] uppercase">Signal Lost</span>
            </div>

            <h1 className="text-2xl md:text-3xl font-bold text-white mb-3">
              404 — Frekans Bulunamadı
            </h1>
            <p className="text-gray-400 max-w-md mx-auto text-base leading-relaxed">
              Aradığın istasyon bu frekansta yayın yapmıyor. Belki taşındı, belki silindi — ama dünya genelinde <span className="text-[#FF4199] font-semibold">60.000+ istasyon</span> seni bekliyor.
            </p>

            {/* Wave animation */}
            <div className="mt-8 mx-auto max-w-xs opacity-40">
              <WaveAnimation />
            </div>
          </div>

          {/* ── SEARCH ── */}
          <div className="max-w-xl mx-auto mb-14">
            <div className="relative">
              <div className="absolute inset-0 bg-[#FF4199]/5 rounded-2xl blur-xl" />
              <form onSubmit={handleSearch}
                className="relative bg-[#111111] border border-white/10 rounded-2xl p-2 flex gap-2 focus-within:border-[#FF4199]/40 transition-colors">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <Input
                    type="search"
                    placeholder="Radyo istasyonu ara..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-transparent border-0 text-white placeholder-gray-500 focus-visible:ring-0 focus-visible:ring-offset-0 h-11"
                  />
                </div>
                <Button
                  type="submit"
                  className="bg-[#FF4199] hover:bg-[#e0357f] text-white rounded-xl px-5 h-11 font-semibold shrink-0"
                >
                  Ara
                </Button>
              </form>
            </div>
          </div>

          {/* ── QUICK LINKS ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-14">
            {quickLinks.map(({ label, icon: Icon, href, color }) => (
              <Link key={href} href={getLocalizedUrl(href)}>
                <div className="group bg-[#111111] border border-white/8 rounded-xl p-4 hover:border-white/20 transition-all duration-200 cursor-pointer hover:bg-[#161616]">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: `${color}18` }}>
                      <Icon className="w-5 h-5" style={{ color }} />
                    </div>
                    <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                      {label}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* ── POPULAR STATIONS + GENRES ── */}
          <div className="grid md:grid-cols-2 gap-6 mb-14">

            {/* Popular Stations */}
            {stationsArray.length > 0 && (
              <div className="bg-[#111111] border border-white/8 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#FF4199]" />
                    <span className="font-semibold text-sm text-white">Popüler İstasyonlar</span>
                  </div>
                  <Link href={getLocalizedUrl("/?tab=popular")}>
                    <span className="text-xs text-[#FF4199] hover:underline cursor-pointer">Tümü →</span>
                  </Link>
                </div>
                <div className="divide-y divide-white/5">
                  {stationsArray.map((station: any) => (
                    <Link
                      key={station._id}
                      href={getLocalizedUrl(`/station/${station.slug || station._id}`)}
                    >
                      <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-[#1E1E1E]">
                          {station.favicon ? (
                            <img
                              src={getImageUrl(station.favicon)}
                              alt={station.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-[#FF4199]/10">
                              <Radio className="w-4 h-4 text-[#FF4199]" />
                            </div>
                          )}
                          {/* Live dot */}
                          <div className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#FF4199] rounded-full border border-[#111]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate group-hover:text-[#FF4199] transition-colors">
                            {station.name}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {station.country} {station.tags?.split(",")[0] && `· ${station.tags.split(",")[0].trim()}`}
                          </p>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-[#FF4199] transition-colors shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Genres */}
            {genresArray.length > 0 && (
              <div className="bg-[#111111] border border-white/8 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-purple-400" />
                    <span className="font-semibold text-sm text-white">Müzik Türleri</span>
                  </div>
                  <Link href={getLocalizedUrl("/genres")}>
                    <span className="text-xs text-purple-400 hover:underline cursor-pointer">Tümü →</span>
                  </Link>
                </div>
                <div className="p-4 grid grid-cols-2 gap-2">
                  {genresArray.map((genre: any) => (
                    <Link
                      key={genre._id}
                      href={getLocalizedUrl(`/genre/${genre.slug}`)}
                    >
                      <div className="group bg-[#181818] border border-white/5 rounded-xl px-3 py-3 hover:border-purple-400/30 hover:bg-[#1E1830] transition-all cursor-pointer">
                        <p className="text-sm font-medium text-white truncate group-hover:text-purple-300 transition-colors">
                          {genre.name}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {(genre.stationCount || 0).toLocaleString()} istasyon
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── BOTTOM STATUS BAR ── */}
          <div className="relative bg-[#111111] border border-white/8 rounded-2xl p-6 overflow-hidden">
            <StaticNoise />
            <div className="relative flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#FF4199]/10 flex items-center justify-center">
                  <Wifi className="w-4 h-4 text-[#FF4199]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Bağlantı Kesildi</p>
                  <p className="text-xs text-gray-500">Bu frekans mevcut değil · Yayın durdu</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Link href={getLocalizedUrl("/")}>
                  <Button
                    variant="outline"
                    className="border-white/10 text-white hover:bg-white/5 hover:border-white/20 rounded-xl text-sm h-9"
                  >
                    <Home className="w-4 h-4 mr-1.5" />
                    Ana Sayfa
                  </Button>
                </Link>
                <Button
                  onClick={() => window.history.back()}
                  className="bg-[#FF4199] hover:bg-[#e0357f] text-white rounded-xl text-sm h-9"
                >
                  Geri Dön
                </Button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
