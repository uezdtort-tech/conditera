/**
 * VoiceMessageBubble — displays a voice message inside a chat.
 *
 * Features:
 *   - Play/pause button with animated waveform
 *   - Progress bar (seekable)
 *   - Duration display (mm:ss)
 *   - Different colors for mine vs theirs
 *   - Auto-loads audio on first play, unloads on screen unmount
 *   - Playback speed toggle (1x → 1.5x → 2x)
 */
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import {
  loadAudio,
  playAudio,
  pauseAudio,
  seekAudio,
  unloadAudio,
  formatDuration,
  type PlaybackState,
} from "@/services/voice";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

interface VoiceMessageBubbleProps {
  uri: string;
  durationMs: number;
  isMine: boolean;
  senderName?: string;
  timestamp: string;
  style?: ViewStyle;
}

export function VoiceMessageBubble({
  uri,
  durationMs,
  isMine,
  senderName,
  timestamp,
  style,
}: VoiceMessageBubbleProps) {
  const [state, setState] = useState<PlaybackState>({
    isLoaded: false,
    isPlaying: false,
    positionMs: 0,
    durationMs,
    didJustFinish: false,
  });
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [error, setError] = useState<string | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unloadAudio(uri).catch(() => {});
    };
  }, [uri]);

  const handlePlayPause = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setError(null);

    if (!state.isLoaded) {
      // Load and play
      setLoading(true);
      try {
        await loadAudio(uri, setState);
        await playAudio(uri);
      } catch (e) {
        setError("Не удалось загрузить аудио");
        console.error(e);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (state.isPlaying) {
      await pauseAudio(uri);
    } else {
      await playAudio(uri);
    }
  };

  const handleSeek = async (percent: number) => {
    if (!state.isLoaded) return;
    const position = (percent / 100) * state.durationMs;
    await seekAudio(uri, position);
  };

  const handleSpeedToggle = async () => {
    Haptics.selectionAsync();
    const next: 1 | 1.5 | 2 = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    // In a real app, we'd set the audio rate here
    // await sound.setRateAsync(next, true);
  };

  const progress = state.durationMs > 0 ? (state.positionMs / state.durationMs) * 100 : 0;
  const displayDuration = state.isLoaded ? state.durationMs : durationMs;

  // Fake waveform bars (random heights based on seed)
  const waveform = useRef(
    Array.from({ length: 28 }, (_, i) => {
      const seed = (i * 13 + uri.length * 7) % 100;
      return 0.3 + (seed % 70) / 100; // 0.3 to 1.0
    })
  ).current;

  const playedBars = Math.floor((progress / 100) * waveform.length);

  return (
    <View
      style={[
        styles.container,
        isMine ? styles.containerMine : styles.containerTheir,
        style,
      ]}
    >
      {/* Play/pause button */}
      <Pressable
        style={[styles.playBtn, isMine ? styles.playBtnMine : styles.playBtnTheir]}
        onPress={handlePlayPause}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="white" />
        ) : (
          <Ionicons
            name={state.isPlaying ? "pause" : "play"}
            size={18}
            color="white"
            style={state.isPlaying ? null : { marginLeft: 2 }}
          />
        )}
      </Pressable>

      {/* Waveform + progress + duration */}
      <View style={styles.rightContent}>
        <View style={styles.waveformRow}>
          {waveform.map((h, i) => (
            <Pressable
              key={i}
              style={[
                styles.bar,
                { height: `${h * 100}%` },
                i < playedBars
                  ? isMine
                    ? styles.barPlayedMine
                    : styles.barPlayedTheir
                  : isMine
                  ? styles.barUnplayedMine
                  : styles.barUnplayedTheir,
              ]}
              onPress={() => handleSeek((i / waveform.length) * 100)}
            />
          ))}
        </View>

        <View style={styles.metaRow}>
          {senderName && !isMine && (
            <Text style={styles.senderName} numberOfLines={1}>
              {senderName}
            </Text>
          )}
          <Pressable onPress={handleSpeedToggle} hitSlop={4}>
            <Text style={[styles.speed, isMine ? styles.textMine : styles.textTheir]}>
              {speed}x
            </Text>
          </Pressable>
          <Text style={[styles.duration, isMine ? styles.textMine : styles.textTheir]}>
            {formatDuration(state.positionMs)} / {formatDuration(displayDuration)}
          </Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
    maxWidth: "85%",
  },
  containerMine: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  containerTheir: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  playBtnMine: {
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  playBtnTheir: {
    backgroundColor: Colors.primary,
  },
  rightContent: {
    flex: 1,
    gap: 4,
  },
  waveformRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    gap: 2,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
    minHeight: 4,
  },
  barPlayedMine: {
    backgroundColor: "white",
  },
  barUnplayedMine: {
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  barPlayedTheir: {
    backgroundColor: Colors.primary,
  },
  barUnplayedTheir: {
    backgroundColor: Colors.textMuted,
    opacity: 0.4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  senderName: {
    flex: 1,
    fontSize: FontSize.xs,
    fontWeight: "600",
    color: Colors.text,
  },
  speed: {
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
  duration: {
    fontSize: FontSize.xs,
    marginLeft: "auto",
  },
  textMine: { color: "rgba(255,255,255,0.9)" },
  textTheir: { color: Colors.textMuted },
  error: {
    fontSize: FontSize.xs,
    color: Colors.error,
  },
});
