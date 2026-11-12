/**
 * ConfectionerCard — reusable card showing avatar, name, rating, specialization.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Colors, Spacing, FontSize, BorderRadius, Shadows } from "@/theme";

interface ConfectionerCardProps {
  confectioner: {
    id: string;
    businessName: string;
    avatar: string;
    city: string;
    rating: number;
    reviewsCount: number;
    ordersCount: number;
    verified: boolean;
    specialization?: string[];
  };
  onPress: () => void;
  style?: object;
}

export function ConfectionerCard({ confectioner, onPress, style }: ConfectionerCardProps) {
  return (
    <Pressable
      style={[styles.card, style]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
    >
      <Image source={{ uri: confectioner.avatar }} style={styles.avatar} />
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {confectioner.businessName}
          </Text>
          {confectioner.verified && (
            <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
          )}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="location" size={11} color={Colors.textMuted} />
          <Text style={styles.meta}>{confectioner.city}</Text>
          <Text style={styles.dot}>·</Text>
          <Ionicons name="star" size={11} color={Colors.warning} />
          <Text style={styles.meta}>{confectioner.rating} ({confectioner.reviewsCount})</Text>
        </View>
        {confectioner.specialization && confectioner.specialization.length > 0 && (
          <Text style={styles.spec} numberOfLines={1}>
            {confectioner.specialization.join(" • ")}
          </Text>
        )}
        <Text style={styles.orders}>{confectioner.ordersCount} заказов</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
    ...Shadows.sm,
  },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.surface },
  info: { flex: 1, justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  name: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text, flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  meta: { fontSize: FontSize.xs, color: Colors.textMuted },
  dot: { color: Colors.textMuted, fontSize: FontSize.xs },
  spec: { fontSize: FontSize.xs, color: Colors.text, marginBottom: 2 },
  orders: { fontSize: FontSize.xs, color: Colors.textMuted },
});
