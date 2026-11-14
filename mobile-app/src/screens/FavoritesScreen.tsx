/**
 * Favorites screen — list of favorited products.
 */
import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { productsApi } from "@/api/client";
import { ProductCard } from "@/components/ProductCard";
import { Colors, Spacing, FontSize } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function FavoritesScreen() {
  const navigation = useNavigation<Nav>();
  const favorites = useAppStore((s) => s.favorites);
  const [products, setProducts] = React.useState<unknown[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      if (favorites.length === 0) {
        setProducts([]);
        setLoading(false);
        return;
      }
      try {
        // Fetch each favorited product (in a real app, you'd have a /api/products?ids=... endpoint)
        const results = await Promise.all(
          favorites.map((id) => productsApi.byId(id).catch(() => null))
        );
        setProducts(results.filter(Boolean).map((r) => (r as { product: unknown }).product));
      } finally {
        setLoading(false);
      }
    })();
  }, [favorites]);

  if (favorites.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="heart-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>Нет избранного</Text>
        <Text style={styles.emptyDesc}>Нажмите ♥ на товаре, чтобы добавить</Text>
        <Pressable style={styles.browseBtn} onPress={() => navigation.navigate("Catalog")}>
          <Text style={styles.browseBtnText}>В каталог</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={products}
        keyExtractor={(item) => (item as Record<string, string>).id}
        numColumns={2}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <ProductCard
            product={item as never}
            onPress={() =>
              navigation.navigate("ProductDetail", { id: (item as Record<string, string>).id })
            }
            style={{ flex: 1 }}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, marginBottom: Spacing.lg },
  browseBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: 24 },
  browseBtnText: { color: "white", fontSize: FontSize.md, fontWeight: "600" },
  list: { padding: Spacing.md },
  row: { gap: Spacing.md, marginBottom: Spacing.md },
});
