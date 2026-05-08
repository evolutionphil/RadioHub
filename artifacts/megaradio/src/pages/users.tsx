import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { 
  Users as UsersIcon, 
  Mail, 
  Globe, 
  Heart, 
  Calendar, 
  Activity, 
  Edit3, 
  MoreHorizontal,
  TrendingUp,
  MapPin,
  Clock,
  Music,
  Headphones,
  UserCheck,
  UserX,
  Shield,
  Crown,
  Star,
  Eye,
  Filter,
  Download,
  BarChart3
} from "lucide-react";

interface User {
  _id: string;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  profileImageUrl?: string;
  avatar?: string;
  country?: string;
  language?: string;
  bio?: string;
  favoriteStations?: any[];
  recentlyPlayedStations?: any[];
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  lastLogin?: string;
  lastActive?: string;
  role?: 'admin' | 'moderator' | 'user';
  status?: 'active' | 'inactive' | 'suspended' | 'pending';
  emailVerified?: boolean;
  permissions?: {
    canManageStations?: boolean;
    canModerate?: boolean;
    canViewAnalytics?: boolean;
  };
  preferences?: {
    theme?: 'light' | 'dark';
    language?: string;
    autoplay?: boolean;
    volume?: number;
    notifications?: boolean;
  };
  // Enhanced social features
  following?: string[];
  followers?: string[];
  followersCount: number;
  followingCount: number;
  favoriteStationsCount: number;
  totalListeningTime: number;
  stationsCreated?: string[];
  stationsCreatedCount: number;
  stats?: {
    totalPlays: number;
    totalListeningHours: number;
    favoriteGenres?: string[];
    mostPlayedStation?: string;
    joinDate: string;
    lastActiveDate: string;
    streakDays: number;
    totalListeningTime?: number;
    stationsDiscovered?: number;
    averageSessionLength?: number;
  };
  location?: {
    city?: string;
    region?: string;
    ip?: string;
  };
}

interface UserStats {
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  topCountries: Array<{ country: string; count: number }>;
  topLanguages: Array<{ language: string; count: number }>;
  usersByRole: Array<{ role: string; count: number }>;
  usersByStatus: Array<{ status: string; count: number }>;
  recentRegistrations?: number;
  activePercentage?: number;
}

interface UserActivity {
  userId: string;
  type: 'login' | 'station_play' | 'favorite_add' | 'profile_update';
  description: string;
  timestamp: string;
  metadata?: any;
}

export default function Users() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch user statistics
  const { data: userStats } = useQuery<UserStats>({
    queryKey: ['/api/users/stats'],
    queryFn: async () => {
      const response = await fetch('/api/users/stats');
      if (!response.ok) throw new Error('Failed to fetch user stats');
      return response.json();
    },
  });

  // Fetch users with filters
  const { data: usersData, isLoading } = useQuery<{ users: User[], total: number }>({
    queryKey: ['/api/users', searchQuery, statusFilter, roleFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (roleFilter !== 'all') params.append('role', roleFilter);
      
      const response = await fetch(`/api/users?${params}`);
      if (!response.ok) throw new Error('Failed to fetch users');
      return response.json();
    },
  });

  // Fetch recent user activity
  const { data: recentActivity } = useQuery<UserActivity[]>({
    queryKey: ['/api/users/activity'],
    queryFn: async () => {
      const response = await fetch('/api/users/activity?limit=10');
      if (!response.ok) throw new Error('Failed to fetch user activity');
      return response.json();
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: Partial<User> }) => {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error('Failed to update user');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users/stats'] });
      toast({ title: "Success", description: "User updated successfully" });
      setIsUserDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  const users = usersData?.users || [];
  const total = usersData?.total || 0;

  const handleUserUpdate = (updates: Partial<User>) => {
    if (selectedUser) {
      updateUserMutation.mutate({ userId: selectedUser._id, updates });
    }
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'login': return <UserCheck className="w-4 h-4 text-green-500" />;
      case 'station_play': return <Headphones className="w-4 h-4 text-blue-500" />;
      case 'favorite_add': return <Heart className="w-4 h-4 text-red-500" />;
      case 'profile_update': return <Edit3 className="w-4 h-4 text-orange-500" />;
      default: return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge variant="destructive" className="flex items-center gap-1"><Crown className="w-3 h-3" /> Admin</Badge>;
      case 'moderator':
        return <Badge variant="default" className="flex items-center gap-1"><Shield className="w-3 h-3" /> Moderator</Badge>;
      default:
        return <Badge variant="secondary" className="flex items-center gap-1"><UsersIcon className="w-3 h-3" /> User</Badge>;
    }
  };

  const getStatusBadge = (status: string, isVerified?: boolean) => {
    const verified = isVerified ? <span className="ml-1" title="Email Verified">✓</span> : null;
    switch (status) {
      case 'active':
        return <Badge variant="default" className="text-green-700 bg-green-100">{status}{verified}</Badge>;
      case 'inactive':
        return <Badge variant="secondary">{status}{verified}</Badge>;
      case 'suspended':
        return <Badge variant="destructive">{status}{verified}</Badge>;
      case 'pending':
        return <Badge variant="outline">{status}{verified}</Badge>;
      default:
        return <Badge variant="default">active{verified}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600">Comprehensive user account and activity management - {total} total users</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export Users
          </Button>
          <Button size="sm">
            <UsersIcon className="w-4 h-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      {userStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <UsersIcon className="w-8 h-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Users</p>
                  <p className="text-2xl font-bold">{userStats.totalUsers.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Activity className="w-8 h-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Active Users</p>
                  <p className="text-2xl font-bold">{userStats.activeUsers.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Last 7 days</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <TrendingUp className="w-8 h-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">New This Week</p>
                  <p className="text-2xl font-bold">{userStats.recentRegistrations?.toLocaleString() || 0}</p>
                  <p className="text-xs text-gray-500">Recent registrations</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <BarChart3 className="w-8 h-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Active Rate</p>
                  <p className="text-2xl font-bold">{userStats.activePercentage || 0}%</p>
                  <p className="text-xs text-gray-500">Active users</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="users">User Directory</TabsTrigger>
          <TabsTrigger value="analytics">Analytics & Insights</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
        </TabsList>

        {/* Users Directory Tab */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                <CardTitle className="flex items-center">
                  <UsersIcon className="w-5 h-5 mr-2" />
                  All Users ({total})
                </CardTitle>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <Input
                    placeholder="Search users by name, email, or username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full sm:w-72"
                  />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-full sm:w-40">
                      <SelectValue placeholder="Filter by role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User Profile</TableHead>
                      <TableHead>Contact & Location</TableHead>
                      <TableHead>Role & Status</TableHead>
                      <TableHead>Activity Stats</TableHead>
                      <TableHead>Listening Data</TableHead>
                      <TableHead>Joined Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user: User) => (
                      <TableRow key={user._id} className="hover:bg-gray-50">
                        <TableCell>
                          <div className="flex items-center space-x-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={user.profileImageUrl} />
                              <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-600 text-white">
                                {(user.fullName || user.firstName || user.username || user.email)?.charAt(0)?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium text-gray-900">
                                {user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Anonymous User'}
                              </div>
                              <div className="text-sm text-gray-500 flex items-center gap-1">
                                @{user.username || user.email?.split('@')[0]}
                                {user.emailVerified && <span className="text-green-600" title="Verified">✓</span>}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center space-x-1 text-sm">
                              <Mail className="w-4 h-4 text-gray-400" />
                              <span className="truncate max-w-48">{user.email}</span>
                            </div>
                            <div className="flex items-center space-x-1 text-sm text-gray-500">
                              <MapPin className="w-4 h-4 text-gray-400" />
                              <span>{user.country || user.location?.city || 'Unknown'}</span>
                              <Globe className="w-4 h-4 text-gray-400 ml-2" />
                              <span>{user.language || user.preferences?.language || 'en'}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            {getRoleBadge(user.role || 'user')}
                            {getStatusBadge(user.status || 'active', user.emailVerified)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center space-x-1">
                              <Clock className="w-4 h-4 text-gray-400" />
                              <span>Last: {user.lastActive ? new Date(user.lastActive).toLocaleDateString() : 'Never'}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Activity className="w-4 h-4 text-gray-400" />
                              <span>{user.stats?.totalListeningTime ? formatDuration(user.stats.totalListeningTime) : '0m'} total</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center space-x-1">
                              <Heart className="w-4 h-4 text-red-400" />
                              <span>{user.favoriteStations?.length || 0} favorites</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Music className="w-4 h-4 text-blue-400" />
                              <span>{user.stats?.stationsDiscovered || 0} discovered</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-1 text-sm">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span>{new Date(user.createdAt).toLocaleDateString()}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedUser(user);
                                setIsUserDialogOpen(true);
                              }}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {users.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <div className="flex flex-col items-center space-y-2">
                            <UsersIcon className="w-12 h-12 text-gray-400" />
                            <p className="text-gray-500">No users found matching your criteria.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User Distribution by Role */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Shield className="w-5 h-5 mr-2" />
                  User Distribution by Role
                </CardTitle>
              </CardHeader>
              <CardContent>
                {userStats?.usersByRole.map((item, index) => (
                  <div key={item.role} className="flex items-center justify-between py-2">
                    <div className="flex items-center space-x-2">
                      {getRoleBadge(item.role)}
                      <span className="capitalize">{item.role}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Progress value={(item.count / userStats.totalUsers) * 100} className="w-20" />
                      <span className="text-sm font-medium">{item.count}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Top Countries */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Globe className="w-5 h-5 mr-2" />
                  Top User Countries
                </CardTitle>
              </CardHeader>
              <CardContent>
                {userStats?.topCountries.slice(0, 5).map((item, index) => (
                  <div key={item.country} className="flex items-center justify-between py-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-2xl">{index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🌍'}</span>
                      <span>{item.country}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Progress value={(item.count / userStats.totalUsers) * 100} className="w-20" />
                      <span className="text-sm font-medium">{item.count}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* User Status Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Activity className="w-5 h-5 mr-2" />
                  User Status Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                {userStats?.usersByStatus.map((item) => (
                  <div key={item.status} className="flex items-center justify-between py-2">
                    <div className="flex items-center space-x-2">
                      {getStatusBadge(item.status)}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Progress value={(item.count / userStats.totalUsers) * 100} className="w-20" />
                      <span className="text-sm font-medium">{item.count}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Language Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Globe className="w-5 h-5 mr-2" />
                  Language Preferences
                </CardTitle>
              </CardHeader>
              <CardContent>
                {userStats?.topLanguages.slice(0, 5).map((item) => (
                  <div key={item.language} className="flex items-center justify-between py-2">
                    <div className="flex items-center space-x-2">
                      <span className="uppercase text-sm font-mono bg-gray-100 px-2 py-1 rounded">{item.language}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Progress value={(item.count / userStats.totalUsers) * 100} className="w-20" />
                      <span className="text-sm font-medium">{item.count}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Activity className="w-5 h-5 mr-2" />
                Recent User Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentActivity?.map((activity, index) => (
                  <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                    {getActivityIcon(activity.type)}
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">{activity.description}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
                {(!recentActivity || recentActivity.length === 0) && (
                  <div className="text-center py-8">
                    <Activity className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-500">No recent user activity found.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* User Details Dialog */}
      <Dialog open={isUserDialogOpen} onOpenChange={setIsUserDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User Details & Management</DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-6">
              {/* User Profile Section */}
              <div className="flex items-start space-x-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={selectedUser.profileImageUrl} />
                  <AvatarFallback className="bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xl">
                    {(selectedUser.fullName || selectedUser.firstName || selectedUser.username || selectedUser.email)?.charAt(0)?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold">
                    {selectedUser.fullName || `${selectedUser.firstName || ''} ${selectedUser.lastName || ''}`.trim() || selectedUser.username || 'Anonymous User'}
                  </h3>
                  <p className="text-gray-600">{selectedUser.email}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {getRoleBadge(selectedUser.role || 'user')}
                    {getStatusBadge(selectedUser.status || 'active', selectedUser.emailVerified)}
                  </div>
                </div>
              </div>

              {/* User Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                  <Heart className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-blue-900">{selectedUser.favoriteStationsCount || selectedUser.favoriteStations?.length || 0}</p>
                  <p className="text-sm text-blue-700">Favorites</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg text-center">
                  <Headphones className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-green-900">{selectedUser.totalListeningTime ? `${Math.round(selectedUser.totalListeningTime)}h` : '0h'}</p>
                  <p className="text-sm text-green-700">Listening Time</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg text-center">
                  <Music className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-purple-900">{selectedUser.stationsCreatedCount || 0}</p>
                  <p className="text-sm text-purple-700">Stations Created</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg text-center">
                  <UsersIcon className="w-8 h-8 text-orange-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-orange-900">{selectedUser.followersCount || 0}</p>
                  <p className="text-sm text-orange-700">Followers</p>
                </div>
              </div>

              {/* Social Stats */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="bg-indigo-50 p-3 rounded-lg text-center">
                  <TrendingUp className="w-6 h-6 text-indigo-600 mx-auto mb-1" />
                  <p className="text-lg font-bold text-indigo-900">{selectedUser.followingCount || 0}</p>
                  <p className="text-xs text-indigo-700">Following</p>
                </div>
                <div className="bg-rose-50 p-3 rounded-lg text-center">
                  <Star className="w-6 h-6 text-rose-600 mx-auto mb-1" />
                  <p className="text-lg font-bold text-rose-900">{selectedUser.stats?.totalPlays || 0}</p>
                  <p className="text-xs text-rose-700">Total Plays</p>
                </div>
              </div>

              {/* User Bio and Details */}
              {selectedUser.bio && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-2">Bio</h4>
                  <p className="text-gray-700">{selectedUser.bio}</p>
                </div>
              )}

              {/* User Management Actions */}
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => handleUserUpdate({ status: selectedUser.status === 'active' ? 'inactive' : 'active' })}
                  disabled={updateUserMutation.isPending}
                >
                  {selectedUser.status === 'active' ? <UserX className="w-4 h-4 mr-2" /> : <UserCheck className="w-4 h-4 mr-2" />}
                  {selectedUser.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleUserUpdate({ role: selectedUser.role === 'admin' ? 'user' : 'admin' })}
                  disabled={updateUserMutation.isPending}
                >
                  <Crown className="w-4 h-4 mr-2" />
                  {selectedUser.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                </Button>
                <Button variant="outline" disabled={updateUserMutation.isPending}>
                  <Mail className="w-4 h-4 mr-2" />
                  Send Email
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
