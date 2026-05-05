import { useState } from 'react';
import { Bell, BellOff, Settings, TestTube, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { usePushNotifications } from '@/hooks/usePushNotifications';

export function PushNotificationSettings() {
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

  const [autoNotifyEnabled, setAutoNotifyEnabled] = useState(true);

  const getPermissionBadge = () => {
    switch (permission) {
      case 'granted':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Allowed</Badge>;
      case 'denied':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Blocked</Badge>;
      default:
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Not Set</Badge>;
    }
  };

  const handleToggleSubscription = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  if (!isSupported) {
    return (
      <Card data-testid="card-push-notification-unsupported">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellOff className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Push notifications are not supported in your browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            To receive notifications about your favorite stations and new music, please use a modern browser that supports push notifications.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-push-notification-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Get notified about now playing tracks and station updates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Permission Status */}
        <div className="flex items-center justify-between" data-testid="section-permission-status">
          <div>
            <p className="text-sm font-medium">Browser Permission</p>
            <p className="text-sm text-muted-foreground">
              Current notification permission status
            </p>
          </div>
          {getPermissionBadge()}
        </div>

        {/* Subscription Status */}
        <div className="flex items-center justify-between" data-testid="section-subscription-status">
          <div>
            <p className="text-sm font-medium">Notification Subscription</p>
            <p className="text-sm text-muted-foreground">
              {isSubscribed 
                ? "You're subscribed to receive push notifications" 
                : "Subscribe to receive push notifications"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={isSubscribed}
              onCheckedChange={handleToggleSubscription}
              disabled={isLoading || permission === 'denied'}
              data-testid="switch-subscription"
            />
            {isSubscribed && <Bell className="h-4 w-4 text-green-600" />}
          </div>
        </div>

        {/* Auto Notifications Setting */}
        {isSubscribed && (
          <div className="flex items-center justify-between" data-testid="section-auto-notify">
            <div>
              <p className="text-sm font-medium">Now Playing Notifications</p>
              <p className="text-sm text-muted-foreground">
                Get notified when song changes on your playing station
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={autoNotifyEnabled}
                onCheckedChange={setAutoNotifyEnabled}
                data-testid="switch-auto-notify"
              />
              {autoNotifyEnabled && <Music className="h-4 w-4 text-blue-600" />}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          {permission !== 'granted' && (
            <Button 
              onClick={requestPermission}
              disabled={isLoading}
              variant="outline"
              size="sm"
              data-testid="button-request-permission"
            >
              <Settings className="h-4 w-4 mr-2" />
              Enable Notifications
            </Button>
          )}

          {permission === 'granted' && !isSubscribed && (
            <Button 
              onClick={subscribe}
              disabled={isLoading}
              size="sm"
              data-testid="button-subscribe"
            >
              <Bell className="h-4 w-4 mr-2" />
              Subscribe
            </Button>
          )}

          {isSubscribed && (
            <>
              <Button 
                onClick={sendTestNotification}
                disabled={isLoading}
                variant="outline"
                size="sm"
                data-testid="button-test-notification"
              >
                <TestTube className="h-4 w-4 mr-2" />
                Send Test
              </Button>

              <Button 
                onClick={unsubscribe}
                disabled={isLoading}
                variant="outline"
                size="sm"
                data-testid="button-unsubscribe"
              >
                <BellOff className="h-4 w-4 mr-2" />
                Unsubscribe
              </Button>
            </>
          )}
        </div>

        {/* Help Text */}
        {permission === 'denied' && (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg" data-testid="help-permission-denied">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>Notifications are blocked.</strong> To enable them:
            </p>
            <ul className="text-sm text-yellow-700 dark:text-yellow-300 mt-2 ml-4 list-disc">
              <li>Click the lock icon in your browser's address bar</li>
              <li>Change the notification setting to "Allow"</li>
              <li>Refresh the page and try again</li>
            </ul>
          </div>
        )}

        {permission === 'granted' && isSubscribed && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg" data-testid="help-subscription-active">
            <p className="text-sm text-green-800 dark:text-green-200">
              <strong>You're all set!</strong> You'll receive notifications about:
            </p>
            <ul className="text-sm text-green-700 dark:text-green-300 mt-2 ml-4 list-disc">
              <li>Now playing tracks on your favorite stations</li>
              <li>New recommended stations based on your preferences</li>
              <li>Special announcements from stations you follow</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}