/**
 * SimpleXScreen — экран управления SimpleX-профилем кондитера.
 *
 * Возможности:
 *   - Создать SimpleX-профиль (если ещё нет)
 *   - Показать QR-код и адрес для подключения клиентов
 *   - Список входящих сообщений с возможностью ответа
 *   - Деактивировать профиль
 *
 * Архитектура: simplexApi из @/api/client обращается к тем же endpoints,
 * что и web-версия (/api/simplex/contacts, /api/simplex/send, /api/simplex/read).
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  FlatList,
  TextInput,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, type NativeStackNavigationProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";

import { simplexApi, type SimpleXContact, type SimpleXMessage } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatRelative } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SimpleXScreen() {
  const navigation = useNavigation<Nav>();
  const [contact, setContact] = useState<SimpleXContact | null>(null);
  const [messages, setMessages] = useState<SimpleXMessage[]>([]);
  const [stats, setStats] = useState({ total: 0, unread: 0 });
  const [connectInstructions, setConnectInstructions] = useState<{
    address: string;
    qrUrl: string;
    deepLink: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Reply state
  const [replyTo, setReplyTo] = useState<{ chatId: string; fromName: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await simplexApi.getProfile();
      setContact(data.contact);
      setMessages(data.recentMessages);
      setStats(data.stats);
      setConnectInstructions(data.connectInstructions);
    } catch (e) {
      console.error("[SimpleXScreen] load failed:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateProfile = async () => {
    setCreating(true);
    try {
      const result = await simplexApi.createProfile();
      if (result.success) {
        Alert.alert("Готово", "SimpleX-профиль создан");
        setShowQR(true);
        await load();
      }
    } catch (e: any) {
      Alert.alert("Ошибка", e.message || "Не удалось создать профиль");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProfile = () => {
    Alert.alert(
      "Деактивировать профиль?",
      "Клиенты не смогут отправлять новые сообщения. Существующая переписка сохранится.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Деактивировать",
          style: "destructive",
          onPress: async () => {
            try {
              await simplexApi.deleteProfile();
              await load();
            } catch (e: any) {
              Alert.alert("Ошибка", e.message);
            }
          },
        },
      ]
    );
  };

  const handleSendReply = async () => {
    if (!replyTo || !replyText.trim()) return;
    setSending(true);
    try {
      await simplexApi.send(replyTo.fromName, replyText.trim(), replyTo.chatId);
      setReplyText("");
      setReplyTo(null);
      await load();
    } catch (e: any) {
      Alert.alert("Ошибка отправки", e.message);
    } finally {
      setSending(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await simplexApi.markRead(undefined, true);
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Загрузка...</Text>
      </SafeAreaView>
    );
  }

  const hasProfile = !!contact?.active;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Ionicons name="shield-checkmark" size={20} color={Colors.success} />
          <Text style={styles.headerTitle}>SimpleX (E2E)</Text>
        </View>
        {hasProfile && (
          <Pressable onPress={handleRefresh} hitSlop={8}>
            <Ionicons name="refresh" size={22} color={Colors.text} />
          </Pressable>
        )}
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[Colors.primary]} />
        }
      >
        {/* Info banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle" size={20} color={Colors.success} />
          <Text style={styles.infoText}>
            SimpleX Chat обеспечивает сквозное шифрование (Double Ratchet + пост-квантовый CRYSTALS-Kyber).
            Клиенты подключаются через QR-код, переписка не видна серверам маркетплейса.
          </Text>
        </View>

        {!hasProfile ? (
          // === Создание профиля ===
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="shield-checkmark" size={56} color={Colors.success} />
            </View>
            <Text style={styles.emptyTitle}>Создать приватный канал</Text>
            <Text style={styles.emptyDescription}>
              После создания вы получите уникальный #simplex-адрес и QR-код.
              Разместите его в профиле или отправляйте клиентам напрямую — они подключатся
              через приложение SimpleX Chat и смогут общаться с вами конфиденциально.
            </Text>
            <Pressable
              style={[styles.createButton, creating && styles.disabled]}
              onPress={handleCreateProfile}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color={Colors.background} />
              ) : (
                <>
                  <Ionicons name="add-circle" size={20} color={Colors.background} />
                  <Text style={styles.createButtonText}>Создать SimpleX-профиль</Text>
                </>
              )}
            </Pressable>
          </View>
        ) : (
          <>
            {/* === KPI === */}
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Ionicons name="people" size={20} color={Colors.primary} />
                <Text style={styles.kpiValue}>{contact!.connectionsCount}</Text>
                <Text style={styles.kpiLabel}>Подключений</Text>
              </View>
              <View style={styles.kpiCard}>
                <Ionicons name="chatbubbles" size={20} color={Colors.success} />
                <Text style={styles.kpiValue}>{stats.total}</Text>
                <Text style={styles.kpiLabel}>Сообщений</Text>
              </View>
              <View style={styles.kpiCard}>
                <Ionicons name="alert-circle" size={20} color={Colors.warning} />
                <Text style={styles.kpiValue} style={[styles.kpiValue, { color: Colors.warning }]}>
                  {stats.unread}
                </Text>
                <Text style={styles.kpiLabel}>Непрочитано</Text>
              </View>
            </View>

            {/* === QR-код === */}
            <View style={styles.qrCard}>
              <View style={styles.qrCardHeader}>
                <View style={styles.qrCardTitleRow}>
                  <Ionicons name="qr-code" size={18} color={Colors.primary} />
                  <Text style={styles.qrCardTitle}>Ваш #simplex-адрес</Text>
                </View>
                <Pressable onPress={() => setShowQR(!showQR)}>
                  <Text style={styles.toggleText}>{showQR ? "Скрыть" : "Показать"}</Text>
                </Pressable>
              </View>
              {showQR && connectInstructions && (
                <View style={styles.qrContent}>
                  <Image
                    source={{ uri: connectInstructions.qrUrl }}
                    style={styles.qrImage}
                    contentFit="contain"
                  />
                  <View style={styles.qrInstructions}>
                    <Text style={styles.qrAddressLabel}>Адрес:</Text>
                    <Text style={styles.qrAddress} selectable>
                      {connectInstructions.address}
                    </Text>
                    <Text style={styles.qrStepTitle}>Как подключиться:</Text>
                    <Text style={styles.qrStep}>1. Установите SimpleX Chat (iOS / Android / desktop)</Text>
                    <Text style={styles.qrStep}>2. Откройте приложение → «Добавить контакт»</Text>
                    <Text style={styles.qrStep}>3. Сканируйте QR-код или вставьте адрес</Text>
                    <Text style={styles.qrStep}>4. Отправьте первое сообщение</Text>
                  </View>
                </View>
              )}
              {!showQR && (
                <Text style={styles.qrHiddenText}>
                  Адрес скрыт. Нажмите «Показать», чтобы увидеть QR-код.
                </Text>
              )}
            </View>

            {/* === Сообщения === */}
            <View style={styles.messagesCard}>
              <View style={styles.messagesHeader}>
                <Text style={styles.messagesTitle}>
                  Входящие сообщения
                  {stats.unread > 0 && ` · ${stats.unread} новых`}
                </Text>
                {stats.unread > 0 && (
                  <Pressable onPress={handleMarkAllRead} hitSlop={8}>
                    <Text style={styles.markReadText}>Прочитать все</Text>
                  </Pressable>
                )}
              </View>

              {messages.length === 0 ? (
                <View style={styles.messagesEmpty}>
                  <Ionicons name="chatbubble-outline" size={36} color={Colors.textMuted} />
                  <Text style={styles.messagesEmptyText}>Пока нет сообщений</Text>
                  <Text style={styles.messagesEmptyHint}>Поделитесь QR-кодом с клиентами</Text>
                </View>
              ) : (
                <View>
                  {messages.map((msg) => {
                    const isOutgoing = msg.direction === "outgoing";
                    const files = msg.metadata?.files || [];
                    return (
                      <View
                        key={msg.id}
                        style={[
                          styles.messageBubble,
                          isOutgoing
                            ? styles.messageOutgoing
                            : msg.readByOperator
                            ? styles.messageIncoming
                            : styles.messageUnread,
                        ]}
                      >
                        <View style={styles.messageHeader}>
                          <Text style={styles.messageSender}>
                            {isOutgoing ? "Вы" : msg.fromName || "Клиент"}
                          </Text>
                          <Text style={styles.messageTime}>
                            {formatRelative(msg.receivedAt)}
                          </Text>
                          {!msg.readByOperator && !isOutgoing && (
                            <View style={styles.unreadDot} />
                          )}
                        </View>
                        {msg.text && (
                          <Text style={styles.messageText}>{msg.text}</Text>
                        )}
                        {files.length > 0 && (
                          <Text style={styles.messageFiles}>
                            📎 {files.length} файл(ов)
                          </Text>
                        )}
                        {!isOutgoing && (
                          <Pressable
                            style={styles.replyButton}
                            onPress={() => {
                              setReplyTo({ chatId: msg.simplexChatId, fromName: msg.fromName || "" });
                              setReplyText("");
                            }}
                          >
                            <Ionicons name="send" size={12} color={Colors.primary} />
                            <Text style={styles.replyButtonText}>Ответить</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Reply form */}
              {replyTo && (
                <View style={styles.replyForm}>
                  <View style={styles.replyHeader}>
                    <Text style={styles.replyTitle}>
                      Ответ для: <Text style={{ color: Colors.primary }}>{replyTo.fromName}</Text>
                    </Text>
                    <Pressable
                      onPress={() => setReplyTo(null)}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={18} color={Colors.textMuted} />
                    </Pressable>
                  </View>
                  <TextInput
                    style={styles.replyInput}
                    value={replyText}
                    onChangeText={setReplyText}
                    placeholder="Введите ответ..."
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    maxLength={16000}
                    textAlignVertical="top"
                  />
                  <View style={styles.replyActions}>
                    <Text style={styles.charCount}>{replyText.length} / 16000</Text>
                    <Pressable
                      style={[styles.sendButton, (!replyText.trim() || sending) && styles.disabled]}
                      onPress={handleSendReply}
                      disabled={!replyText.trim() || sending}
                    >
                      {sending ? (
                        <ActivityIndicator size="small" color={Colors.background} />
                      ) : (
                        <>
                          <Ionicons name="send" size={14} color={Colors.background} />
                          <Text style={styles.sendButtonText}>Отправить</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}
            </View>

            {/* === Danger zone === */}
            <View style={styles.dangerCard}>
              <View style={styles.dangerHeader}>
                <Ionicons name="trash" size={18} color={Colors.error} />
                <Text style={styles.dangerTitle}>Деактивация профиля</Text>
              </View>
              <Text style={styles.dangerDescription}>
                После деактивации клиенты не смогут отправлять новые сообщения.
                Существующая переписка сохранится в дашборде.
              </Text>
              <Pressable style={styles.dangerButton} onPress={handleDeleteProfile}>
                <Text style={styles.dangerButtonText}>Деактивировать SimpleX-профиль</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: Spacing.md },
  loadingText: { fontSize: FontSize.sm, color: Colors.textMuted },

  // === Header ===
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    flex: 1,
    marginLeft: Spacing.sm,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    color: Colors.text,
  },

  // === ScrollView ===
  scrollView: { flex: 1 },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xxl },

  // === Info banner ===
  infoBanner: {
    flexDirection: "row",
    gap: Spacing.sm,
    backgroundColor: `${Colors.success}15`,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  infoText: {
    flex: 1,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    lineHeight: 17,
  },

  // === Empty state ===
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    marginTop: Spacing.xl,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: `${Colors.success}20`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  emptyDescription: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.success,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  createButtonText: {
    color: Colors.background,
    fontSize: FontSize.md,
    fontWeight: "600",
  },

  // === KPI ===
  kpiRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm + 2,
    alignItems: "center",
    gap: 4,
  },
  kpiValue: {
    fontSize: FontSize.xl,
    fontWeight: "700",
    color: Colors.text,
  },
  kpiLabel: {
    fontSize: FontSize.xs - 1,
    color: Colors.textMuted,
    textAlign: "center",
  },

  // === QR Card ===
  qrCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  qrCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  qrCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  qrCardTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.text,
  },
  toggleText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: "500",
  },
  qrContent: {
    alignItems: "center",
  },
  qrImage: {
    width: 200,
    height: 200,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.success,
    marginBottom: Spacing.md,
  },
  qrInstructions: {
    alignSelf: "stretch",
  },
  qrAddressLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  qrAddress: {
    fontSize: FontSize.xs - 1,
    color: Colors.text,
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  qrStepTitle: {
    fontSize: FontSize.sm,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  qrStep: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: 4,
    lineHeight: 18,
  },
  qrHiddenText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },

  // === Messages ===
  messagesCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  messagesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  messagesTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.text,
  },
  markReadText: {
    fontSize: FontSize.xs,
    color: Colors.primary,
    fontWeight: "500",
  },
  messagesEmpty: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  messagesEmptyText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing.sm,
  },
  messagesEmptyHint: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
  },

  // === Message bubble ===
  messageBubble: {
    padding: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  messageOutgoing: {
    backgroundColor: `${Colors.primary}10`,
    borderColor: `${Colors.primary}30`,
    marginLeft: Spacing.lg,
  },
  messageIncoming: {
    backgroundColor: Colors.background,
    borderColor: Colors.border,
  },
  messageUnread: {
    backgroundColor: `${Colors.warning}10`,
    borderColor: `${Colors.warning}40`,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: 4,
  },
  messageSender: {
    fontSize: FontSize.xs,
    fontWeight: "600",
    color: Colors.text,
    flex: 1,
  },
  messageTime: {
    fontSize: FontSize.xs - 1,
    color: Colors.textMuted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.warning,
  },
  messageText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 19,
  },
  messageFiles: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
  },
  replyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: Spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.sm,
    backgroundColor: `${Colors.primary}10`,
  },
  replyButtonText: {
    fontSize: FontSize.xs - 1,
    color: Colors.primary,
    fontWeight: "500",
  },

  // === Reply form ===
  replyForm: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: `${Colors.primary}30`,
  },
  replyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  replyTitle: {
    fontSize: FontSize.xs,
    color: Colors.text,
    fontWeight: "500",
  },
  replyInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  replyActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  charCount: {
    fontSize: FontSize.xs - 1,
    color: Colors.textMuted,
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  sendButtonText: {
    color: Colors.background,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },

  // === Danger zone ===
  dangerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: `${Colors.error}40`,
  },
  dangerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  dangerTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.error,
  },
  dangerDescription: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  dangerButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.error,
    alignSelf: "flex-start",
  },
  dangerButtonText: {
    fontSize: FontSize.xs,
    color: Colors.error,
    fontWeight: "500",
  },

  // === Common ===
  disabled: {
    opacity: 0.5,
  },
});
