/**
 * Chat list screen — shows all chat rooms (direct with confectioners, support, etc.).
 *
 * Each row shows: avatar, name, last message preview, time, unread badge.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { useChat, type ChatRoom } from "@/hooks/useChat";
import { Colors, Spacing, FontSize, BorderRadius, formatRelative } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

// Mock initial rooms — in a real app, these would come from the API
const INITIAL_ROOMS: ChatRoom[] = [
  {
    id: "support",
    name: "Поддержка Уездного кондитера",
    avatar: "https://i.pravatar.cc/100?img=68",
    type: "support",
    unreadCount: 0,
    online: true,
    lastMessage: {
      id: "sys1",
      text: "Добро пожаловать! Если есть вопросы — пишите.",
      senderId: "support",
      senderName: "Поддержка",
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      status: "read",
    },
  },
  {
    id: "room-sladkaya-uezdnaya",
    name: "Сладкая уездная",
    avatar: "https://i.pravatar.cc/100?img=32",
    type: "direct",
    unreadCount: 2,
    online: true,
    lastMessage: {
      id: "msg1",
      text: "Здравствуйте! Ваш торт будет готов завтра к 14:00.",
      senderId: "conf1",
      senderName: "Мария",
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      status: "delivered",
    },
  },
];

export function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);

  const chat = useChat({
    userId: user?.id || null,
    userName: user?.name || "Пользователь",
    userAvatar: user?.avatar,
    enabled: !!user,
  });

  const [rooms, setRooms] = useState<ChatRoom[]>(INITIAL_ROOMS);

  // Merge incoming rooms from chat hook
  useEffect(() => {
    if (chat.rooms.length > 0) {
      setRooms((prev) => {
        const merged = [...prev];
        for (const r of chat.rooms) {
          const i = merged.findIndex((m) => m.id === r.id);
          if (i === -1) merged.push(r);
          else merged[i] = { ...merged[i], ...r };
        }
        return merged;
      });
    }
  }, [chat.rooms]);

  // Update rooms when a new lastMessage comes in
  useEffect(() => {
    if (chat.messages) {
      setRooms((prev) =>
        prev.map((room) => {
          const msgs = chat.messages[room.id];
          if (msgs && msgs.length > 0) {
            const last = msgs[msgs.length - 1];
            return { ...room, lastMessage: last };
          }
          return room;
        })
      );
    }
  }, [chat.messages]);

  if (!user) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="chatbubbles-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Войдите в аккаунт</Text>
        <Text style={styles.emptyDesc}>Чтобы общаться с кондитерами</Text>
        <Pressable
          style={styles.loginBtn}
          onPress={() => navigation.navigate("Auth", { mode: "login" })}
        >
          <Text style={styles.loginBtnText}>Войти</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const totalUnread = rooms.reduce((sum, r) => sum + r.unreadCount, 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Чаты</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: chat.isConnected ? Colors.success : Colors.textMuted }]} />
          <Text style={styles.statusText}>{chat.isConnected ? "онлайн" : "офлайн"}</Text>
        </View>
      </View>

      {chat.error && (
        <View style={styles.errorBar}>
          <Ionicons name="warning" size={14} color="white" />
          <Text style={styles.errorText}>Не удалось подключиться: {chat.error}</Text>
        </View>
      )}

      <FlatList
        data={rooms}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setTimeout(() => setRefreshing(false), 1000);
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={64} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>Нет чатов</Text>
            <Text style={styles.emptyDesc}>Начните диалог с кондитером из его профиля</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.roomRow}
            onPress={() => {
              Haptics.selectionAsync();
              chat.joinRoom(item.id);
              chat.markAsRead(item.id, []);
              navigation.navigate("ChatDetail", { roomId: item.id, roomName: item.name });
            }}
          >
            <View style={styles.avatarContainer}>
              <Image source={{ uri: item.avatar }} style={styles.avatar} />
              {item.online && <View style={styles.onlineDot} />}
            </View>
            <View style={styles.roomInfo}>
              <View style={styles.roomHeader}>
                <Text style={styles.roomName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.roomTime}>
                  {item.lastMessage ? formatRelative(item.lastMessage.timestamp) : ""}
                </Text>
              </View>
              <View style={styles.roomFooter}>
                <Text
                  style={[
                    styles.roomLastMessage,
                    item.unreadCount > 0 && styles.roomLastMessageUnread,
                  ]}
                  numberOfLines={1}
                >
                  {item.lastMessage?.text || "Нет сообщений"}
                </Text>
                {item.unreadCount > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{item.unreadCount}</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, marginBottom: Spacing.lg, textAlign: "center" },
  loginBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: BorderRadius.pill },
  loginBtnText: { color: "white", fontSize: FontSize.md, fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: FontSize.xs, color: Colors.textMuted },
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.error,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  errorText: { color: "white", fontSize: FontSize.xs, flex: 1 },
  empty: { alignItems: "center", paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.xl },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  avatarContainer: { position: "relative" },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: Colors.surface },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.success,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  roomInfo: { flex: 1 },
  roomHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  roomName: { flex: 1, fontSize: FontSize.md, fontWeight: "600", color: Colors.text },
  roomTime: { fontSize: FontSize.xs, color: Colors.textMuted, marginLeft: Spacing.sm },
  roomFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  roomLastMessage: { flex: 1, fontSize: FontSize.sm, color: Colors.textMuted },
  roomLastMessageUnread: { color: Colors.text, fontWeight: "500" },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
    marginLeft: Spacing.sm,
  },
  unreadText: { color: "white", fontSize: FontSize.xs, fontWeight: "700" },
});
