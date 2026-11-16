/**
 * Biometric authentication service.
 *
 * Uses expo-local-authentication for:
 *   - Face ID (iOS)
 *   - Touch ID (iOS)
 *   - Fingerprint (Android)
 *   - Iris (Android, Samsung)
 *   - Facial recognition (Android)
 *
 * On first login, user can opt-in to biometric. We store a flag in SecureStore.
 * On subsequent app launches, if the flag is set, we prompt biometric.
 *
 * Stored in SecureStore (encrypted):
 *   - "biometric_enabled": "true" | "false"
 *   - "biometric_user_email": stored email for re-login
 */
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_ENABLED_KEY = "conditera_biometric_enabled";
const BIOMETRIC_EMAIL_KEY = "conditera_biometric_email";

export interface BiometricSupport {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
  /** Human-readable name for the strongest available biometric */
  displayName: string;
}

/**
 * Check what biometric hardware the device has.
 */
export async function checkBiometricSupport(): Promise<BiometricSupport> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

  let displayName = "Биометрия";
  if (supportedTypes.includes(2)) displayName = "Face ID";
  else if (supportedTypes.includes(1)) displayName = "Touch ID";
  else if (supportedTypes.includes(3)) displayName = "Распознавание лица (Android)";
  else if (supportedTypes.includes(4)) displayName = "Iris";
  else if (supportedTypes.includes(5)) displayName = "Отпечаток пальца";

  return {
    hasHardware,
    isEnrolled,
    supportedTypes,
    displayName,
  };
}

/**
 * Check if user has enabled biometric login.
 */
export async function isBiometricEnabled(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return value === "true";
}

/**
 * Enable biometric login for this device, storing the user's email for re-auth.
 */
export async function enableBiometric(email: string): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
  await SecureStore.setItemAsync(BIOMETRIC_EMAIL_KEY, email);
}

/**
 * Disable biometric login.
 */
export async function disableBiometric(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
  await SecureStore.deleteItemAsync(BIOMETRIC_EMAIL_KEY);
}

/**
 * Get the email associated with biometric login (if enabled).
 */
export async function getBiometricEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(BIOMETRIC_EMAIL_KEY);
}

export interface BiometricAuthResult {
  success: boolean;
  error?: "user_cancel" | "user_fallback" | "system_cancel" | "app_cancel" | "lockout" | "unavailable" | "unknown";
  warning?: string;
}

/**
 * Prompt the user for biometric authentication.
 * Returns success=true if authenticated, else error details.
 */
export async function authenticateWithBiometric(
  promptMessage = "Войдите в Кондитера",
  options: { disableDeviceFallback?: boolean } = {}
): Promise<BiometricAuthResult> {
  const support = await checkBiometricSupport();
  if (!support.hasHardware) {
    return { success: false, error: "unavailable", warning: "Биометрия недоступна на этом устройстве" };
  }
  if (!support.isEnrolled) {
    return { success: false, error: "unavailable", warning: "Биометрия не настроена. Добавьте отпечаток/Face ID в настройках устройства." };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Отмена",
    fallbackLabel: "Ввести пароль",
    disableDeviceFallback: options.disableDeviceFallback ?? false,
  });

  if (result.success) {
    return { success: true };
  }

  const errorMap: Record<number, BiometricAuthResult["error"]> = {
    [LocalAuthentication.AuthenticationError.USER_CANCEL]: "user_cancel",
    [LocalAuthentication.AuthenticationError.USER_FALLBACK]: "user_fallback",
    [LocalAuthentication.AuthenticationError.SYSTEM_CANCEL]: "system_cancel",
    [LocalAuthentication.AuthenticationError.APP_CANCEL]: "app_cancel",
    [LocalAuthentication.AuthenticationError.LOCKOUT]: "lockout",
  };

  return {
    success: false,
    error: errorMap[result.error] || "unknown",
    warning: result.warning || (result.error === "lockout"
      ? "Слишком много попыток. Попробуйте позже."
      : undefined),
  };
}
