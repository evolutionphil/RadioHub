import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, Edit2, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getAvatarUrl } from "@/lib/utils";

interface UserSubscription {
  plan: 'free' | 'premium' | 'pro';
  platform: 'ios' | 'android' | 'web' | 'admin';
  productId?: string;
  transactionId?: string;
  expiresAt?: string;
  startedAt?: string;
  isTrial?: boolean;
  isActive: boolean;
  cancelledAt?: string;
}

interface UserProfile {
  _id: string;
  email: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  profilePicture?: string;
  authProvider?: string;
  googleId?: string;
  followers?: number;
  favorites?: number;
  subscription?: UserSubscription | null;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
}

export default function AdminUsers() {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  const { toast } = useToast();

  const { data: usersResponse, isLoading: isLoadingUsers, error: usersError } = useQuery<{ users: UserProfile[]; total: number }>({
    queryKey: ["/api/admin/users"],
    staleTime: 30000,
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    retry: 2,
  });
  const users = usersResponse?.users || [];

  const filteredUsers = users.filter((user) =>
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.firstName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (user.lastName?.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const updateUserMutation = useMutation({
    mutationFn: (data: { userId: string; updates: Partial<UserProfile> }) =>
      apiRequest("PATCH", `/api/admin/users/${data.userId}`, {
        body: data.updates,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Success", description: "User updated successfully" });
      setEditingUserId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update user", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("DELETE", `/api/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Success", description: "User deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete user", variant: "destructive" });
    },
  });

  const handleSaveEdit = (userId: string) => {
    updateUserMutation.mutate({ userId, updates: editData });
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const getSubscriptionBadge = (sub?: UserSubscription | null) => {
    if (!sub || !sub.isActive || sub.plan === 'free') return null;
    const colors: Record<string, string> = {
      premium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      pro: "bg-purple-100 text-purple-800 border-purple-300",
    };
    const icons: Record<string, string> = { premium: "⭐", pro: "💎" };
    return (
      <Badge className={`${colors[sub.plan] || ''} border text-xs`}>
        {icons[sub.plan] || ''} {sub.plan.toUpperCase()}
        {sub.isTrial && " (Trial)"}
      </Badge>
    );
  };

  const getAuthMethodBadge = (authProvider?: string) => {
    const provider = authProvider || "Email";
    const variants: Record<string, string> = {
      "google": "bg-blue-100 text-blue-800",
      "facebook": "bg-purple-100 text-purple-800",
      "apple": "bg-gray-100 text-gray-800",
      "email": "bg-green-100 text-green-800",
    };
    return variants[provider.toLowerCase()] || "bg-gray-100 text-gray-800";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users Management</h1>
        <p className="text-gray-600 mt-2">View and manage all registered users</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Users</CardTitle>
          <CardDescription>Search by email, first name, or last name</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-400" size={20} />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Users ({filteredUsers.length})</CardTitle>
          <CardDescription>Manage user profiles, data, and permissions</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingUsers ? (
            <div className="flex justify-center py-8">
              <Loader2 className="animate-spin" size={32} />
            </div>
          ) : usersError ? (
            <div className="text-center py-8">
              <p className="text-red-600 font-medium mb-2">Failed to load users</p>
              <p className="text-gray-500 text-sm">{(usersError as Error).message}</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No users found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="font-bold">Name</TableHead>
                    <TableHead className="font-bold">Email</TableHead>
                    <TableHead className="font-bold text-center">Followers</TableHead>
                    <TableHead className="font-bold">Auth Method</TableHead>
                    <TableHead className="font-bold text-center">Plan</TableHead>
                    <TableHead className="font-bold text-center">Favorites</TableHead>
                    <TableHead className="font-bold">Created</TableHead>
                    <TableHead className="font-bold">Last Update</TableHead>
                    <TableHead className="font-bold">User ID</TableHead>
                    <TableHead className="font-bold text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user._id} className="hover:bg-gray-50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <img
                            src={getAvatarUrl(user)}
                            alt={user.fullName || `${user.firstName} ${user.lastName}`}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                          <span className="font-medium">
                            {user.fullName || `${user.firstName} ${user.lastName}`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{user.followers || 0}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getAuthMethodBadge(user.authProvider)}>
                          {user.authProvider || "Email"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {getSubscriptionBadge(user.subscription) || (
                          <span className="text-gray-400 text-xs">Free</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{user.favorites || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(user.createdAt)}</TableCell>
                      <TableCell className="text-sm">{formatDate(user.updatedAt)}</TableCell>
                      <TableCell className="text-xs text-gray-500 font-mono">
                        {user._id.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex gap-2 justify-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingUserId(user._id);
                              setEditData(user);
                            }}
                            title="Edit user"
                          >
                            <Edit2 size={16} />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Are you sure you want to delete ${user.firstName} ${user.lastName}?`
                                )
                              ) {
                                deleteUserMutation.mutate(user._id);
                              }
                            }}
                            title="Delete user"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editingUserId && (() => {
        const editUser = users.find(u => u._id === editingUserId);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditingUserId(null)}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="bg-white border-b px-6 py-4 rounded-t-lg">
                <h2 className="text-xl font-bold text-gray-900">Edit User Information</h2>
                <p className="text-sm text-gray-500 mt-1">User ID: {editingUserId}</p>
              </div>
              <div className="bg-white px-6 py-5 space-y-5">
                <div className="flex items-center gap-4 pb-4 border-b border-gray-200">
                  <img
                    src={getAvatarUrl(editUser || editData as UserProfile)}
                    alt="Avatar"
                    className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">{editData.fullName || "No name"}</p>
                    <p className="text-sm text-gray-500">{editData.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <Input
                      value={editData.fullName || ""}
                      onChange={(e) => setEditData({ ...editData, fullName: e.target.value })}
                      placeholder="Full name"
                      className="bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <Input
                      value={editData.email || ""}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      placeholder="Email"
                      type="email"
                      className="bg-white text-gray-900 border-gray-300"
                    />
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">User Details</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Auth Method</span>
                      <p className="font-medium text-gray-900">{editUser?.authProvider || "email"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Status</span>
                      <p className="font-medium">
                        <span className={editUser?.isActive !== false ? "text-green-600" : "text-red-600"}>
                          {editUser?.isActive !== false ? "Active" : "Inactive"}
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Followers</span>
                      <p className="font-medium text-gray-900">{editUser?.followers || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Favorites</span>
                      <p className="font-medium text-gray-900">{editUser?.favorites || 0}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Created</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.createdAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Update</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.updatedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Subscription</span>
                      <p className="font-medium">
                        {getSubscriptionBadge(editUser?.subscription) || (
                          <span className="text-gray-400">Free</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Platform</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.platform || "-"}</p>
                    </div>
                    {editUser?.subscription?.expiresAt && (
                      <div>
                        <span className="text-gray-500">Expires</span>
                        <p className="font-medium text-gray-900">{formatDate(editUser.subscription.expiresAt)}</p>
                      </div>
                    )}
                    {editUser?.googleId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Google ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs">{editUser.googleId}</p>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-gray-500">User ID</span>
                      <p className="font-medium text-gray-900 font-mono text-xs">{editingUserId}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => setEditingUserId(null)}
                    disabled={updateUserMutation.isPending}
                    className="bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleSaveEdit(editingUserId)}
                    disabled={updateUserMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {updateUserMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 animate-spin" size={16} />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
