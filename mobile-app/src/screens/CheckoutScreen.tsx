/**
 * Checkout screen — delivery info + payment method + order creation.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ordersApi, paymentApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatCurrency } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PAYMENT_METHODS = [
  { id: "card", label: "Банковская карта", icon: "card" as const },
  { id: "sbp", label: "СБП", icon: "qr-code" as const },
  { id: "cash", label: "Наличные", icon: "cash" as const },
  { id: "split", label: "Сплит", icon: "people" as const },
];

export function CheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const cart = useAppStore((s) => s.cart);
  const cartTotal = useAppStore((s) => s.cartTotal);
  const clearCart = useAppStore((s) => s.clearCart);
  const setOrders = useAppStore((s) => s.setOrders);
  const orders = useAppStore((s) => s.orders);
  const user = useAppStore((s) => s.user);

  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [comment, setComment] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert("Войдите в аккаунт", "Чтобы оформить заказ, нужно авторизоваться");
      navigation.navigate("Auth", { mode: "login" });
      return;
    }
    if (cart.length === 0) {
      Alert.alert("Корзина пуста");
      return;
    }
    if (!deliveryAddress || !deliveryDate) {
      Alert.alert("Заполните адрес и дату доставки");
      return;
    }

    setSubmitting(true);
    try {
      const { order } = await ordersApi.create({
        items: cart.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          customization: i.customization,
        })),
        deliveryAddress,
        deliveryDate,
        deliveryTime,
        paymentMethod,
        comment,
      });

      setOrders([order, ...orders]);
      clearCart();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Try to create payment (if card)
      if (paymentMethod === "card") {
        try {
          const payment = await paymentApi.create(order.id);
          if (payment.confirmationUrl) {
            Alert.alert(
              "Заказ создан!",
              `Номер заказа: ${order.number}\n\nПерейдите к оплате?`,
              [
                { text: "Позже", style: "cancel" },
                {
                  text: "Оплатить",
                  onPress: () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  },
                },
              ]
            );
          }
        } catch (e) {
          console.warn("Payment creation failed:", e);
        }
      } else {
        Alert.alert(
          "Заказ создан!",
          `Номер: ${order.number}\nСумма: ${formatCurrency(order.total)}`,
          [
            {
              text: "OK",
              onPress: () => navigation.navigate("Orders"),
            },
          ]
        );
      }
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Оформление заказа</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Delivery info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Доставка</Text>
          <TextInput
            style={styles.input}
            placeholder="Адрес доставки"
            value={deliveryAddress}
            onChangeText={setDeliveryAddress}
            placeholderTextColor={Colors.textMuted}
          />
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: Spacing.sm }]}
              placeholder="Дата (ГГГГ-ММ-ДД)"
              value={deliveryDate}
              onChangeText={setDeliveryDate}
              placeholderTextColor={Colors.textMuted}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Время"
              value={deliveryTime}
              onChangeText={setDeliveryTime}
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <TextInput
            style={[styles.input, { minHeight: 80 }]}
            placeholder="Комментарий к заказу"
            value={comment}
            onChangeText={setComment}
            multiline
            textAlignVertical="top"
            placeholderTextColor={Colors.textMuted}
          />
        </View>

        {/* Payment method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Способ оплаты</Text>
          {PAYMENT_METHODS.map((m) => (
            <Pressable
              key={m.id}
              style={[
                styles.paymentOption,
                paymentMethod === m.id && styles.paymentOptionActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setPaymentMethod(m.id);
              }}
            >
              <Ionicons
                name={m.icon}
                size={22}
                color={paymentMethod === m.id ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.paymentLabel,
                  paymentMethod === m.id && styles.paymentLabelActive,
                ]}
              >
                {m.label}
              </Text>
              {paymentMethod === m.id && (
                <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
              )}
            </Pressable>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ваш заказ</Text>
          {cart.map((item) => (
            <View key={item.productId} style={styles.summaryRow}>
              <Text style={styles.summaryText} numberOfLines={1}>
                {item.title} × {item.quantity}
              </Text>
              <Text style={styles.summaryPrice}>
                {formatCurrency(item.price * item.quantity)}
              </Text>
            </View>
          ))}
          <View style={[styles.summaryRow, { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.sm, paddingTop: Spacing.sm }]}>
            <Text style={styles.totalLabel}>Итого</Text>
            <Text style={styles.totalValue}>{formatCurrency(cartTotal())}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.ctaBar}>
        <Pressable
          style={[styles.ctaButton, submitting && styles.ctaButtonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Text style={styles.ctaButtonText}>Оформить заказ</Text>
              <Ionicons name="arrow-forward" size={18} color="white" />
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  section: {
    padding: Spacing.md,
    borderBottomWidth: 8,
    borderBottomColor: Colors.surface,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    fontSize: FontSize.md,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  row: { flexDirection: "row" },
  paymentOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  paymentOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "11",
  },
  paymentLabel: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  paymentLabelActive: { color: Colors.primary, fontWeight: "600" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  summaryText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, marginRight: Spacing.sm },
  summaryPrice: { fontSize: FontSize.sm, fontWeight: "500", color: Colors.text },
  totalLabel: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text },
  totalValue: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.primary },
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.md,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    gap: Spacing.xs,
  },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaButtonText: { color: "white", fontSize: FontSize.lg, fontWeight: "600" },
});
