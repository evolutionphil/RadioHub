import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, Loader2, Music, Globe, Radio } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { SeoHead } from "@/components/SeoHead";
import { HighlightMatch } from "@/components/HighlightMatch";
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

  const [, navigate] = useLocation();

  // Build a flat list of focusable suggestions in display order:
  // genres → countries → stations. Each item carries the href to navigate to
  // on Enter and an id used to wire up the focus ring + scroll-into-view.
  const flatItems = useMemo(() => {
    const items: { id: string; href: string }[] = [];
    for (const g of genres) {
      items.push({
        id: `genre-${g.slug}`,
        href: `${langPrefix}/genres/${encodeURIComponent(g.slug)}`,
      });
    }
    for (const c of countryHits) {
      items.push({
        id: `country-${countrySlug(c.canonical)}`,
        href: `${langPrefix}/regions/${c.regionSlug}/${countrySlug(c.canonical)}`,
      });
    }
    stations.forEach((station, idx) => {
      const slug = station.slug || station._id;
      if (!slug) return;
      items.push({
        id: `station-${slug}-${idx}`,
        href: `${langPrefix}/station/${slug}`,
      });
    });
    return items;
  }, [genres, countryHits, stations, langPrefix]);

  const [activeIndex, setActiveIndex] = useState(-1);
  const itemRefs = useRef<Map<string, HTMLAnchorElement | null>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);
  // After a keyboard navigation, ignore hover-driven activeIndex updates until
  // the mouse actually moves. This prevents the cursor sitting over a result
  // from "snapping back" the active item when the next/prev item scrolls under
  // it on Arrow Down/Up/Home/End.
  const suppressHoverRef = useRef(false);

  useEffect(() => {
    const onMove = () => {
      suppressHoverRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Snap focus back to the search input when the user presses Arrow Up/Down
  // anywhere on the page, so keyboard navigation keeps working even after a
  // click moves focus elsewhere. We skip when focus is already in another
  // editable control so we don't hijack typing in unrelated inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      )
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const input = inputRef.current;
      if (!input) return;
      const active = document.activeElement as HTMLElement | null;
      if (active === input) return;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }
      if (flatItems.length === 0) {
        input.focus();
        return;
      }
      e.preventDefault();
      input.focus();
      suppressHoverRef.current = true;
      setActiveIndex((i) => {
        if (e.key === "ArrowDown") {
          return i < 0 ? 0 : (i + 1) % flatItems.length;
        }
        if (e.key === "ArrowUp") {
          return i <= 0 ? flatItems.length - 1 : i - 1;
        }
        if (e.key === "Home") {
          return 0;
        }
        return flatItems.length - 1;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flatItems.length]);

  // Reset focus when the result set changes
  useEffect(() => {
    setActiveIndex(-1);
  }, [debounced]);

  // Keep activeIndex within bounds when results shrink
  useEffect(() => {
    if (activeIndex >= flatItems.length) setActiveIndex(-1);
  }, [flatItems.length, activeIndex]);

  // Scroll the focused item into view
  useEffect(() => {
    if (activeIndex < 0) return;
    const item = flatItems[activeIndex];
    if (!item) return;
    const el = itemRefs.current.get(item.id);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flatItems]);

  const setActiveById = useCallback(
    (id: string) => {
      if (suppressHoverRef.current) return;
      const idx = flatItems.findIndex((it) => it.id === id);
      if (idx >= 0) setActiveIndex(idx);
    },
    [flatItems]
  );

  const setItemRef = useCallback(
    (id: string) => (el: HTMLAnchorElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (query !== "") {
        e.preventDefault();
        setQuery("");
        setActiveIndex(-1);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (flatItems.length === 0) return;
      e.preventDefault();
      suppressHoverRef.current = true;
      setActiveIndex((i) => (i + 1) % flatItems.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (flatItems.length === 0) return;
      e.preventDefault();
      suppressHoverRef.current = true;
      setActiveIndex((i) => (i <= 0 ? flatItems.length - 1 : i - 1));
      return;
    }
    if (e.key === "Home") {
      if (flatItems.length === 0) return;
      e.preventDefault();
      suppressHoverRef.current = true;
      setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      if (flatItems.length === 0) return;
      e.preventDefault();
      suppressHoverRef.current = true;
      setActiveIndex(flatItems.length - 1);
      return;
    }
    if (e.key === "Enter") {
      const target = flatItems[activeIndex] ?? flatItems[0];
      if (target) {
        e.preventDefault();
        navigate(target.href);
      }
    }
  };

  const activeId =
    activeIndex >= 0 ? flatItems[activeIndex]?.id ?? null : null;
  const focusRingClass =
    "ring-2 ring-[#FF4199] ring-offset-2 ring-offset-[#0E0E0E]";

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
            ref={inputRef}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={enabled && totalHits > 0}
            aria-controls="search-results"
            aria-activedescendant={activeId ?? undefined}
            aria-autocomplete="list"
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
          <div
            className="space-y-10"
            data-testid="search-results"
            id="search-results"
            role="listbox"
          >
            {genres.length > 0 && (
              <ResultSection
                icon={<Music size={18} />}
                title={t("search_section_genres", "Genres")}
              >
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {genres.map((g) => {
                    const id = `genre-${g.slug}`;
                    const isActive = activeId === id;
                    return (
                    <li key={g.slug}>
                      <Link
                        href={`${langPrefix}/genres/${encodeURIComponent(g.slug)}`}
                        ref={setItemRef(id)}
                        id={id}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveById(id)}
                        className={`flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors ${isActive ? focusRingClass : ""}`}
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
                    );
                  })}
                </ul>
              </ResultSection>
            )}

            {countryHits.length > 0 && (
              <ResultSection
                icon={<Globe size={18} />}
                title={t("search_section_countries", "Countries")}
              >
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {countryHits.map((c) => {
                    const id = `country-${countrySlug(c.canonical)}`;
                    const isActive = activeId === id;
                    return (
                    <li key={c.canonical}>
                      <Link
                        href={`${langPrefix}/regions/${c.regionSlug}/${countrySlug(c.canonical)}`}
                        ref={setItemRef(id)}
                        id={id}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveById(id)}
                        className={`flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors ${isActive ? focusRingClass : ""}`}
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
                    );
                  })}
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
                    const id = `station-${slug}-${idx}`;
                    const isActive = activeId === id;
                    return (
                      <li key={`${slug}-${idx}`}>
                        <Link
                          href={`${langPrefix}/station/${slug}`}
                          ref={setItemRef(id)}
                          id={id}
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveById(id)}
                          className={`flex items-center gap-4 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors ${isActive ? focusRingClass : ""}`}
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
