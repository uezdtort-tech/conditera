/**
 * Voice message service — recording + playback using expo-av.
 *
 * Recording:
 *   - Request microphone permission
 *   - Start recording with high-quality AAC settings
 *   - Stop recording → returns local URI + duration
 *   - Upload URI to backend (would be `/api/upload/voice` in production)
 *
 * Playback:
 *   - Load audio from URI (local or remote)
 *   - Play / pause / stop
 *   - Track progress (currentTime / duration)
 *   - Auto-release on completion
 */
import { Audio, type AVPlaybackStatus } from "expo-av";
import { Platform, Alert } from "react-native";

export interface RecordingResult {
  uri: string;
  durationMs: number;
  sizeBytes?: number;
}

export interface PlaybackState {
  isLoaded: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  didJustFinish: boolean;
}

const RECORDING_OPTIONS = {
  isMeteringEnabled: true,
  android: {
    extension: ".m4a",
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: ".m4a",
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
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
};

let recordingInstance: Audio.Recording | null = null;

/**
 * Request microphone permission.
 * Returns true if granted.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const { status } = await Audio.requestPermissionsAsync();
    return status === "granted";
  } catch (e) {
    console.error("Microphone permission error:", e);
    return false;
  }
}

/**
 * Start recording audio.
 * Throws if permission denied or already recording.
 */
export async function startRecording(): Promise<void> {
  if (recordingInstance) {
    throw new Error("Already recording");
  }

  const granted = await requestMicrophonePermission();
  if (!granted) {
    throw new Error("Микрофон не разрешён. Включите в настройках устройства.");
  }

  // Configure audio mode for recording
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: false,
    });
  } catch (e) {
    console.warn("Audio mode setup failed:", e);
  }

  recordingInstance = new Audio.Recording();
  await recordingInstance.prepareToRecordAsync(RECORDING_OPTIONS);
  await recordingInstance.startAsync();
  console.log("[voice] recording started");
}

/**
 * Stop recording and return the audio file URI + duration.
 */
export async function stopRecording(): Promise<RecordingResult> {
  if (!recordingInstance) {
    throw new Error("Not recording");
  }

  try {
    await recordingInstance.stopAndUnloadAsync();
    const uri = recordingInstance.getURI();
    if (!uri) {
      throw new Error("Recording URI is null");
    }

    // Get duration from the audio file
    let durationMs = 0;
    try {
      const { sound } = await recordingInstance.createNewLoadedSoundAsync();
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        durationMs = status.durationMillis || 0;
      }
      await sound.unloadAsync();
    } catch (e) {
      console.warn("Failed to get recording duration:", e);
    }

    const result: RecordingResult = {
      uri,
      durationMs,
    };
    console.log(`[voice] recording stopped: ${uri} (${durationMs}ms)`);
    return result;
  } finally {
    recordingInstance = null;
    // Reset audio mode
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (e) {
      // ignore
    }
  }
}

/**
 * Cancel recording — discard the file without returning it.
 */
export async function cancelRecording(): Promise<void> {
  if (!recordingInstance) return;
  try {
    await recordingInstance.stopAndUnloadAsync();
  } catch (e) {
    // ignore
  }
  recordingInstance = null;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  } catch (e) {
    // ignore
  }
  console.log("[voice] recording cancelled");
}

/**
 * Get current recording metering (for waveform visualization).
 * Returns dB value, or null if not recording.
 */
export async function getRecordingMetering(): Promise<number | null> {
  if (!recordingInstance) return null;
  try {
    const status = await recordingInstance.getStatusAsync();
    if (status.isRecording && status.metering !== undefined) {
      return status.metering;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// ===== Playback =====

interface PlaybackInstance {
  sound: Audio.Sound;
  uri: string;
  onStatusUpdate?: (state: PlaybackState) => void;
}

const activePlayback = new Map<string, PlaybackInstance>();

/**
 * Load audio for playback (does not start playing).
 * Returns a playbackId (the URI) that can be used to control playback.
 */
export async function loadAudio(
  uri: string,
  onStatusUpdate?: (state: PlaybackState) => void
): Promise<string> {
  // If already loaded, return existing
  if (activePlayback.has(uri)) {
    return uri;
  }

  const { sound } = await Audio.Sound.createAsync(
    { uri },
    { shouldPlay: false, progressUpdateIntervalMillis: 100 },
    (status: AVPlaybackStatus) => {
      const inst = activePlayback.get(uri);
      if (!inst) return;
      if (!status.isLoaded) {
        inst.onStatusUpdate?.({
          isLoaded: false,
          isPlaying: false,
          positionMs: 0,
          durationMs: 0,
          didJustFinish: false,
        });
        return;
      }
      const state: PlaybackState = {
        isLoaded: true,
        isPlaying: status.isPlaying,
        positionMs: status.positionMillis || 0,
        durationMs: status.durationMillis || 0,
        didJustFinish: status.didJustFinish || false,
      };
      inst.onStatusUpdate?.(state);
      if (state.didJustFinish) {
        // Reset position to start, but keep paused
        sound.setPositionAsync(0).catch(() => {});
      }
    }
  );

  activePlayback.set(uri, { sound, uri, onStatusUpdate });
  console.log(`[voice] loaded: ${uri}`);
  return uri;
}

/**
 * Play loaded audio. If already playing, pause.
 */
export async function playAudio(uri: string): Promise<void> {
  const inst = activePlayback.get(uri);
  if (!inst) {
    throw new Error("Audio not loaded");
  }
  await inst.sound.playAsync();
}

/**
 * Pause playback.
 */
export async function pauseAudio(uri: string): Promise<void> {
  const inst = activePlayback.get(uri);
  if (!inst) return;
  await inst.sound.pauseAsync();
}

/**
 * Stop and reset to start.
 */
export async function stopAudio(uri: string): Promise<void> {
  const inst = activePlayback.get(uri);
  if (!inst) return;
  await inst.sound.stopAsync();
}

/**
 * Seek to position (ms).
 */
export async function seekAudio(uri: string, positionMs: number): Promise<void> {
  const inst = activePlayback.get(uri);
  if (!inst) return;
  await inst.sound.setPositionAsync(positionMs);
}

/**
 * Unload audio to free memory.
 */
export async function unloadAudio(uri: string): Promise<void> {
  const inst = activePlayback.get(uri);
  if (!inst) return;
  await inst.sound.unloadAsync();
  activePlayback.delete(uri);
}

/**
 * Unload all audio (call on screen unmount).
 */
export async function unloadAllAudio(): Promise<void> {
  for (const [uri, inst] of activePlayback) {
    try {
      await inst.sound.unloadAsync();
    } catch (e) {
      // ignore
    }
  }
  activePlayback.clear();
}

/**
 * Format duration in mm:ss format.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
