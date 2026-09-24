"use client";

/**
 * useVoiceRecorder — запись голосовых сообщений в чат.
 *
 * Web-версия: MediaRecorder API + Web Audio API для waveform.
 * Mobile (expo-av): см. mobile-app/src/hooks/useVoiceRecorder.ts
 *
 * Flow:
 *  1. start() — запрашивает микрофон, начинает запись
 *  2. Анализатор собирает waveform каждые 100мс
 *  3. stop() — останавливает, возвращает { url, durationSec, waveform }
 *  4. cancel() — отменяет запись без возврата данных
 *
 * Браузерная поддержка: Chrome 47+, Firefox 25+, Safari 14.1+, Edge 79+
 * Формат: audio/webm (Chrome/Firefox), audio/mp4 (Safari)
 */

import { useState, useRef, useCallback, useEffect } from "react";

export interface VoiceRecording {
  url: string;          // blob URL или data URL
  durationSec: number;
  waveform: number[];   // 0..1
  mimeType: string;
}

interface UseVoiceRecorderOptions {
  maxDurationSec?: number;       // авто-стоп, по умолчанию 120
  waveformSamples?: number;      // количество точек в waveform, по умолчанию 50
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}) {
  const { maxDurationSec = 120, waveformSamples = 50 } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0); // 0..1, текущий уровень сигнала

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const waveformIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (waveformIntervalRef.current) clearInterval(waveformIntervalRef.current);
    if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setElapsedSec(0);
    waveformRef.current = [];

    try {
      // Запрос микрофона
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      // AudioContext для waveform
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      recorder.start();
      setIsRecording(true);
      startTimeRef.current = Date.now();

      // Timer: обновляем elapsedSec каждую секунду
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsedSec(elapsed);
        if (elapsed >= maxDurationSec) {
          stop();
        }
      }, 1000);

      // Waveform: собираем пиковые амплитуды каждые 100мс
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      waveformIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        // Считаем RMS (root mean square) — общую громкость
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setLevel(rms);
        // Сохраняем в waveform (массив 50 элементов)
        waveformRef.current.push(rms);
        if (waveformRef.current.length > waveformSamples) {
          waveformRef.current.shift();
        }
      }, 100);

      // Auto-stop после maxDurationSec
      autoStopTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          stop();
        }
      }, maxDurationSec * 1000);
    } catch (e) {
      console.error("useVoiceRecorder start error:", e);
      setError(
        e instanceof Error
          ? e.message.includes("Permission")
            ? "Доступ к микрофону запрещён. Разрешите доступ в настройках браузера."
            : e.message
          : "Не удалось получить доступ к микрофону"
      );
      cleanup();
      setIsRecording(false);
    }
  }, [maxDurationSec, waveformSamples, cleanup]);

  const stop = useCallback((): Promise<VoiceRecording | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== "recording") {
        cleanup();
        setIsRecording(false);
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        const durationSec = Math.floor((Date.now() - startTimeRef.current) / 1000);

        // Нормализуем waveform до waveformSamples
        const raw = waveformRef.current;
        let waveform: number[] = [];
        if (raw.length > 0) {
          const step = raw.length / waveformSamples;
          for (let i = 0; i < waveformSamples; i++) {
            const idx = Math.floor(i * step);
            waveform.push(Math.min(1, raw[idx] || 0));
          }
        }

        cleanup();
        setIsRecording(false);
        setLevel(0);
        resolve({
          url,
          durationSec: Math.max(1, durationSec),
          waveform,
          mimeType: recorder.mimeType,
        });
      };

      recorder.stop();
    });
  }, [cleanup]);

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {}
    }
    cleanup();
    setIsRecording(false);
    setLevel(0);
    setElapsedSec(0);
  }, [cleanup]);

  return {
    isRecording,
    elapsedSec,
    error,
    level,
    start,
    stop,
    cancel,
  };
}

/**
 * Форматирование длительности в MM:SS
 */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
