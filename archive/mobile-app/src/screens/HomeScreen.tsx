/**
 * Home screen — promotions carousel, popular cakes, nearby confectioners.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { productsApi, confectionersApi, promotionsApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { ProductCard } from "@/components/ProductCard";
import { ConfectionerCard } from "@/components/ConfectionerCard";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatCurrency } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [popularProducts, setPopularProducts] = useState<unknown[]>([]);
  const [newProducts, setNewProducts] = useState<unknown[]>([]);
  const [topConfectioners, setTopConfectioners] = useState<unknown[]>([]);
  const [promotions, setPromotions] = useState<unknown[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [popular, fresh, confectioners, promos] = await Promise.all([
        productsApi.list({ sort: "popular", limit: 10 }),
        productsApi.list({ sort: "rating", limit: 10 }),
        confectionersApi.list({ sort: "rating", limit: 5 }),
        promotionsApi.list(),
      ]);
      setPopularProducts(popular.products);
      setNewProducts(fresh.products);
      setTopConfectioners(confectioners.confectioners);
      setPromotions(promos.promotions);
    } catch (e) {
      console.error("Home load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadData();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Загрузка...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>Кондитера</Text>
            <Text style={styles.tagline}>Маркетплейс частных кондитеров России</Text>
          </View>
        </View>

        {/* Promotions carousel */}
        {promotions.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.promoCarousel}
            contentContainerStyle={{ paddingRight: Spacing.md }}
          >
            {(promotions as Array<Record<string, unknown>>).map((promo, i) => (
              <Pressable
                key={i}
                style={styles.promoCard}
                onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
              >
                <LinearGradient
                  colors={[Colors.primary, Colors.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.promoGradient}
                >
                  <Text style={styles.promoTitle}>{String(promo.title || "")}</Text>
                  <Text style={styles.promoDesc} numberOfLines={2}>
                    {String(promo.description || "")}
                  </Text>
                  {promo.promoCode && (
                    <View style={styles.promoCodeBadge}>
                      <Text style={styles.promoCodeText}>{String(promo.promoCode)}</Text>
                    </View>
                  )}
                </LinearGradient>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Popular products */}
        <Section
          title="🔥 Популярное"
          onSeeAll={() => navigation.navigate("Catalog", { q: "" })}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: Spacing.md }}>
            {popularProducts.map((p) => (
              <ProductCard
                key={(p as Record<string, string>).id}
                product={p as never}
                onPress={() => navigation.navigate("ProductDetail", { id: (p as Record<string, string>).id })}
                style={styles.horizontalCard}
              />
            ))}
          </ScrollView>
        </Section>

        {/* New products */}
        <Section
          title="✨ Новинки"
          onSeeAll={() => navigation.navigate("Catalog")}
        >
          <View style={styles.grid}>
            {newProducts.slice(0, 4).map((p) => (
              <ProductCard
                key={(p as Record<string, string>).id}
                product={p as never}
                onPress={() => navigation.navigate("ProductDetail", { id: (p as Record<string, string>).id })}
                style={styles.gridCard}
              />
            ))}
          </View>
        </Section>

        {/* Top confectioners */}
        <Section
          title="👨‍🍳 Топ кондитеры"
          onSeeAll={() => navigation.navigate("Confectioners")}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: Spacing.md }}>
            {topConfectioners.map((c) => (
              <ConfectionerCard
                key={(c as Record<string, string>).id}
                confectioner={c as never}
                onPress={() => navigation.navigate("ConfectionerDetail", { id: (c as Record<string, string>).id })}
                style={styles.horizontalCard}
              />
            ))}
          </ScrollView>
        </Section>

        {/* Quick actions */}
        <View style={styles.quickActions}>
          <Pressable
            style={styles.quickAction}
            onPress={() => navigation.navigate("NearbyConfectioners")}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.success + "22" }]}>
              <Ionicons name="navigate" size={24} color={Colors.success} />
            </View>
            <Text style={styles.quickActionLabel}>Рядом со мной</Text>
          </Pressable>
          <Pressable
            style={styles.quickAction}
            onPress={() => navigation.navigate("ChatList")}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.info + "22" }]}>
              <Ionicons name="chatbubbles" size={24} color={Colors.info} />
            </View>
            <Text style={styles.quickActionLabel}>Чаты</Text>
          </Pressable>
          <Pressable
            style={styles.quickAction}
            onPress={() => navigation.navigate("Catalog")}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.accent + "22" }]}>
              <Ionicons name="pricetag" size={24} color={Colors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>Каталог</Text>
          </Pressable>
        </View>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  onSeeAll,
  children,
}: {
  title: string;
  onSeeAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.seeAll}>Все →</Text>
        </Pressable>
      </View>
      {children}
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
    backgroundColor: Colors.background,
  },
  loadingText: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: FontSize.md,
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  logo: {
    fontSize: FontSize.xxxl,
    fontWeight: "700",
    color: Colors.primary,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginTop: 2,
  },
  promoCarousel: {
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  promoCard: {
    width: SCREEN_WIDTH - Spacing.md * 3,
    height: 140,
    marginRight: Spacing.md,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    ...Shadows.md,
  },
  promoGradient: {
    flex: 1,
    padding: Spacing.md,
    justifyContent: "space-between",
  },
  promoTitle: {
    color: "white",
    fontSize: FontSize.xl,
    fontWeight: "700",
  },
  promoDesc: {
    color: "rgba(255,255,255,0.9)",
    fontSize: FontSize.sm,
  },
  promoCodeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  promoCodeText: {
    color: "white",
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.xl,
    fontWeight: "700",
    color: Colors.text,
  },
  seeAll: {
    fontSize: FontSize.sm,
    color: Colors.primary,
  },
  horizontalCard: {
    width: 180,
    marginRight: Spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  gridCard: {
    flex: 1,
    minWidth: "45%",
    maxWidth: "48%",
  },
  quickActions: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  quickAction: {
    flex: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  quickActionLabel: {
    fontSize: FontSize.xs,
    color: Colors.text,
    fontWeight: "500",
    textAlign: "center",
  },
});
