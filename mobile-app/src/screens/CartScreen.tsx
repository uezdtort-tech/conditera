/**
 * Cart screen — list of cart items, total, checkout button.
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatCurrency } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function CartScreen() {
  const navigation = useNavigation<Nav>();
  const cart = useAppStore((s) => s.cart);
  const updateQuantity = useAppStore((s) => s.updateQuantity);
  const removeFromCart = useAppStore((s) => s.removeFromCart);
  const clearCart = useAppStore((s) => s.clearCart);
  const cartTotal = useAppStore((s) => s.cartTotal);

  if (cart.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="cart-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Корзина пуста</Text>
        <Text style={styles.emptyDesc}>Добавьте товары из каталога</Text>
        <Pressable
          style={styles.browseBtn}
          onPress={() => navigation.navigate("Catalog")}
        >
          <Text style={styles.browseBtnText}>Перейти в каталог</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Корзина ({cart.length})</Text>
        <Pressable
          onPress={() =>
            Alert.alert("Очистить корзину?", undefined, [
              { text: "Отмена", style: "cancel" },
              { text: "Очистить", style: "destructive", onPress: clearCart },
            ])
          }
        >
          <Text style={styles.clearBtn}>Очистить</Text>
        </Pressable>
      </View>

      <FlatList
        data={cart}
        keyExtractor={(item) => item.productId}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <View style={styles.cartItem}>
            <Image source={{ uri: item.image }} style={styles.itemImage} />
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.itemPrice}>{formatCurrency(item.price)}</Text>
              <View style={styles.quantityRow}>
                <Pressable
                  style={styles.qtyBtn}
                  onPress={() => updateQuantity(item.productId, item.quantity - 1)}
                >
                  <Ionicons name="remove" size={16} color={Colors.text} />
                </Pressable>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <Pressable
                  style={styles.qtyBtn}
                  onPress={() => updateQuantity(item.productId, item.quantity + 1)}
                >
                  <Ionicons name="add" size={16} color={Colors.text} />
                </Pressable>
              </View>
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                removeFromCart(item.productId);
              }}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={20} color={Colors.error} />
            </Pressable>
          </View>
        )}
      />

      <View style={styles.ctaBar}>
        <View>
          <Text style={styles.ctaLabel}>Итого</Text>
          <Text style={styles.ctaPrice}>{formatCurrency(cartTotal())}</Text>
        </View>
        <Pressable
          style={styles.ctaButton}
          onPress={() => navigation.navigate("Checkout")}
        >
          <Text style={styles.ctaButtonText}>Оформить заказ</Text>
          <Ionicons name="arrow-forward" size={18} color="white" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
    backgroundColor: Colors.background,
  },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: "600",
    color: Colors.text,
    marginTop: Spacing.md,
  },
  emptyDesc: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  browseBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
  },
  browseBtnText: {
    color: "white",
    fontSize: FontSize.md,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerTitle: {
    fontSize: FontSize.xl,
    fontWeight: "700",
    color: Colors.text,
  },
  clearBtn: {
    color: Colors.error,
    fontSize: FontSize.sm,
  },
  cartItem: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
  },
  itemInfo: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  itemTitle: {
    fontSize: FontSize.sm,
    fontWeight: "500",
    color: Colors.text,
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: FontSize.md,
    fontWeight: "700",
    color: Colors.primary,
    marginBottom: Spacing.sm,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  qtyValue: {
    fontSize: FontSize.md,
    fontWeight: "600",
    minWidth: 24,
    textAlign: "center",
  },
  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    ...Shadows.lg,
  },
  ctaLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  ctaPrice: {
    fontSize: FontSize.xxl,
    fontWeight: "700",
    color: Colors.text,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    gap: Spacing.xs,
  },
  ctaButtonText: {
    color: "white",
    fontSize: FontSize.md,
    fontWeight: "600",
  },
});
