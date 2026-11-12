/**
 * Notification preferences screen — toggle channels and categories.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { notificationsApi, type NotificationPreferences } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function NotificationPreferencesScreen() {
  const navigation = useNavigation<Nav>();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { preferences } = await notificationsApi.preferences();
      setPrefs(preferences);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const update = (key: keyof NotificationPreferences, value: boolean | number) => {
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      await notificationsApi.updatePreferences(prefs);
      Alert.alert("Сохранено", "Настройки уведомлений обновлены");
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !prefs) {
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
        <Text style={styles.headerTitle}>Настройки уведомлений</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <Section title="Каналы связи">
          <ToggleRow icon="mail" label="Email" desc="На адрес вашей почты" value={prefs.emailEnabled} onValueChange={(v) => update("emailEnabled", v)} />
          <ToggleRow icon="chatbubble" label="SMS" desc="На номер телефона (платная опция)" value={prefs.smsEnabled} onValueChange={(v) => update("smsEnabled", v)} />
          <ToggleRow icon="notifications" label="Push-уведомления" desc="В мобильном приложении" value={prefs.pushEnabled} onValueChange={(v) => update("pushEnabled", v)} />
          <ToggleRow icon="send" label="Telegram" desc="Через бота @conditera_bot" value={prefs.telegramEnabled} onValueChange={(v) => update("telegramEnabled", v)} />
          <ToggleRow icon="phone-portrait" label="В приложении" desc="В разделе «Уведомления»" value={prefs.inAppEnabled} onValueChange={(v) => update("inAppEnabled", v)} />
        </Section>

        <Section title="Категории">
          <ToggleRow icon="receipt" label="Статусы заказов" desc="Создан, подтверждён, готов, доставлен" value={prefs.orderUpdates} onValueChange={(v) => update("orderUpdates", v)} />
          <ToggleRow icon="card" label="Платежи" desc="Оплата прошла, возврат, ошибка карты" value={prefs.paymentUpdates} onValueChange={(v) => update("paymentUpdates", v)} />
          <ToggleRow icon="chatbubbles" label="Сообщения" desc="От кондитеров и поддержки" value={prefs.messages} onValueChange={(v) => update("messages", v)} />
          <ToggleRow icon="star" label="Отзывы" desc="Новые отзывы, ответы кондитеров" value={prefs.reviews} onValueChange={(v) => update("reviews", v)} />
          <ToggleRow icon="gift" label="Бонусы и лояльность" desc="Начисления, сгорание, новые уровни" value={prefs.loyalty} onValueChange={(v) => update("loyalty", v)} />
          <ToggleRow icon="pricetag" label="Акции и промокоды" desc="Скидки от любимых кондитеров" value={prefs.promos} onValueChange={(v) => update("promos", v)} />
          <ToggleRow icon="cart" label="Брошенная корзина" desc="Напоминание о товарах" value={prefs.abandonedCart} onValueChange={(v) => update("abandonedCart", v)} />
          <ToggleRow icon="newspaper" label="Дайджест недели" desc="Сводка новинок раз в неделю" value={prefs.digest} onValueChange={(v) => update("digest", v)} />
        </Section>

        <Section title="Тихие часы">
          <Text style={styles.sectionDesc}>
            В это время push-уведомления накапливаются, а не приходят сразу
          </Text>
          <View style={styles.quietRow}>
            <Text>С</Text>
            <Text style={styles.quietValue}>{prefs.quietHoursStart}:00</Text>
            <Text style={{ marginHorizontal: Spacing.md }}>—</Text>
            <Text>До</Text>
            <Text style={styles.quietValue}>{prefs.quietHoursEnd}:00</Text>
          </View>
        </Section>
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable style={[styles.saveBtn, saving && styles.saveBtnDisabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>Сохранить</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  desc,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  desc: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleIcon}>
        <Ionicons name={icon} size={18} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDesc}>{desc}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: Colors.primary, false: Colors.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  section: { padding: Spacing.md, borderTopWidth: 8, borderTopColor: Colors.surface },
  sectionTitle: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text, marginBottom: Spacing.sm },
  sectionDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.md },
  toggleRow: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.sm, gap: Spacing.sm },
  toggleIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.primary + "15", justifyContent: "center", alignItems: "center" },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, fontWeight: "500" },
  toggleDesc: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  quietRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  quietValue: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.primary, marginHorizontal: Spacing.xs },
  ctaBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: Spacing.md, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border },
  saveBtn: { backgroundColor: Colors.primary, paddingVertical: Spacing.md, borderRadius: BorderRadius.pill, alignItems: "center" },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "white", fontSize: FontSize.lg, fontWeight: "600" },
});
