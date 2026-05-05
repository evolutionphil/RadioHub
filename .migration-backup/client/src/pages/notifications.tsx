import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Bell, BellOff, Settings, TestTube, Heart, Radio } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';

export default function NotificationSettings() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    requestPermission,
    sendTestNotification
  } = usePushNotifications();

  const [settings, setSettings] = useState({
    favorites: true,
    nowPlaying: true,
    newStations: false,
    recommendations: false
  });

  useEffect(() => {
    // Load user notification preferences if available
    if (user && user.notificationSettings) {
      setSettings({
        favorites: user.notificationSettings.favorites ?? true,
        nowPlaying: user.notificationSettings.nowPlaying ?? true,
        newStations: user.notificationSettings.newStations ?? false,
        recommendations: user.notificationSettings.recommendations ?? false
      });
    }
  }, [user]);

  const handleSubscribe = async () => {
    if (!isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "Please log in to enable notifications",
        variant: "destructive"
      });
      return;
    }

    if (permission === 'default') {
      const granted = await requestPermission();
      if (!granted) {
        toast({
          title: "Permission Denied",
          description: "Please enable notifications in your browser settings",
          variant: "destructive"
        });
        return;
      }
    }

    const success = await subscribe();
    if (success) {
      toast({
        title: "Notifications Enabled",
        description: "You'll now receive push notifications",
      });
    } else {
      toast({
        title: "Subscription Failed",
        description: "Could not enable notifications. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleUnsubscribe = async () => {
    const success = await unsubscribe();
    if (success) {
      toast({
        title: "Notifications Disabled",
        description: "You'll no longer receive push notifications",
      });
    } else {
      toast({
        title: "Error",
        description: "Could not disable notifications. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleTestNotification = async () => {
    try {
      await sendTestNotification();
      toast({
        title: "Test Sent",
        description: "Check your notifications!",
      });
    } catch (error) {
      toast({
        title: "Test Failed",
        description: "Could not send test notification",
        variant: "destructive"
      });
    }
  };

  const handleSettingChange = async (setting: string, value: boolean) => {
    const newSettings = { ...settings, [setting]: value };
    setSettings(newSettings);

    // Save to backend
    try {
      const response = await fetch('/api/user/notification-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newSettings)
      });

      if (response.ok) {
        toast({
          title: "Settings Updated",
          description: "Your notification preferences have been saved",
        });
      }
    } catch (error) {
      // Failed to save notification settings
      // Revert the change
      setSettings(settings);
      toast({
        title: "Save Failed",
        description: "Could not save your preferences",
        variant: "destructive"
      });
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Settings
            </CardTitle>
            <CardDescription>
              Please log in to manage your notification preferences
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Notification Settings</h1>
      </div>

      {/* Browser Support Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isSupported ? <Bell className="h-5 w-5 text-green-500" /> : <BellOff className="h-5 w-5 text-red-500" />}
            Push Notifications
          </CardTitle>
          <CardDescription>
            {isSupported 
              ? "Your browser supports push notifications" 
              : "Push notifications are not supported in your browser"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSupported && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base font-medium">Status</Label>
                  <p className="text-sm text-muted-foreground">
                    {isSubscribed ? "Enabled" : "Disabled"} • Permission: {permission}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!isSubscribed ? (
                    <Button 
                      onClick={handleSubscribe} 
                      disabled={isLoading}
                      data-testid="button-enable-notifications"
                    >
                      {isLoading ? "Enabling..." : "Enable Notifications"}
                    </Button>
                  ) : (
                    <>
                      <Button 
                        variant="outline" 
                        onClick={handleTestNotification}
                        data-testid="button-test-notification"
                      >
                        <TestTube className="h-4 w-4 mr-2" />
                        Test
                      </Button>
                      <Button 
                        variant="destructive" 
                        onClick={handleUnsubscribe}
                        data-testid="button-disable-notifications"
                      >
                        Disable
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isSubscribed && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium">Notification Types</h3>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Heart className="h-4 w-4 text-red-500" />
                          <div>
                            <Label htmlFor="favorites" className="text-base">Favorite Stations</Label>
                            <p className="text-sm text-muted-foreground">
                              Get notified when you add stations to favorites
                            </p>
                          </div>
                        </div>
                        <Switch
                          id="favorites"
                          checked={settings.favorites}
                          onCheckedChange={(value) => handleSettingChange('favorites', value)}
                          data-testid="switch-favorites"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Radio className="h-4 w-4 text-blue-500" />
                          <div>
                            <Label htmlFor="nowPlaying" className="text-base">Now Playing</Label>
                            <p className="text-sm text-muted-foreground">
                              Show notifications with current track information
                            </p>
                          </div>
                        </div>
                        <Switch
                          id="nowPlaying"
                          checked={settings.nowPlaying}
                          onCheckedChange={(value) => handleSettingChange('nowPlaying', value)}
                          data-testid="switch-now-playing"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Bell className="h-4 w-4 text-green-500" />
                          <div>
                            <Label htmlFor="newStations" className="text-base">New Stations</Label>
                            <p className="text-sm text-muted-foreground">
                              Get notified about new stations in your favorite genres
                            </p>
                          </div>
                        </div>
                        <Switch
                          id="newStations"
                          checked={settings.newStations}
                          onCheckedChange={(value) => handleSettingChange('newStations', value)}
                          data-testid="switch-new-stations"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Settings className="h-4 w-4 text-purple-500" />
                          <div>
                            <Label htmlFor="recommendations" className="text-base">Recommendations</Label>
                            <p className="text-sm text-muted-foreground">
                              Receive personalized station recommendations
                            </p>
                          </div>
                        </div>
                        <Switch
                          id="recommendations"
                          checked={settings.recommendations}
                          onCheckedChange={(value) => handleSettingChange('recommendations', value)}
                          data-testid="switch-recommendations"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {!isSupported && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                To enable push notifications, please use a modern browser like Chrome, Firefox, or Safari.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it Works */}
      <Card>
        <CardHeader>
          <CardTitle>How Push Notifications Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <h4 className="font-medium">What you'll receive:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Confirmation when you add stations to favorites</li>
              <li>• Now playing information for your current station</li>
              <li>• New station recommendations based on your preferences</li>
              <li>• Updates about stations in your favorite genres</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium">Privacy & Control:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• You can disable notifications at any time</li>
              <li>• Choose which types of notifications to receive</li>
              <li>• No personal data is shared with third parties</li>
              <li>• Works even when the app is closed</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}