import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAdminViewPrefs } from "@/hooks/useAdminViewPrefs";
import { ResetViewButton } from "@/components/admin/ResetViewButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Search, Edit2, Trash2, Crown, Ban } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getAvatarUrl } from "@/lib/utils";

interface UserSubscription {
  plan: 'none' | 'remove_ads' | 'premium_monthly' | 'premium_yearly' | 'premium_lifetime';
  platform: 'ios' | 'android' | 'tvos' | 'macos' | 'web' | 'admin';
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  expiresAt?: string | null;
  startedAt?: string;
  lastVerifiedAt?: string;
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

// Namespaced under `admin-users:` so the same admin preferences endpoint
// can serve other admin pages. The shared hook prefixes with `admin:` for
// localStorage automatically.
const VIEW_PREFS_KEY = "admin-users:view-prefs:v1";

interface UsersViewPrefs {
  searchQuery: string;
}

const DEFAULT_VIEW_PREFS: UsersViewPrefs = {
  searchQuery: "",
};

function sanitizeViewPrefs(raw: unknown): UsersViewPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_VIEW_PREFS;
  const obj = raw as Record<string, unknown>;
  return {
    searchQuery: typeof obj.searchQuery === "string" ? obj.searchQuery : "",
  };
}

export default function AdminUsers() {
  const {
    prefs,
    setPrefs,
    reset: resetViewPrefs,
  } = useAdminViewPrefs<UsersViewPrefs>(
    VIEW_PREFS_KEY,
    DEFAULT_VIEW_PREFS,
    sanitizeViewPrefs,
  );
  const searchQuery = prefs.searchQuery;
  const setSearchQuery = (value: string) =>
    setPrefs((p) => ({ ...p, searchQuery: value }));
  const hasNonDefaultViewPrefs = searchQuery.trim() !== "";
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserProfile>>({});
  // Local form state for the "Admin Overrides" section in the edit modal.
  // Reset every time the user opens a new edit dialog.
  const [subPlanDraft, setSubPlanDraft] = useState<string>("none");
  const [subExpiresDraft, setSubExpiresDraft] = useState<string>("");
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

  // Admin override: revoke active subscription. Stamps cancelledAt + flips
  // isActive=false but keeps the historical product/txn fields for audit.
  const cancelSubMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/admin/users/${userId}/subscription/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Subscription cancelled", description: "User's subscription marked inactive." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel subscription", variant: "destructive" });
    },
  });

  // Admin override: grant lifetime premium (platform='admin', expiresAt=null,
  // isActive=true). Used for promo codes, support compensation, etc.
  const grantLifetimeMutation = useMutation({
    mutationFn: (userId: string) =>
      apiRequest("POST", `/api/admin/users/${userId}/subscription/grant-lifetime`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Lifetime granted", description: "User now has premium_lifetime via admin override." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to grant lifetime", variant: "destructive" });
    },
  });

  // Free-form plan/expiry override (existing endpoint). Lets admin pick a
  // plan from the dropdown and (optionally) set a custom expiresAt.
  const updateSubMutation = useMutation({
    mutationFn: (data: { userId: string; plan: string; expiresAt?: string | null }) =>
      apiRequest("PATCH", `/api/admin/users/${data.userId}/subscription`, {
        body: {
          plan: data.plan,
          isActive: data.plan !== "none",
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Subscription updated", description: "Plan saved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update subscription", variant: "destructive" });
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
    if (!sub || !sub.isActive || sub.plan === 'none') return null;
    const colors: Record<string, string> = {
      remove_ads: "bg-blue-100 text-blue-800 border-blue-300",
      premium_monthly: "bg-yellow-100 text-yellow-800 border-yellow-300",
      premium_yearly: "bg-orange-100 text-orange-800 border-orange-300",
      premium_lifetime: "bg-purple-100 text-purple-800 border-purple-300",
    };
    const labels: Record<string, string> = {
      remove_ads: "No Ads",
      premium_monthly: "Premium (M)",
      premium_yearly: "Premium (Y)",
      premium_lifetime: "Lifetime",
    };
    const icons: Record<string, string> = {
      remove_ads: "🚫",
      premium_monthly: "⭐",
      premium_yearly: "⭐",
      premium_lifetime: "💎",
    };
    return (
      <Badge className={`${colors[sub.plan] || ''} border text-xs`}>
        {icons[sub.plan] || ''} {labels[sub.plan] || sub.plan}
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-3 text-gray-400" size={20} />
              <Input
                data-testid="input-search-users"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <ResetViewButton
              hasNonDefaultPrefs={hasNonDefaultViewPrefs}
              reset={resetViewPrefs}
              toastDescription="Search restored to defaults on this device and your account."
              title="Clear search on this device and your account"
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
                          <span className="text-gray-400 text-xs">-</span>
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
                              setSubPlanDraft(user.subscription?.plan || "none");
                              setSubExpiresDraft(
                                user.subscription?.expiresAt
                                  ? new Date(user.subscription.expiresAt).toISOString().slice(0, 10)
                                  : "",
                              );
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

                {/* Subscription Details — full read-only view of every IUser.subscription field */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                    <span>Subscription Details</span>
                    {getSubscriptionBadge(editUser?.subscription) || (
                      <span className="text-xs text-gray-400 normal-case font-normal">No active plan</span>
                    )}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Plan</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.plan || "none"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Active</span>
                      <p className={`font-medium ${editUser?.subscription?.isActive ? "text-green-700" : "text-red-700"}`}>
                        {editUser?.subscription?.isActive ? "Yes" : "No"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Platform</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.platform || "-"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Trial</span>
                      <p className="font-medium text-gray-900">{editUser?.subscription?.isTrial ? "Yes" : "No"}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Started</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.subscription?.startedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Expires</span>
                      <p className="font-medium text-gray-900">
                        {editUser?.subscription?.expiresAt
                          ? formatDate(editUser.subscription.expiresAt)
                          : editUser?.subscription?.plan === "premium_lifetime"
                            ? "Never (lifetime)"
                            : "-"}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Last verified</span>
                      <p className="font-medium text-gray-900">{formatDate(editUser?.subscription?.lastVerifiedAt)}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Cancelled</span>
                      <p className="font-medium text-gray-900">
                        {editUser?.subscription?.cancelledAt ? formatDate(editUser.subscription.cancelledAt) : "-"}
                      </p>
                    </div>
                    {editUser?.subscription?.productId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Product ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs break-all">{editUser.subscription.productId}</p>
                      </div>
                    )}
                    {editUser?.subscription?.originalTransactionId && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Original transaction ID</span>
                        <p className="font-medium text-gray-900 font-mono text-xs break-all">{editUser.subscription.originalTransactionId}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Admin Overrides — bypass Apple/Google. Sets platform='admin' on the server. */}
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Admin Overrides</h3>
                  <p className="text-xs text-gray-600">
                    These actions bypass Apple/Google verification. The server stamps <code className="bg-white px-1 rounded">platform=admin</code> so the override is auditable.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Plan</label>
                      <select
                        value={subPlanDraft}
                        onChange={(e) => setSubPlanDraft(e.target.value)}
                        className="w-full bg-white text-gray-900 border border-gray-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="none">none (no plan)</option>
                        <option value="remove_ads">remove_ads</option>
                        <option value="premium_monthly">premium_monthly</option>
                        <option value="premium_yearly">premium_yearly</option>
                        <option value="premium_lifetime">premium_lifetime</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Expires (optional)</label>
                      <Input
                        type="date"
                        value={subExpiresDraft}
                        onChange={(e) => setSubExpiresDraft(e.target.value)}
                        className="bg-white text-gray-900 border-gray-300 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateSubMutation.mutate({
                          userId: editingUserId,
                          plan: subPlanDraft,
                          expiresAt: subExpiresDraft ? new Date(subExpiresDraft).toISOString() : null,
                        })
                      }
                      disabled={updateSubMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {updateSubMutation.isPending ? <Loader2 className="mr-1 animate-spin" size={14} /> : null}
                      Save plan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Grant lifetime premium to this user (admin override)?")) {
                          grantLifetimeMutation.mutate(editingUserId);
                        }
                      }}
                      disabled={grantLifetimeMutation.isPending}
                      className="bg-white text-purple-700 border-purple-300 hover:bg-purple-50"
                    >
                      <Crown size={14} className="mr-1" />
                      Grant lifetime
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("Cancel this user's subscription? They will lose premium access immediately.")) {
                          cancelSubMutation.mutate(editingUserId);
                        }
                      }}
                      disabled={cancelSubMutation.isPending || !editUser?.subscription?.isActive}
                      className="bg-white text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Ban size={14} className="mr-1" />
                      Cancel subscription
                    </Button>
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
