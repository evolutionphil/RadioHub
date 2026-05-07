import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, Loader2, Music, Globe, Radio } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/SeoHead";
import {
  canonicalizeCountry,
  countrySlug,
  getRegionSlugForCountry,
} from "@shared/country-regions";

interface SearchStation {
  _id?: string;
  name: string;
  slug?: string;
  country?: string;
  countrycode?: string;
  genre?: string;
  favicon?: string;
  bitrate?: number;
}

interface StationSearchResponse {
  success?: boolean;
  data?: SearchStation[];
  stations?: SearchStation[];
  total?: number;
}

interface SearchGenre {
  slug: string;
  name: string;
  stationCount?: number;
}

interface GenresSearchResponse {
  genres?: SearchGenre[];
  data?: SearchGenre[];
  total?: number;
}

interface RichCountry {
  name: string;
  stationCount?: number;
  code?: string;
}

interface CountryHit {
  name: string;
  canonical: string;
  stationCount?: number;
  regionSlug: string;
}

type Translator = (key: string, fallback?: string) => string;

export default function SearchPage() {
  const { t } = useTranslation();
  const { currentLanguage } = useSeoRouting();
  const langPrefix = currentLanguage === "en" ? "" : `/${currentLanguage}`;

  const initialQuery =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("q") || ""
      : "";

  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Keep ?q= in the URL so the result is shareable / linkable
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (debounced) url.searchParams.set("q", debounced);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url.toString());
  }, [debounced]);

  const enabled = debounced.length >= 2;

  // 1. Stations — instant fuzzy search via the precomputed endpoint
  const stationsQ = useQuery<StationSearchResponse>({
    queryKey: ["/api/stations/precomputed", { search: debounced, limit: 20 }],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams({ search: debounced, limit: "20" });
      const res = await fetch(`/api/stations/precomputed?${params}`);
      if (!res.ok) throw new Error("Station search failed");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // 2. Genres — server-side text search
  const genresQ = useQuery<GenresSearchResponse>({
    queryKey: ["/api/genres", { search: debounced, limit: 8 }],
    enabled,
    queryFn: async () => {
      const params = new URLSearchParams({
        search: debounced,
        limit: "8",
        page: "1",
      });
      const res = await fetch(`/api/genres?${params}`);
      if (!res.ok) throw new Error("Genre search failed");
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // 3. Countries — fetched once (rich format) then filtered client-side.
  //    The API has no country search endpoint, but the rich list is small
  //    (~232 entries) and cached for the session.
  const countriesQ = useQuery<RichCountry[]>({
    queryKey: ["/api/countries", "rich"],
    queryFn: async () => {
      const res = await fetch(`/api/countries?format=rich`);
      if (!res.ok) throw new Error("Country list failed");
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  const countryHits: CountryHit[] = useMemo(() => {
    if (!enabled || !countriesQ.data) return [];
    const q = debounced.toLowerCase();
    const seen = new Set<string>();
    const hits: CountryHit[] = [];
    for (const c of countriesQ.data) {
      if (!c?.name) continue;
      const display = c.name;
      if (!display.toLowerCase().includes(q)) continue;
      const canonical = canonicalizeCountry(display);
      if (seen.has(canonical)) continue;
      const regionSlug = getRegionSlugForCountry(canonical);
      if (!regionSlug) continue; // can't deep-link without a region bucket
      seen.add(canonical);
      hits.push({
        name: display,
        canonical,
        stationCount: c.stationCount,
        regionSlug,
      });
      if (hits.length >= 8) break;
    }
    return hits;
  }, [enabled, debounced, countriesQ.data]);

  const stations = stationsQ.data?.data || stationsQ.data?.stations || [];
  const genres = genresQ.data?.genres || genresQ.data?.data || [];

  const isFetching =
    stationsQ.isFetching || genresQ.isFetching || countriesQ.isFetching;
  const totalHits = stations.length + genres.length + countryHits.length;

  const h1 = t("search_page_h1", "Search Live Radio Stations");
  const intro = t(
    "search_page_intro",
    "Search Mega Radio's catalogue of 60,000+ live radio stations from 120+ countries. Type a station name, music genre, language, or country to start streaming free online radio instantly."
  );
  const placeholder = t(
    "search_placeholder",
    "Search stations, genres, countries…"
  );

  return (
    <div className="min-h-screen bg-[#0E0E0E] text-white">
      <SeoHead pageType="search" />

      <div className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-4">{h1}</h1>
        <p className="text-gray-400 text-base md:text-lg mb-8 leading-relaxed">
          {intro}
        </p>

        <div className="relative mb-8">
          <SearchIcon
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"
            size={20}
          />
          <input
            data-testid="input-search"
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-12 py-4 text-base text-white placeholder:text-gray-500 focus:outline-none focus:border-[#FF4199] transition-colors"
          />
          {isFetching && enabled && (
            <Loader2
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 animate-spin"
              size={20}
            />
          )}
        </div>

        {!enabled && (
          <div className="text-gray-400 text-center py-12">
            {t(
              "search_min_chars_hint",
              "Type at least 2 characters to start searching."
            )}
          </div>
        )}

        {enabled && isFetching && totalHits === 0 && (
          <div className="space-y-3" data-testid="search-loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 bg-white/5 rounded-xl animate-pulse"
              />
            ))}
          </div>
        )}

        {enabled && !isFetching && totalHits === 0 && (
          <div
            className="text-center py-12 text-gray-400"
            data-testid="search-empty"
          >
            {t(
              "search_no_results",
              "No stations, genres or countries match your search."
            )}
          </div>
        )}

        {enabled && totalHits > 0 && (
          <div className="space-y-10" data-testid="search-results">
            {genres.length > 0 && (
              <ResultSection
                icon={<Music size={18} />}
                title={t("search_section_genres", "Genres")}
              >
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {genres.map((g) => (
                    <li key={g.slug}>
                      <Link
                        href={`${langPrefix}/genres/${encodeURIComponent(g.slug)}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                        data-testid={`link-genre-${g.slug}`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                          <Music size={16} className="text-[#FF4199]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate capitalize">
                            <HighlightMatch text={g.name} query={debounced} />
                          </div>
                          {typeof g.stationCount === "number" && (
                            <div className="text-xs text-gray-400">
                              {g.stationCount.toLocaleString()}{" "}
                              {t("stations", "stations")}
                            </div>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </ResultSection>
            )}

            {countryHits.length > 0 && (
              <ResultSection
                icon={<Globe size={18} />}
                title={t("search_section_countries", "Countries")}
              >
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {countryHits.map((c) => (
                    <li key={c.canonical}>
                      <Link
                        href={`${langPrefix}/regions/${c.regionSlug}/${countrySlug(c.canonical)}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                        data-testid={`link-country-${countrySlug(c.canonical)}`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                          <Globe size={16} className="text-[#FF4199]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">
                            <HighlightMatch text={c.name} query={debounced} />
                          </div>
                          {typeof c.stationCount === "number" && (
                            <div className="text-xs text-gray-400">
                              {c.stationCount.toLocaleString()}{" "}
                              {t("stations", "stations")}
                            </div>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </ResultSection>
            )}

            {stations.length > 0 && (
              <ResultSection
                icon={<Radio size={18} />}
                title={t("search_section_stations", "Stations")}
              >
                <ul className="space-y-2">
                  {stations.map((station, idx) => {
                    const slug = station.slug || station._id;
                    if (!slug) return null;
                    return (
                      <li key={`${slug}-${idx}`}>
                        <Link
                          href={`${langPrefix}/station/${slug}`}
                          className="flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                          data-testid={`link-station-${slug}`}
                        >
                          <div className="w-12 h-12 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden flex items-center justify-center">
                            {station.favicon ? (
                              <img
                                src={station.favicon}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            ) : (
                              <Radio size={18} className="text-gray-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate">
                              <HighlightMatch
                                text={station.name}
                                query={debounced}
                              />
                            </div>
                            <div className="text-xs text-gray-400 truncate">
                              {[station.country, station.genre]
                                .filter(Boolean)
                                .join(" • ")}
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </ResultSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const haystack = text;
  const needle = query;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (!lowerNeedle || !lowerHay.includes(lowerNeedle)) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < haystack.length) {
    const idx = lowerHay.indexOf(lowerNeedle, i);
    if (idx === -1) {
      parts.push(haystack.slice(i));
      break;
    }
    if (idx > i) parts.push(haystack.slice(i, idx));
    parts.push(
      <mark
        key={key++}
        className="bg-transparent text-[#FF4199] font-bold"
      >
        {haystack.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
  }
  return <>{parts}</>;
}

function ResultSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm uppercase tracking-wider text-gray-400 mb-3">
        <span className="text-[#FF4199]">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
