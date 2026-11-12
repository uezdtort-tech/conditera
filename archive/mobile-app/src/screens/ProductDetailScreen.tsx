/**
 * Product detail screen — images, price, fillings selector, AR button.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { productsApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatCurrency } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProductRoute = RouteProp<RootStackParamList, "ProductDetail">;

export function ProductDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ProductRoute>();
  const [product, setProduct] = useState<null | {
    id: string;
    title: string;
    description: string;
    price: number;
    oldPrice?: number;
    images: string[];
    rating: number;
    reviewsCount: number;
    weight?: string;
    servings?: number;
    prepTime?: string;
    isPopular?: boolean;
    isNew?: boolean;
    isHit?: boolean;
    fillings?: Array<{ name: string; priceModifier: number }>;
    coatings?: Array<{ name: string; priceModifier: number }>;
    decorations?: Array<{ name: string; priceModifier: number }>;
    confectioner?: { businessName: string; avatar: string; verified: boolean; city: string };
    modelUrl?: string;
    arEnabled?: boolean;
  }>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFilling, setSelectedFilling] = useState(0);
  const [selectedCoating, setSelectedCoating] = useState(0);
  const [selectedDecoration, setSelectedDecoration] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isFavorite, setIsFavorite] = useState(false);

  const addToCart = useAppStore((s) => s.addToCart);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const favorites = useAppStore((s) => s.favorites);

  React.useEffect(() => {
    (async () => {
      try {
        const data = await productsApi.byId(route.params.id);
        setProduct(data.product);
        setIsFavorite(favorites.includes(data.product.id));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
     
  }, [route.params.id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Товар не найден</Text>
      </SafeAreaView>
    );
  }

  const fillingModifier = product.fillings?.[selectedFilling]?.priceModifier || 0;
  const coatingModifier = product.coatings?.[selectedCoating]?.priceModifier || 0;
  const decorationModifier = product.decorations?.[selectedDecoration]?.priceModifier || 0;
  const finalPrice = (product.price + fillingModifier + coatingModifier + decorationModifier) * quantity;

  const handleAddToCart = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addToCart(product as never, quantity);
    Alert.alert("Добавлено", `${product.title} (${quantity} шт.) добавлен в корзину`);
  };

  const handleFavorite = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleFavorite(product.id);
    setIsFavorite(!isFavorite);
  };

  const handleAR = () => {
    if (product.modelUrl) {
      // Open native AR viewer screen with WebView + model-viewer
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      navigation.navigate("ARViewer", {
        modelUrl: product.modelUrl,
        modelUsdzUrl: product.modelUsdzUrl,
        posterImage: product.images[0],
        productName: product.title,
      });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Pressable onPress={handleFavorite} hitSlop={8}>
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={24}
            color={isFavorite ? Colors.accent : Colors.text}
          />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image */}
        <View style={styles.imageContainer}>
          <Image
            source={product.images[0]}
            style={styles.image}
            contentFit="cover"
            transition={300}
          />
          {product.arEnabled && (
            <Pressable style={styles.arButton} onPress={handleAR}>
              <Ionicons name="cube" size={16} color="white" />
              <Text style={styles.arButtonText}>AR</Text>
            </Pressable>
          )}
          {product.oldPrice && (
            <View style={styles.discountBadge}>
              <Text style={styles.discountText}>
                -{Math.round((1 - product.price / product.oldPrice) * 100)}%
              </Text>
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.title}>{product.title}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="star" size={16} color={Colors.warning} />
            <Text style={styles.metaText}>
              {product.rating} ({product.reviewsCount} отзывов)
            </Text>
            {product.weight && (
              <>
                <Text style={styles.dot}>•</Text>
                <Ionicons name="scale" size={16} color={Colors.textMuted} />
                <Text style={styles.metaText}>{product.weight}</Text>
              </>
            )}
            {product.prepTime && (
              <>
                <Text style={styles.dot}>•</Text>
                <Ionicons name="time" size={16} color={Colors.textMuted} />
                <Text style={styles.metaText}>{product.prepTime}</Text>
              </>
            )}
          </View>

          {/* Confectioner */}
          {product.confectioner && (
            <View style={styles.confectionerRow}>
              <Image source={product.confectioner.avatar} style={styles.confectionerAvatar} />
              <View style={{ flex: 1 }}>
                <Text style={styles.confectionerName}>
                  {product.confectioner.businessName}
                  {product.confectioner.verified && (
                    <Text style={{ color: Colors.primary }}> ✓</Text>
                  )}
                </Text>
                <Text style={styles.confectionerCity}>{product.confectioner.city}</Text>
              </View>
            </View>
          )}

          <Text style={styles.description}>{product.description}</Text>

          {/* Fillings */}
          {product.fillings && product.fillings.length > 0 && (
            <Selector
              title="Начинка"
              options={product.fillings.map((f) => ({
                label: f.name + (f.priceModifier > 0 ? ` (+${formatCurrency(f.priceModifier)})` : ""),
              }))}
              selected={selectedFilling}
              onSelect={setSelectedFilling}
            />
          )}

          {/* Coatings */}
          {product.coatings && product.coatings.length > 0 && (
            <Selector
              title="Покрытие"
              options={product.coatings.map((c) => ({
                label: c.name + (c.priceModifier > 0 ? ` (+${formatCurrency(c.priceModifier)})` : ""),
              }))}
              selected={selectedCoating}
              onSelect={setSelectedCoating}
            />
          )}

          {/* Decorations */}
          {product.decorations && product.decorations.length > 0 && (
            <Selector
              title="Декор"
              options={product.decorations.map((d) => ({
                label: d.name + (d.priceModifier > 0 ? ` (+${formatCurrency(d.priceModifier)})` : ""),
              }))}
              selected={selectedDecoration}
              onSelect={setSelectedDecoration}
            />
          )}

          {/* Quantity */}
          <View style={styles.quantityRow}>
            <Text style={styles.sectionLabel}>Количество</Text>
            <View style={styles.quantityControls}>
              <Pressable
                style={styles.quantityBtn}
                onPress={() => setQuantity(Math.max(1, quantity - 1))}
              >
                <Ionicons name="remove" size={20} color={Colors.text} />
              </Pressable>
              <Text style={styles.quantityValue}>{quantity}</Text>
              <Pressable
                style={styles.quantityBtn}
                onPress={() => setQuantity(quantity + 1)}
              >
                <Ionicons name="add" size={20} color={Colors.text} />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.ctaBar}>
        <View>
          <Text style={styles.ctaLabel}>Итого</Text>
          <Text style={styles.ctaPrice}>{formatCurrency(finalPrice)}</Text>
        </View>
        <Pressable style={styles.ctaButton} onPress={handleAddToCart}>
          <Ionicons name="cart" size={20} color="white" />
          <Text style={styles.ctaButtonText}>В корзину</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Selector({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: Array<{ label: string }>;
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <View style={styles.selector}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {options.map((opt, i) => (
          <Pressable
            key={i}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(i);
            }}
            style={[
              styles.selectorChip,
              selected === i && styles.selectorChipActive,
            ]}
          >
            <Text
              style={[
                styles.selectorChipText,
                selected === i && styles.selectorChipTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
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
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  imageContainer: {
    marginHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    ...Shadows.md,
  },
  image: {
    width: "100%",
    height: 320,
    backgroundColor: Colors.surface,
  },
  arButton: {
    position: "absolute",
    top: Spacing.sm,
    right: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.pill,
    gap: 4,
  },
  arButtonText: {
    color: "white",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  discountBadge: {
    position: "absolute",
    top: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: Colors.error,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  discountText: {
    color: "white",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  info: {
    padding: Spacing.md,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  metaText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
  dot: {
    color: Colors.textMuted,
    marginHorizontal: 2,
  },
  confectionerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  confectionerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  confectionerName: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.text,
  },
  confectionerCity: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  description: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  selector: {
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    fontSize: FontSize.md,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  selectorChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectorChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  selectorChipText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  selectorChipTextActive: {
    color: "white",
    fontWeight: "600",
  },
  quantityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  quantityControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  quantityBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quantityValue: {
    fontSize: FontSize.lg,
    fontWeight: "600",
    color: Colors.text,
    minWidth: 30,
    textAlign: "center",
  },
  ctaBar: {
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
