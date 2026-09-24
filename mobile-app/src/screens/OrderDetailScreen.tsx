/**
 * Order detail screen.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, formatCurrency, formatDate } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "OrderDetail">;

export function OrderDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const orders = useAppStore((s) => s.orders);
  const order = orders.find((o) => o.id === route.params.id);

  if (!order) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Заказ не найден</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{order.number}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xl }}>
        {/* Status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Статус заказа</Text>
          <Text style={styles.statusValue}>{order.status}</Text>
          <Text style={styles.paymentStatus}>
            Оплата: {order.paymentStatus === "succeeded" ? "✓ Оплачен" : order.paymentStatus === "pending" ? "⏳ Ожидает оплаты" : order.paymentStatus}
          </Text>
        </View>

        {/* Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Состав заказа</Text>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Image source={{ uri: item.image }} style={styles.itemImage} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.itemPrice}>{formatCurrency(item.price)} × {item.quantity}</Text>
              </View>
              <Text style={styles.itemTotal}>{formatCurrency(item.price * item.quantity)}</Text>
            </View>
          ))}
        </View>

        {/* Delivery */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Доставка</Text>
          {order.deliveryAddress && (
            <View style={styles.infoRow}>
              <Ionicons name="location" size={16} color={Colors.primary} />
              <Text style={styles.infoText}>{order.deliveryAddress}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Ionicons name="calendar" size={16} color={Colors.primary} />
            <Text style={styles.infoText}>{formatDate(order.deliveryDate)}</Text>
          </View>
          {order.deliveryTime && (
            <View style={styles.infoRow}>
              <Ionicons name="time" size={16} color={Colors.primary} />
              <Text style={styles.infoText}>{order.deliveryTime}</Text>
            </View>
          )}
          {order.comment && (
            <View style={styles.infoRow}>
              <Ionicons name="chatbox" size={16} color={Colors.primary} />
              <Text style={styles.infoText}>{order.comment}</Text>
            </View>
          )}
        </View>

        {/* Total */}
        <View style={styles.section}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Товары</Text>
            <Text style={styles.totalValue}>{formatCurrency(order.total - order.deliveryCost)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Доставка</Text>
            <Text style={styles.totalValue}>{formatCurrency(order.deliveryCost)}</Text>
          </View>
          <View style={[styles.totalRow, { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.sm, paddingTop: Spacing.sm }]}>
            <Text style={styles.grandTotalLabel}>Итого</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(order.total)}</Text>
          </View>
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
  statusCard: { margin: Spacing.md, padding: Spacing.lg, backgroundColor: Colors.primary + "11", borderRadius: BorderRadius.md, alignItems: "center" },
  statusLabel: { fontSize: FontSize.sm, color: Colors.textMuted },
  statusValue: { fontSize: FontSize.xxl, fontWeight: "700", color: Colors.primary, marginVertical: 4 },
  paymentStatus: { fontSize: FontSize.sm, color: Colors.text },
  section: { padding: Spacing.md, borderTopWidth: 8, borderTopColor: Colors.surface },
  sectionTitle: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text, marginBottom: Spacing.sm },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: Spacing.sm, gap: Spacing.sm },
  itemImage: { width: 60, height: 60, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface },
  itemTitle: { fontSize: FontSize.sm, color: Colors.text },
  itemPrice: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  itemTotal: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text },
  infoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 6 },
  infoText: { fontSize: FontSize.sm, color: Colors.text, flex: 1 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totalLabel: { fontSize: FontSize.sm, color: Colors.textMuted },
  totalValue: { fontSize: FontSize.sm, color: Colors.text },
  grandTotalLabel: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text },
  grandTotalValue: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.primary },
});
