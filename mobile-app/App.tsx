/**
 * App entry point — splash screen + navigation + push notifications setup.
 */
import React, { useState, useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { Asset } from "expo-asset";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { Platform, View, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppNavigator } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors } from "@/theme";
import {
  isBiometricEnabled,
  authenticateWithBiometric,
  getBiometricEmail,
} from "@/services/biometric";

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // Try biometric login on first launch (if user has enabled it)
  useEffect(() => {
    async function tryBiometricLogin() {
      try {
        const enabled = await isBiometricEnabled();
        if (!enabled || isAuthenticated) return;

        const result = await authenticateWithBiometric(
          "Войдите в Кондитера",
          { disableDeviceFallback: false }
        );

        if (result.success) {
          const email = await getBiometricEmail();
          if (email) {
            // In production: use stored refresh token to silently re-authenticate.
            // For demo: just log — Zustand persist already restored user state from AsyncStorage.
            console.log("[biometric] authenticated for", email);
          }
        }
      } catch (e) {
        console.warn("Biometric login failed:", e);
      }
    }
    tryBiometricLogin();
  }, [isAuthenticated]);

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load any assets if needed
        await Asset.loadAsync([
          // require("./assets/icon.png"),
        ]);

        // Register for push notifications if user is authenticated
        if (isAuthenticated) {
          await registerForPushNotifications();
        }

        // Listen for incoming notifications while app is foregrounded
        notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
          console.log("Notification received:", notification.request.content.title);
        });

        // Listen for user tapping on a notification
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
          console.log("Notification tapped:", response.notification.request.content.data);
        });
      } catch (e) {
        console.warn("App prepare error:", e);
      } finally {
        setAppReady(true);
        await SplashScreen.hideAsync();
      }
    }
    prepare();

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [isAuthenticated]);

  if (!appReady) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Colors.primary }}>
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AppNavigator />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

async function registerForPushNotifications() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Уведомления",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: Colors.primary,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Push notification permission not granted");
    return;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: "conditera",
    })).data;
    console.log("Push token:", token);
    // TODO: send token to backend via POST /api/notifications/subscribe
  } catch (e) {
    console.warn("Failed to get push token:", e);
  }
}
