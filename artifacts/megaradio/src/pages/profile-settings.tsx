import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useNotificationService } from "@/services/NotificationService";
import { apiRequest } from "@/lib/queryClient";
import { PushNotificationSettings } from "@/components/PushNotificationSettings";

const profileSettingsSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().optional(),
  country: z.string().optional(),
  language: z.string().optional(),
  is_public_profile: z.boolean().default(false),
  is_autoplay_at_login: z.boolean().default(false),
  play_at_login: z.enum(["LAST_PLAYED", "RANDOM", "FAVORITE"]).default("LAST_PLAYED"),
});

type ProfileSettingsData = z.infer<typeof profileSettingsSchema>;

function SettingsContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const notificationService = useNotificationService();
  const queryClient = useQueryClient();
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");

  // Fetch countries
  const { data: countries = [] } = useQuery<string[]>({
    queryKey: ["/api/filters/countries"],
  });

  // Fetch languages - we'll need to add this endpoint
  const { data: languages = [] } = useQuery<{key: string, name: string}[]>({
    queryKey: ["/api/languages"],
  });

  const form = useForm<ProfileSettingsData>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: {
      name: user?.fullName || "",
      email: user?.email || "",
      password: "",
      country: user?.location || "",
      language: (user as any)?.preferences?.language || "en",
      is_public_profile: (user as any)?.isPublicProfile || false,
      is_autoplay_at_login: (user as any)?.preferences?.autoplay || false,
      play_at_login: "LAST_PLAYED", // Not in current user schema
    },
  });

  // Update form when user data changes
  React.useEffect(() => {
    if (user) {
      const userData = {
        name: user?.fullName || "",
        email: user?.email || "",
        password: "",
        country: user?.location || "",
        language: (user as any)?.preferences?.language || "en",
        is_public_profile: (user as any)?.isPublicProfile || false,
        is_autoplay_at_login: (user as any)?.preferences?.autoplay || false,
        play_at_login: (user as any)?.preferences?.playAtLogin || "LAST_PLAYED",
      };
      
      // Form populating with user data
      
      form.reset(userData);
    }
  }, [user, form]);

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileSettingsData) => {
      const payload: any = {
        fullName: data.name,
        email: data.email,
        location: data.country,
        isPublicProfile: data.is_public_profile,
        preferences: {
          language: data.language,
          autoplay: data.is_autoplay_at_login,
          playAtLogin: data.play_at_login || 'LAST_PLAYED', // Default to LAST_PLAYED if not selected
        },
      };

      if (data.password) {
        payload.password = data.password;
      }

      return apiRequest("PUT", "/api/auth/profile", { body: payload });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      
      // Show rich notification for profile update
      notificationService.profileUpdated();
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      form.setValue("password", "");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
      
      // Show profile update failure notification
      notificationService.profileUpdateFailed(error.message || "Failed to update your profile. Please try again.");
    },
  });

  // Avatar update mutation
  const updateAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("avatar", file);

      const response = await fetch("/api/auth/avatar", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload avatar");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Success",
        description: "Avatar updated successfully",
      });
      
      // Show rich notification for avatar update (a subset of profile update)
      notificationService.profileUpdated();
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: "Failed to update avatar",
        variant: "destructive",
      });
      
      // Show avatar update failure notification
      notificationService.profileUpdateFailed("Failed to update your avatar. Please try again with a different image.");
    },
  });

  const selectProfileImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.click();

    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        setAvatarFile(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          setAvatarPreview(e.target?.result as string);
        };
        reader.readAsDataURL(file);
        updateAvatarMutation.mutate(file);
      }
    };
  };

  const onSubmit = (data: ProfileSettingsData) => {
    updateProfileMutation.mutate(data);
  };

  // Get user stats (followers/following)
  const userStats = {
    followers_count: user?.followersCount || 0,
    followings_count: user?.followingCount || 0,
  };

  return (
    <div className="min-h-screen bg-[#0E0E0E] px-4 py-6">
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4 md:gap-6">
          {/* Profile Section */}
          <div className="col-span-full flex w-full flex-col items-center justify-around gap-4 rounded bg-[#151515] p-8 md:flex-row">
            <div className="flex flex-col items-center gap-8 sm:flex-row">
              <div className="relative h-24 w-24 flex-shrink-0">
                <img
                  loading="lazy"
                  className="h-full w-full rounded-full object-cover"
                  src={avatarPreview || user?.avatar || `https://gravatar.com/avatar?d=robohash`}
                  alt="Profile"
                />
                <button
                  type="button"
                  className="absolute bottom-[10px] right-0"
                  onClick={selectProfileImage}
                >
                  <svg width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M14.19 0H5.81C2.17 0 0 2.17 0 5.81v8.37C0 17.83 2.17 20 5.81 20h8.37c3.64 0 5.81-2.17 5.81-5.81V5.81C20 2.17 17.83 0 14.19 0ZM8.95 15.51c-.29.29-.84.57-1.24.63l-2.46.35c-.09.01-.18.02-.27.02-.41 0-.79-.14-1.06-.41-.33-.33-.47-.81-.39-1.34l.35-2.46c.06-.41.33-.95.63-1.24L8.97 6.6a7.546 7.546 0 0 0 .6 1.29c.1.17.21.33.3.45.11.17.24.33.32.42.05.07.09.12.11.14.25.3.54.58.79.79.07.07.11.11.13.12.15.12.3.24.43.33.16.12.32.23.49.32.2.12.42.23.64.34.23.1.44.19.65.26l-4.48 4.45Zm6.42-6.42-.92.93a.31.31 0 0 1-.22.09c-.03 0-.07 0-.09-.01a6.202 6.202 0 0 1-4.23-4.23c-.03-.11 0-.23.08-.3l.93-.93c1.52-1.52 2.97-1.49 4.46 0 .76.76 1.13 1.49 1.13 2.25-.01.72-.38 1.44-1.14 2.2Z"
                      fill="#fff"
                    />
                  </svg>
                </button>
              </div>
              <div className="w-full text-center sm:text-start">
                <div className="truncate text-2xl font-bold text-white">{user?.fullName}</div>
                <div className="truncate text-base font-medium text-[#818181]">{user?.email}</div>
              </div>
            </div>
            <div className="flex divide-x divide-neutral-600 md:ml-auto">
              <p className="px-4 text-2xl">
                <span className="font-semibold text-white">{userStats.followers_count}</span>{" "}
                <span className="text-neutral-500">Followers</span>
              </p>
              <p className="px-4 text-2xl">
                <span className="font-semibold text-white">{userStats.followings_count}</span>{" "}
                <span className="text-neutral-500">Follows</span>
              </p>
            </div>
          </div>

          {/* Play at log in */}
          <div className="col-span-full w-full rounded bg-[#151515] p-8 md:col-auto">
            <div className="font-medium text-white">Play at log in</div>
            <div className="py-4">
              <div className="flex items-center gap-4">
                <Switch
                  id="is_autoplay_at_login"
                  checked={form.watch("is_autoplay_at_login")}
                  onCheckedChange={(checked) => form.setValue("is_autoplay_at_login", checked)}
                />
                <Label htmlFor="is_autoplay_at_login" className="text-white">Autoplay</Label>
              </div>
              <Separator className="my-4 bg-neutral-600" />
              <div className="flex flex-col gap-y-6">
                <div className="flex items-center gap-4">
                  <input
                    className="radio"
                    value="LAST_PLAYED"
                    type="radio"
                    id="last_played"
                    {...form.register("play_at_login")}
                  />
                  <Label htmlFor="last_played" className="text-white">Last Played</Label>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    className="radio"
                    value="RANDOM"
                    type="radio"
                    id="random"
                    {...form.register("play_at_login")}
                  />
                  <Label htmlFor="random" className="text-white">Random</Label>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    className="radio"
                    value="FAVORITE"
                    type="radio"
                    id="favorite"
                    {...form.register("play_at_login")}
                  />
                  <Label htmlFor="favorite" className="text-white">Favorite</Label>
                </div>
              </div>
            </div>
          </div>

          {/* Profile Information */}
          <div className="col-span-full w-full rounded bg-[#151515] p-8 md:col-auto">
            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col">
                <Label className="mb-2 font-medium text-white">Your Name</Label>
                <Input
                  type="text"
                  className="h-12 rounded bg-primary text-white"
                  {...form.register("name")}
                />
                {form.formState.errors.name && (
                  <span className="text-red-500 text-sm">{form.formState.errors.name.message}</span>
                )}
              </div>
              <div className="flex flex-col">
                <Label className="mb-2 font-medium text-white">Password</Label>
                <Input
                  type="password"
                  className="h-12 rounded bg-primary text-white"
                  placeholder="Leave blank to keep current password"
                  {...form.register("password")}
                />
              </div>
              <div className="col-span-full flex flex-col">
                <Label className="mb-2 font-medium text-white">Email</Label>
                <Input
                  type="email"
                  className="h-12 rounded bg-primary text-white"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <span className="text-red-500 text-sm">{form.formState.errors.email.message}</span>
                )}
              </div>
              <div className="flex flex-col">
                <Label className="mb-2 font-medium text-white">Country</Label>
                <Select
                  value={form.watch("country")}
                  onValueChange={(value) => form.setValue("country", value)}
                >
                  <SelectTrigger className="rounded-md bg-transparent py-3 text-white">
                    <SelectValue placeholder="-- Select Option --" />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((country, index) => (
                      <SelectItem key={index} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col">
                <Label className="mb-2 font-medium text-white">Language</Label>
                <Select
                  value={form.watch("language")}
                  onValueChange={(value) => form.setValue("language", value)}
                >
                  <SelectTrigger className="rounded-md bg-transparent py-3 text-white">
                    <SelectValue placeholder="-- Select Option --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="fr">French</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                    <SelectItem value="it">Italian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <Separator className="my-8 bg-neutral-600" />
            
            <div>
              <div className="flex justify-between">
                <h2 className="font-medium text-white">Public Profile</h2>
                <Switch
                  checked={form.watch("is_public_profile")}
                  onCheckedChange={(checked) => form.setValue("is_public_profile", checked)}
                  className={form.watch("is_public_profile") ? "bg-accent" : "bg-gray-700"}
                />
              </div>
              <p className="text-gray-400">This lets users to see your profile</p>
            </div>
            
            <Separator className="my-8 bg-neutral-600" />
            
            {/* Push Notification Settings Section */}
            <div className="mb-8">
              <PushNotificationSettings />
            </div>
            
            <div className="col-span-full mt-8 text-right">
              <Button
                type="submit"
                className="rounded bg-accent py-3 px-12"
                disabled={updateProfileMutation.isPending}
              >
                {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function ProfileSettings() {
  return (
    <ProtectedRoute>
      <SettingsContent />
    </ProtectedRoute>
  );
}