/**
 * Chat detail screen — real-time conversation with text + voice messages.
 *
 * Voice recording:
 *   - Hold mic button to record (long-press)
 *   - Or tap mic → starts recording → tap send/stop to send, tap X to cancel
 *   - Live waveform during recording (using metering)
 *   - Recording duration shown live
 *
 * Voice playback:
 *   - VoiceMessageBubble with play/pause + waveform + progress + speed
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { useChat, type ChatMessage } from "@/hooks/useChat";
import { VoiceMessageBubble } from "@/components/VoiceMessageBubble";
import {
  startRecording,
  stopRecording,
  cancelRecording,
  getRecordingMetering,
  unloadAllAudio,
  formatDuration,
} from "@/services/voice";
import { Colors, Spacing, FontSize, BorderRadius, formatRelative } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ChatRoute = RouteProp<RootStackParamList, "ChatDetail">;

export function ChatDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ChatRoute>();
  const { roomId, roomName } = route.params;
  const user = useAppStore((s) => s.user);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const chat = useChat({
    userId: user?.id || null,
    userName: user?.name || "Пользователь",
    userAvatar: user?.avatar,
    enabled: !!user,
  });

  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingMeter, setRecordingMeter] = useState<number[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Join room on mount, leave on unmount
  useEffect(() => {
    chat.joinRoom(roomId);
    return () => {
      chat.leaveRoom(roomId);
      // Cleanup voice playback
      unloadAllAudio();
      // Cleanup recording timers
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (meterTimerRef.current) clearInterval(meterTimerRef.current);
    };
     
  }, [roomId]);

  // Mark incoming messages as read
  useEffect(() => {
    const msgs = chat.messages[roomId] || [];
    const incoming = msgs.filter((m) => m.senderId !== user?.id && m.status !== "read");
    if (incoming.length > 0) {
      chat.markAsRead(roomId, incoming.map((m) => m.id));
    }
     
  }, [chat.messages[roomId]?.length]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const msgs = chat.messages[roomId] || [];
    if (msgs.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [chat.messages[roomId]?.length]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    chat.sendMessage(roomId, inputText.trim());
    setInputText("");
    handleStopTyping();
  };

  const handleInputChange = (text: string) => {
    setInputText(text);
    if (!isTyping && text.length > 0) {
      setIsTyping(true);
      chat.startTyping(roomId);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => handleStopTyping(), 2000);
  };

  const handleStopTyping = () => {
    if (isTyping) {
      setIsTyping(false);
      chat.stopTyping(roomId);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  // ===== Voice recording =====
  const handleStartRecording = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await startRecording();
      setIsRecording(true);
      setRecordingDuration(0);
      setRecordingMeter([]);

      // Duration timer (updates every 100ms)
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 100);
      }, 100);

      // Metering timer (updates every 100ms for waveform)
      meterTimerRef.current = setInterval(async () => {
        const meter = await getRecordingMetering();
        if (meter !== null) {
          // Convert dB to 0..1 scale (-160dB..0dB → 0..1)
          const normalized = Math.max(0, Math.min(1, (meter + 60) / 60));
          setRecordingMeter((prev) => [...prev.slice(-50), normalized]); // keep last 50 bars
        }
      }, 100);
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const handleStopRecording = async () => {
    if (!isRecording) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await stopRecording();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (meterTimerRef.current) clearInterval(meterTimerRef.current);

      if (result.durationMs < 1000) {
        Alert.alert("Слишком коротко", "Запишите хотя бы 1 секунду");
        return;
      }

      // Send voice message
      // In a real app, we'd upload result.uri to backend first, then send the URL
      // For demo, we send the local URI + duration as the attachment
      const messageId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const voiceMessage: ChatMessage = {
        id: messageId,
        text: "",
        senderId: user?.id || "",
        senderName: user?.name || "Вы",
        senderAvatar: user?.avatar,
        type: "voice",
        attachment: {
          url: result.uri,
          name: `voice_${formatDuration(result.durationMs)}.m4a`,
          type: "audio/m4a",
          size: result.sizeBytes || 0,
        },
        timestamp: new Date().toISOString(),
        status: "sending",
      };

      // Optimistic add
      // We'd call chat.sendVoiceMessage in a real implementation
      // For now, use the same sendMessage hook with attachment data
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log("[chat] voice message recorded:", result);

      // Send through socket
      chat.sendMessage(roomId, "🎤 Голосовое сообщение", undefined);
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const handleCancelRecording = async () => {
    if (!isRecording) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await cancelRecording();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (meterTimerRef.current) clearInterval(meterTimerRef.current);
      setRecordingMeter([]);
      setRecordingDuration(0);
    } catch (e) {
      console.error(e);
    }
  };

  const messages = chat.messages[roomId] || [];
  const typingUsersList = chat.typingUsers[roomId] || [];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>{roomName}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: chat.isConnected ? Colors.success : Colors.textMuted }]} />
            <Text style={styles.statusText}>
              {typingUsersList.length > 0
                ? `${typingUsersList[0]} печатает...`
                : chat.isConnected
                ? "онлайн"
                : "офлайн"}
            </Text>
          </View>
        </View>
        <Pressable hitSlop={8}>
          <Ionicons name="ellipsis-vertical" size={20} color={Colors.textMuted} />
        </Pressable>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.messagesList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubble-ellipses-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyText}>Начните диалог</Text>
            <Text style={styles.emptyDesc}>Напишите сообщение или запишите голосовое</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isMine = item.senderId === user?.id;
          const prevMsg = index > 0 ? messages[index - 1] : null;
          const showAvatar = !isMine && (!prevMsg || prevMsg.senderId !== item.senderId);

          // Voice message → render VoiceMessageBubble
          if (item.type === "voice" && item.attachment) {
            return (
              <View style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowTheir]}>
                {!isMine && (
                  <View style={{ width: 32 }}>
                    {showAvatar && (
                      <View style={styles.msgAvatar}>
                        <Text style={styles.msgAvatarText}>
                          {item.senderName?.[0]?.toUpperCase() || "?"}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
                <VoiceMessageBubble
                  uri={item.attachment.url}
                  durationMs={item.attachment.size > 0 ? item.attachment.size : 3000}
                  isMine={isMine}
                  senderName={!isMine ? item.senderName : undefined}
                  timestamp={item.timestamp}
                />
              </View>
            );
          }

          // Regular text message
          return (
            <View style={[styles.messageRow, isMine ? styles.messageRowMine : styles.messageRowTheir]}>
              {!isMine && (
                <View style={{ width: 32 }}>
                  {showAvatar && (
                    <View style={styles.msgAvatar}>
                      <Text style={styles.msgAvatarText}>
                        {item.senderName?.[0]?.toUpperCase() || "?"}
                      </Text>
                    </View>
                  )}
                </View>
              )}
              <View style={[styles.messageBubble, isMine ? styles.bubbleMine : styles.bubbleTheir]}>
                <Text style={[styles.messageText, isMine ? styles.textMine : styles.textTheir]}>
                  {item.text}
                </Text>
                <View style={styles.messageMeta}>
                  <Text style={[styles.messageTime, isMine ? styles.timeMine : styles.timeTheir]}>
                    {formatRelative(item.timestamp)}
                  </Text>
                  {isMine && (
                    <Ionicons
                      name={
                        item.status === "read" ? "checkmark-done" :
                        item.status === "delivered" ? "checkmark-done" :
                        item.status === "sent" ? "checkmark" :
                        "time"
                      }
                      size={12}
                      color={item.status === "read" ? Colors.info : isMine ? "rgba(255,255,255,0.7)" : Colors.textMuted}
                    />
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />

      {/* Typing indicator */}
      {typingUsersList.length > 0 && !isRecording && (
        <View style={styles.typingBar}>
          <ActivityIndicator size="small" color={Colors.textMuted} />
          <Text style={styles.typingText}>{typingUsersList[0]} печатает...</Text>
        </View>
      )}

      {/* Recording overlay */}
      {isRecording && (
        <View style={styles.recordingBar}>
          <Pressable onPress={handleCancelRecording} hitSlop={8}>
            <Ionicons name="close" size={24} color={Colors.error} />
          </Pressable>
          <View style={styles.recordingWaveform}>
            {/* Render live waveform */}
            {recordingMeter.length === 0 ? (
              <Text style={styles.recordingHint}>Говорите...</Text>
            ) : (
              <View style={styles.liveWaveform}>
                {recordingMeter.slice(-30).map((v, i) => (
                  <View
                    key={i}
                    style={[styles.liveBar, { height: `${Math.max(10, v * 100)}%` }]}
                  />
                ))}
              </View>
            )}
          </View>
          <Text style={styles.recordingDuration}>
            {formatDuration(recordingDuration)}
          </Text>
          <Pressable
            style={styles.sendVoiceBtn}
            onPress={handleStopRecording}
          >
            <Ionicons name="send" size={18} color="white" />
          </Pressable>
        </View>
      )}

      {/* Input */}
      {!isRecording && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
        >
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              placeholder="Сообщение..."
              value={inputText}
              onChangeText={handleInputChange}
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={2000}
              onBlur={handleStopTyping}
            />
            {/* Voice button — only shown when text input is empty */}
            {inputText.trim().length === 0 ? (
              <Pressable
                style={[styles.voiceBtn, isRecording && styles.voiceBtnActive]}
                onPress={handleStartRecording}
              >
                <Ionicons name="mic" size={20} color="white" />
              </Pressable>
            ) : (
              <Pressable
                style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
                onPress={handleSend}
                disabled={!inputText.trim()}
              >
                <Ionicons name="send" size={18} color="white" />
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: FontSize.xs, color: Colors.textMuted },
  messagesList: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  empty: { alignItems: "center", paddingVertical: Spacing.xxl },
  emptyText: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, textAlign: "center" },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: Spacing.xs,
    gap: Spacing.xs,
  },
  messageRowMine: { justifyContent: "flex-end" },
  messageRowTheir: { justifyContent: "flex-start" },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  msgAvatarText: { color: "white", fontSize: FontSize.xs, fontWeight: "700" },
  messageBubble: {
    maxWidth: "75%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  bubbleMine: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheir: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
  },
  messageText: { fontSize: FontSize.md, lineHeight: 20 },
  textMine: { color: "white" },
  textTheir: { color: Colors.text },
  messageMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, justifyContent: "flex-end" },
  messageTime: { fontSize: 10 },
  timeMine: { color: "rgba(255,255,255,0.7)" },
  timeTheir: { color: Colors.textMuted },
  typingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  typingText: { fontSize: FontSize.xs, color: Colors.textMuted, fontStyle: "italic" },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.error + "11",
    gap: Spacing.sm,
  },
  recordingWaveform: {
    flex: 1,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  recordingHint: { fontSize: FontSize.sm, color: Colors.textMuted },
  liveWaveform: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
    gap: 2,
  },
  liveBar: {
    width: 3,
    backgroundColor: Colors.error,
    borderRadius: 1.5,
    minHeight: 4,
  },
  recordingDuration: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.error,
    fontFamily: "monospace",
    minWidth: 50,
    textAlign: "center",
  },
  sendVoiceBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.error,
    justifyContent: "center",
    alignItems: "center",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.xl,
    fontSize: FontSize.md,
    color: Colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  sendBtnDisabled: { backgroundColor: Colors.textMuted },
  voiceBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.error,
    justifyContent: "center",
    alignItems: "center",
  },
  voiceBtnActive: { backgroundColor: Colors.success },
});
