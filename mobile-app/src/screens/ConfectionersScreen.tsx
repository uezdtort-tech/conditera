/**
 * Confectioners screen — list of all confectioners.
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

import { confectionersApi } from "@/api/client";
import type { RootStackParamList } from "@/navigation/AppNavigator";
import { ConfectionerCard } from "@/components/ConfectionerCard";
import { Colors, Spacing, FontSize } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ConfectionersScreen() {
  const navigation = useNavigation<Nav>();
  const [confectioners, setConfectioners] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await confectionersApi.list({ sort: "rating", limit: 50 });
      setConfectioners(data.confectioners);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Кондитеры</Text>
      </View>
      <FlatList
        data={confectioners}
        keyExtractor={(item) => (item as Record<string, string>).id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        contentContainerStyle={{ padding: Spacing.md }}
        renderItem={({ item }) => (
          <ConfectionerCard
            confectioner={item as never}
            onPress={() => navigation.navigate("ConfectionerDetail", { id: (item as Record<string, string>).id })}
            style={{ marginBottom: Spacing.md }}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { padding: Spacing.md },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: "700", color: Colors.text },
});
