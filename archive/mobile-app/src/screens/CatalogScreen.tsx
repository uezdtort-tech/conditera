/**
 * Catalog screen — product list with filters.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

import { productsApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { ProductCard } from "@/components/ProductCard";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type CatalogRoute = RouteProp<RootStackParamList, "Catalog">;

const CATEGORIES = [
  { id: "all", label: "Все" },
  { id: "cakes", label: "Торты" },
  { id: "cupcakes", label: "Капкейки" },
  { id: "bento", label: "Бенто-торты" },
  { id: "macarons", label: "Макаронс" },
  { id: "cheesecakes", label: "Чизкейки" },
  { id: "cookies", label: "Печенье" },
  { id: "desserts", label: "Десерты" },
];

const SORTS = [
  { id: "popular", label: "Популярные" },
  { id: "price-asc", label: "Цена ↑" },
  { id: "price-desc", label: "Цена ↓" },
  { id: "rating", label: "Рейтинг" },
];

export function CatalogScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<CatalogRoute>();
  const [products, setProducts] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState(route.params?.category || "all");
  const [sort, setSort] = useState("popular");
  const [search, setSearch] = useState(route.params?.q || "");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadProducts = useCallback(
    async (reset = false) => {
      try {
        if (reset) {
          setLoading(true);
          setPage(0);
        }
        const offset = reset ? 0 : page * 20;
        const data = await productsApi.list({
          category: category !== "all" ? category : undefined,
          q: search || undefined,
          sort,
          limit: 20,
          offset,
        });
        setProducts(reset ? data.products : [...products, ...data.products]);
        setHasMore(data.products.length === 20);
      } catch (e) {
        console.error("Catalog load error:", e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [category, search, sort, page, products]
  );

  useEffect(() => {
    loadProducts(true);
     
  }, [category, sort, search]);

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadProducts(true);
  };

  const onLoadMore = () => {
    if (!hasMore || loading) return;
    setPage((p) => p + 1);
    loadProducts(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Search */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск тортов, десертов..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      {/* Categories */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIES}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.categoriesContainer}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setCategory(item.id);
            }}
            style={[styles.categoryChip, category === item.id && styles.categoryChipActive]}
          >
            <Text
              style={[
                styles.categoryText,
                category === item.id && styles.categoryTextActive,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        )}
      />

      {/* Sort */}
      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              Haptics.selectionAsync();
              setSort(s.id);
            }}
            style={[styles.sortChip, sort === s.id && styles.sortChipActive]}
          >
            <Text
              style={[
                styles.sortText,
                sort === s.id && styles.sortTextActive,
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Products grid */}
      <FlatList
        data={products}
        keyExtractor={(item) => (item as Record<string, string>).id}
        numColumns={2}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Ничего не найдено</Text>
              <Text style={styles.emptyDesc}>Попробуйте изменить фильтры</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          loading ? <ActivityIndicator color={Colors.primary} style={{ padding: Spacing.md }} /> : null
        }
        renderItem={({ item }) => (
          <ProductCard
            product={item as never}
            onPress={() =>
              navigation.navigate("ProductDetail", { id: (item as Record<string, string>).id })
            }
            style={styles.card}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchInput: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.pill,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  categoriesContainer: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
  },
  categoryText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  categoryTextActive: {
    color: "white",
    fontWeight: "600",
  },
  sortRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  sortChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
  },
  sortChipActive: {
    backgroundColor: Colors.primaryLight + "33",
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  sortText: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
  },
  sortTextActive: {
    color: Colors.primary,
    fontWeight: "600",
  },
  list: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  row: {
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  card: {
    flex: 1,
  },
  empty: {
    padding: Spacing.xxl,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  emptyDesc: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
