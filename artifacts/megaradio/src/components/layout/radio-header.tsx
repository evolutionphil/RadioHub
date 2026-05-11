import { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { User } from "lucide-react";
import notificationIcon from "@assets/notification1.png";
import { useGlobalPlayer } from "@/hooks/useGlobalPlayer";
import { useAuth } from "@/hooks/useAuth";
import { UserMenuDropdown } from "@/components/ui/UserMenuDropdown";
// 🚀 LAZY: modal only loads on first open
const AddYourStationModal = lazy(() => import("@/components/modals/AddYourStationModal"));
import { useTranslation } from "@/hooks/useTranslation";
import { useSeoRouting } from "@/hooks/useSeoRouting";
import { getImageUrl } from "@/lib/utils";
import { getStationUrl } from "@/utils/slugs";
import { HighlightMatch } from "@/components/HighlightMatch";
import { getCountryCodeFromApiName, getLanguageForCountry } from "@workspace/seo-shared/seo-config";
import {
  canonicalizeCountry,
  countrySlug,
  getRegionSlugForCountry,
} from "@workspace/seo-shared/country-regions";
import { Music, Globe } from "lucide-react";
import {
  buildDropdownKeyHandler as buildSharedDropdownKeyHandler,
  focusFirstInside as focusFirstInsideShared,
} from "@/lib/dropdown-keyboard";

interface RadioHeaderProps {
  showSearch?: boolean;
  showAddStationModal?: boolean;
  setShowAddStationModal?: (show: boolean) => void;
  selectedCountry?: string;
  onCountryChange?: (country: string, isManual?: boolean) => void;
}

export default function RadioHeader({ 
  showSearch = true,
  showAddStationModal = false,
  setShowAddStationModal,
  selectedCountry = "all",
  onCountryChange
}: RadioHeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [isNotificationDropdownOpen, setIsNotificationDropdownOpen] = useState(false);
  const [isMobileProfileMenuOpen, setIsMobileProfileMenuOpen] = useState(false);
  
  const { t, setLanguage } = useTranslation();
  const { getLocalizedUrl, cleanPath, navigateTranslated, currentLanguage } = useSeoRouting();
  const langPrefix = currentLanguage === "en" ? "" : `/${currentLanguage}`;
  const [location, setLocation] = useLocation();
  
  // Use getLanguageForCountry helper from @shared/seo-config (single source of truth)
  
  // Country selection state
  const [selectedCountryObj, setSelectedCountryObj] = useState<{ name: string; code: string } | null>(null);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [filteredStations, setFilteredStations] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Touch handling for mobile scroll
  const [touchStartY, setTouchStartY] = useState<number>(0);
  const [touchStartTime, setTouchStartTime] = useState<number>(0);
  const [avatarError, setAvatarError] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
    }
  }, []);
  
  // Refs for positioning dropdown
  const countryButtonRef = useRef<HTMLButtonElement>(null);
  const countryButtonDesktopRef = useRef<HTMLButtonElement>(null);
  const countryButtonMobileRef = useRef<HTMLButtonElement>(null);
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  // Tracks the trigger button that opened the country dropdown so keyboard
  // users get focus restored to it on close (Escape / selection).
  const lastCountryTriggerRef = useRef<HTMLButtonElement | null>(null);

  const toggleCountryDropdown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      lastCountryTriggerRef.current = e.currentTarget;
      setIsCountryDropdownOpen((prev) => !prev);
    },
    []
  );

  const closeCountryDropdownAndRestoreFocus = useCallback(() => {
    setIsCountryDropdownOpen(false);
    setCountrySearchQuery("");
    // Defer focus restore until after the portal unmounts so the browser does
    // not move focus elsewhere first.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        lastCountryTriggerRef.current?.focus();
      });
    }
  }, []);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonDesktopRef = useRef<HTMLButtonElement>(null);
  const mobileProfileButtonRef = useRef<HTMLDivElement>(null);
  // Tracks the trigger button that opened the notification or mobile profile
  // dropdown so keyboard users get focus restored to it on close.
  const lastNotificationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileProfileTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  // Refs to the rendered dropdown roots, used for the on-open focus move and
  // the Tab/Shift+Tab focus trap inside each open popover.
  const notificationDropdownRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileDropdownRef = useRef<HTMLDivElement | null>(null);

  const toggleNotificationDropdown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
      lastNotificationTriggerRef.current = e.currentTarget;
      setIsNotificationDropdownOpen((prev) => !prev);
    },
    []
  );

  const closeNotificationDropdownAndRestoreFocus = useCallback(() => {
    setIsNotificationDropdownOpen(false);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        lastNotificationTriggerRef.current?.focus();
      });
    }
  }, []);

  const toggleMobileProfileMenu = useCallback(() => {
    setIsMobileProfileMenuOpen((prev) => !prev);
  }, []);

  const closeMobileProfileMenuAndRestoreFocus = useCallback(() => {
    setIsMobileProfileMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        mobileProfileTriggerButtonRef.current?.focus();
      });
    }
  }, []);

  // Focus the first focusable element in a dropdown root once it mounts. If
  // there is nothing focusable, fall back to focusing the root container so
  // Escape and the Tab trap still work.
  const focusFirstInside = useCallback((root: HTMLElement | null) => {
    focusFirstInsideShared(root);
  }, []);

  useEffect(() => {
    if (!isNotificationDropdownOpen) return;
    const id = window.requestAnimationFrame(() => {
      focusFirstInside(notificationDropdownRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isNotificationDropdownOpen, focusFirstInside]);

  useEffect(() => {
    if (!isMobileProfileMenuOpen) return;
    const id = window.requestAnimationFrame(() => {
      focusFirstInside(mobileProfileDropdownRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [isMobileProfileMenuOpen, focusFirstInside]);

  // Build a keyboard handler that traps Tab/Shift+Tab inside the open
  // dropdown and closes it (with focus restore) on Escape.
  const buildDropdownKeyHandler = useCallback(
    (rootRef: React.RefObject<HTMLDivElement | null>, close: () => void) =>
      buildSharedDropdownKeyHandler<HTMLDivElement>(rootRef, close),
    []
  );

  const { playStation } = useGlobalPlayer();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  // Fetch user notifications (with 30s polling for real-time message notifications)
  const { data: notificationsData, isLoading: notificationsLoading } = useQuery({
    queryKey: ['/api/user/notifications'],
    queryFn: async () => {
      const response = await fetch('/api/user/notifications?page=1&limit=10', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }
      return response.json();
    },
    enabled: !!isAuthenticated,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const notifications = (notificationsData as any)?.notifications || [];
  const unreadCount = (notificationsData as any)?.unreadCount || 0;
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobileDevice(window.innerWidth < 768 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close search dropdown when route changes
  useEffect(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
  }, [location]);

  // Handle click outside to close country dropdown and notification dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Don't close if clicking on any country button (including mobile)
      const countryButtons = document.querySelectorAll('[data-country-button], .country-selector');
      for (let i = 0; i < countryButtons.length; i++) {
        if (countryButtons[i].contains(target)) {
          return;
        }
      }
      
      // Don't close if clicking inside the search bar or search results
      const searchElements = document.querySelectorAll('[data-search-element]');
      for (let i = 0; i < searchElements.length; i++) {
        if (searchElements[i].contains(target)) {
          return;
        }
      }
      
      // Don't close if clicking inside the country dropdown (portal rendered elements)
      const countryDropdownElements = document.querySelectorAll('[data-country-dropdown]');
      for (let i = 0; i < countryDropdownElements.length; i++) {
        if (countryDropdownElements[i].contains(target)) {
          return;
        }
      }
      
      // Check for notification dropdown clicks (button or dropdown itself)
      const notificationElements = document.querySelectorAll('button[aria-label="Notifications"], [data-notification-dropdown]');
      let clickedNotificationElement = false;
      for (let i = 0; i < notificationElements.length; i++) {
        if (notificationElements[i].contains(target)) {
          clickedNotificationElement = true;
          break;
        }
      }
      
      if (!clickedNotificationElement) {
        setIsNotificationDropdownOpen(false);
      }
      
      // Check for mobile profile dropdown clicks
      const profileElements = document.querySelectorAll('[data-testid="button-mobile-profile"], [data-testid="mobile-profile-dropdown"]');
      let clickedProfileElement = false;
      for (let i = 0; i < profileElements.length; i++) {
        if (profileElements[i].contains(target)) {
          clickedProfileElement = true;
          break;
        }
      }
      
      if (!clickedProfileElement) {
        setIsMobileProfileMenuOpen(false);
      }
      
      setIsCountryDropdownOpen(false);
      setCountrySearchQuery("");
    };

    if (isCountryDropdownOpen || isNotificationDropdownOpen || isMobileProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCountryDropdownOpen, isNotificationDropdownOpen, isMobileProfileMenuOpen]);

  // Dropdown scroll prevention handled by backdrop only - no body manipulation

  // Fetch countries for dropdown from stations - OPTIMIZED with cache
  const { data: countriesRaw = [], isLoading: countriesLoading } = useQuery<string[]>({
    queryKey: ['/api/filters/countries'],
    staleTime: 10 * 60 * 1000, // 10 minutes - country list rarely changes
    gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
  });

  // Convert string array to objects format expected by the frontend
  // Memoized to prevent recalculation on every render
  const countries = useMemo(() => 
    countriesRaw.map((countryName) => ({
      name: countryName,
      code: getCountryCode(countryName)
    })),
    [countriesRaw]
  );
  
  // Get selected country code directly from seo-config (no need to wait for countries API)
  const selectedCountryCode = useMemo(() => {
    if (selectedCountry === "all" || selectedCountry === "Global") return null;
    return getCountryCodeFromApiName(selectedCountry);
  }, [selectedCountry]);

  // Filter countries based on search
  const filteredCountries = useMemo(() => {
    if (!countries) return [];
    
    if (!countrySearchQuery.trim()) {
      return countries; // Show all countries when no search query
    }
    
    return countries.filter((country) => 
      country.name?.toLowerCase().includes(countrySearchQuery.toLowerCase())
    );
  }, [countries, countrySearchQuery]);

  // Helper function to get country code from country name
  // Uses getCountryCodeFromApiName from seo-config which handles all 232 countries + aliases
  function getCountryCode(countryName: string): string {
    return getCountryCodeFromApiName(countryName);
  }
  


  // Genre search results for the header dropdown (mirrors /search)
  const { data: genresSearchData, isFetching: isGenresFetching } = useQuery<{
    genres?: Array<{ slug: string; name: string; stationCount?: number }>;
    data?: Array<{ slug: string; name: string; stationCount?: number }>;
  }>({
    queryKey: ['/api/genres', { search: debouncedSearchQuery, limit: 5 }],
    enabled: debouncedSearchQuery.trim().length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams({
        search: debouncedSearchQuery.trim(),
        limit: '5',
        page: '1',
      });
      const res = await fetch(`/api/genres?${params}`);
      if (!res.ok) throw new Error('Genre search failed');
      return res.json();
    },
    staleTime: 60 * 1000,
  });

  // Rich country list (small, cached) — filtered client-side just like /search
  const { data: richCountries = [], isFetching: isCountriesFetching } = useQuery<Array<{ name: string; stationCount?: number }>>({
    queryKey: ['/api/countries', 'rich'],
    queryFn: async () => {
      const res = await fetch(`/api/countries?format=rich`);
      if (!res.ok) throw new Error('Country list failed');
      return res.json();
    },
    staleTime: 60 * 60 * 1000,
  });

  const matchingGenres = useMemo(
    () => (genresSearchData?.genres || genresSearchData?.data || []).slice(0, 5),
    [genresSearchData]
  );

  const matchingCountries = useMemo(() => {
    const term = debouncedSearchQuery.trim().toLowerCase();
    if (term.length < 2 || !richCountries.length) return [];
    const seen = new Set<string>();
    const hits: Array<{ name: string; canonical: string; regionSlug: string; stationCount?: number }> = [];
    for (const c of richCountries) {
      if (!c?.name) continue;
      if (!c.name.toLowerCase().includes(term)) continue;
      const canonical = canonicalizeCountry(c.name);
      if (seen.has(canonical)) continue;
      const regionSlug = getRegionSlugForCountry(canonical);
      if (!regionSlug) continue;
      seen.add(canonical);
      hits.push({ name: c.name, canonical, regionSlug, stationCount: c.stationCount });
      if (hits.length >= 5) break;
    }
    return hits;
  }, [debouncedSearchQuery, richCountries]);

  // Search functionality
  useEffect(() => {
    const performSearch = async () => {
      const searchTerm = debouncedSearchQuery.trim();
      
      if (!searchTerm || searchTerm.length < 2) {
        setFilteredStations([]);
        setIsSearching(false);
        return;
      }
      
      setIsSearching(true);
      
      try {
        const params = new URLSearchParams({
          search: searchTerm,
          limit: '20'
        });
        
        const response = await fetch(`/api/stations?${params}`);
        if (!response.ok) {
          throw new Error(`Search failed: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.stations) {
          setFilteredStations(data.stations);
        } else {
          setFilteredStations([]);
        }
      } catch (error) {
        // console.error('Search error:', error);
        setFilteredStations([]);
      } finally {
        setIsSearching(false);
      }
    };
    
    performSearch();
  }, [debouncedSearchQuery]);

  // Close search and other modals when mobile menu opens
  useEffect(() => {
    if (isMobileMenuOpen) {
      setIsSearchOpen(false);
      setSearchQuery("");
      setIsCountryDropdownOpen(false);
      setCountrySearchQuery("");
    }
  }, [isMobileMenuOpen]);

  const searchLoading = (searchQuery.trim().length >= 2 && debouncedSearchQuery !== searchQuery) || isSearching || isGenresFetching || isCountriesFetching;
  const hasAnyResults = filteredStations.length > 0 || matchingGenres.length > 0 || matchingCountries.length > 0;

  // Keyboard navigation for the header search dropdown — mirrors /search.
  // Items are flattened in display order: genres → countries → stations.
  const PAGE_STEP = 10;
  const STATION_LIMIT = 10;
  const visibleStations = useMemo(
    () => filteredStations.slice(0, STATION_LIMIT),
    [filteredStations]
  );
  const flatSearchItems = useMemo(() => {
    type Item =
      | { kind: 'genre'; id: string; href: string }
      | { kind: 'country'; id: string; href: string }
      | { kind: 'station'; id: string; station: any };
    const items: Item[] = [];
    for (const g of matchingGenres) {
      items.push({
        kind: 'genre',
        id: `genre-${g.slug}`,
        href: `${langPrefix}/genres/${encodeURIComponent(g.slug)}`,
      });
    }
    for (const c of matchingCountries) {
      items.push({
        kind: 'country',
        id: `country-${c.canonical}`,
        href: `${langPrefix}/regions/${c.regionSlug}/${countrySlug(c.canonical)}`,
      });
    }
    visibleStations.forEach((station: any, idx: number) => {
      const slug = station.slug || station._id || idx;
      items.push({
        kind: 'station',
        id: `station-${slug}-${idx}`,
        station,
      });
    });
    return items;
  }, [matchingGenres, matchingCountries, visibleStations, langPrefix]);

  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchItemRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const suppressSearchHoverRef = useRef(false);

  useEffect(() => {
    const onMove = () => { suppressSearchHoverRef.current = false; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Reset highlight whenever the query or the result set changes
  useEffect(() => {
    setActiveSearchIndex(-1);
  }, [debouncedSearchQuery]);

  useEffect(() => {
    if (activeSearchIndex >= flatSearchItems.length) setActiveSearchIndex(-1);
  }, [flatSearchItems.length, activeSearchIndex]);

  // Reset when the dropdown closes
  useEffect(() => {
    if (!isSearchOpen) setActiveSearchIndex(-1);
  }, [isSearchOpen]);

  // Scroll the highlighted item into view
  useEffect(() => {
    if (activeSearchIndex < 0) return;
    const item = flatSearchItems[activeSearchIndex];
    if (!item) return;
    const el = searchItemRefs.current.get(item.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeSearchIndex, flatSearchItems]);

  const setSearchItemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) searchItemRefs.current.set(id, el);
      else searchItemRefs.current.delete(id);
    },
    []
  );

  const setActiveSearchById = useCallback(
    (id: string) => {
      if (suppressSearchHoverRef.current) return;
      const idx = flatSearchItems.findIndex((it) => it.id === id);
      if (idx >= 0) setActiveSearchIndex(idx);
    },
    [flatSearchItems]
  );

  const activateSearchItem = useCallback(
    (item: typeof flatSearchItems[number]) => {
      if (item.kind === 'station') {
        playStation(item.station);
        setIsSearchOpen(false);
        setSearchQuery('');
        setLocation(getStationUrl(item.station));
      } else {
        setIsSearchOpen(false);
        setSearchQuery('');
        setLocation(item.href);
      }
    },
    [playStation, setLocation]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (searchQuery !== '') {
        setSearchQuery('');
        setActiveSearchIndex(-1);
      } else {
        setIsSearchOpen(false);
      }
      return;
    }
    // Don't navigate or activate when the dropdown isn't showing results.
    // Without this, a short window exists where the user can press Enter on
    // stale results after backspacing the query below the 2-char threshold.
    if (searchQuery.trim().length < 2 || flatSearchItems.length === 0) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => (i < 0 ? 0 : (i + 1) % flatSearchItems.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => (i <= 0 ? flatSearchItems.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex(flatSearchItems.length - 1);
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => Math.min((i < 0 ? 0 : i) + PAGE_STEP, flatSearchItems.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      suppressSearchHoverRef.current = true;
      setActiveSearchIndex((i) => Math.max((i < 0 ? 0 : i) - PAGE_STEP, 0));
      return;
    }
    if (e.key === 'Enter') {
      const target = flatSearchItems[activeSearchIndex] ?? flatSearchItems[0];
      if (target) {
        e.preventDefault();
        activateSearchItem(target);
      }
    }
  };

  const activeSearchId =
    activeSearchIndex >= 0 ? flatSearchItems[activeSearchIndex]?.id ?? null : null;
  const searchFocusRingClass = 'ring-2 ring-[#FF4199] ring-offset-2 ring-offset-[#1D1D1D]';

  // ---------- Country picker keyboard navigation ----------
  const countryItems = useMemo(() => {
    const items: Array<{ id: string; activate: () => void }> = [
      {
        id: 'global',
        activate: () => {
          onCountryChange?.("all", true);
          closeCountryDropdownAndRestoreFocus();
        },
      },
    ];
    for (const country of filteredCountries) {
      const code = country.code || country.name;
      items.push({
        id: `country-${code}`,
        activate: () => {
          onCountryChange?.(country.name, true);
          if (isAuthenticated) {
            setSelectedCountryObj({ name: country.name, code: country.code });
          }
          localStorage.setItem('selectedCountry', country.name);
          localStorage.setItem('countryPreference', 'manual');
          closeCountryDropdownAndRestoreFocus();
        },
      });
    }
    return items;
  }, [filteredCountries, isAuthenticated, onCountryChange, closeCountryDropdownAndRestoreFocus]);

  const [activeCountryIndex, setActiveCountryIndex] = useState(-1);
  const countryItemRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const suppressCountryHoverRef = useRef(false);

  useEffect(() => {
    const onMove = () => { suppressCountryHoverRef.current = false; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Reset highlight when search query changes or dropdown closes
  useEffect(() => {
    setActiveCountryIndex(-1);
  }, [countrySearchQuery]);
  useEffect(() => {
    if (!isCountryDropdownOpen) setActiveCountryIndex(-1);
  }, [isCountryDropdownOpen]);
  useEffect(() => {
    if (activeCountryIndex >= countryItems.length) setActiveCountryIndex(-1);
  }, [countryItems.length, activeCountryIndex]);

  // Scroll the highlighted country into view
  useEffect(() => {
    if (activeCountryIndex < 0) return;
    const item = countryItems[activeCountryIndex];
    if (!item) return;
    const el = countryItemRefs.current.get(item.id);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeCountryIndex, countryItems]);

  const setCountryItemRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) countryItemRefs.current.set(id, el);
      else countryItemRefs.current.delete(id);
    },
    []
  );

  const setActiveCountryById = useCallback(
    (id: string) => {
      if (suppressCountryHoverRef.current) return;
      const idx = countryItems.findIndex((it) => it.id === id);
      if (idx >= 0) setActiveCountryIndex(idx);
    },
    [countryItems]
  );

  const handleCountryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (countrySearchQuery !== '') {
        setCountrySearchQuery('');
        setActiveCountryIndex(-1);
      } else {
        closeCountryDropdownAndRestoreFocus();
      }
      return;
    }
    // Trap Tab/Shift+Tab inside the dropdown so focus does not leak back to
    // the page while the picker is open. The search input is the only
    // focusable element inside the dropdown, so we just keep focus on it.
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
    if (countryItems.length === 0) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => (i < 0 ? 0 : (i + 1) % countryItems.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => (i <= 0 ? countryItems.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex(countryItems.length - 1);
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => Math.min((i < 0 ? 0 : i) + PAGE_STEP, countryItems.length - 1));
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      suppressCountryHoverRef.current = true;
      setActiveCountryIndex((i) => Math.max((i < 0 ? 0 : i) - PAGE_STEP, 0));
      return;
    }
    if (e.key === 'Enter') {
      const target = countryItems[activeCountryIndex] ?? countryItems[0];
      if (target) {
        e.preventDefault();
        target.activate();
      }
    }
  };

  const activeCountryId =
    activeCountryIndex >= 0 ? countryItems[activeCountryIndex]?.id ?? null : null;
  const countryFocusRingClass = 'ring-2 ring-[#FF4199] ring-inset';

  return (
    <>
      {/* OPTIMIZED HEADER - Compact, responsive, balanced from all sides */}
      <nav className="fixed top-0 left-0 right-0 z-40 w-full text-white">
        <div className="flex items-center justify-center border-b border-gray-900 bg-[#0E0E0E] sm:border-0 w-full">
          {/* Main content container - Uses .container class for perfect alignment with content below */}
          {/* CRITICAL: Desktop nav shows at xl(1280px) to prevent overflow on tablet */}
          <div className="container relative box-border overflow-hidden grid grid-cols-5 xl:flex xl:justify-between h-[70px] md:h-[80px] lg:h-[90px] xl:h-[105px] items-center">
            
            {/* Mobile: Menu + Logo together on left side | Desktop: Logo only */}
            <div className="col-span-2 flex items-center gap-5 xl:col-auto xl:gap-2">
              {/* Mobile Menu Toggle - hidden on desktop (xl+) */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="xl:hidden flex items-center justify-center text-white flex-shrink-0 p-3 -m-3 min-h-[48px] min-w-[48px]"
                aria-label="Toggle menu"
              >
                {isMobileMenuOpen ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>

              {/* Logo - Figma specs: icon 50x50px, text 100.85x23.15px, left 61px (11px gap) */}
              <Link href={getLocalizedUrl("/")} className="not-active flex flex-shrink-0 items-center">
                <div className="relative flex-shrink-0">
                  <img 
                    className="w-8 h-8 md:w-10 md:h-10 lg:w-[50px] lg:h-[50px] flex-shrink-0 rounded-[6px] relative z-10"
                    src="/images/logo-icon.webp"
                    width="50"
                    height="50"
                    alt="Megaradio streaming service" 
                    title="Megaradio - Listen to live stations worldwide"
                  />
                  {/* Pink glow effect - bottom right - HIDDEN on mobile/tablet, visible from xl+ */}
                  <div 
                    className="hidden xl:block absolute -bottom-3 -right-3 w-16 h-16 rounded-full blur-lg pointer-events-none"
                    style={{ background: 'radial-gradient(circle, #FF4199 0%, #FF4199 30%, transparent 70%)', opacity: 0.85 }}
                  />
                </div>
                <div className="ml-2 xl:ml-[11px] hidden text-white xl:flex items-center whitespace-nowrap font-ubuntu" style={{ width: '100.85px', height: '23.15px' }}>
                  <span className="font-bold leading-none" style={{ fontSize: '20.38px', lineHeight: '100%' }}>mega</span><span className="font-normal leading-none" style={{ fontSize: '20.38px', lineHeight: '100%' }}>radio</span>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation + Right Controls - all right-aligned together (visible xl+) */}
            <div className="hidden xl:flex items-center gap-2 2xl:gap-3 ml-auto">
              <Link href={getLocalizedUrl("/genres")} className="nav-item font-ubuntu font-bold text-sm leading-tight text-center whitespace-nowrap hover:text-[#FF4199] transition-colors">{t('nav_genres', 'Genres')}</Link>
              <Link href={getLocalizedUrl("/recommendations")} className="nav-item font-ubuntu font-bold text-sm leading-tight text-center whitespace-nowrap hover:text-[#FF4199] transition-colors">{t('nav_for_you', 'For You')}</Link>
              <button 
                onClick={() => setShowAddStationModal?.(true)}
                className="nav-item font-ubuntu font-bold text-sm leading-tight text-center hover:text-[#FF4199] transition-colors cursor-pointer whitespace-nowrap"
              >
                {t('nav_add_your_station', 'Add your station')}
              </button>
            </div>

            {/* Right Side controls - col-span-3 on mobile/tablet */}
            <div className="flex items-center col-span-3 justify-self-end xl:col-auto xl:ml-5 2xl:ml-8 gap-2 md:gap-3 xl:gap-4 2xl:gap-5">
              {/* Mobile/Tablet: Authenticated users - Search + Bell + Country + Avatar (sıra: 1-2-3-4) */}
              {!authLoading && isAuthenticated && (
                <div className="xl:hidden flex items-center" style={{ height: '45px', gap: '12px' }}>
                  {/* 1. Search Icon - Mobile only */}
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: '24px', height: '24px' }}
                    aria-label={t('general_search', 'Search')}
                    data-testid="button-search-mobile"
                  >
                    <svg className="w-6 h-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                  
                  {/* 2. Notification Icon - Layout: 24x24, Icon: 24x24, Dot: 8x8 */}
                  <button
                    ref={notificationButtonRef}
                    onClick={toggleNotificationDropdown}
                    className="relative flex items-center justify-center flex-shrink-0"
                    style={{ width: '24px', height: '24px' }}
                    aria-label="Notifications"
                    aria-haspopup="dialog"
                    aria-expanded={isNotificationDropdownOpen}
                    data-testid="button-notifications-mobile"
                  >
                    <img src={notificationIcon} alt="Notifications" style={{ width: '24px', height: '24px' }} />
                    {unreadCount > 0 && (
                      <span className="absolute bg-[#FF4199]" style={{ width: '8px', height: '8px', borderRadius: '30px', top: '1px', right: '0px' }} />
                    )}
                  </button>
                  
                  {/* 3. Country Selector - Layout: 34x34, border-radius: 4px, bg: #2F2F2F, border: 1px #2F2F2F */}
                  <button 
                    ref={countryButtonMobileRef}
                    onClick={toggleCountryDropdown}
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: '34px', height: '34px', minWidth: '34px', minHeight: '34px', borderRadius: '4px', backgroundColor: '#2F2F2F', border: '1px solid #2F2F2F', padding: '0px' }}
                    aria-label={t('general_select_country', 'Select country')}
                    aria-haspopup="listbox"
                    aria-expanded={isCountryDropdownOpen}
                    data-country-button
                  >
                    {(selectedCountry === "all" || selectedCountry === "Global") ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="fill-[#FF4199]" style={{ width: '24px', height: '24px' }}>
                        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                      </svg>
                    ) : selectedCountryCode ? (
                      <img
                        src={`https://flagcdn.com/w80/${selectedCountryCode.toLowerCase()}.png`}
                        alt={selectedCountry}
                        style={{ width: '24px', height: '24px' }}
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                    )}
                  </button>
                  
                  {/* 3. User Avatar with Dropdown Menu - Layout: 45x45, border-radius: 50px */}
                  <div className="relative flex-shrink-0" ref={mobileProfileButtonRef}>
                    <button 
                      ref={mobileProfileTriggerButtonRef}
                      onClick={toggleMobileProfileMenu}
                      className="flex items-center justify-center overflow-hidden bg-[#FF4199]"
                      style={{ width: '45px', height: '45px', borderRadius: '50px' }}
                      aria-label="Profile menu"
                      aria-haspopup="menu"
                      aria-expanded={isMobileProfileMenuOpen}
                      data-testid="button-mobile-profile"
                    >
                      {user?.avatar && !avatarError ? (
                        <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                      ) : (
                        <User className="w-6 h-6 text-white" />
                      )}
                    </button>
                  </div>
                </div>
              )}
              
              {/* Mobile/Tablet: NOT authenticated - Search + Country + Login */}
              {!authLoading && !isAuthenticated && (
                <>
                  {/* Search Icon - Mobile only */}
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="xl:hidden flex items-center justify-center flex-shrink-0"
                    style={{ width: '24px', height: '24px' }}
                    aria-label={t('general_search', 'Search')}
                    data-testid="button-search-mobile-guest"
                  >
                    <svg className="w-6 h-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                  
                  {/* Country Selector - Layout: 34x34, border-radius: 4px, bg: #2F2F2F, border: 1px #2F2F2F */}
                  <button 
                    ref={countryButtonMobileRef}
                    onClick={toggleCountryDropdown}
                    className="xl:hidden flex items-center justify-center flex-shrink-0"
                    style={{ width: '34px', height: '34px', minWidth: '34px', minHeight: '34px', borderRadius: '4px', backgroundColor: '#2F2F2F', border: '1px solid #2F2F2F', padding: '0px' }}
                    aria-label={t('general_select_country', 'Select country')}
                    aria-haspopup="listbox"
                    aria-expanded={isCountryDropdownOpen}
                    data-country-button
                  >
                    {(selectedCountry === "all" || selectedCountry === "Global") ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="fill-[#FF4199]" style={{ width: '24px', height: '24px' }}>
                        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.30-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                      </svg>
                    ) : selectedCountryCode ? (
                      <img
                        src={`https://flagcdn.com/w80/${selectedCountryCode.toLowerCase()}.png`}
                        alt={selectedCountry}
                        style={{ width: '24px', height: '24px' }}
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                    )}
                  </button>
                  
                  {/* Login Icon */}
                  <Link 
                    href={getLocalizedUrl("/login")}
                    className="xl:hidden flex items-center justify-center w-10 h-10 rounded-full bg-[#FF4199] hover:bg-[#E5357F] transition-colors"
                    aria-label={t('nav_login', 'Log in')}
                    data-testid="button-mobile-login"
                  >
                    <User className="w-5 h-5 text-white" />
                  </Link>
                </>
              )}
              
              {/* Desktop only (xl+) */}
              {authLoading ? (
                <div className="hidden xl:flex items-center gap-[15px]">
                  <div className="nav-skeleton nav-skeleton-button loading-placeholder"></div>
                  <div className="nav-skeleton nav-skeleton-button loading-placeholder"></div>
                </div>
              ) : isAuthenticated ? (
                <>
                  {/* 1. Notification Icon - desktop only (xl+) */}
                  <button
                    ref={notificationButtonDesktopRef}
                    onClick={toggleNotificationDropdown}
                    className="hidden xl:flex relative items-center justify-center"
                    style={{ width: '24px', height: '24px' }}
                    aria-label="Notifications"
                    aria-haspopup="dialog"
                    aria-expanded={isNotificationDropdownOpen}
                    data-testid="button-notifications-desktop"
                  >
                    <img src={notificationIcon} alt="Notifications" style={{ width: '24px', height: '24px' }} />
                    {unreadCount > 0 && (
                      <span className="absolute bg-[#FF4199]" style={{ width: '8px', height: '8px', borderRadius: '30px', top: '1px', right: '0px' }} />
                    )}
                  </button>
                  
                  {/* 2. Country Selector - desktop only (xl+) - Figma: 147x38px, border-radius 5px */}
                  <div className="hidden xl:block relative dropdown-container" ref={countryDropdownRef}>
                    <button 
                      ref={countryButtonDesktopRef}
                      onClick={toggleCountryDropdown}
                      className="country-selector flex items-center text-white bg-[#1D1D1D] hover:bg-[#2A2A2A] transition-colors overflow-hidden whitespace-nowrap"
                      style={{ width: '147px', height: '38px', borderRadius: '5px' }}
                      aria-label={t('general_select_country', 'Select country')}
                      aria-haspopup="listbox"
                      aria-expanded={isCountryDropdownOpen}
                      title={(selectedCountry === "all" || selectedCountry === "Global") ? 'Global' : selectedCountry}
                    >
                      {/* Flag - Figma: 24x24px, left 9px - Uses selectedCountryCode directly (no API wait) */}
                      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: '24px', height: '24px', marginLeft: '9px' }}>
                        {(selectedCountry === "all" || selectedCountry === "Global") ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: '24px', height: '24px' }} className="fill-[#FF4199]">
                            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                          </svg>
                        ) : selectedCountryCode ? (
                          <img
                            src={`https://flagcdn.com/w40/${selectedCountryCode.toLowerCase()}.png`}
                            alt={selectedCountry}
                            style={{ width: '24px', height: '24px' }}
                            className="object-cover rounded-full"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                        )}
                      </div>
                      {/* Country text - Figma: Ubuntu Bold 15px, line-height 100%, left aligned */}
                      <span className="font-ubuntu font-bold text-white truncate flex-1 text-left" style={{ fontSize: '15px', lineHeight: '100%', marginLeft: '9px' }}>
                        {(selectedCountry === "all" || selectedCountry === "Global") ? t('nav_global', 'Global') : selectedCountry}
                      </span>
                      {/* Arrow - Figma: 20x20px, pointing down */}
                      <svg className="text-white flex-shrink-0" style={{ width: '20px', height: '20px', marginRight: '10px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* 3. Search Button - desktop only (xl+) - Figma: 38x38px, #1D1D1D, rounded-[5px] */}
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="hidden xl:flex items-center justify-center gap-2 h-[38px] px-2 rounded-[5px] bg-[#1D1D1D] hover:bg-[#2A2A2A] transition-colors"
                    aria-label={t('general_search', 'Search')}
                    title={isMac ? '⌘K' : 'Ctrl+K'}
                  >
                    <svg className="w-[20px] h-[20px] text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <kbd className="font-ubuntu inline-flex items-center px-1.5 py-0.5 text-[11px] font-semibold text-gray-300 bg-[#0E0E0E] border border-[#FF4199]/40 rounded">
                      {isMac ? '⌘K' : 'Ctrl K'}
                    </kbd>
                  </button>

                  {/* 4. Vertical Divider */}
                  <div className="hidden xl:block w-[2px] h-[33px] bg-[#222222] rounded-sm" />

                  {/* 5. User Section - Username + Avatar - Desktop only (xl+) */}
                  <Link 
                    href={getLocalizedUrl("/profile/favorites")}
                    className="hidden xl:flex items-center hover:opacity-80 transition-opacity cursor-pointer"
                    title={user?.username || user?.fullName || "User"}
                  >
                    {/* Username text - shown fully per global standards (Gmail, LinkedIn, Slack) - shows on xl+ (1280px+) */}
                    {(user?.username || user?.fullName) && (
                      <p className="font-ubuntu font-bold text-[15px] text-white pr-4 overflow-hidden">
                        {user?.username || user?.fullName}
                      </p>
                    )}
                    {/* Avatar - 45x45px rounded-full per Figma */}
                    <div className="flex items-center justify-center flex-shrink-0 overflow-hidden bg-[#FF4199]" style={{ width: '45px', height: '45px', borderRadius: '50px' }}>
                      {user?.avatar && !avatarError ? (
                        <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" onError={() => setAvatarError(true)} />
                      ) : (
                        <User className="w-5 h-5 text-white" />
                      )}
                    </div>
                  </Link>
                </>
              ) : (
                <>
                  {/* NOT Authenticated: Country Selector + Search + Divider + Login + Sign Up */}
                  {/* Country Selector - desktop only (xl+) - Figma: 147x38px, border-radius 5px */}
                  <div className="hidden xl:block relative dropdown-container" ref={countryDropdownRef}>
                    <button 
                      ref={countryButtonRef}
                      onClick={toggleCountryDropdown}
                      className="country-selector flex items-center text-white bg-[#1D1D1D] hover:bg-[#2A2A2A] transition-colors overflow-hidden"
                      style={{ width: '147px', height: '38px', borderRadius: '5px' }}
                      aria-label={t('general_select_country', 'Select country')}
                      aria-haspopup="listbox"
                      aria-expanded={isCountryDropdownOpen}
                      title={(selectedCountry === "all" || selectedCountry === "Global") ? 'Global' : selectedCountry}
                    >
                      {/* Flag - Figma: 24x24px, left 9px - Uses selectedCountryCode directly (no API wait) */}
                      <div className="flex-shrink-0 flex items-center justify-center" style={{ width: '24px', height: '24px', marginLeft: '9px' }}>
                        {(selectedCountry === "all" || selectedCountry === "Global") ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: '24px', height: '24px' }} className="fill-[#FF4199]">
                            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                          </svg>
                        ) : selectedCountryCode ? (
                          <img
                            src={`https://flagcdn.com/w40/${selectedCountryCode.toLowerCase()}.png`}
                            alt={selectedCountry}
                            style={{ width: '24px', height: '24px' }}
                            className="object-cover rounded-full"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-600 animate-pulse" />
                        )}
                      </div>
                      {/* Country text - Figma: Ubuntu Bold 15px, line-height 100%, left aligned */}
                      <span className="font-ubuntu font-bold text-white truncate flex-1 text-left" style={{ fontSize: '15px', lineHeight: '100%', marginLeft: '9px' }}>
                        {(selectedCountry === "all" || selectedCountry === "Global") ? t('nav_global', 'Global') : selectedCountry}
                      </span>
                      {/* Arrow - Figma: 20x20px, pointing down */}
                      <svg className="text-white flex-shrink-0" style={{ width: '20px', height: '20px', marginRight: '10px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Search Button - desktop only (xl+) - Figma: 38x38px */}
                  <button
                    onClick={() => setIsSearchOpen(true)}
                    className="hidden xl:flex items-center justify-center gap-2 h-[38px] px-2 rounded-[5px] bg-[#1D1D1D] hover:bg-[#2A2A2A] transition-colors"
                    aria-label={t('general_search', 'Search')}
                    title={isMac ? '⌘K' : 'Ctrl+K'}
                  >
                    <svg className="w-[20px] h-[20px] text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <kbd className="font-ubuntu inline-flex items-center px-1.5 py-0.5 text-[11px] font-semibold text-gray-300 bg-[#0E0E0E] border border-[#FF4199]/40 rounded">
                      {isMac ? '⌘K' : 'Ctrl K'}
                    </kbd>
                  </button>
                  
                  {/* Vertical Divider - desktop only (xl+) */}
                  <div className="hidden xl:block w-[2px] h-[33px] bg-[#222222] rounded-sm" />
                  
                  {/* Log in Button - desktop only (xl+) */}
                  <div className="hidden xl:flex items-center">
                    <Link 
                      href={getLocalizedUrl("/login")} 
                      className="flex items-center justify-center text-white font-semibold transition-colors bg-[#FF4199] hover:bg-[#E5357F] w-[97px] h-[45px] rounded-[25px] text-sm"
                    >
                      {t('nav_login', 'Log in')}
                    </Link>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu - EXACT from original - Rendered via portal for absolute positioning */}
      {isMobileMenuOpen && typeof document !== 'undefined' && createPortal(
          <div 
            className="fixed inset-0 min-h-screen bg-[#0E0E0E]/95 backdrop-blur xl:hidden" 
            style={{ 
              zIndex: 45,
              top: '70px',
              left: 0,
              right: 0,
              bottom: 0
            }}
          >
            <div className="pt-4 pb-3">
              <div className="space-y-1">
                <Link 
                  href={getLocalizedUrl("/genres")} 
                  className="nav-item flex items-center min-h-[48px] px-4 py-3 text-base font-medium text-white hover:text-[#FF4199] transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_genres', 'Genres')}
                </Link>
                <Link 
                  href={getLocalizedUrl("/recommendations")} 
                  className="nav-item flex items-center min-h-[48px] px-4 py-3 text-base font-medium text-white hover:text-[#FF4199] transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('nav_for_you', 'For You')}
                </Link>

                <button 
                  className="nav-item flex items-center min-h-[48px] px-4 py-3 text-base font-medium text-white hover:text-[#FF4199] transition-colors text-left w-full"
                  onClick={() => {
                    // console.log(' Mobile Add Station button clicked!', { setShowAddStationModal });
                    setIsMobileMenuOpen(false);
                    setShowAddStationModal?.(true);
                  }}
                >
                  {t('nav_add_your_station', 'Add your station')}
                </button>
                
                {/* Mobile Auth section - EXACT from original LayoutHeader.vue */}
                <div className="auth-section border-t border-gray-900">
                  {authLoading ? (
                    // Loading placeholders for mobile to prevent layout shift
                    <div className="space-y-2 px-4 py-2">
                      <div className="nav-skeleton nav-skeleton-text loading-placeholder"></div>
                      <div className="nav-skeleton nav-skeleton-text loading-placeholder"></div>
                    </div>
                  ) : isAuthenticated ? (
                    <>
                      <Link 
                        href={getLocalizedUrl("/profile/favorites")} 
                        className="nav-item flex items-center min-h-[48px] px-4 py-3 text-base font-medium text-white hover:text-[#FF4199] transition-colors"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        {t('nav_your_favorites', 'Your Favorites')}
                      </Link>
                    </>
                    ) : (
                      <>
                        <Link 
                          href={getLocalizedUrl("/login")} 
                          className="nav-item flex items-center min-h-[48px] px-4 py-3 text-base font-medium text-white hover:text-[#FF4199] transition-colors"
                          onClick={() => setIsMobileMenuOpen(false)}
                        >
                          {t('nav_login', 'Login') || 'Login'}
                        </Link>
                        <Link 
                          href={getLocalizedUrl("/signup")} 
                          className="nav-item flex items-center min-h-[48px] px-4 py-3 text-base font-medium text-white hover:text-[#FF4199] transition-colors"
                          onClick={() => setIsMobileMenuOpen(false)}
                        >
                          {t('nav_signup', 'Sign up') || 'Sign up'}
                        </Link>
                      </>
                    )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Search Popup Modal - EXACT from original */}
      {isSearchOpen && showSearch && !isMobileMenuOpen && createPortal(
        <div data-search-element className="fixed inset-0 flex items-start justify-center pt-24 bg-black/80 backdrop-blur-sm" style={{ zIndex: 9999 }}>
          <div className="w-full max-w-2xl mx-4">
            <div data-search-element className="bg-[#1D1D1D] border border-[#2F2F2F] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">{t('general_search_title', 'Search')}</h3>
                <button
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSearchQuery("");
                  }}
                  className="text-gray-400 hover:text-white p-3 -m-3 rounded-md min-h-[48px] min-w-[48px] flex items-center justify-center"
                  aria-label="Close search"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={t('search_placeholder', 'Search stations, genres, countries…')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  onKeyDown={handleSearchKeyDown}
                  role="combobox"
                  aria-expanded={searchQuery.length >= 2 && hasAnyResults}
                  aria-controls="header-search-results"
                  aria-activedescendant={activeSearchId ?? undefined}
                  aria-autocomplete="list"
                  className="w-full h-12 bg-[#0E0E0E] border border-[#2F2F2F] rounded-xl pl-4 pr-12 text-white placeholder-gray-400 focus:border-[#FF4199] focus:outline-none"
                  autoFocus
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>

              {/* Search Results */}
              {searchQuery && searchQuery.length >= 2 && (
                <div
                  className="mt-4 max-h-96 overflow-y-auto"
                  id="header-search-results"
                  role="listbox"
                >
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-transparent"></div>
                      <span className="ml-2 text-gray-300">{t('general_searching', 'Searching...')}</span>
                    </div>
                  ) : hasAnyResults ? (
                    <div className="space-y-4">
                      {matchingGenres.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-wider text-gray-400">
                            <Music size={14} className="text-[#FF4199]" />
                            <span>{t('search_section_genres', 'Genres')}</span>
                          </div>
                          {matchingGenres.map((g) => {
                            const id = `genre-${g.slug}`;
                            const isActive = activeSearchId === id;
                            return (
                            <Link
                              key={id}
                              href={`${langPrefix}/genres/${encodeURIComponent(g.slug)}`}
                              ref={setSearchItemRef(id)}
                              id={id}
                              role="option"
                              aria-selected={isActive}
                              onMouseEnter={() => setActiveSearchById(id)}
                              onClick={() => {
                                setIsSearchOpen(false);
                                setSearchQuery("");
                              }}
                              className={`flex items-center p-3 hover:bg-[#2F2F2F] rounded-lg cursor-pointer transition-colors ${isActive ? searchFocusRingClass : ''}`}
                              data-testid={`header-search-genre-${g.slug}`}
                            >
                              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center mr-3 flex-shrink-0">
                                <Music size={16} className="text-[#FF4199]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-white font-medium truncate capitalize">
                                  <HighlightMatch text={g.name} query={debouncedSearchQuery} />
                                </div>
                                {typeof g.stationCount === 'number' && (
                                  <div className="text-gray-400 text-sm">
                                    {g.stationCount.toLocaleString()} {t('stations', 'stations')}
                                  </div>
                                )}
                              </div>
                            </Link>
                            );
                          })}
                        </div>
                      )}

                      {matchingCountries.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-wider text-gray-400">
                            <Globe size={14} className="text-[#FF4199]" />
                            <span>{t('search_section_countries', 'Countries')}</span>
                          </div>
                          {matchingCountries.map((c) => {
                            const id = `country-${c.canonical}`;
                            const isActive = activeSearchId === id;
                            return (
                            <Link
                              key={id}
                              href={`${langPrefix}/regions/${c.regionSlug}/${countrySlug(c.canonical)}`}
                              ref={setSearchItemRef(id)}
                              id={id}
                              role="option"
                              aria-selected={isActive}
                              onMouseEnter={() => setActiveSearchById(id)}
                              onClick={() => {
                                setIsSearchOpen(false);
                                setSearchQuery("");
                              }}
                              className={`flex items-center p-3 hover:bg-[#2F2F2F] rounded-lg cursor-pointer transition-colors ${isActive ? searchFocusRingClass : ''}`}
                              data-testid={`header-search-country-${countrySlug(c.canonical)}`}
                            >
                              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center mr-3 flex-shrink-0">
                                <Globe size={16} className="text-[#FF4199]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-white font-medium truncate">
                                  <HighlightMatch text={c.name} query={debouncedSearchQuery} />
                                </div>
                                {typeof c.stationCount === 'number' && (
                                  <div className="text-gray-400 text-sm">
                                    {c.stationCount.toLocaleString()} {t('stations', 'stations')}
                                  </div>
                                )}
                              </div>
                            </Link>
                            );
                          })}
                        </div>
                      )}

                      {filteredStations.length > 0 && (
                        <div className="space-y-1">
                          {(matchingGenres.length > 0 || matchingCountries.length > 0) && (
                            <div className="flex items-center gap-2 px-1 text-xs uppercase tracking-wider text-gray-400">
                              <span>{t('search_section_stations', 'Stations')}</span>
                            </div>
                          )}
                      {visibleStations.map((station: any, index: number) => {
                        const slug = station.slug || station._id || index;
                        const id = `station-${slug}-${index}`;
                        const isActive = activeSearchId === id;
                        return (
                        <div
                          key={station._id || index}
                          ref={setSearchItemRef(id)}
                          id={id}
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveSearchById(id)}
                          className={`flex items-center p-3 hover:bg-[#2F2F2F] rounded-lg cursor-pointer transition-colors ${isActive ? searchFocusRingClass : ''}`}
                          onClick={() => {
                            playStation(station);
                            setIsSearchOpen(false);
                            setSearchQuery("");
                            // Use localized URL for station
                            const stationUrl = getStationUrl(station);
                            setLocation(stationUrl);
                          }}
                        >
                          <img
                            src={station.localImagePath ? `/station-images/${station.localImagePath}` : 
                                 (station.favicon && station.favicon.trim() !== '' && station.favicon !== 'null' && station.favicon !== 'undefined') ? 
                                 getImageUrl(station.favicon) : '/images/no-image.webp'}
                            alt={station.name}
                            className="w-10 h-10 rounded-lg object-cover mr-3 flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/images/no-image.webp';
                            }}
                          />
                          <div className="flex-1">
                            <div className="text-white font-medium">
                              <HighlightMatch text={station.name} query={debouncedSearchQuery} />
                            </div>
                            <div className="text-gray-400 text-sm">
                              <HighlightMatch text={station.country} query={debouncedSearchQuery} />
                            </div>
                          </div>
                          
                          {/* Station Votes */}
                          {station.votes !== undefined && (
                            <div className="flex items-center space-x-1 text-xs ml-2">
                              <svg className="w-3 h-3 fill-current text-[#FF4199]" viewBox="0 0 24 24">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                              </svg>
                              <span className="text-[#FF4199]">{station.votes || 0}</span>
                            </div>
                          )}
                        </div>
                        );
                      })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      {t('search_no_results', 'No stations, genres or countries match your search.')}
                    </div>
                  )}
                </div>
              )}

              {/* Keyboard shortcut hints - hidden on small/touch screens */}
              <div className="hidden sm:flex [@media(pointer:coarse)]:!hidden items-center justify-end gap-3 mt-4 pt-3 border-t border-[#2F2F2F] text-[11px] text-gray-400">
                <span className="inline-flex items-center gap-1.5">
                  <kbd className="font-ubuntu inline-flex items-center px-1.5 py-0.5 font-semibold text-gray-300 bg-[#0E0E0E] border border-[#FF4199]/40 rounded">
                    {t('search_kbd_enter', 'Enter')}
                  </kbd>
                  <span>{t('search_kbd_enter_hint', 'to select')}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <kbd className="font-ubuntu inline-flex items-center px-1.5 py-0.5 font-semibold text-gray-300 bg-[#0E0E0E] border border-[#FF4199]/40 rounded">
                    {t('search_kbd_esc', 'Esc')}
                  </kbd>
                  <span>{t('search_kbd_esc_hint', 'to close')}</span>
                </span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Country Dropdown - Portal rendered for authenticated users (mobile + desktop) */}
      {isCountryDropdownOpen && isAuthenticated && (() => {
        // Use whichever button is actually visible in the DOM
        const desktopButtonRect = countryButtonDesktopRef.current?.getBoundingClientRect();
        const mobileButtonRect = countryButtonMobileRef.current?.getBoundingClientRect();
        const buttonRect = desktopButtonRect && desktopButtonRect.width > 0 ? desktopButtonRect : mobileButtonRect;
        const isDesktopVisible = !!(desktopButtonRect && desktopButtonRect.width > 0);
        const dropdownWidth = Math.min(window.innerWidth - 32, 320);
        const left = isDesktopVisible 
          ? Math.max(16, (buttonRect?.right ?? 0) - dropdownWidth)
          : 'auto';
        const right = !isDesktopVisible ? 16 : 'auto';
        const top = window.scrollY + (buttonRect?.bottom ?? 70) + 12;
        
        return createPortal(
        <div 
          data-country-dropdown
          className="fixed bg-[#0E0E0E]/95 border border-[#2F2F2F] rounded-lg shadow-2xl backdrop-blur z-50"
          style={{
            width: dropdownWidth,
            maxHeight: '70vh',
            top: top,
            left: left,
            right: right
          }}
          data-testid="country-dropdown-authenticated"
        >
          <div className="overflow-hidden rounded-lg bg-[#0E0E0E]/95 p-4 shadow-lg ring-1 ring-black ring-opacity-5 backdrop-blur">
            <div className="relative mb-4">
              <input
                type="text"
                value={countrySearchQuery}
                onChange={(e) => setCountrySearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleCountryKeyDown}
                role="combobox"
                aria-expanded={true}
                aria-controls="header-country-list-auth"
                aria-activedescendant={activeCountryId ? `header-country-auth-${activeCountryId}` : undefined}
                aria-autocomplete="list"
                className="w-full rounded-lg bg-[#2A2A2A] border border-[#444] px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-[#FF4199] transition-colors"
                placeholder={t('general_search_countries', 'Search countries...')}
                autoFocus
              />
            </div>
            <div
              id="header-country-list-auth"
              role="listbox"
              className="max-h-80 overflow-y-auto scrollbar-none scroll-smooth"
                 style={{ 
                   scrollbarWidth: 'none', 
                   msOverflowStyle: 'none',
                   WebkitOverflowScrolling: 'touch'
                 }}>
              <div 
                ref={setCountryItemRef('global')}
                id="header-country-auth-global"
                role="option"
                aria-selected={activeCountryId === 'global'}
                onMouseEnter={() => setActiveCountryById('global')}
                className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${activeCountryId === 'global' ? countryFocusRingClass : ''}`}
                onClick={() => {
                  onCountryChange?.("all", true);
                  closeCountryDropdownAndRestoreFocus();
                }}
              >
                <span className="pr-4">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 fill-[#FF4199]">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                  </svg>
                </span>
                <span className="block truncate text-white">{t('nav_global', 'Global')}</span>
              </div>
              {filteredCountries.map((country, index: number) => {
                const itemId = `country-${country.code || country.name}`;
                const isActive = activeCountryId === itemId;
                return (
                <div 
                  key={`mobile-portal-${country.name || index}`}
                  ref={setCountryItemRef(itemId)}
                  id={`header-country-auth-${itemId}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveCountryById(itemId)}
                  className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${isActive ? countryFocusRingClass : ''}`}
                  onClick={() => {
                    onCountryChange?.(country.name, true);
                    setSelectedCountryObj({ name: country.name, code: country.code });
                    localStorage.setItem('selectedCountry', country.name);
                    localStorage.setItem('countryPreference', 'manual'); // Persist manual selection
                    closeCountryDropdownAndRestoreFocus();
                    // NOTE: No URL navigation - country is just a content filter, not a URL change
                    // User's language preference (URL slug) stays unchanged
                  }}
                  title={country.name}
                >
                  <span className="pr-3 flex items-center justify-center w-10 flex-shrink-0">
                    {country.code ? (
                      <img
                        src={`/flags/${country.code?.toLowerCase()}-40.webp`}
                        alt={country.name}
                        className="w-7 h-5 object-cover rounded border border-gray-500 shadow-sm"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-xs font-bold text-white bg-gray-600 px-1.5 py-0.5 rounded shadow-sm">
                        {country.name.split(' ').map(word => word.charAt(0)).join('').substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-white">{country.name}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      );
      })()}

      {/* Country Dropdown - Portal rendered for unauthenticated users */}
      {isCountryDropdownOpen && !isAuthenticated && (() => {
        // Use whichever button is actually visible in the DOM
        const desktopButtonRect = countryButtonRef.current?.getBoundingClientRect();
        const mobileButtonRect = countryButtonMobileRef.current?.getBoundingClientRect();
        const buttonRect = desktopButtonRect && desktopButtonRect.width > 0 ? desktopButtonRect : mobileButtonRect;
        const isDesktopVisible = !!(desktopButtonRect && desktopButtonRect.width > 0);
        const dropdownWidth = Math.min(window.innerWidth - 32, 320);
        const left = isDesktopVisible 
          ? Math.max(16, (buttonRect?.right ?? 0) - dropdownWidth)
          : 'auto';
        const right = !isDesktopVisible ? 16 : 'auto';
        const top = window.scrollY + (buttonRect?.bottom ?? 70) + 12;
        
        return createPortal(
        <div 
          data-country-dropdown
          className="fixed bg-[#0E0E0E]/95 border border-[#2F2F2F] rounded-lg shadow-2xl backdrop-blur z-50"
          style={{
            width: dropdownWidth,
            maxHeight: '70vh',
            top: top,
            left: left,
            right: right
          }}
          data-testid="country-dropdown-unauthenticated"
        >
          <div className="overflow-hidden rounded-lg bg-[#0E0E0E]/95 p-4 shadow-lg ring-1 ring-black ring-opacity-5 backdrop-blur">
            <div className="relative mb-4">
              <input
                type="text"
                value={countrySearchQuery}
                onChange={(e) => setCountrySearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleCountryKeyDown}
                role="combobox"
                aria-expanded={true}
                aria-controls="header-country-list-unauth"
                aria-activedescendant={activeCountryId ? `header-country-unauth-${activeCountryId}` : undefined}
                aria-autocomplete="list"
                className="w-full rounded-lg bg-[#2A2A2A] border border-[#444] px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-[#FF4199] transition-colors"
                placeholder={t('general_search_countries', 'Search countries...')}
                autoFocus
              />
            </div>
            <div
              id="header-country-list-unauth"
              role="listbox"
              className="max-h-80 overflow-y-auto scrollbar-none scroll-smooth"
                 style={{ 
                   scrollbarWidth: 'none', 
                   msOverflowStyle: 'none',
                   WebkitOverflowScrolling: 'touch'
                 }}>
              <div 
                ref={setCountryItemRef('global')}
                id="header-country-unauth-global"
                role="option"
                aria-selected={activeCountryId === 'global'}
                onMouseEnter={() => setActiveCountryById('global')}
                className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${activeCountryId === 'global' ? countryFocusRingClass : ''}`}
                onClick={() => {
                  onCountryChange?.("all", true);
                  closeCountryDropdownAndRestoreFocus();
                }}
              >
                <span className="pr-3 flex items-center justify-center w-10 flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 fill-[#FF4199]">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM6.262 6.072a8.25 8.25 0 1010.562-.766 4.5 4.5 0 01-1.318 1.357L14.25 7.5l.165.33a.809.809 0 01-1.086 1.085l-.604-.302a1.125 1.125 0 00-1.298.21l-.132.131c-.439.44-.439 1.152 0 1.591l.296.296c.256.257.622.374.98.314l1.17-.195c.323-.054.654.036.905.245l1.33 1.108c.32.267.46.694.358 1.1a8.7 8.7 0 01-2.288 4.04l-.723.724a1.125 1.125 0 01-1.298.21l-.153-.076a1.125 1.125 0 01-.622-1.006v-1.089c0-.298-.119-.585-.33-.796l-1.347-1.347a1.125 1.125 0 01-.21-1.298L9.75 12l-1.64-1.64a6 6 0 01-1.676-3.257l-.172-1.03Z" clipRule="evenodd" />
                  </svg>
                </span>
                <span className="flex-1 min-w-0 truncate text-white font-medium">{t('nav_global', 'Global')}</span>
              </div>
              {filteredCountries.map((country) => {
                const itemId = `country-${country.code || country.name}`;
                const isActive = activeCountryId === itemId;
                return (
                <div 
                  key={country.code || country.name}
                  ref={setCountryItemRef(itemId)}
                  id={`header-country-unauth-${itemId}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveCountryById(itemId)}
                  className={`relative flex cursor-pointer select-none items-center p-2 rounded-lg hover:bg-[#2A2A2A] ${isActive ? countryFocusRingClass : ''}`}
                  onClick={() => {
                    onCountryChange?.(country.name, true);
                    localStorage.setItem('selectedCountry', country.name);
                    localStorage.setItem('countryPreference', 'manual');
                    closeCountryDropdownAndRestoreFocus();
                    // NOTE: No URL navigation - country is just a content filter, not a URL change
                    // User's language preference (URL slug) stays unchanged
                  }}
                  title={country.name}
                >
                  <span className="pr-3 flex items-center justify-center w-10 flex-shrink-0">
                    {country.code ? (
                      <img
                        src={`/flags/${country.code?.toLowerCase()}-40.webp`}
                        alt={country.name}
                        className="w-7 h-5 object-cover rounded border border-gray-500 shadow-sm"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          img.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-xs font-bold text-white bg-gray-600 px-1.5 py-0.5 rounded shadow-sm">
                        {country.name.split(' ').map(word => word.charAt(0)).join('').substring(0, 2).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-white">{country.name}</span>
                </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      );
      })()}

      {/* Notification Dropdown - Portal rendered - Figma: 331x312px, border-radius 4px, border 1px #4D4D4D */}
      {isNotificationDropdownOpen && isAuthenticated && (() => {
        const isDesktop = window.innerWidth >= 1280;
        const rect = isDesktop
          ? notificationButtonDesktopRef.current?.getBoundingClientRect()
          : notificationButtonRef.current?.getBoundingClientRect();
        const dropdownWidth = isDesktop ? 331 : Math.min(window.innerWidth - 32, 331);
        const left = isDesktop 
          ? (rect ? rect.right - dropdownWidth : 'auto')
          : undefined;
        const right = !isDesktop ? 16 : undefined;
        const top = rect ? (window.scrollY + rect.bottom + 12) : 'auto';
        
        return createPortal(
        <div 
          ref={notificationDropdownRef}
          data-notification-dropdown
          className="fixed bg-black shadow-2xl z-50"
          style={{
            width: dropdownWidth,
            height: '312px',
            top: top,
            left: left,
            right: right,
            borderRadius: '4px',
            border: '1px solid #4D4D4D'
          }}
          role="dialog"
          aria-label={t('notifications_title', 'Notifications')}
          tabIndex={-1}
          onKeyDown={buildDropdownKeyHandler(
            notificationDropdownRef,
            closeNotificationDropdownAndRestoreFocus
          )}
          data-testid="notification-dropdown"
        >
          {/* Header - Figma: Ubuntu Medium 14px, no icon */}
          <div className="px-[19px] py-[14px]">
            <span className="font-ubuntu font-medium text-white" style={{ fontSize: '14px', lineHeight: '100%' }}>
              {t('notifications_title', 'Notifications')}
            </span>
          </div>
          
          {/* Notifications List - Figma: item layout 248x32px, left 19px - scrollbar hidden */}
          <div className="overflow-y-auto scrollbar-hide" style={{ maxHeight: 'calc(312px - 42px)', scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}>
            {notificationsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-500 border-t-white"></div>
              </div>
            ) : notifications.length > 0 ? (
              notifications.map((notification: any, index: number) => {
                const fromUser = notification.fromUserId;
                const isMessage = notification.type === 'new_message';
                const isFollow = notification.type === 'follow' || notification.type === 'unfollow';
                const isStation = notification.type === 'new_station';
                const isUnread = !notification.read && !notification.isRead;

                const handleNotifClick = async () => {
                  if (isMessage && fromUser?._id) {
                    setLocation(`/en/profile/messages?partner=${fromUser._id}`);
                  } else if (isFollow && fromUser?.username) {
                    setLocation(`/en/user/${fromUser.username}`);
                  } else if (isStation && notification.data?.stationSlug) {
                    setLocation(`/en/station/${notification.data.stationSlug}`);
                  }
                  if (notification._id) {
                    fetch(`/api/user/notifications/${notification._id}/read`, { method: 'PATCH', credentials: 'include' }).catch(() => {});
                  }
                };

                return (
                <div 
                  key={notification._id || index}
                  onClick={handleNotifClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNotifClick();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-3 hover:bg-[#1A1A1A] focus:bg-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#FF4199] focus:ring-inset transition-colors cursor-pointer relative"
                  style={{ padding: '8px 19px', minHeight: '48px', background: isUnread ? 'rgba(255,65,153,0.05)' : undefined }}
                  data-testid={`notification-item-${index}`}
                >
                  {isUnread && <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#FF4199]" />}
                  {/* Icon - 32x32px */}
                  <div 
                    className="flex-shrink-0 overflow-hidden"
                    style={{ width: '32px', height: '32px', borderRadius: '16.49px' }}
                  >
                    {isStation && notification.data?.stationFavicon ? (
                      <img 
                        src={notification.data.stationFavicon} 
                        alt="" 
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (isFollow || isMessage) && fromUser ? (
                      fromUser.avatar || fromUser.profileImageUrl ? (
                        <img 
                          src={fromUser.avatar || fromUser.profileImageUrl} 
                          alt="" 
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.style.display = 'none';
                            const parent = img.parentElement;
                            if (parent) {
                              const letter = (fromUser.fullName || fromUser.username || 'U').charAt(0).toUpperCase();
                              const bg = isMessage ? '#FF4199' : '#2F2F2F';
                              parent.innerHTML = `<div class="w-full h-full flex items-center justify-center" style="background:${bg}"><span class="text-white text-xs font-medium">${letter}</span></div>`;
                            }
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ background: isMessage ? '#FF4199' : '#2F2F2F' }}>
                          <span className="text-white text-xs font-medium">
                            {(fromUser.fullName || fromUser.username || 'U').charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )
                    ) : (
                      <div className="w-full h-full bg-[#2F2F2F] flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-gray-400">
                          <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="font-ubuntu font-medium text-white truncate" style={{ fontSize: '14px', lineHeight: '100%' }}>
                      {isStation
                        ? `${notification.data?.stationSlug?.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || notification.title?.replace(' Added', '') || 'Station'} added. Click to listen!`
                        : isMessage && fromUser
                          ? `${fromUser.fullName || fromUser.username || 'Someone'} size mesaj yazdı`
                          : notification.title || t('notifications_new_station', 'New notification')}
                    </div>
                    <div className="font-ubuntu font-normal mt-1" style={{ fontSize: '14px', lineHeight: '100%', color: '#777777' }}>
                      {notification.createdAt ? (
                        (() => {
                          const date = new Date(notification.createdAt);
                          const now = new Date();
                          const diffMs = now.getTime() - date.getTime();
                          const diffMins = Math.floor(diffMs / (1000 * 60));
                          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                          const diffDays = Math.floor(diffHours / 24);
                          if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
                          if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                          if (diffMins > 0) return `${diffMins} min ago`;
                          return 'Just now';
                        })()
                      ) : '1 day ago'}
                    </div>
                  </div>
                </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div 
                  className="flex items-center justify-center bg-[#2F2F2F] mb-3"
                  style={{ width: '32px', height: '32px', borderRadius: '16.49px' }}
                >
                  <img src={notificationIcon} alt="" style={{ width: '16px', height: '16px', opacity: 0.5 }} />
                </div>
                <span className="font-ubuntu" style={{ fontSize: '14px', color: '#777777' }}>
                  {t('notifications_empty', 'No notifications yet')}
                </span>
              </div>
            )}
          </div>
        </div>,
        document.body
      );
      })()}

      {/* Mobile Profile Dropdown Portal */}
      {isMobileProfileMenuOpen && mobileProfileButtonRef.current && createPortal(
        <div 
          ref={mobileProfileDropdownRef}
          className="fixed w-56 bg-[#1D1D1D] rounded-lg shadow-xl py-2 border border-[#2D2D2D] focus:outline-none"
          style={{
            top: window.scrollY + mobileProfileButtonRef.current.getBoundingClientRect().bottom + 8,
            right: window.innerWidth - mobileProfileButtonRef.current.getBoundingClientRect().right,
            zIndex: 9999
          }}
          role="menu"
          aria-label={t('nav_profile_menu', 'Profile menu')}
          tabIndex={-1}
          onKeyDown={buildDropdownKeyHandler(
            mobileProfileDropdownRef,
            closeMobileProfileMenuAndRestoreFocus
          )}
          data-testid="mobile-profile-dropdown"
        >
          <Link 
            href={getLocalizedUrl("/profile/favorites")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <img src="/favorites.png" alt="Favorites" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Your Favorites</span>
          </Link>
          
          <Link 
            href={getLocalizedUrl("/profile/discover")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <img src="/discovery.png" alt="Discover" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Discover</span>
          </Link>
          
          <Link 
            href={getLocalizedUrl("/profile/settings")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <img src="/profile.png" alt="Profile" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Profile</span>
          </Link>
          
          <Link 
            href={getLocalizedUrl("/profile/messages")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <img src="/sms.png" alt="Messages" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Messages</span>
          </Link>
          
          <Link 
            href={getLocalizedUrl("/profile/records")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <img src="/rec.png" alt="Records" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Records</span>
          </Link>
          
          <div className="border-t border-[#2D2D2D] my-1"></div>
          
          <Link 
            href={getLocalizedUrl("/feedback")}
            onClick={() => setIsMobileProfileMenuOpen(false)}
            className="flex items-center px-4 py-3 hover:bg-[#2D2D2D] transition-colors"
          >
            <img src="/feedback.png" alt="Feedback" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Feedback</span>
          </Link>
          
          <button
            onClick={() => {
              setIsMobileProfileMenuOpen(false);
              fetch('/api/auth/logout', { method: 'POST' })
                .then(() => { window.location.href = '/'; })
                .catch(() => { window.location.href = '/'; });
            }}
            className="flex items-center w-full px-4 py-3 hover:bg-[#2D2D2D] transition-colors text-left"
          >
            <img src="/logout.png" alt="Logout" className="w-5 h-5 mr-3" />
            <span className="text-white text-sm font-medium">Logout</span>
          </button>
        </div>,
        document.body
      )}

      {/* Modals — lazy-loaded; Suspense gates the chunk fetch on first open */}
      {showAddStationModal && setShowAddStationModal && (
        <Suspense fallback={null}>
          <AddYourStationModal 
            isOpen={showAddStationModal} 
            onClose={() => setShowAddStationModal(false)} 
          />
        </Suspense>
      )}
    </>
  );
}