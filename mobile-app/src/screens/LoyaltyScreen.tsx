/**
 * Loyalty screen — balance, level, progress, transaction history, levels grid.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import { loyaltyApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, formatCurrency, formatRelative } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const LEVEL_COLORS: Record<string, string> = {
  BRONZE: Colors.bronze,
  SILVER: Colors.silver,
  GOLD: Colors.gold,
  PLATINUM: Colors.platinum,
};

export function LoyaltyScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppStore((s) => s.user);
  const [data, setData] = useState<{
    balance: number;
    level: string;
    totalSpent: number;
    transactions: Array<{
      id: string;
      type: string;
      points: number;
      balanceAfter: number;
      description: string;
      createdAt: string;
    }>;
  } | null>(null);
  const [levels, setLevels] = useState<Record<string, { name: string; minSpent: number; discount: number; multiplier: number; color: string; perks: string[] }>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const [history, lvls] = await Promise.all([loyaltyApi.history(), loyaltyApi.levels()]);
      setData(history);
      setLevels(lvls.levels);
    } catch (e) {
      console.error("Loyalty load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Войдите в аккаунт</Text>
      </SafeAreaView>
    );
  }

  const balance = data?.balance || user.bonusBalance || 0;
  const level = (data?.level || user.loyaltyLevel || "BRONZE") as keyof typeof LEVEL_COLORS;
  const totalSpent = data?.totalSpent || 0;
  const levelColor = LEVEL_COLORS[level];
  const transactions = data?.transactions || [];

  const levelOrder = ["BRONZE", "SILVER", "GOLD", "PLATINUM"] as const;
  const nextLevel = levelOrder[levelOrder.indexOf(level) + 1];
  const nextThreshold = nextLevel ? levels[nextLevel]?.minSpent || 0 : 0;
  const progress = nextLevel
    ? Math.min(100, (totalSpent / nextThreshold) * 100)
    : 100;
  const remaining = nextLevel ? Math.max(0, nextThreshold - totalSpent) : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Лояльность</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
      >
        {/* Level card */}
        <View style={styles.levelCard}>
          <LinearGradient
            colors={[levelColor, levelColor + "aa"]}
            style={styles.levelGradient}
          >
            <View style={styles.levelRow}>
              <View>
                <Text style={styles.levelLabel}>Ваш уровень</Text>
                <Text style={styles.levelName}>
                  {levels[level]?.name || level}
                </Text>
              </View>
              <View style={styles.balanceBox}>
                <Text style={styles.balanceLabel}>Бонусов</Text>
                <Text style={styles.balanceValue}>{balance}</Text>
              </View>
            </View>

            {nextLevel ? (
              <>
                <Text style={styles.progressLabel}>
                  До уровня «{levels[nextLevel]?.name}»: {formatCurrency(remaining)}
                </Text>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
              </>
            ) : (
              <Text style={styles.maxLevel}>Достигнут максимальный уровень! 🎉</Text>
            )}
          </LinearGradient>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="wallet" size={20} color={Colors.success} />
            <Text style={styles.statLabel}>Потрачено</Text>
            <Text style={styles.statValue}>{formatCurrency(totalSpent)}</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="trending-up" size={20} color={Colors.primary} />
            <Text style={styles.statLabel}>Множитель</Text>
            <Text style={styles.statValue}>×{levels[level]?.multiplier || 1}</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="cash" size={20} color={Colors.accent} />
            <Text style={styles.statLabel}>Кэшбек</Text>
            <Text style={styles.statValue}>{levels[level]?.discount || 0}%</Text>
          </View>
        </View>

        {/* Levels grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Уровни лояльности</Text>
          {levelOrder.map((lvl) => {
            const cfg = levels[lvl];
            if (!cfg) return null;
            const isCurrent = lvl === level;
            const isAchieved = totalSpent >= cfg.minSpent;
            return (
              <View
                key={lvl}
                style={[
                  styles.levelRow2,
                  isCurrent && { borderColor: cfg.color, borderWidth: 2 },
                ]}
              >
                <View style={[styles.levelDot, { backgroundColor: cfg.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.levelName2, { color: cfg.color }]}>
                    {cfg.name}
                    {isCurrent && " (Вы)"}
                  </Text>
                  <Text style={styles.levelThreshold}>
                    От {formatCurrency(cfg.minSpent)} · ×{cfg.multiplier} · {cfg.discount}% кэшбек
                  </Text>
                </View>
                {isAchieved && <Ionicons name="checkmark-circle" size={20} color={Colors.success} />}
              </View>
            );
          })}
        </View>

        {/* Transactions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>История начислений</Text>
          {transactions.length === 0 ? (
            <Text style={styles.emptyText}>Пока нет транзакций</Text>
          ) : (
            transactions.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View
                  style={[
                    styles.txIcon,
                    { backgroundColor: tx.points > 0 ? Colors.success + "22" : Colors.error + "22" },
                  ]}
                >
                  <Ionicons
                    name={tx.points > 0 ? "arrow-down-left" : "arrow-up-right"}
                    size={18}
                    color={tx.points > 0 ? Colors.success : Colors.error}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txDesc}>{tx.description}</Text>
                  <Text style={styles.txTime}>
                    {formatRelative(tx.createdAt)} · баланс: {tx.balanceAfter}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.txPoints,
                    { color: tx.points > 0 ? Colors.success : Colors.error },
                  ]}
                >
                  {tx.points > 0 ? "+" : ""}{tx.points}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* How to earn */}
        <View style={styles.earnCard}>
          <Text style={styles.earnTitle}>Как заработать бонусы</Text>
          <View style={styles.earnItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.earnText}>1 балл за каждые 100 ₽ в заказе</Text>
          </View>
          <View style={styles.earnItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.earnText}>Кэшбек {levels[level]?.discount || 0}% баллами с каждого заказа</Text>
          </View>
          <View style={styles.earnItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.earnText}>+100 бонусов за отзыв с фото</Text>
          </View>
          <View style={styles.earnItem}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.earnText}>+500 бонусов за приглашённого друга</Text>
          </View>
        </View>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  levelCard: { margin: Spacing.md, borderRadius: BorderRadius.lg, overflow: "hidden" },
  levelGradient: { padding: Spacing.lg },
  levelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: Spacing.md },
  levelLabel: { color: "rgba(255,255,255,0.85)", fontSize: FontSize.sm },
  levelName: { color: "white", fontSize: FontSize.xxl, fontWeight: "700" },
  balanceBox: { alignItems: "flex-end" },
  balanceLabel: { color: "rgba(255,255,255,0.85)", fontSize: FontSize.sm },
  balanceValue: { color: "white", fontSize: FontSize.xxl, fontWeight: "700" },
  progressLabel: { color: "rgba(255,255,255,0.9)", fontSize: FontSize.sm, marginBottom: 6 },
  progressBar: { height: 8, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "white", borderRadius: 4 },
  maxLevel: { color: "white", fontSize: FontSize.sm, fontWeight: "600" },
  statsRow: { flexDirection: "row", paddingHorizontal: Spacing.md, gap: Spacing.sm, marginBottom: Spacing.md },
  stat: { flex: 1, backgroundColor: Colors.surface, padding: Spacing.md, borderRadius: BorderRadius.md, alignItems: "center" },
  statLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  statValue: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text, marginTop: 2 },
  section: { padding: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text, marginBottom: Spacing.sm },
  levelRow2: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.sm, gap: Spacing.sm, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.sm, marginBottom: 4, borderWidth: 1, borderColor: "transparent" },
  levelDot: { width: 12, height: 12, borderRadius: 6 },
  levelName2: { fontSize: FontSize.md, fontWeight: "600" },
  levelThreshold: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted, padding: Spacing.md },
  txRow: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.sm, gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  txIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: "center", alignItems: "center" },
  txDesc: { fontSize: FontSize.sm, fontWeight: "500", color: Colors.text },
  txTime: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  txPoints: { fontSize: FontSize.md, fontWeight: "700" },
  earnCard: { margin: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md },
  earnTitle: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text, marginBottom: Spacing.sm },
  earnItem: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 4 },
  earnText: { fontSize: FontSize.sm, color: Colors.text, flex: 1 },
});
