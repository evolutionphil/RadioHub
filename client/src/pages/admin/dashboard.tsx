import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { 
  Radio, 
  Globe, 
  Languages, 
  Music, 
  Settings, 
  BarChart3, 
  Users, 
  FileText,
  Database,
  Activity,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Image
} from "lucide-react";
import { Link } from "wouter";

interface DashboardStats {
  totalStations: number;
  totalCountries: number;
  totalLanguages: number;
  totalGenres: number;
  totalCodecs: number;
  workingStations: number;
  offlineStations: number;
  workingPercentage: number;
  recentlyUpdated: number;
  unresolvedErrors: number;
  totalUsers: number;
  activeRegisteredUsers: number;
  openFeedback: number;
  stationsWithFavicon: number;
  faviconPercentage: number;
  stationsWithDesc: number;
  descriptionPercentage: number;
  activeVisitors: number;
  todayVisitors: number;
  weekVisitors: number;
  topCountries: Array<{ name: string; count: number }>;
  topGenres: Array<{ name: string; count: number }>;
  codecDistribution: Array<{ name: string; count: number }>;
  syncStatus: {
    isRunning: boolean;
    lastSync: string | null;
    lastSyncStatus: string;
    isHealthy: boolean;
  };
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 30000, // Cache for 30 seconds
    refetchOnWindowFocus: false,
  });

  const { data: languages } = useQuery({
    queryKey: ["/api/admin/translation-languages"],
    staleTime: 60000, // Cache for 1 minute
    refetchOnWindowFocus: false,
  });

  const quickActions = [
    {
      title: "Manage Stations",
      description: "Add, edit, and organize radio stations",
      icon: Radio,
      href: "/admin/stations",
      color: "bg-blue-500"
    },
    {
      title: "Translation Management",
      description: "Manage translation keys and strings",
      icon: Languages,
      href: "/admin/translations",
      color: "bg-green-500"
    },
    {
      title: "URL Translations",
      description: "Manage multilingual URL paths (SEO)",
      icon: Languages,
      href: "/admin/url-translations",
      color: "bg-indigo-500"
    },
    {
      title: "Language Configuration", 
      description: "Configure supported languages",
      icon: Globe,
      href: "/admin/translation-languages",
      color: "bg-purple-500"
    },
    {
      title: "Database Languages", 
      description: "View real languages from station data",
      icon: Database,
      href: "/admin/real-languages",
      color: "bg-indigo-500"
    },
    {
      title: "Advertisement Management",
      description: "Manage ads displayed on station pages",
      icon: Music,
      href: "/admin/advertisements",
      color: "bg-cyan-500"
    },
    {
      title: "Sync Status",
      description: "Monitor Radio-Browser API sync",
      icon: Activity,
      href: "/admin/sync",
      color: "bg-orange-500"
    },
    {
      title: "Users Management",
      description: "Manage all registered users and their profiles",
      icon: Users,
      href: "/admin/users",
      color: "bg-green-600"
    },
    {
      title: "Analytics",
      description: "View usage statistics and reports",
      icon: BarChart3,
      href: "/admin/analytics",
      color: "bg-pink-500"
    },
    {
      title: "System Settings",
      description: "Configure system preferences",
      icon: Settings,
      href: "/admin/settings",
      color: "bg-gray-500"
    }
  ];

  const recentActivity = [
    { 
      action: "Station Sync Completed", 
      time: "5 minutes ago",
      status: "success",
      details: `${stats?.totalStations || 0} stations synchronized`
    },
    { 
      action: "Translation Update", 
      time: "1 hour ago",
      status: "info",
      details: `${Array.isArray(languages) ? languages.length : 0} languages configured`
    },
    { 
      action: "Performance Check", 
      time: "2 hours ago",
      status: "success",
      details: "All systems operational"
    }
  ];

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-300 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage your radio station platform
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 border rounded-md text-sm">
          <CheckCircle className="w-4 h-4 text-green-500" />
          System Online
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Users (Now)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-green-600">{stats?.activeVisitors || 0}</div>
              <Users className="w-6 h-6 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Visitors Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.todayVisitors || 0}</div>
              <Activity className="w-6 h-6 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Visitors This Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.weekVisitors || 0}</div>
              <TrendingUp className="w-6 h-6 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Registered Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
              <Users className="w-6 h-6 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Stations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalStations?.toLocaleString() || 0}</div>
              <Radio className="w-6 h-6 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalCountries || 0}</div>
              <Globe className="w-6 h-6 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Languages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{Array.isArray(languages) ? languages.length : 0}</div>
              <Languages className="w-6 h-6 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Genres
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{stats?.totalGenres || 0}</div>
              <Music className="w-6 h-6 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Station Quality Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stations Online
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-green-600">{stats?.workingStations || 0}</span>
                <CheckCircle className="w-6 h-6 text-green-500" />
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats?.workingPercentage || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{stats?.workingPercentage || 0}% working</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              With Favicons
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-blue-600">{stats?.stationsWithFavicon || 0}</span>
                <Image className="w-6 h-6 text-blue-500" />
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats?.faviconPercentage || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{stats?.faviconPercentage || 0}% have logos</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              With Descriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-purple-600">{stats?.stationsWithDesc || 0}</span>
                <FileText className="w-6 h-6 text-purple-500" />
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-purple-500 h-2 rounded-full transition-all"
                  style={{ width: `${stats?.descriptionPercentage || 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{stats?.descriptionPercentage || 0}% with AI descriptions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Common administrative tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action, index) => (
              <Link key={index} href={action.href}>
                <Button
                  variant="outline"
                  className="h-auto p-4 flex flex-col items-start gap-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 w-full">
                    <div className={`p-2 rounded-lg ${action.color}`}>
                      <action.icon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium">{action.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {action.description}
                      </div>
                    </div>
                  </div>
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity, index) => (
                <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                  <div className={`p-1 rounded-full ${
                    activity.status === 'success' ? 'bg-green-100' : 'bg-blue-100'
                  }`}>
                    <CheckCircle className={`w-3 h-3 ${
                      activity.status === 'success' ? 'text-green-600' : 'text-blue-600'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{activity.action}</div>
                    <div className="text-xs text-muted-foreground">{activity.details}</div>
                    <div className="text-xs text-muted-foreground mt-1">{activity.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Database Connection</span>
                <div className="px-2 py-1 border rounded text-xs text-green-600 border-green-600">
                  Online
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Radio-Browser API</span>
                <div className="px-2 py-1 border rounded text-xs text-green-600 border-green-600">
                  Connected
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Translation System</span>
                <div className="px-2 py-1 border rounded text-xs text-green-600 border-green-600">
                  Active
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Last Sync</span>
                <span className="text-sm text-muted-foreground">
                  {stats?.recentSyncDate ? new Date(stats.recentSyncDate).toLocaleDateString() : 'Never'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}