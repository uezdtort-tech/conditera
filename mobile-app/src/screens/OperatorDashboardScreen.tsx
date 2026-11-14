/**
 * OperatorDashboardScreen — экран оператора поддержки в mobile-app.
 *
 * Показывает:
 *  - Сводку эскалаций (pending/assigned/resolved)
 *  - Список эскалаций с фильтром
 *  - Tap на эскалацию → открытие чата (ChatDetailScreen)
 *
 * Синхронизирован с web-версией OperatorDashboard.
 * API: /api/operator/escalations, /api/operator/assign
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

interface Escalation {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  reason: string;
  message: string;
  status: string;
  assignedTo: string | null;
  createdAt: string;
}

interface Summary {
  pending: number;
  assigned: number;
  resolved: number;
  total: number;
}

const REASON_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  manual_request: { label: "Запрос оператора", icon: "🙋", color: "#3b82f6" },
  bot_unknown: { label: "Бот не справился", icon: "🤖", color: "#f59e0b" },
  complaint: { label: "Жалоба", icon: "⚠️", color: "#ef4444" },
  dispute: { label: "Спор", icon: "⚖️", color: "#a855f7" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "#f59e0b" },
  assigned: { label: "В работе", color: "#3b82f6" },
  resolved: { label: "Закрыта", color: "#10b981" },
};

function formatRelative(date: string): string {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}

export function OperatorDashboardScreen({ navigation }: { navigation: any }) {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [summary, setSummary] = useState<Summary>({ pending: 0, assigned: 0, resolved: 0, total: 0 });
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`http://localhost:3000/api/operator/escalations?status=${filter}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setEscalations(data.escalations || []);
        setSummary(data.summary || { pending: 0, assigned: 0, resolved: 0, total: 0 });
      }
    } catch (e) {
      console.error("load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const handleAssign = async (id: string) => {
    try {
      const res = await fetch("http://localhost:3000/api/operator/assign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: id }),
      });
      if (res.ok) {
        Alert.alert("✓", "Взято в работу");
        load();
      }
    } catch (e) {
      Alert.alert("Ошибка", "Не удалось взять в работу");
    }
  };

  const openChat = (esc: Escalation) => {
    navigation.navigate("ChatDetail", {
      roomId: esc.roomId,
      userName: esc.userName,
    });
  };

  const renderEscalation = ({ item }: { item: Escalation }) => {
    const reason = REASON_LABELS[item.reason] || REASON_LABELS.manual_request;
    const status = STATUS_LABELS[item.status] || STATUS_LABELS.pending;
    return (
      <Pressable
        style={styles.escalationCard}
        onPress={() => openChat(item)}
      >
        <View style={styles.escHeader}>
          <Text style={styles.escUserName}>{item.userName}</Text>
          <Text style={styles.escTime}>{formatRelative(item.createdAt)}</Text>
        </View>
        <View style={styles.escBadges}>
          <View style={[styles.badge, { backgroundColor: reason.color + "20" }]}>
            <Text style={styles.badgeIcon}>{reason.icon}</Text>
            <Text style={[styles.badgeText, { color: reason.color }]}>{reason.label}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: status.color + "20" }]}>
            <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={styles.escMessage} numberOfLines={2}>{item.message}</Text>
        {item.status === "pending" && (
          <Pressable
            style={styles.assignButton}
            onPress={(e) => {
              e.stopPropagation();
              handleAssign(item.id);
            }}
          >
            <Ionicons name="person-add-outline" size={14} color="#fff" />
            <Text style={styles.assignButtonText}>Взять в работу</Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="headset" size={28} color={Colors.primary} />
        <Text style={styles.title}>Оператор поддержки</Text>
      </View>

      {/* Summary cards */}
      <View style={styles.summaryRow}>
        {[
          { key: "pending", label: "Ожидают", value: summary.pending, color: "#f59e0b", icon: "time" },
          { key: "assigned", label: "В работе", value: summary.assigned, color: "#3b82f6", icon: "person" },
          { key: "resolved", label: "Закрыто", value: summary.resolved, color: "#10b981", icon: "checkmark" },
        ].map((s) => (
          <Pressable
            key={s.key}
            style={[styles.summaryCard, filter === s.key && styles.summaryCardActive]}
            onPress={() => setFilter(s.key)}
          >
            <Ionicons name={s.icon as any} size={18} color={s.color} />
            <Text style={styles.summaryValue}>{s.value}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: 8 }}
      >
        {["pending", "assigned", "resolved", "all"].map((s) => (
          <Pressable
            key={s}
            style={[styles.filterChip, filter === s && styles.filterChipActive]}
            onPress={() => setFilter(s)}
          >
            <Text style={[styles.filterChipText, filter === s && styles.filterChipTextActive]}>
              {STATUS_LABELS[s]?.label || "Все"}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* List */}
      <FlatList
        data={escalations}
        keyExtractor={(item) => item.id}
        renderItem={renderEscalation}
        contentContainerStyle={{ padding: Spacing.md }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} colors={[Colors.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle" size={56} color={Colors.muted} />
            <Text style={styles.emptyText}>Нет эскалаций</Text>
          </View>
        }
      />
    </View>
  );
}

import { Alert } from "react-native";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: "bold",
    color: Colors.text,
  },
  summaryRow: {
    flexDirection: "row",
    padding: Spacing.md,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryCardActive: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  summaryValue: {
    fontSize: FontSize.xl,
    fontWeight: "bold",
    color: Colors.text,
    marginTop: 4,
  },
  summaryLabel: {
    fontSize: FontSize.xs,
    color: Colors.muted,
  },
  filterRow: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  filterChipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  escalationCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  escHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  escUserName: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.text,
  },
  escTime: {
    fontSize: FontSize.xs,
    color: Colors.muted,
  },
  escBadges: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    gap: 4,
  },
  badgeIcon: { fontSize: 12 },
  badgeText: {
    fontSize: 11,
    fontWeight: "500",
  },
  escMessage: {
    fontSize: FontSize.sm,
    color: Colors.muted,
    lineHeight: 18,
  },
  assignButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    marginTop: 8,
    gap: 4,
  },
  assignButtonText: {
    color: "#fff",
    fontSize: FontSize.sm,
    fontWeight: "600",
  },
  empty: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  emptyText: {
    marginTop: Spacing.sm,
    color: Colors.muted,
    fontSize: FontSize.md,
  },
});
