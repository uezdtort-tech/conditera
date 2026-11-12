/**
 * AR Viewer screen — opens a WebView with Google's <model-viewer> web component.
 *
 * Loads a self-contained HTML page that:
 *   - Includes the model-viewer script from a CDN
 *   - Renders the 3D model with auto-rotate, camera controls, AR button
 *   - Supports Scene Viewer (Android Chrome) and Quick Look (iOS Safari via USDZ)
 *
 * On iOS, Quick Look requires USDZ format. If modelUsdzUrl is provided, we
 * render an <a rel="ar"> link that triggers the native Quick Look viewer.
 *
 * On Android, the AR button triggers Scene Viewer via Google Play Services.
 */
import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { WebView, type WebViewMessage } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ARRoute = RouteProp<RootStackParamList, "ARViewer">;

/**
 * Build the HTML page with model-viewer.
 * Self-contained — no external assets other than the model-viewer CDN script.
 */
function buildARHtml(opts: {
  modelUrl: string;
  modelUsdzUrl?: string;
  posterImage?: string;
  productName: string;
  arEnabled: boolean;
}): string {
  const { modelUrl, modelUsdzUrl, posterImage, productName, arEnabled } = opts;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>${productName} — 3D превью</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: linear-gradient(135deg, #faf5ff 0%, #fdf2f8 50%, #fffbeb 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    model-viewer {
      width: 100%;
      height: 100%;
      --poster-color: transparent;
    }
    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .loading-icon {
      width: 48px;
      height: 48px;
      border: 4px solid #e9d5ff;
      border-top-color: #7c3aed;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text {
      color: #6b21a8;
      font-size: 14px;
      font-weight: 500;
    }
    .header {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 10;
      background: rgba(255,255,255,0.95);
      padding: 8px 12px;
      border-radius: 999px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header-badge {
      background: linear-gradient(135deg, #7c3aed, #ec4899);
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .header-name {
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
      max-width: 200px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hint {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12px;
      z-index: 10;
    }
    .ar-fallback {
      position: absolute;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      background: white;
      padding: 16px 24px;
      border-radius: 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      max-width: 320px;
    }
    .ar-fallback-title {
      font-size: 15px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .ar-fallback-desc {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.4;
      margin-bottom: 12px;
    }
    .ar-fallback-btn {
      display: inline-block;
      background: linear-gradient(135deg, #7c3aed, #ec4899);
      color: white;
      padding: 10px 20px;
      border-radius: 999px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }
  </style>
  <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
</head>
<body>
  <div class="header">
    <span class="header-badge">3D</span>
    <span class="header-name">${productName}</span>
  </div>

  <div class="loading" id="loading">
    <div class="loading-icon"></div>
    <div class="loading-text">Загрузка 3D-модели...</div>
  </div>

  <model-viewer
    src="${modelUrl}"
    ${modelUsdzUrl ? `ios-src="${modelUsdzUrl}"` : ""}
    ${posterImage ? `poster="${posterImage}"` : ""}
    alt="3D модель: ${productName}"
    ar
    ar-modes="scene-viewer quick-look webxr"
    camera-controls
    touch-action="pan-y"
    auto-rotate
    auto-rotate-delay="3000"
    rotation-per-second="30deg"
    shadow-intensity="1"
    environment-image="neutral"
    camera-orbit="0deg 75deg 105deg"
    field-of-view="30deg"
    style="width: 100%; height: 100%; background: transparent;"
    onload="document.getElementById('loading').style.display='none'"
  >
    <button slot="ar-button" style="position: absolute; bottom: 60px; right: 16px; background: linear-gradient(135deg, #7c3aed, #ec4899); color: white; padding: 10px 20px; border-radius: 999px; border: none; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(124,58,237,0.4); display: flex; align-items: center; gap: 6px;">
      📱 Посмотреть в AR
    </button>
  </model-viewer>

  <div class="hint">Покрутите модель, чтобы рассмотреть со всех сторон</div>

  <script>
    // Hide loading after 8s as a fallback
    setTimeout(function() {
      var l = document.getElementById('loading');
      if (l) l.style.display = 'none';
    }, 8000);

    // Notify React Native when AR button is clicked
    document.querySelector('model-viewer').addEventListener('ar-status', function(e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'ar-status',
          status: e.detail.status
        }));
      }
    });
  </script>
</body>
</html>`;
}

export function ARViewerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ARRoute>();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [arStatus, setArStatus] = useState<string | null>(null);

  const { modelUrl, modelUsdzUrl, posterImage, productName } = route.params;

  if (!modelUrl) {
    return (
      <SafeAreaView style={styles.center}>
        <Ionicons name="cube-outline" size={64} color={Colors.textMuted} />
        <Text style={styles.emptyTitle}>3D-модель недоступна</Text>
        <Text style={styles.emptyDesc}>У этого товара пока нет 3D-модели</Text>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Вернуться</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const html = buildARHtml({
    modelUrl,
    modelUsdzUrl,
    posterImage,
    productName,
    arEnabled: true,
  });

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "ar-status") {
        setArStatus(data.status);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (e) {
      console.warn("WebView message parse error:", e);
    }
  };

  // iOS: try to open USDZ directly in Quick Look
  const openIOSQuickLook = () => {
    if (Platform.OS === "ios" && modelUsdzUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Linking.openURL(modelUsdzUrl);
    } else {
      Alert.alert(
        "AR недоступен",
        "Для AR-просмотра откройте товар в браузере Safari (iOS) или Chrome (Android) на устройстве с поддержкой ARCore/ARKit."
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="close" size={26} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>3D / AR превью</Text>
        <Pressable onPress={openIOSQuickLook} hitSlop={8}>
          <Ionicons name="cube" size={24} color={Colors.primary} />
        </Pressable>
      </View>

      {arStatus === "session-started" && (
        <View style={styles.arActiveBar}>
          <Ionicons name="cube" size={14} color="white" />
          <Text style={styles.arActiveText}>AR-сессия активна</Text>
        </View>
      )}

      <View style={styles.webviewContainer}>
        {loading && (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Загрузка 3D-модели...</Text>
          </View>
        )}
        <WebView
          ref={webViewRef}
          source={{ html }}
          style={styles.webview}
          onMessage={handleMessage}
          onLoadEnd={() => setLoading(false)}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          originWhitelist={["*"]}
        />
      </View>

      {/* Footer hint */}
      <View style={styles.footer}>
        <View style={styles.footerInfo}>
          <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Покрутите модель пальцем. Нажмите «Посмотреть в AR», чтобы разместить торт в реальном пространстве.
          </Text>
        </View>
        <Pressable style={styles.arBtn} onPress={openIOSQuickLook}>
          <Ionicons name="phone-portrait" size={16} color="white" />
          <Text style={styles.arBtnText}>Открыть AR</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: "600", color: Colors.text, marginTop: Spacing.md },
  emptyDesc: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 4, marginBottom: Spacing.lg, textAlign: "center" },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: BorderRadius.pill },
  backBtnText: { color: "white", fontSize: FontSize.md, fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: "600", color: Colors.text },
  arActiveBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.success,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  arActiveText: { color: "white", fontSize: FontSize.xs, fontWeight: "600" },
  webviewContainer: { flex: 1, position: "relative" },
  webview: { flex: 1, backgroundColor: "transparent" },
  loadingOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
    zIndex: 10,
  },
  loadingText: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: FontSize.sm },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  footerInfo: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: Spacing.xs },
  footerText: { flex: 1, fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 16 },
  arBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    gap: Spacing.xs,
  },
  arBtnText: { color: "white", fontSize: FontSize.sm, fontWeight: "600" },
});
