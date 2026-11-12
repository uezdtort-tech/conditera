/**
 * Orders list screen.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import { ordersApi, type Order } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, formatCurrency, formatDate } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Ожидает",
  NEGOTIATING: "Согласование",
  CONFIRMED: "Подтверждён",
  PREPARING: "Готовится",
  READY: "Готов",
  IN_DELIVERY: "В доставке",
  DELIVERED: "Доставлен",
  COMPLETED: "Завершён",
  CANCELLED: "Отменён",
  REFUNDED: "Возврат",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: Colors.warning,
  NEGOTIATING: Colors.info,
  CONFIRMED: Colors.info,
  PREPARING: Colors.info,
  READY: Colors.success,
  IN_DELIVERY: Colors.info,
  DELIVERED: Colors.success,
  COMPLETED: Colors.success,
  CANCELLED: Colors.error,
  REFUNDED: Colors.error,
};

export function OrdersScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAppStore((s) => s.user);
  const cachedOrders = useAppStore((s) => s.orders);
  const setOrders = useAppStore((s) => s.setOrders);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const { orders } = await ordersApi.list();
      setOrders(orders);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user) load();
    else setLoading(false);
  }, [user]);

  if (!user) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="receipt-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Войдите в аккаунт</Text>
        <Text style={styles.emptyDesc}>Чтобы видеть свои заказы</Text>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (cachedOrders.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="receipt-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Заказов пока нет</Text>
        <Text style={styles.emptyDesc}>Сделайте первый заказ из каталога</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Мои заказы</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={cachedOrders}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ padding: Spacing.md }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.orderCard}
            onPress={() => navigation.navigate("OrderDetail", { id: item.id })}
          >
            <View style={styles.orderHeader}>
              <Text style={styles.orderNumber}>{item.number}</Text>
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[item.status] || Colors.textMuted) + "22" }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] || Colors.textMuted }]}>
                  {STATUS_LABELS[item.status] || item.status}
                </Text>
              </View>
            </View>
            <Text style={styles.orderDate}>{formatDate(item.createdAt)}</Text>
            <View style={styles.orderItems}>
              {item.items.slice(0, 2).map((it) => (
                <Text key={it.id} style={styles.orderItem} numberOfLines={1}>
                  • {it.title} × {it.quantity}
                </Text>
              ))}
              {item.items.length > 2 && (
                <Text style={styles.orderItemMore}>+ ещё {item.items.length - 2}</Text>
              )}
            </View>
            <View style={styles.orderFooter}>
              <Text style={styles.orderTotal}>{formatCurrency(item.total)}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  orderCard: { backgroundColor: Colors.background, padding: Spacing.md, marginBottom: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  orderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  orderNumber: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  statusText: { fontSize: FontSize.xs, fontWeight: "600" },
  orderDate: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: Spacing.sm },
  orderItems: { marginBottom: Spacing.sm },
  orderItem: { fontSize: FontSize.sm, color: Colors.text },
  orderItemMore: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  orderFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  orderTotal: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.primary },
});
