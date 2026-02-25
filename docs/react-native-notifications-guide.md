# MegaRadio — React Native Push Notification Guide

## Overview

There are two types of notifications in MegaRadio:

| Type | Description | Where stored |
|------|-------------|--------------|
| **In-app notifications** | Follow alerts, new stations — stored in DB, fetched via API | MongoDB `UserNotification` |
| **Push notifications** | Real-time alerts sent to device even when app is closed | Expo Push Tokens → Expo API |

---

## 1. Setup: Register Push Token (Expo)

When the user logs in or opens the app, register the device push token:

```javascript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

async function registerPushToken(authToken) {
  if (!Device.isDevice) return; // Must be a real device

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'YOUR_EXPO_PROJECT_ID', // From app.json > extra.eas.projectId
  });

  const pushToken = tokenData.data; // e.g. "ExponentPushToken[xxxxxx]"

  // Send to MegaRadio server
  await fetch('https://themegaradio.com/api/user/push-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      token: pushToken,
      platform: Platform.OS, // 'ios' or 'android'
      deviceName: Device.deviceName || 'Unknown Device',
    }),
  });
}
```

Call this after login:
```javascript
// After successful login / token refresh
const { token } = await loginUser(email, password);
await registerPushToken(token);
```

---

## 2. Configure Notification Handler

In your `App.js` or root component:

```javascript
import * as Notifications from 'expo-notifications';
import { useNavigationContainerRef } from '@react-navigation/native';

// Handle notifications while app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function App() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    // App opened from a notification (background/killed state)
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      handleNotificationNavigation(navigationRef, data);
    });

    return () => subscription.remove();
  }, []);

  return <NavigationContainer ref={navigationRef}>...</NavigationContainer>;
}

function handleNotificationNavigation(navigationRef, data) {
  if (!data) return;

  switch (data.type) {
    case 'follow':
      // Navigate to the follower's profile
      if (data.followerSlug) {
        navigationRef.navigate('Community', {
          screen: 'UserProfile',
          params: { slug: data.followerSlug },
        });
      } else {
        navigationRef.navigate('Community');
      }
      break;

    case 'now-playing':
      navigationRef.navigate('Player', { stationName: data.stationName });
      break;

    case 'favorite-added':
      navigationRef.navigate('Favorites');
      break;

    default:
      navigationRef.navigate('Notifications');
  }
}
```

---

## 3. Fetch In-App Notifications (API)

In-app notifications are stored in the database and fetched via API.
**Mobile must send Bearer token** in the Authorization header:

```javascript
async function fetchNotifications(authToken, page = 1) {
  const response = await fetch(
    `https://themegaradio.com/api/user/notifications?page=${page}&limit=20`,
    {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.json();
}

// Response shape:
// {
//   notifications: [
//     {
//       _id: "...",
//       type: "follow",           // "follow" | "new_station"
//       title: "New Follower",
//       message: "John started following you",
//       read: false,
//       isRead: false,
//       createdAt: "2026-02-25T...",
//       fromUserId: {
//         fullName: "John Doe",
//         username: "johndoe",
//         avatar: "https://..."
//       },
//       data: { followerId: "...", followerSlug: "johndoe" }
//     }
//   ],
//   unreadCount: 3,
//   pagination: { page: 1, limit: 20, total: 5, pages: 1 }
// }
```

---

## 4. Mark Notifications as Read

```javascript
// Mark single notification as read
async function markAsRead(authToken, notificationId) {
  await fetch(`https://themegaradio.com/api/user/notifications/${notificationId}/read`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
}

// Mark all notifications as read
async function markAllAsRead(authToken) {
  await fetch('https://themegaradio.com/api/user/notifications/read-all', {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
}
```

---

## 5. Follow a User (triggers notification)

When you follow a user, the server:
1. Creates a `UserNotification` record in the database
2. Sends an Expo push notification to their device (if registered)

```javascript
async function followUser(authToken, targetUserId) {
  // targetUserId can be a MongoDB ObjectId OR a slug like "cuneyt"
  const response = await fetch(
    `https://themegaradio.com/api/user-engagement/follow/${targetUserId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.json();
  // { success: true, message: "User followed successfully" }
}

async function unfollowUser(authToken, targetUserId) {
  const response = await fetch(
    `https://themegaradio.com/api/user-engagement/unfollow/${targetUserId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.json();
}
```

---

## 6. Remove Push Token on Logout

Always deregister the device token when the user logs out:

```javascript
async function logout(authToken, pushToken) {
  // Deactivate push token first
  await fetch('https://themegaradio.com/api/user/push-token', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: pushToken }),
  });

  // Then logout
  await fetch('https://themegaradio.com/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${authToken}` },
  });
}
```

---

## 7. Notification Data Payloads (from server)

| Notification type | `data.type` | Extra fields |
|-------------------|-------------|--------------|
| New follower | `"follow"` | `followerName`, `followerSlug`, `screen: "Community"` |
| Now playing | `"now-playing"` | `stationName`, `nowPlaying`, `genre`, `homepage` |
| Favorite added | `"favorite-added"` | `stationId`, `stationName` |
| Station recommendation | `"recommendations"` | `stations[]` |

---

## 8. Complete Notification Screen Example

```javascript
import { useEffect, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';

export function NotificationsScreen({ authToken }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    loadNotifications();
  }, []);

  async function loadNotifications() {
    const data = await fetchNotifications(authToken);
    setNotifications(data.notifications);
    setUnreadCount(data.unreadCount);
  }

  async function handleMarkRead(id) {
    await markAsRead(authToken, id);
    setNotifications(prev =>
      prev.map(n => n._id === id ? { ...n, isRead: true, read: true } : n)
    );
  }

  return (
    <View>
      <Text>Notifications ({unreadCount} unread)</Text>
      <FlatList
        data={notifications}
        keyExtractor={item => item._id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handleMarkRead(item._id)}
            style={{ opacity: item.isRead ? 0.6 : 1 }}
          >
            <Text>{item.title}</Text>
            <Text>{item.message}</Text>
            <Text>{new Date(item.createdAt).toLocaleDateString()}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

---

## 9. Required Expo Packages

```bash
npx expo install expo-notifications expo-device
```

`app.json`:
```json
{
  "expo": {
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#1a1a2e",
          "sounds": [],
          "androidMode": "default",
          "androidCollapsedTitle": "MegaRadio"
        }
      ]
    ]
  }
}
```

---

## API Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/user/push-token` | Bearer | Register device push token |
| `DELETE` | `/api/user/push-token` | Bearer | Remove push token (logout) |
| `GET` | `/api/user/notifications` | Bearer | Get in-app notifications |
| `PATCH` | `/api/user/notifications/:id/read` | Bearer | Mark one as read |
| `PATCH` | `/api/user/notifications/read-all` | Bearer | Mark all as read |
| `POST` | `/api/user-engagement/follow/:userId` | Bearer | Follow user (sends notification) |
| `POST` | `/api/user-engagement/unfollow/:userId` | Bearer | Unfollow user |
