/**
 * Biometric settings screen — enable/disable Face ID / Touch ID / Fingerprint.
 *
 * Shows:
 *   - Device support status (Face ID? Touch ID? Fingerprint?)
 *   - Toggle to enable/disable biometric login
 *   - Test button to prompt biometric and verify it works
 *   - Explanation of how it works
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import {
  checkBiometricSupport,
  authenticateWithBiometric,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
  type BiometricSupport,
} from "@/services/biometric";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function BiometricScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppStore((s) => s.user);
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const loadState = async () => {
    try {
      const [s, enabled] = await Promise.all([
        checkBiometricSupport(),
        isBiometricEnabled(),
      ]);
      setSupport(s);
      setIsEnabled(enabled);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  const handleToggle = async (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (value) {
      // Enabling — first verify biometric works
      const result = await authenticateWithBiometric(
        "Подтвердите, чтобы включить биометрию"
      );
      if (result.success) {
        await enableBiometric(user?.email || "");
        setIsEnabled(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          "Готово!",
          `Биометрия включена. Теперь вы можете входить через ${support?.displayName || "биометрию"}.`
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          "Не удалось",
          result.warning || "Биометрия не подтверждена"
        );
      }
    } else {
      await disableBiometric();
      setIsEnabled(false);
      Alert.alert("Отключено", "Биометрия отключена");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await authenticateWithBiometric("Проверка биометрии");
    setTesting(false);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("✓ Успешно", "Биометрия работает корректно");
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Не подтверждено", result.warning || "Попробуйте ещё раз");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Биометрия</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xl }}>
        {/* Support status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Поддержка устройства</Text>
          <View style={styles.supportCard}>
            <Ionicons
              name={support?.supportedTypes.includes(2) ? "face-detector" : "finger-print"}
              size={48}
              color={support?.hasHardware ? Colors.primary : Colors.textMuted}
            />
            <Text style={styles.supportName}>{support?.displayName || "Недоступно"}</Text>
            <Text style={styles.supportStatus}>
              {!support?.hasHardware
                ? "Биометрия не обнаружена на этом устройстве"
                : !support?.isEnrolled
                ? "Не настроена. Добавьте отпечаток/Face ID в настройках устройства."
                : "Готово к использованию ✓"}
            </Text>
          </View>
        </View>

        {/* Toggle */}
        <View style={styles.section}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>
                Вход по {support?.displayName || "биометрии"}
              </Text>
              <Text style={styles.toggleDesc}>
                Включите, чтобы входить в приложение без пароля — через Face ID / отпечаток пальца.
              </Text>
            </View>
            <Switch
              value={isEnabled}
              onValueChange={handleToggle}
              disabled={!support?.hasHardware || !support?.isEnrolled}
              trackColor={{ true: Colors.primary, false: Colors.border }}
            />
          </View>
        </View>

        {/* Test button */}
        {isEnabled && (
          <View style={styles.section}>
            <Pressable style={styles.testBtn} onPress={handleTest} disabled={testing}>
              {testing ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="finger-print" size={20} color="white" />
                  <Text style={styles.testBtnText}>Проверить биометрию</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* How it works */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Как это работает</Text>
          <View style={styles.stepCard}>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
              <Text style={styles.stepText}>
                Войдите обычным способом (email + пароль)
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
              <Text style={styles.stepText}>
                Включите биометрию в этом разделе
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
              <Text style={styles.stepText}>
                При следующем запуске приложение попросит Face ID / отпечаток вместо пароля
              </Text>
            </View>
          </View>
        </View>

        {/* Privacy note */}
        <View style={styles.privacyCard}>
          <Ionicons name="shield-checkmark" size={20} color={Colors.success} />
          <Text style={styles.privacyText}>
            Биометрические данные никогда не покидают устройство. Мы храним только флаг "биометрия включена" и email для входа — в зашифрованном SecureStore.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  section: { padding: Spacing.md, borderTopWidth: 8, borderTopColor: Colors.surface },
  sectionTitle: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text, marginBottom: Spacing.sm },
  supportCard: { alignItems: "center", padding: Spacing.lg, backgroundColor: Colors.surface, borderRadius: BorderRadius.md },
  supportName: { fontSize: FontSize.xl, fontWeight: "700", color: Colors.text, marginTop: Spacing.md },
  supportStatus: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.xs, textAlign: "center" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  toggleTitle: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text },
  toggleDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, lineHeight: 18 },
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: Colors.primary, paddingVertical: Spacing.md, borderRadius: BorderRadius.pill, gap: Spacing.xs },
  testBtnText: { color: "white", fontSize: FontSize.md, fontWeight: "600" },
  stepCard: { backgroundColor: Colors.surface, padding: Spacing.md, borderRadius: BorderRadius.md, gap: Spacing.md },
  stepRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.primary, justifyContent: "center", alignItems: "center" },
  stepNumText: { color: "white", fontSize: FontSize.xs, fontWeight: "700" },
  stepText: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  privacyCard: { margin: Spacing.md, padding: Spacing.md, backgroundColor: Colors.success + "11", borderRadius: BorderRadius.md, flexDirection: "row", gap: Spacing.sm },
  privacyText: { flex: 1, fontSize: FontSize.xs, color: Colors.text, lineHeight: 16 },
});
