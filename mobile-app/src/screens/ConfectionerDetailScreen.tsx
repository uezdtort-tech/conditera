/**
 * Confectioner detail screen — profile + their products.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { confectionersApi, productsApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { ProductCard } from "@/components/ProductCard";
import { SimpleXConnectWidget } from "@/components/SimpleXConnectWidget";
import { Colors, Spacing, FontSize, BorderRadius, formatCurrency } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "ConfectionerDetail">;

export function ConfectionerDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const [confectioner, setConfectioner] = useState<Record<string, unknown> | null>(null);
  const [products, setProducts] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const all = await confectionersApi.list();
        const found = all.confectioners.find((c) => (c as { id: string }).id === route.params.id);
        if (found) setConfectioner(found as Record<string, unknown>);
        const prods = await productsApi.list({ confectionerId: route.params.id, limit: 50 });
        setProducts(prods.products);
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

  if (!confectioner) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Кондитер не найден</Text>
      </SafeAreaView>
    );
  }

  const name = String(confectioner.businessName || "");
  const avatar = String(confectioner.avatar || "");
  const cover = String(confectioner.cover || "");
  const city = String(confectioner.city || "");
  const description = String(confectioner.description || "");
  const rating = Number(confectioner.rating || 0);
  const reviewsCount = Number(confectioner.reviewsCount || 0);
  const ordersCount = Number(confectioner.ordersCount || 0);
  const verified = Boolean(confectioner.verified);
  const specialization = (confectioner.specialization as string[]) || [];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView>
        {cover ? (
          <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" />
        ) : null}

        <View style={styles.profile}>
          <Image source={{ uri: avatar }} style={styles.avatar} />
          <Text style={styles.name}>
            {name}
            {verified && <Text style={styles.verified}> ✓</Text>}
          </Text>
          <Text style={styles.city}>📍 {city}</Text>

          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>⭐ {rating}</Text>
              <Text style={styles.statLabel}>{reviewsCount} отзывов</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{ordersCount}</Text>
              <Text style={styles.statLabel}>заказов</Text>
            </View>
          </View>

          <Text style={styles.description}>{description}</Text>

          {specialization.length > 0 && (
            <View style={styles.specs}>
              {specialization.map((s, i) => (
                <View key={i} style={styles.specChip}>
                  <Text style={styles.specText}>{s}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* SimpleX — приватный E2E-канал с этим кондитером */}
        <View style={styles.simplexSection}>
          <SimpleXConnectWidget
            variant="banner"
            confectionerName={name}
            description="Хотите обсудить заказ конфиденциально? Подключитесь через SimpleX Chat — сквозное шифрование, без номера телефона, без передачи данных третьим сторонам."
          />
        </View>

        <View style={styles.productsSection}>
          <Text style={styles.productsTitle}>Товары ({products.length})</Text>
          <FlatList
            data={products}
            keyExtractor={(item) => (item as Record<string, string>).id}
            numColumns={2}
            scrollEnabled={false}
            columnWrapperStyle={{ gap: Spacing.md, marginBottom: Spacing.md }}
            contentContainerStyle={{ paddingHorizontal: Spacing.md }}
            renderItem={({ item }) => (
              <ProductCard
                product={item as never}
                onPress={() => navigation.navigate("ProductDetail", { id: (item as Record<string, string>).id })}
                style={{ flex: 1 }}
              />
            )}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  cover: { width: "100%", height: 200, backgroundColor: Colors.surface },
  profile: { padding: Spacing.md, alignItems: "center" },
  avatar: { width: 96, height: 96, borderRadius: 48, marginTop: -48, borderWidth: 4, borderColor: Colors.background, backgroundColor: Colors.surface },
  name: { fontSize: FontSize.xxl, fontWeight: "700", color: Colors.text, marginTop: Spacing.sm },
  verified: { color: Colors.primary },
  city: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4 },
  stats: { flexDirection: "row", gap: Spacing.xl, marginTop: Spacing.md },
  stat: { alignItems: "center" },
  statValue: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text },
  statLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  description: { fontSize: FontSize.md, color: Colors.text, textAlign: "center", marginTop: Spacing.md, lineHeight: 22 },
  specs: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: Spacing.xs, marginTop: Spacing.md },
  specChip: { backgroundColor: Colors.surface, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
  specText: { fontSize: FontSize.xs, color: Colors.textMuted },
  simplexSection: { paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
  productsSection: { borderTopWidth: 8, borderTopColor: Colors.surface, paddingTop: Spacing.md },
  productsTitle: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.text, paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
});
