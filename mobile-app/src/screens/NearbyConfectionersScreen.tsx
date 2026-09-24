/**
 * Nearby confectioners screen — map view + list view toggle.
 *
 * Map view: react-native-maps with markers for each confectioner + user's location.
 * List view: existing list with distance.
 * Toggle button in header to switch between views.
 *
 * Markers are color-coded:
 *   - Blue: user's current location
 *   - Purple: verified confectioner
 *   - Orange: regular confectioner
 *
 * Tapping a marker shows a callout with name + distance → navigates to detail.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Dimensions,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

// react-native-maps is native-only — on web, we fall back to list view.
// We use a lazy require() inside try-catch so the bundler can tree-shake it on web.
let MapView: any = null;
let Marker: any = null;
let Callout: any = null;
if (Platform.OS !== "web") {
  try {
    const Maps = require("react-native-maps");
    MapView = Maps.default;
    Marker = Maps.Marker;
    Callout = Maps.Callout;
  } catch (e) {
    console.warn("react-native-maps not available:", e);
  }
}

// Mock for web platform — renders a fallback message
function MapPlaceholder() {
  const React = require("react");
  const { View, Text, StyleSheet } = require("react-native");
  const { Colors, FontSize, Spacing } = require("@/theme");
  return React.createElement(View, { style: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl } },
    React.createElement(Text, { style: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text, marginBottom: 8 } }, "Карта недоступна"),
    React.createElement(Text, { style: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: "center" } }, "react-native-maps требует нативной сборки. Используйте список.")
  );
}

import { confectionersApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import {
  getCurrentLocation,
  calculateDistance,
  formatDistance,
  type Coordinates,
} from "@/services/geolocation";
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface ConfectionerWithDistance {
  id: string;
  businessName: string;
  avatar: string;
  city: string;
  rating: number;
  reviewsCount: number;
  ordersCount: number;
  verified: boolean;
  specialization: string[];
  location: {
    lat?: number;
    lng?: number;
    city?: string;
    region?: string;
    serviceRadiusKm?: number;
    deliveryCities?: string[];
  };
  distanceKm: number | null;
  inServiceArea: boolean;
}

export function NearbyConfectionersScreen() {
  const navigation = useNavigation<Nav>();
  const [confectioners, setConfectioners] = useState<ConfectionerWithDistance[]>([]);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [sortBy, setSortBy] = useState<"distance" | "rating">("distance");
  const [viewMode, setViewMode] = useState<"map" | "list">("list");
  const mapRef = useRef<any>(null);

  const loadData = useCallback(async () => {
    try {
      let coords: Coordinates | null = null;
      try {
        coords = await getCurrentLocation();
        setUserLocation(coords);
        setPermissionDenied(false);
      } catch (e) {
        console.warn("Location error:", e);
        setPermissionDenied(true);
      }

      const data = await confectionersApi.list({ limit: 100 });
      const annotated = data.confectioners.map((c) => {
        const loc = c.location as {
          lat?: number;
          lng?: number;
          serviceRadiusKm?: number;
        };
        const distanceKm =
          typeof loc.lat === "number" && typeof loc.lng === "number" && coords
            ? calculateDistance(coords.latitude, coords.longitude, loc.lat, loc.lng)
            : null;
        const inServiceArea =
          distanceKm !== null &&
          typeof loc.serviceRadiusKm === "number" &&
          distanceKm <= loc.serviceRadiusKm;
        return {
          ...c,
          location: loc as ConfectionerWithDistance["location"],
          distanceKm,
          inServiceArea,
        } as ConfectionerWithDistance;
      });
      setConfectioners(annotated);

      // Center map on user or first confectioner with coords
      if (coords && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }, 1000);
      }
    } catch (e) {
      console.error("Load error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sorted = React.useMemo(() => {
    const arr = [...confectioners];
    if (sortBy === "distance") {
      arr.sort((a, b) => {
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      });
    } else {
      arr.sort((a, b) => b.rating - a.rating);
    }
    return arr;
  }, [confectioners, sortBy]);

  const confectionersWithCoords = sorted.filter(
    (c) => typeof c.location.lat === "number" && typeof c.location.lng === "number"
  );

  const requestPermissionAgain = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    loadData();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Кондитеры рядом</Text>
        {/* Map/list toggle */}
        <View style={styles.viewToggle}>
          <Pressable
            style={[styles.toggleBtn, viewMode === "list" && styles.toggleBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode("list");
            }}
          >
            <Ionicons name="list" size={16} color={viewMode === "list" ? "white" : Colors.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, viewMode === "map" && styles.toggleBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode("map");
            }}
            disabled={!MapView}
          >
            <Ionicons name="map" size={16} color={viewMode === "map" ? "white" : Colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* Location status */}
      {userLocation && (
        <View style={styles.locationBar}>
          <Ionicons name="location" size={14} color={Colors.primary} />
          <Text style={styles.locationText}>
            {userLocation.latitude.toFixed(4)}, {userLocation.longitude.toFixed(4)}
          </Text>
        </View>
      )}

      {permissionDenied && (
        <View style={styles.permissionBar}>
          <Ionicons name="location-outline" size={20} color={Colors.warning} />
          <Text style={styles.permissionText}>
            Геолокация не разрешена — расстояние не показывается
          </Text>
          <Pressable onPress={requestPermissionAgain} hitSlop={8}>
            <Text style={styles.permissionBtn}>Повторить</Text>
          </Pressable>
        </View>
      )}

      {/* Sort toggle (list view only) */}
      {viewMode === "list" && (
        <View style={styles.sortRow}>
          <Pressable
            style={[styles.sortBtn, sortBy === "distance" && styles.sortBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setSortBy("distance");
            }}
          >
            <Ionicons name="navigate" size={14} color={sortBy === "distance" ? "white" : Colors.textMuted} />
            <Text style={[styles.sortBtnText, sortBy === "distance" && styles.sortBtnTextActive]}>
              По расстоянию
            </Text>
          </Pressable>
          <Pressable
            style={[styles.sortBtn, sortBy === "rating" && styles.sortBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setSortBy("rating");
            }}
          >
            <Ionicons name="star" size={14} color={sortBy === "rating" ? "white" : Colors.textMuted} />
            <Text style={[styles.sortBtnText, sortBy === "rating" && styles.sortBtnTextActive]}>
              По рейтингу
            </Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Определяем местоположение...</Text>
        </View>
      ) : viewMode === "map" && MapView ? (
        /* ===== Map view ===== */
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={
              userLocation
                ? {
                    latitude: userLocation.latitude,
                    longitude: userLocation.longitude,
                    latitudeDelta: 0.5,
                    longitudeDelta: 0.5,
                  }
                : confectionersWithCoords[0]?.location.lat && confectionersWithCoords[0]?.location.lng
                ? {
                    latitude: confectionersWithCoords[0].location.lat!,
                    longitude: confectionersWithCoords[0].location.lng!,
                    latitudeDelta: 0.5,
                    longitudeDelta: 0.5,
                  }
                : {
                    latitude: 55.7558,
                    longitude: 37.6173, // Moscow as default
                    latitudeDelta: 1,
                    longitudeDelta: 1,
                  }
            }
            showsUserLocation
            showsMyLocationButton
          >
            {/* User location marker (custom) */}
            {userLocation && (
              <Marker
                coordinate={{
                  latitude: userLocation.latitude,
                  longitude: userLocation.longitude,
                }}
                pinColor={Colors.info}
                title="Вы здесь"
              >
                <View style={styles.userMarker}>
                  <View style={styles.userMarkerInner} />
                </View>
              </Marker>
            )}

            {/* Confectioner markers */}
            {confectionersWithCoords.map((c) => (
              <Marker
                key={c.id}
                coordinate={{
                  latitude: c.location.lat!,
                  longitude: c.location.lng!,
                }}
                pinColor={c.verified ? Colors.primary : Colors.warning}
              >
                <Callout
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    navigation.navigate("ConfectionerDetail", { id: c.id });
                  }}
                >
                  <View style={styles.callout}>
                    <Image source={{ uri: c.avatar }} style={styles.calloutAvatar} />
                    <View style={styles.calloutInfo}>
                      <Text style={styles.calloutName} numberOfLines={1}>{c.businessName}</Text>
                      <Text style={styles.calloutMeta}>
                        ⭐ {c.rating} · {formatDistance(c.distanceKm)}
                      </Text>
                      {c.inServiceArea && (
                        <Text style={styles.calloutService}>✓ Доставляет вам</Text>
                      )}
                      <Text style={styles.calloutTap}>Нажмите, чтобы открыть →</Text>
                    </View>
                  </View>
                </Callout>
              </Marker>
            ))}
          </MapView>

          {/* Bottom card with count */}
          <View style={styles.mapFooter} pointerEvents="none">
            <View style={styles.mapFooterCard}>
              <Ionicons name="restaurant" size={16} color={Colors.primary} />
              <Text style={styles.mapFooterText}>
                {confectionersWithCoords.length} кондитеров на карте
              </Text>
            </View>
          </View>

          {/* "Switch to list" hint */}
          <Pressable
            style={styles.switchToListBtn}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode("list");
            }}
          >
            <Ionicons name="list" size={16} color="white" />
            <Text style={styles.switchToListText}>Список</Text>
          </Pressable>
        </View>
      ) : viewMode === "map" && !MapView ? (
        <View style={styles.center}>
          <Ionicons name="map-outline" size={64} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>Карта недоступна</Text>
          <Text style={styles.emptyDesc}>
           react-native-maps требует нативной сборки (не работает в Expo Go Web).
            Используйте список.
          </Text>
          <Pressable style={styles.useListBtn} onPress={() => setViewMode("list")}>
            <Text style={styles.useListBtnText}>Перейти к списку</Text>
          </Pressable>
        </View>
      ) : (
        /* ===== List view (existing) ===== */
        <FlatList
          data={sorted}
          keyExtractor={(c) => c.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadData();
              }}
            />
          }
          contentContainerStyle={{ padding: Spacing.md }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="restaurant-outline" size={64} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Кондитеры не найдены</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.confCard}
              onPress={() => navigation.navigate("ConfectionerDetail", { id: item.id })}
            >
              <Image source={{ uri: item.avatar }} style={styles.avatar} />
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>{item.businessName}</Text>
                  {item.verified && (
                    <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />
                  )}
                </View>
                <Text style={styles.city}>📍 {item.city}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="star" size={12} color={Colors.warning} />
                  <Text style={styles.metaText}>{item.rating} ({item.reviewsCount})</Text>
                  <Text style={styles.dot}>·</Text>
                  <Text style={styles.metaText}>{item.ordersCount} заказов</Text>
                </View>
                {item.specialization && item.specialization.length > 0 && (
                  <Text style={styles.spec} numberOfLines={1}>
                    {item.specialization.join(" • ")}
                  </Text>
                )}
              </View>
              <View style={styles.distanceBox}>
                <Text style={styles.distanceValue}>
                  {formatDistance(item.distanceKm)}
                </Text>
                {item.inServiceArea ? (
                  <View style={styles.serviceBadge}>
                    <Text style={styles.serviceText}>Доставляет вам</Text>
                  </View>
                ) : item.distanceKm !== null ? (
                  <Text style={styles.outOfArea}>вне зоны</Text>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: FontSize.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  viewToggle: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.pill,
    padding: 2,
  },
  toggleBtn: {
    width: 36,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  toggleBtnActive: { backgroundColor: Colors.primary },
  locationBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.primary + "11",
  },
  locationText: { fontSize: FontSize.xs, color: Colors.primary, fontFamily: "monospace" },
  permissionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.warning + "22",
  },
  permissionText: { flex: 1, fontSize: FontSize.xs, color: Colors.text },
  permissionBtn: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: "600" },
  sortRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  sortBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
  },
  sortBtnActive: { backgroundColor: Colors.primary },
  sortBtnText: { fontSize: FontSize.xs, color: Colors.textMuted },
  sortBtnTextActive: { color: "white", fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, textAlign: "center", paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  useListBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: BorderRadius.pill },
  useListBtnText: { color: "white", fontSize: FontSize.md, fontWeight: "600" },
  // ===== Map styles =====
  mapContainer: { flex: 1, position: "relative" },
  map: { flex: 1, width: "100%", height: "100%" },
  userMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.info + "33",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: Colors.info,
  },
  userMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.info,
  },
  callout: {
    flexDirection: "row",
    gap: 8,
    padding: 4,
    width: 220,
  },
  calloutAvatar: { width: 44, height: 44, borderRadius: 22 },
  calloutInfo: { flex: 1 },
  calloutName: { fontSize: FontSize.md, fontWeight: "700", color: Colors.text, marginBottom: 2 },
  calloutMeta: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  calloutService: { fontSize: FontSize.xs, color: Colors.success, fontWeight: "600", marginBottom: 2 },
  calloutTap: { fontSize: 10, color: Colors.primary, fontWeight: "500" },
  mapFooter: {
    position: "absolute",
    bottom: Spacing.md,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  mapFooterCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: "white",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    ...Shadows.md,
  },
  mapFooterText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: "500" },
  switchToListBtn: {
    position: "absolute",
    top: Spacing.md,
    right: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    ...Shadows.md,
  },
  switchToListText: { color: "white", fontSize: FontSize.xs, fontWeight: "600" },
  // ===== List styles =====
  confCard: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
    ...Shadows.sm,
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.surface },
  info: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  name: { fontSize: FontSize.md, fontWeight: "600", color: Colors.text, flex: 1 },
  city: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  metaText: { fontSize: FontSize.xs, color: Colors.textMuted },
  dot: { color: Colors.textMuted, fontSize: FontSize.xs },
  spec: { fontSize: FontSize.xs, color: Colors.text },
  distanceBox: { alignItems: "flex-end", justifyContent: "center" },
  distanceValue: { fontSize: FontSize.lg, fontWeight: "700", color: Colors.primary, marginBottom: 4 },
  serviceBadge: {
    backgroundColor: Colors.success + "22",
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  serviceText: { fontSize: 9, color: Colors.success, fontWeight: "600" },
  outOfArea: { fontSize: 9, color: Colors.textMuted },
});
