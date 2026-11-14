/**
 * Notifications screen — list of in-app notifications.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { notificationsApi, type Notification } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, formatRelative } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppStore((s) => s.user);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { notifications } = await notificationsApi.list();
      setNotifications(notifications);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user]);

  const handleMarkAllRead = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await notificationsApi.markRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
      );
    } catch (e) {
      console.error(e);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Войдите в аккаунт</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Уведомления</Text>
        <Pressable onPress={handleMarkAllRead} hitSlop={8}>
          <Text style={styles.markReadBtn}>Прочитать все</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: Spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={64} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Нет уведомлений</Text>
              <Text style={styles.emptyDesc}>Здесь появятся статусы заказов и бонусы</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isUnread = !item.readAt;
            return (
              <Pressable
                style={[styles.notifCard, isUnread && styles.notifUnread]}
                onPress={async () => {
                  if (isUnread) {
                    await notificationsApi.markRead([item.id]);
                    setNotifications((prev) =>
                      prev.map((n) =>
                        n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n
                      )
                    );
                  }
                }}
              >
                {isUnread && <View style={styles.unreadDot} />}
                <View style={styles.notifContent}>
                  <Text style={styles.notifTitle}>{item.title}</Text>
                  <Text style={styles.notifBody}>{item.body}</Text>
                  <Text style={styles.notifTime}>{formatRelative(item.createdAt)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  markReadBtn: { color: Colors.primary, fontSize: FontSize.xs },
  empty: { alignItems: "center", paddingVertical: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  notifCard: { flexDirection: "row", backgroundColor: Colors.background, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.sm },
  notifUnread: { backgroundColor: Colors.primary + "0a", borderColor: Colors.primary + "44" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6, marginRight: Spacing.sm },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text },
  notifBody: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, lineHeight: 18 },
  notifTime: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 6 },
});
