import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { 
  Radio, 
  BarChart3, 
  Podcast, 
  Tags, 
  Globe, 
  Languages, 
  RefreshCw, 
  Settings,
  Users,
  ChevronDown,
  ChevronRight,
  Music,
  FileText,
  Activity,
  MessageSquare,
  Send,
  Image,
  Search
} from "lucide-react";

interface NavigationItem {
  name: string;
  href?: string;
  icon?: any;
  children?: NavigationItem[];
}

const navigation: NavigationItem[] = [
  { name: 'Dashboard', href: '/admin/dashboard', icon: BarChart3 },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'IAP Events', href: '/admin/iap-events', icon: FileText },
  { name: 'SEO Maintenance', href: '/admin/seo-maintenance', icon: FileText },
  { 
    name: 'Settings', 
    icon: Settings,
    children: [
      { name: 'System Settings', href: '/admin/settings' },
      { name: 'Discover Genres', href: '/admin/genres' },
      { name: 'Social Media Links', href: '/admin/footer-social-media' },
    ]
  },
  { 
    name: 'Station Management', 
    icon: Podcast,
    children: [
      { name: 'All Stations', href: '/admin/stations' },
      { name: 'Station Slugs', href: '/admin/station-slugs' },
      { name: 'Duplicate Management', href: '/admin/duplicates' },
      { name: 'Performance Optimization', href: '/admin/performance' },
    ]
  },
  {
    name: 'Content Management',
    icon: Tags,
    children: [
      { name: 'Genres', href: '/admin/genres' },
      { name: 'Codecs', href: '/admin/codecs' },
    ]
  },
  {
    name: 'Radio Browser API',
    icon: RefreshCw,
    children: [
      { name: 'API Explorer', href: '/admin/radio-browser' },
      { name: 'Sync Status', href: '/admin/sync' },
    ]
  },
  {
    name: 'Analytics & Reports',
    icon: Activity,
    children: [
      { name: 'Station Analytics', href: '/admin/analytics' },
      { name: 'Status Monitoring', href: '/admin/status-monitoring' },
    ]
  },
  {
    name: 'Translations',
    icon: Globe,
    children: [
      { name: 'Translation Keys', href: '/admin/translations' },
      { name: 'Language Management', href: '/admin/translation-languages' },
    ]
  },
  {
    name: 'SEO & Search',
    icon: Search,
    children: [
      { name: 'IndexNow Monitoring', href: '/admin/indexnow' },
      { name: 'GSC URL Inspection', href: '/admin/gsc-inspection' },
      { name: 'URL Translations', href: '/admin/url-translations' },
      { name: 'Country-Language Map', href: '/admin/country-language-mappings' },
      { name: 'Genre Whitelist', href: '/admin/genre-whitelist' },
      { name: 'Genre Slug Cleanup', href: '/admin/genre-slug-cleanup' },
    ]
  },
];

interface SidebarProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

export default function Sidebar({ isMobileMenuOpen, setIsMobileMenuOpen }: SidebarProps) {
  const [location] = useLocation();
  const [expandedItems, setExpandedItems] = useState<string[]>(['Station Management']);

  const toggleExpanded = (itemName: string) => {
    setExpandedItems(prev => 
      prev.includes(itemName) 
        ? prev.filter(name => name !== itemName)
        : [...prev, itemName]
    );
  };

  const isActiveLink = (href?: string) => {
    if (!href) return false;
    return location === href || (href !== '/admin' && href !== '/' && location.startsWith(href));
  };

  const renderNavigationItem = (item: NavigationItem) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.name);
    const isActive = isActiveLink(item.href);
    const hasActiveChild = hasChildren && item.children?.some(child => isActiveLink(child.href));

    if (hasChildren) {
      return (
        <div key={item.name}>
          <button
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              'w-full group flex items-center px-2 py-2 text-sm font-medium rounded-md text-left',
              isExpanded || hasActiveChild
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {Icon && <Icon className="mr-3 w-5 h-5" />}
            <span className="flex-1">{item.name}</span>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          
          {isExpanded && (
            <div className="ml-8 mt-1 space-y-1">
              {item.children?.map((child) => (
                <Link key={child.name} href={child.href!}>
                  <span
                    className={cn(
                      'group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer',
                      isActiveLink(child.href)
                        ? 'bg-primary text-white'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
          className={cn(
            'group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer',
            isActive
              ? 'bg-primary text-white'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          )}
        >
          {Icon && <Icon className="mr-3 w-5 h-5" />}
          {item.name}
        </span>
      </Link>
    );
  };

  const handleLinkClick = () => {
    // Close mobile menu when a link is clicked
    setIsMobileMenuOpen(false);
  };

  const renderNavigationItemWithCloseHandler = (item: NavigationItem) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.includes(item.name);
    const isActive = isActiveLink(item.href);
    const hasActiveChild = hasChildren && item.children?.some(child => isActiveLink(child.href));

    if (hasChildren) {
      return (
        <div key={item.name}>
          <button
            onClick={() => toggleExpanded(item.name)}
            className={cn(
              'w-full group flex items-center px-2 py-2 text-sm font-medium rounded-md text-left',
              isExpanded || hasActiveChild
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            )}
          >
            {Icon && <Icon className="mr-3 w-5 h-5" />}
            <span className="flex-1">{item.name}</span>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          
          {isExpanded && (
            <div className="ml-8 mt-1 space-y-1">
              {item.children?.map((child) => (
                <Link key={child.name} href={child.href!}>
                  <span
                    onClick={handleLinkClick}
                    className={cn(
                      'group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer',
                      isActiveLink(child.href)
                        ? 'bg-primary text-white'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
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
          onClick={handleLinkClick}
          className={cn(
            'group flex items-center px-2 py-2 text-sm font-medium rounded-md cursor-pointer',
            isActive
              ? 'bg-primary text-white'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          )}
        >
          {Icon && <Icon className="mr-3 w-5 h-5" />}
          {item.name}
        </span>
      </Link>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-white border-r border-gray-200">
            {/* Logo/Brand */}
            <div className="flex items-center flex-shrink-0 px-4">
              <div className="flex items-center">
                <Radio className="w-8 h-8 text-primary mr-3" />
                <h1 className="text-xl font-bold text-gray-900">RadioHub Admin</h1>
              </div>
            </div>
            
            {/* Navigation */}
            <nav className="mt-8 flex-1 px-2 space-y-1">
              {navigation.map(renderNavigationItem)}
            </nav>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white transform md:hidden",
        isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
        "transition-transform duration-300 ease-in-out"
      )}>
        <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto bg-white border-r border-gray-200 h-full">
          {/* Logo/Brand */}
          <div className="flex items-center flex-shrink-0 px-4">
            <div className="flex items-center">
              <Radio className="w-8 h-8 text-primary mr-3" />
              <h1 className="text-xl font-bold text-gray-900">RadioHub Admin</h1>
            </div>
          </div>
          
          {/* Navigation */}
          <nav className="mt-8 flex-1 px-2 space-y-1">
            {navigation.map(renderNavigationItemWithCloseHandler)}
          </nav>
        </div>
      </div>
    </>
  );
}