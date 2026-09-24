// Web mock for react-native-maps (native-only module)
// On native platforms, the real react-native-maps is used via lazy require().
// On web, this mock is loaded to prevent the bundler from failing.

import React from "react";
import { View, Text, StyleSheet } from "react-native";

export const MapPlaceholder = () => (
  <View style={styles.placeholder}>
    <Text style={styles.title}>Карта недоступна</Text>
    <Text style={styles.desc}>
      react-native-maps требует нативной сборки. Используйте список.
    </Text>
  </View>
);

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  desc: { fontSize: 14, color: "#6b7280", textAlign: "center" },
});

// Default export — a no-op component so the call sites don't crash
export default MapPlaceholder;

// Named exports to match react-native-maps API (no-ops on web)
export const Marker = (props) => null;
export const Callout = (props) => props.children || null;
export const Circle = (props) => null;
export const Polyline = (props) => null;
export const Polygon = (props) => null;
export const Heatmap = (props) => null;
export const Overlay = (props) => null;
export const UrlTile = (props) => null;
export const LocalTile = (props) => null;
export const AnimatedRegion = class { };
export const MAP_TYPES = {
  STANDARD: "standard",
  SATELLITE: "satellite",
  HYBRID: "hybrid",
  TERRAIN: "terrain",
  NONE: "none",
  MUTEDSTANDARD: "mutedStandard",
};
export const PROVIDER_DEFAULT = "default";
export const PROVIDER_GOOGLE = "google";
