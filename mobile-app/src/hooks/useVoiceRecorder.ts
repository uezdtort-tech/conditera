/**
 * useVoiceRecorder — hook для записи голосовых сообщений в mobile-app.
 *
 * Использует expo-av (Audio.Recording).
 * Web-версия: src/hooks/useVoiceRecorder.ts (Web Audio API)
 *
 * Flow:
 *  1. start() — запрашивает разрешения, начинает запись
 *  2. stop() → { uri, durationMs } → загрузить на сервер через /api/chat/upload
 *  3. cancel() — отменяет без сохранения
 *
 * Возвращает состояние + функции для UI.
 */

import { useState, useCallback, useRef } from "react";
import { Audio } from "expo-av";
import { Platform, Alert } from "react-native";

export interface MobileRecording {
  uri: string;
  durationMs: number;
  sizeBytes?: number;
}

interface UseVoiceRecorderOptions {
  maxDurationMs?: number;       // авто-стоп, по умолчанию 120000 (2 мин)
  onRecordingComplete?: (rec: MobileRecording) => void;
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { maxDurationMs = 120000, onRecordingComplete } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0); // 0..1 для визуализации
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    timerRef.current = null;
    autoStopRef.current = null;
  }, []);

  /**
   * Запросить разрешение на микрофон.
   */
  const requestPermission = async (): Promise<boolean> => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Доступ к микрофону запрещён",
          "Разрешите доступ в настройках приложения, чтобы записывать голосовые сообщения.",
          [{ text: "OK" }]
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error("Permission request error:", e);
      return false;
    }
  };

  /**
   * Начать запись.
   */
  const start = useCallback(async () => {
    setError(null);
    setElapsedMs(0);
    setLevel(0);

    const granted = await requestPermission();
    if (!granted) {
      setError("Доступ к микрофону запрещён");
      return;
    }

    try {
      // Настройки аудио: AAC, 128 kbps, 44.1 kHz — хороший баланс качества/размера
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordingAsync({
        android: {
          extension: ".m4a",
          outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
          audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: ".m4a",
          outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
          audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: "audio/webm",
          bitsPerSecond: 128000,
        },
      });

      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      startTimeRef.current = Date.now();

      // Timer: обновляем elapsed каждые 100мс
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setElapsedMs(elapsed);

        // Случайная визуализация уровня (expo-av не отдаёт реальный level)
        // В проде можно подключить expo-av-visualizer
        setLevel(0.3 + Math.random() * 0.5);

        if (elapsed >= maxDurationMs) {
          stop();
        }
      }, 100);

      // Auto-stop
      autoStopRef.current = setTimeout(() => {
        if (recordingRef.current) {
          stop();
        }
      }, maxDurationMs);
    } catch (e) {
      console.error("Recording start error:", e);
      setError("Не удалось начать запись: " + (e as Error).message);
      cleanup();
      setIsRecording(false);
    }
  }, [maxDurationMs, cleanup]);

  /**
   * Остановить запись и вернуть результат.
   */
  const stop = useCallback(async (): Promise<MobileRecording | null> => {
    const recording = recordingRef.current;
    if (!recording) {
      cleanup();
      setIsRecording(false);
      return null;
    }

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const status = await recording.getStatusAsync();

      cleanup();
      setIsRecording(false);
      setLevel(0);

      if (!uri) {
        setError("Запись не сохранена");
        return null;
      }

      const result: MobileRecording = {
        uri,
        durationMs: status.durationMillis || (Date.now() - startTimeRef.current),
      };

      // Восстанавливаем аудио-режим
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      onRecordingComplete?.(result);
      return result;
    } catch (e) {
      console.error("Recording stop error:", e);
      setError("Не удалось сохранить запись");
      cleanup();
      setIsRecording(false);
      return null;
    }
  }, [cleanup, onRecordingComplete]);

  /**
   * Отменить запись без сохранения.
   */
  const cancel = useCallback(async () => {
    const recording = recordingRef.current;
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {}
    }
    cleanup();
    setIsRecording(false);
    setLevel(0);
    setElapsedMs(0);
  }, [cleanup]);

  return {
    isRecording,
    elapsedMs,
    level,
    error,
    start,
    stop,
    cancel,
  };
}

/**
 * Format duration in mm:ss
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
