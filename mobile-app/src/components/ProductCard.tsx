/**
 * ProductCard — reusable card showing product image, title, price, rating.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatCurrency } from "@/theme";

interface ProductCardProps {
  product: {
    id: string;
    title: string;
    price: number;
    oldPrice?: number;
    images: string[];
    rating?: number;
    isPopular?: boolean;
    isNew?: boolean;
    isHit?: boolean;
    weight?: string;
  };
  onPress: () => void;
  style?: object;
}

export function ProductCard({ product, onPress, style }: ProductCardProps) {
  const favorites = useAppStore((s) => s.favorites);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = favorites.includes(product.id);

  const discount = product.oldPrice
    ? Math.round((1 - product.price / product.oldPrice) * 100)
    : 0;

  return (
    <Pressable
      style={[styles.card, style]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
    >
      <View style={styles.imageContainer}>
        <Image
          source={product.images[0]}
          style={styles.image}
          contentFit="cover"
          transition={200}
        />
        {discount > 0 && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>-{discount}%</Text>
          </View>
        )}
        <Pressable
          style={styles.favBtn}
          hitSlop={8}
          onPress={(e) => {
            e.stopPropagation();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            toggleFavorite(product.id);
          }}
        >
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={18}
            color={isFavorite ? Colors.accent : "white"}
          />
        </Pressable>
        {product.isHit && (
          <View style={styles.hitBadge}>
            <Text style={styles.hitText}>ХИТ</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{product.title}</Text>
        {product.rating ? (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color={Colors.warning} />
            <Text style={styles.rating}>{product.rating}</Text>
            {product.weight && (
              <>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.weight}>{product.weight}</Text>
              </>
            )}
          </View>
        ) : null}
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatCurrency(product.price)}</Text>
          {product.oldPrice && (
            <Text style={styles.oldPrice}>{formatCurrency(product.oldPrice)}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.sm,
  },
  imageContainer: {
    position: "relative",
    aspectRatio: 1,
    backgroundColor: Colors.surface,
  },
  image: { width: "100%", height: "100%" },
  discountBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: Colors.error,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountText: { color: "white", fontSize: 10, fontWeight: "700" },
  favBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  hitBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hitText: { color: "white", fontSize: 10, fontWeight: "700" },
  info: { padding: Spacing.sm },
  title: { fontSize: FontSize.sm, fontWeight: "500", color: Colors.text, marginBottom: 4, minHeight: 36 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  rating: { fontSize: FontSize.xs, color: Colors.textMuted },
  dot: { color: Colors.textMuted, fontSize: FontSize.xs },
  weight: { fontSize: FontSize.xs, color: Colors.textMuted },
  priceRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  price: { fontSize: FontSize.md, fontWeight: "700", color: Colors.primary },
  oldPrice: { fontSize: FontSize.xs, color: Colors.textMuted, textDecorationLine: "line-through" },
});
