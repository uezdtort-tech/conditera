/**
 * Profile screen — avatar, name, navigation to orders/loyalty/notifications.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, formatCurrency } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);

  if (!user) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="person-circle-outline" size={72} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Вы не вошли</Text>
        <Text style={styles.emptyDesc}>Войдите, чтобы заказывать и копить бонусы</Text>
        <Pressable
          style={styles.loginBtn}
          onPress={() => navigation.navigate("Auth", { mode: "login" })}
        >
          <Text style={styles.loginBtnText}>Войти</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const loyaltyLevel = user.loyaltyLevel || "BRONZE";
  const levelColor =
    loyaltyLevel === "PLATINUM" ? Colors.platinum :
    loyaltyLevel === "GOLD" ? Colors.gold :
    loyaltyLevel === "SILVER" ? Colors.silver : Colors.bronze;

  const menuItems = [
    { icon: "receipt", label: "Мои заказы", view: "Orders" as const, color: Colors.primary },
    { icon: "gift", label: "Лояльность и бонусы", view: "Loyalty" as const, color: Colors.gold },
    { icon: "chatbubbles", label: "Чаты с кондитерами", view: "ChatList" as const, color: Colors.info },
    { icon: "shield-checkmark", label: "SimpleX (E2E-чат)", view: "SimpleX" as const, color: Colors.success },
    { icon: "navigate", label: "Кондитеры рядом", view: "NearbyConfectioners" as const, color: Colors.success },
    { icon: "notifications", label: "Уведомления", view: "Notifications" as const, color: Colors.accent },
    { icon: "settings", label: "Настройки уведомлений", view: "NotificationPreferences" as const, color: Colors.info },
    { icon: "finger-print", label: "Биометрия (Face ID / Touch ID)", view: "Biometric" as const, color: Colors.primary },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView>
        {/* Profile card */}
        <View style={styles.profileCard}>
          <Image
            source={user.avatar || "https://i.pravatar.cc/200"}
            style={styles.avatar}
          />
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          {user.city && <Text style={styles.userCity}>📍 {user.city}</Text>}

          {/* Loyalty badge */}
          <View style={[styles.levelBadge, { backgroundColor: levelColor + "22", borderColor: levelColor }]}>
            <Ionicons name="trophy" size={16} color={levelColor} />
            <Text style={[styles.levelText, { color: levelColor }]}>
              {loyaltyLevel === "BRONZE" ? "Бронзовый" :
               loyaltyLevel === "SILVER" ? "Серебряный" :
               loyaltyLevel === "GOLD" ? "Золотой" : "Платиновый"} уровень
            </Text>
          </View>

          {/* Bonus balance */}
          <View style={styles.bonusCard}>
            <Ionicons name="coins" size={24} color={Colors.gold} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bonusLabel}>Бонусов</Text>
              <Text style={styles.bonusValue}>{user.bonusBalance || 0}</Text>
            </View>
            <Pressable onPress={() => navigation.navigate("Loyalty")}>
              <Text style={styles.bonusSeeAll}>→</Text>
            </Pressable>
          </View>
        </View>

        {/* Menu items */}
        <View style={styles.menu}>
          {menuItems.map((item, i) => (
            <Pressable
              key={i}
              style={styles.menuItem}
              onPress={() => navigation.navigate(item.view)}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.color + "22" }]}>
                <Ionicons name={item.icon as never} size={20} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Logout */}
        <Pressable
          style={styles.logoutBtn}
          onPress={() =>
            Alert.alert("Выйти из аккаунта?", undefined, [
              { text: "Отмена", style: "cancel" },
              { text: "Выйти", style: "destructive", onPress: logout },
            ])
          }
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={styles.logoutText}>Выйти</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  loginBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
  },
  loginBtnText: { color: "white", fontSize: FontSize.md, fontWeight: "600" },
  profileCard: {
    alignItems: "center",
    padding: Spacing.lg,
    backgroundColor: Colors.background,
    borderBottomWidth: 8,
    borderBottomColor: Colors.surface,
  },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: Spacing.sm },
  userName: { fontSize: FontSize.xxl, fontWeight: "700", color: Colors.text },
  userEmail: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  userCity: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  levelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
  levelText: { fontSize: FontSize.sm, fontWeight: "600" },
  bonusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
    width: "100%",
  },
  bonusLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  bonusValue: { fontSize: FontSize.xxl, fontWeight: "700", color: Colors.gold },
  bonusSeeAll: { fontSize: FontSize.lg, color: Colors.textMuted },
  menu: { padding: Spacing.md },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  menuLabel: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.error + "44",
    borderRadius: BorderRadius.md,
  },
  logoutText: { color: Colors.error, fontSize: FontSize.md, fontWeight: "500" },
});
