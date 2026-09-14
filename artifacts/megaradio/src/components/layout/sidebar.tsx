import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Radio,
  BarChart3,
  Podcast,
  Tags,
  Globe,
  RefreshCw,
  Settings,
  Users,
  ChevronDown,
  ChevronRight,
  FileText,
  Activity,
  Search,
  Tv,
  Image,
  Database,
  Home,
  AlertCircle,
  MessageSquare,
  Megaphone,
  MapPin,
  Map,
  Eye,
  CreditCard,
  Key,
  X,
} from "lucide-react";

interface NavigationItem {
  name: string;
  href?: string;
  icon?: any;
  children?: NavigationItem[];
}

const navigation: NavigationItem[] = [
  { name: "Dashboard", href: "/admin/dashboard", icon: BarChart3 },
  { name: "Users", href: "/admin/users", icon: Users },

  {
    name: "Apps & Devices",
    icon: Tv,
    children: [
      { name: "TV/App Version", href: "/admin/tv-version" },
      { name: "IAP Events", href: "/admin/iap-events" },
      { name: "Sales Analytics", href: "/admin/sales" },
      { name: "Advertisements", href: "/admin/advertisements" },
    ],
  },

  {
    name: "Station Management",
    icon: Podcast,
    children: [
      { name: "All Stations", href: "/admin/stations" },
      { name: "Station Slugs", href: "/admin/station-slugs" },
      { name: "Cities", href: "/admin/cities" },
      { name: "Duplicate Management", href: "/admin/duplicates" },
      { name: "Logo Management", href: "/admin/logos" },
      { name: "Performance", href: "/admin/performance" },
    ],
  },

  {
    name: "Content Management",
    icon: Tags,
    children: [
      { name: "Genres", href: "/admin/genres" },
      { name: "Genre Whitelist", href: "/admin/genre-whitelist" },
      { name: "Genre Slug Cleanup", href: "/admin/genre-slug-cleanup" },
      { name: "Codecs", href: "/admin/codecs" },
    ],
  },

  {
    name: "Radio Browser API",
    icon: RefreshCw,
    children: [
      { name: "API Explorer", href: "/admin/radio-browser" },
      { name: "Sync Status", href: "/admin/sync" },
    ],
  },

  {
    name: "Translations",
    icon: Globe,
    children: [
      { name: "SEO Translations Hub", href: "/admin/seo-translations" },
      { name: "Translation Keys", href: "/admin/translations" },
      { name: "Language Management", href: "/admin/translation-languages" },
    ],
  },

  {
    name: "SEO & Search",
    icon: Search,
    children: [
      { name: "SEO Preview", href: "/admin/seo-preview" },
      { name: "SEO Coverage", href: "/admin/coverage" },
      { name: "SEO Maintenance", href: "/admin/seo-maintenance" },
      { name: "IndexNow Monitoring", href: "/admin/indexnow" },
      { name: "GSC URL Inspection", href: "/admin/gsc-inspection" },
      { name: "SEMrush Issues", href: "/admin/semrush" },
      { name: "URL Translations", href: "/admin/url-translations" },
      { name: "Country-Language Map", href: "/admin/country-language-mappings" },
    ],
  },

  {
    name: "Analytics & Reports",
    icon: Activity,
    children: [
      { name: "Station Analytics", href: "/admin/analytics" },
      { name: "Status Monitoring", href: "/admin/status-monitoring" },
      { name: "Error Logs", href: "/admin/error-logs" },
      { name: "iOS / CarPlay Logs", href: "/admin/app-logs" },
      { name: "Feedback", href: "/admin/feedback" },
    ],
  },

  {
    name: "Developer API",
    icon: Key,
    children: [
      { name: "API Keys & Users", href: "/admin/api-keys" },
    ],
  },

  {
    name: "Settings",
    icon: Settings,
    children: [
      { name: "System Settings", href: "/admin/settings" },
      { name: "Home Settings", href: "/admin/home-settings" },
      { name: "Social Media Links", href: "/admin/footer-social-media" },
      { name: "Database Management", href: "/admin/db-management" },
      {
        name: "Payment Gateway",
        icon: CreditCard,
        children: [
          { name: "Stripe", href: "/admin/stripe-plans" },
          { name: "Paddle", href: "/admin/paddle-plans" },
        ],
      },
    ],
  },
];

interface SidebarProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

function navigationPages(items: NavigationItem[], ancestors: string[] = []): Array<{ name: string; href: string; section: string }> {
  return items.flatMap(item => item.children
    ? navigationPages(item.children, [...ancestors, item.name])
    : item.href ? [{ name: item.name, href: item.href, section: ancestors.join(' / ') }] : []);
}
const pages = navigationPages(navigation);

// Recursively check if item or any descendant matches the active href.
function hasActiveDescendant(item: NavigationItem, isActiveFn: (href?: string) => boolean): boolean {
  if (item.href && isActiveFn(item.href)) return true;
  return item.children?.some(c => hasActiveDescendant(c, isActiveFn)) ?? false;
}

// Collect names of ALL groups that contain the active route anywhere in their subtree.
function getGroupsToAutoExpand(items: NavigationItem[], isActiveFn: (href?: string) => boolean): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.children) {
      if (hasActiveDescendant(item, isActiveFn)) {
        result.push(item.name);
        result.push(...getGroupsToAutoExpand(item.children, isActiveFn));
      }
    }
  }
  return result;
}

export default function Sidebar({ isMobileMenuOpen, setIsMobileMenuOpen }: SidebarProps) {
  const [location] = useLocation();
  const [expandedItems, setExpandedItems] = useState<string[]>(["Station Management"]);
  const [search, setSearch] = useState('');
  const mobileNavigation = useRef<HTMLDivElement>(null);
  const searchTerm = search.trim().toLocaleLowerCase();
  const matches = searchTerm ? pages.filter(page => `${page.name} ${page.section}`.toLocaleLowerCase().includes(searchTerm)) : [];

  const toggleExpanded = (itemName: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemName) ? prev.filter((n) => n !== itemName) : [...prev, itemName],
    );
  };

  const isActiveLink = useCallback((href?: string) => {
    if (!href) return false;
    const path = location.split(/[?#]/)[0];
    return path === href || path.startsWith(`${href}/`);
  }, [location]);

  // Reveal the active route when navigation changes, but respect a subsequent
  // manual collapse. Unioning active groups during every render prevented it.
  useEffect(() => {
    const autoExpand = getGroupsToAutoExpand(navigation, isActiveLink);
    setExpandedItems(previous => Array.from(new Set([...previous, ...autoExpand])));
  }, [isActiveLink]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const desktopMedia = window.matchMedia?.('(min-width: 768px)');
    if (desktopMedia?.matches) { setIsMobileMenuOpen(false); return; }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = mobileNavigation.current;
    const controls = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? []);
    controls()[0]?.focus();
    const closeOnDesktop = () => { if (desktopMedia?.matches) setIsMobileMenuOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => {
      // The panel is display:none above md; release Tab even before React
      // applies the state update from the breakpoint change.
      if (desktopMedia?.matches) return;
      if (event.key === 'Escape') { event.preventDefault(); setIsMobileMenuOpen(false); }
      if (event.key === 'Tab') {
        const items = controls();
        const first = items[0]; const last = items[items.length - 1];
        if (!first || !last) return;
        if (!panel?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    desktopMedia?.addEventListener('change', closeOnDesktop);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      desktopMedia?.removeEventListener('change', closeOnDesktop);
      document.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus();
    };
  }, [isMobileMenuOpen, setIsMobileMenuOpen]);

  // Render an item at a given nesting depth (0 = top-level group, 1 = inside group, 2 = inside sub-group).
  const renderItem = (item: NavigationItem, depth: number, onLinkClick?: () => void): React.ReactNode => {
    const Icon = item.icon;
    const hasChildren = !!item.children?.length;
    const isExpanded = expandedItems.includes(item.name);
    const isActive = isActiveLink(item.href);
    const hasActiveChild = hasActiveDescendant(item, isActiveLink);

    if (hasChildren) {
      const isSubGroup = depth >= 1; // "Payment Gateway" style sub-group

      return (
        <div key={item.name}>
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              "w-full group flex items-center text-sm font-medium rounded-md text-left transition-colors",
              isSubGroup
                ? "min-h-[40px] px-2 py-2"
                : "min-h-[48px] px-2 py-3",
              isExpanded || hasActiveChild
                ? "bg-gray-100 text-gray-900"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
            )}
          >
            {Icon && depth === 0 && <Icon className="mr-3 w-5 h-5 shrink-0" />}
            {Icon && depth >= 1 && <Icon className="mr-2 w-4 h-4 shrink-0 opacity-70" />}
            <span className="flex-1">{item.name}</span>
            {isExpanded
              ? <ChevronDown className="w-4 h-4 shrink-0" />
              : <ChevronRight className="w-4 h-4 shrink-0" />}
          </button>

          {isExpanded && (
            <div className={cn("mt-1 space-y-1", depth === 0 ? "ml-8" : "ml-4")}>
              {item.children!.map(child => renderItem(child, depth + 1, onLinkClick))}
            </div>
          )}
        </div>
      );
    }

    // Leaf link
    return (
      <Link key={item.name} href={item.href!} aria-current={isActive ? 'page' : undefined} onClick={onLinkClick}>
        <span
          className={cn(
            "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium cursor-pointer transition-all",
            depth === 1 ? "min-h-[42px]" : "min-h-[38px]",
            isActive
              ? "bg-primary text-white shadow-sm shadow-primary/30"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
          )}
        >
          {Icon && <Icon className={cn("w-4 h-4 shrink-0", isActive ? "opacity-100" : "opacity-60")} />}
          <span className="truncate">{item.name}</span>
        </span>
      </Link>
    );
  };

  const renderNavContent = (onLinkClick?: () => void) => (
    <>
      <div className="flex items-center flex-shrink-0 px-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 mr-3">
          <Radio className="w-5 h-5 text-primary" />
        </span>
        <div className="leading-tight">
          <p className="text-base font-bold text-gray-900">RadioHub</p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">Admin</p>
        </div>
      </div>
      <div role="search" aria-label="Find an admin page" className="relative mx-3 mt-5">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" />
        <input type="search" aria-label="Find admin page" placeholder="Find admin page…" value={search}
          onChange={event => setSearch(event.target.value)}
          className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-9 text-sm text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        {search && <button type="button" aria-label="Clear page search" onClick={() => setSearch('')}
          className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:bg-gray-200"><X className="h-4 w-4" /></button>}
      </div>
      <nav aria-label="Admin pages" className="mt-3 flex-1 px-3 space-y-1 overflow-y-auto">
        {searchTerm ? matches.length ? matches.map(page => (
          <Link key={page.href} href={page.href} aria-current={isActiveLink(page.href) ? 'page' : undefined}
            onClick={() => { setSearch(''); onLinkClick?.(); }}
            className="block rounded-lg px-3 py-2 text-sm text-gray-900 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <span className="block font-medium">{page.name}</span>
            {page.section && <span className="block text-xs text-gray-500">{page.section}</span>}
          </Link>
        )) : <p role="status" className="px-3 py-4 text-sm text-gray-500">No admin pages match “{search.trim()}”.</p>
          : navigation.map((item) => renderItem(item, 0, onLinkClick))}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-white border-r border-gray-200">
            {renderNavContent()}
          </div>
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div
        ref={mobileNavigation}
        id="admin-mobile-navigation"
        role={isMobileMenuOpen ? 'dialog' : undefined}
        aria-modal={isMobileMenuOpen || undefined}
        aria-label="Admin navigation"
        aria-hidden={!isMobileMenuOpen}
        inert={!isMobileMenuOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-white transform md:hidden",
          isMobileMenuOpen ? "translate-x-0 visible" : "-translate-x-full invisible pointer-events-none",
          "transition-transform duration-300 ease-in-out",
        )}
      >
        <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-white border-r border-gray-200 h-full">
          <button type="button" onClick={() => setIsMobileMenuOpen(false)} aria-label="Close admin navigation"
            className="absolute right-2 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"><X className="h-5 w-5" /></button>
          {renderNavContent(() => setIsMobileMenuOpen(false))}
        </div>
      </div>
    </>
  );
}
