import { useNotifications } from "@/hooks/useNotifications";

// Notification service that provides pre-configured notifications for common use cases
export class NotificationService {
  private notify: ReturnType<typeof useNotifications>['notify'];

  constructor(notifyFunction: ReturnType<typeof useNotifications>['notify']) {
    this.notify = notifyFunction;
  }

  // 1. FAVORITES NOTIFICATIONS
  addedToFavorites(stationName: string, stationCountry?: string) {
    return this.notify({
      type: 'success',
      title: '❤️ Added to Favorites',
      message: `${stationName}${stationCountry ? ` from ${stationCountry}` : ''} is now in your favorites collection!`,
      duration: 4000,
      actions: [
        {
          label: 'View Favorites',
          onClick: () => { window.location.href = '/profile/favorites'; }
        }
      ]
    });
  }

  removedFromFavorites(stationName: string) {
    return this.notify({
      type: 'info',
      title: 'Removed from Favorites',
      message: `${stationName} has been removed from your favorites`,
      duration: 3000,
      // icon removed for simplicity
    });
  }

  // 2. PROFILE UPDATES NOTIFICATIONS
  profileUpdated() {
    return this.notify({
      type: 'success',
      title: '✅ Profile Updated',
      message: 'Your profile information has been successfully updated',
      duration: 3000,
      // icon removed for simplicity
    });
  }

  profileUpdateFailed(error?: string) {
    return this.notify({
      type: 'error',
      title: '❌ Profile Update Failed',
      message: error || 'Failed to update your profile. Please try again.',
      duration: 5000,
      // icon removed for simplicity
    });
  }

  // 3. LOGIN/AUTHENTICATION NOTIFICATIONS
  loginSuccess(userName?: string) {
    return this.notify({
      type: 'success',
      title: '🎉 Welcome Back!',
      message: `Successfully logged in${userName ? ` as ${userName}` : ''}`,
      duration: 4000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Go to Dashboard',
          onClick: () => { window.location.href = '/profile'; }
        }
      ]
    });
  }

  loginFailed(error?: string) {
    return this.notify({
      type: 'error',
      title: '❌ Login Failed',
      message: error || 'Invalid credentials. Please check your username and password.',
      duration: 5000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Try Again',
          onClick: () => { window.location.href = '/login'; }
        }
      ]
    });
  }

  logoutSuccess(userName?: string) {
    return this.notify({
      type: 'info',
      title: '👋 Logged Out',
      message: `You have been successfully logged out${userName ? `, ${userName}` : ''}`,
      duration: 2000,
      // icon removed for simplicity
    });
  }

  signupSuccess(userName?: string, email?: string) {
    return this.notify({
      type: 'success',
      title: '🎉 Welcome to the Community!',
      message: `Account created successfully${userName ? ` for ${userName}` : ''}${email ? `. Please check ${email} to verify your account.` : ''}`,
      duration: 5000,
      actions: [
        {
          label: 'Start Exploring',
          onClick: () => { window.location.href = '/'; }
        }
      ]
    });
  }

  signupFailed(error?: string) {
    return this.notify({
      type: 'error',
      title: '❌ Signup Failed',
      message: error || 'Unable to create your account. Please check your information and try again.',
      duration: 5000,
      actions: [
        {
          label: 'Try Again',
          onClick: () => { window.location.href = '/auth/signup'; }
        }
      ]
    });
  }

  // 4. NEW STATION NOTIFICATIONS
  newStationAdded(stationName: string, stationCountry: string) {
    return this.notify({
      type: 'info',
      title: '📻 New Station Added',
      message: `${stationName} from ${stationCountry} has been added to the system`,
      duration: 6000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Listen Now',
          onClick: () => {
            // This would be implemented to play the new station
            // Playing new station
          }
        },
        {
          label: 'View Details',
          onClick: () => {
            // This would navigate to the station detail page
            // Viewing station
          }
        }
      ]
    });
  }

  newStationDiscovered(stationName: string, location: string) {
    return this.notify({
      type: 'success',
      title: '🔍 Station Discovered',
      message: `Found new station "${stationName}" near ${location}`,
      duration: 5000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Explore',
          onClick: () => { window.location.href = '/discover'; }
        }
      ]
    });
  }

  // 5. USER REGISTRATION & SOCIAL NOTIFICATIONS
  newUserRegistered(userName: string) {
    return this.notify({
      type: 'info',
      title: '👋 New User Joined',
      message: `Welcome ${userName} to the community!`,
      duration: 4000,
      // icon removed for simplicity
    });
  }

  newFollower(followerName: string) {
    return this.notify({
      type: 'info',
      title: '🎉 New Follower',
      message: `${followerName} started following you`,
      duration: 4000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'View Profile',
          onClick: () => { window.location.href = '/profile'; }
        }
      ]
    });
  }

  followedUserNewFavorite(userName: string, stationName: string) {
    return this.notify({
      type: 'info',
      title: '❤️ Friend\'s New Favorite',
      message: `${userName} added "${stationName}" to their favorites`,
      duration: 5000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Listen',
          onClick: () => {
            // Playing station from user's favorites
          }
        }
      ]
    });
  }

  // 6. SYSTEM & GENERAL NOTIFICATIONS
  systemMaintenance(message: string, scheduledTime?: string) {
    return this.notify({
      type: 'warning',
      title: '⚠️ System Maintenance',
      message: `${message}${scheduledTime ? ` Scheduled for: ${scheduledTime}` : ''}`,
      duration: 8000,
      persistent: true,
      // icon removed for simplicity
    });
  }

  connectionIssue() {
    return this.notify({
      type: 'error',
      title: '🌐 Connection Issue',
      message: 'Having trouble connecting to our servers. Please check your internet connection.',
      duration: 5000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Retry',
          onClick: () => { window.location.reload(); }
        }
      ]
    });
  }

  // 7. STATION PLAYBACK NOTIFICATIONS
  stationStartedPlaying(stationName: string) {
    return this.notify({
      type: 'info',
      title: '🎵 Now Playing',
      message: `Started playing ${stationName}`,
      duration: 2000,
      // icon removed for simplicity
    });
  }

  stationPlaybackError(stationName: string, error?: string) {
    return this.notify({
      type: 'error',
      title: '❌ Playback Error',
      message: `Unable to play ${stationName}${error ? `: ${error}` : ''}`,
      duration: 4000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Try Another Station',
          onClick: () => { 
            // CRITICAL: Prevent audio interruption during navigation
            window.history.pushState(null, '', '/discover');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        }
      ]
    });
  }

  // 8. LOCATION & DISCOVERY NOTIFICATIONS
  locationDetected(city: string, country: string, stationCount: number) {
    return this.notify({
      type: 'success',
      title: '📍 Location Detected',
      message: `Found you in ${city}, ${country}. Discovered ${stationCount} nearby stations!`,
      duration: 5000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Explore Local Stations',
          onClick: () => { window.location.href = '/#stations-near-you'; }
        }
      ]
    });
  }

  // 9. COMMUNITY ACTIVITIES
  popularStationTrending(stationName: string, country: string) {
    return this.notify({
      type: 'info',
      title: '🔥 Trending Now',
      message: `${stationName} from ${country} is trending in your area`,
      duration: 4000,
      // icon removed for simplicity,
      actions: [
        {
          label: 'Listen Now',
          onClick: () => {
            // Playing trending station
          }
        }
      ]
    });
  }
}

// Hook to use the notification service
export function useNotificationService() {
  const { notify } = useNotifications();
  
  return new NotificationService(notify);
}