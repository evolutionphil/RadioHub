import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useState } from "react";
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
      { name: "Feedback", href: "/admin/feedback" },
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
    ],
  },
];

interface SidebarProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

export default function Sidebar({ isMobileMenuOpen, setIsMobileMenuOpen }: SidebarProps) {
  const [location] = useLocation();
  const [expandedItems, setExpandedItems] = useState<string[]>(["Station Management"]);

  const toggleExpanded = (itemName: string) => {
    setExpandedItems((prev) =>
      prev.includes(itemName) ? prev.filter((n) => n !== itemName) : [...prev, itemName],
    );
  };

  const isActiveLink = (href?: string) => {
    if (!href) return false;
    return location === href || (href !== "/admin" && href !== "/" && location.startsWith(href));
  };

  // Auto-expand the group containing the active route on first render.
  // (useState initializer runs once, so this is safe.)
  const activeGroupName = navigation.find(
    (item) => item.children?.some((c) => isActiveLink(c.href)),
  )?.name;

  // Ensure the active group is always expanded (merge with initialState).
  const effectiveExpanded = activeGroupName && !expandedItems.includes(activeGroupName)
    ? [...expandedItems, activeGroupName]
    : expandedItems;

  const renderItem = (item: NavigationItem, onLinkClick?: () => void) => {
    const Icon = item.icon;
    const hasChildren = !!item.children?.length;
    const isExpanded = effectiveExpanded.includes(item.name);
    const isActive = isActiveLink(item.href);
    const hasActiveChild = hasChildren && item.children!.some((c) => isActiveLink(c.href));

    if (hasChildren) {
      return (
        <div key={item.name}>
          <button
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              "w-full group flex items-center min-h-[48px] px-2 py-3 text-sm font-medium rounded-md text-left",
              isExpanded || hasActiveChild
                ? "bg-gray-100 text-gray-900"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
            )}
          >
            {Icon && <Icon className="mr-3 w-5 h-5 shrink-0" />}
            <span className="flex-1">{item.name}</span>
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {isExpanded && (
            <div className="ml-8 mt-1 space-y-1">
              {item.children!.map((child) => (
                <Link key={child.name} href={child.href!}>
                  <span
                    onClick={onLinkClick}
                    className={cn(
                      "group flex items-center min-h-[44px] px-2 py-2 text-sm font-medium rounded-md cursor-pointer",
                      isActiveLink(child.href)
                        ? "bg-primary text-white"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                    )}
                  >
                    {child.name}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link key={item.name} href={item.href!}>
        <span
          onClick={onLinkClick}
          className={cn(
            "group flex items-center min-h-[48px] px-2 py-3 text-sm font-medium rounded-md cursor-pointer",
            isActive
              ? "bg-primary text-white"
              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
          )}
        >
          {Icon && <Icon className="mr-3 w-5 h-5 shrink-0" />}
          {item.name}
        </span>
      </Link>
    );
  };

  const NavContent = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <>
      <div className="flex items-center flex-shrink-0 px-4">
        <Radio className="w-8 h-8 text-primary mr-3" />
        <h1 className="text-xl font-bold text-gray-900">RadioHub Admin</h1>
      </div>
      <nav className="mt-8 flex-1 px-2 space-y-1 overflow-y-auto">
        {navigation.map((item) => renderItem(item, onLinkClick))}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-white border-r border-gray-200">
            <NavContent />
          </div>
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-white transform md:hidden",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          "transition-transform duration-300 ease-in-out",
        )}
      >
        <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-white border-r border-gray-200 h-full">
          <NavContent onLinkClick={() => setIsMobileMenuOpen(false)} />
        </div>
      </div>
    </>
  );
}
