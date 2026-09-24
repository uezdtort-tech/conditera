"use client";

/**
 * VoiceMessagePlayer — проигрывание голосового сообщения в чате.
 *
 * Показывает:
 *  - Кнопку play/pause
 *  - Waveform-визуализацию с прогрессом
 *  - Длительность в MM:SS
 *
 * Web Audio API для воспроизведения через <audio> элемент.
 */

import { useState, useRef, useEffect } from "react";
import { Play, Pause } from "lucide-react";
import { formatDuration } from "@/hooks/useVoiceRecorder";
import { cn } from "@/lib/utils";

interface VoiceMessagePlayerProps {
  url: string;
  durationSec: number;
  waveform?: number[];
  isOwn?: boolean;
}

export function VoiceMessagePlayer({
  url,
  durationSec,
  waveform,
  isOwn,
}: VoiceMessagePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.preload = "metadata";

    const onTimeUpdate = () => setCurrentSec(audio.currentTime);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentSec(0);
    };
    const onLoaded = () => {
      // Реальная длительность может отличаться от переданной
      if (audio.duration && isFinite(audio.duration)) {
        // используем реальную
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoaded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [url]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  };

  const progress = durationSec > 0 ? currentSec / durationSec : 0;

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <button
        onClick={toggle}
        className={cn(
          "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
          isOwn
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        {isPlaying ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5 ml-0.5" />
        )}
      </button>

      {/* Waveform */}
      <div className="flex-1 flex items-center gap-0.5 h-8">
        {waveform && waveform.length > 0 ? (
          waveform.map((amp, i) => {
            const isPassed = i / waveform.length < progress;
            const height = Math.max(2, Math.min(28, amp * 32));
            return (
              <div
                key={i}
                className={cn(
                  "w-0.5 rounded-full transition-colors",
                  isPassed
                    ? isOwn
                      ? "bg-primary-foreground/80"
                      : "bg-primary"
                    : isOwn
                    ? "bg-primary-foreground/30"
                    : "bg-muted-foreground/30"
                )}
                style={{ height: `${height}px` }}
              />
            );
          })
        ) : (
          // Fallback: равномерные полоски
          Array.from({ length: 30 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-0.5 rounded-full",
                i / 30 < progress
                  ? isOwn ? "bg-primary-foreground/80" : "bg-primary"
                  : isOwn ? "bg-primary-foreground/30" : "bg-muted-foreground/30"
              )}
              style={{ height: `${6 + Math.sin(i * 0.5) * 4 + 4}px` }}
            />
          ))
        )}
      </div>

      {/* Duration */}
      <div
        className={cn(
          "text-[10px] tabular-nums shrink-0",
          isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
        )}
      >
        {formatDuration(Math.ceil(isPlaying ? currentSec : durationSec))}
      </div>
    </div>
  );
}
