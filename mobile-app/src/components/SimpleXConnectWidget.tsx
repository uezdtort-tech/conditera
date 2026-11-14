/**
 * SimpleXConnectWidget — React Native компонент для подключения
 * к приватному E2E-каналу маркетплейса через SimpleX Chat.
 *
 * Варианты:
 *   - "banner" — карточка с описанием + кнопка "Показать QR-код"
 *   - "compact" — компактная кнопка-чип
 *   - "card" — карточка с QR-кодом (для экрана SimpleX-чатов)
 *
 * При нажатии открывает Modal с QR-кодом и инструкцией.
 * QR-код рендерится через API qrserver.com (как и в web-виджете).
 *
 * Совместимость: expo-image, expo-linking, @expo/vector-icons/Ionicons.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  Linking,
  ActivityIndicator,
  Platform,
  Share,
} from "react-native";
import { Image } from "expo-image";
import * as LinkingExpo from "expo-linking";
import { Ionicons } from "@expo/vector-icons";

import { simplexApi, type SimpleXSupportAddress } from "@/api/client";
import { Colors, Spacing, FontSize, BorderRadius, Shadows, formatRelative } from "@/theme";

type Variant = "banner" | "compact" | "card";

export function SimpleXConnectWidget({
  variant = "banner",
  title = "Приватный канал",
  description,
  confectionerName,
}: {
  variant?: Variant;
  title?: string;
  description?: string;
  /** Если передано — будет показано "Приватный канал с {confectionerName}" */
  confectionerName?: string;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [data, setData] = useState<SimpleXSupportAddress | null>(null);
  const [loading, setLoading] = useState(false);

  const finalTitle = confectionerName ? `Приватный канал с ${confectionerName}` : title;
  const finalDescription =
    description ||
    "Обсудите заказ конфиденциально через SimpleX Chat — сквозное шифрование, без номера телефона, без передачи данных.";

  const handlePress = async () => {
    setLoading(true);
    try {
      const result = await simplexApi.supportAddress();
      setData(result);
      if (result.available) {
        setModalVisible(true);
      } else {
        // Если адрес недоступен — всё равно показываем модалку с инструкцией
        setModalVisible(true);
      }
    } catch (e) {
      console.error("[SimpleX] Failed to load support address:", e);
      setData({
        available: false,
        instructions: undefined,
      });
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  // ===== Compact variant — кнопка-чип =====
  if (variant === "compact") {
    return (
      <>
        <Pressable
          style={[styles.compactButton, loading && styles.disabled]}
          onPress={handlePress}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Приватный канал SimpleX"
        >
          <Ionicons name="shield-checkmark" size={14} color={Colors.success} />
          {loading ? (
            <ActivityIndicator size="small" color={Colors.text} style={{ marginLeft: 6 }} />
          ) : (
            <Text style={styles.compactText}>Приватный канал</Text>
          )}
        </Pressable>
        <SimpleXModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          data={data}
          title={finalTitle}
          description={finalDescription}
        />
      </>
    );
  }

  // ===== Banner variant — карточка с описанием =====
  if (variant === "banner") {
    return (
      <>
        <View style={styles.bannerContainer}>
          <View style={styles.bannerRow}>
            <View style={styles.bannerIconWrap}>
              <Ionicons name="shield-checkmark" size={24} color={Colors.success} />
            </View>
            <View style={styles.bannerContent}>
              <View style={styles.bannerTitleRow}>
                <Text style={styles.bannerTitle}>{finalTitle}</Text>
                <View style={styles.e2eBadge}>
                  <Text style={styles.e2eBadgeText}>E2E</Text>
                </View>
              </View>
              <Text style={styles.bannerDescription}>{finalDescription}</Text>
              <Pressable
                style={[styles.bannerButton, loading && styles.disabled]}
                onPress={handlePress}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={Colors.background} />
                ) : (
                  <>
                    <Ionicons name="qr-code" size={16} color={Colors.background} />
                    <Text style={styles.bannerButtonText}>Показать QR-код</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
        <SimpleXModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          data={data}
          title={finalTitle}
          description={finalDescription}
        />
      </>
    );
  }

  // ===== Card variant — карточка с QR-кодом (для отдельного экрана) =====
  return (
    <>
      <View style={styles.cardContainer}>
        <View style={styles.cardHeader}>
          <Ionicons name="shield-checkmark" size={28} color={Colors.success} />
          <Text style={styles.cardTitle}>{finalTitle}</Text>
        </View>
        <Text style={styles.cardDescription}>{finalDescription}</Text>
        <Pressable
          style={[styles.cardButton, loading && styles.disabled]}
          onPress={handlePress}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.background} />
          ) : (
            <>
              <Ionicons name="qr-code" size={18} color={Colors.background} />
              <Text style={styles.cardButtonText}>Открыть QR-код</Text>
            </>
          )}
        </Pressable>
      </View>
      <SimpleXModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        data={data}
        title={finalTitle}
        description={finalDescription}
      />
    </>
  );
}

// ===== Modal с QR-кодом и инструкцией =====
function SimpleXModal({
  visible,
  onClose,
  data,
  title,
  description,
}: {
  visible: boolean;
  onClose: () => void;
  data: SimpleXSupportAddress | null;
  title: string;
  description: string;
}) {
  const handleShare = async () => {
    if (!data?.address) return;
    try {
      await Share.share({
        message: `Подключитесь ко мне через SimpleX Chat: ${data.address}`,
      });
    } catch (e) {
      console.error("Share failed:", e);
    }
  };

  const handleOpenSimplexSite = () => {
    LinkingExpo.openURL("https://simplex.chat/downloads/");
  };

  const handleCopyAddress = () => {
    if (!data?.address) return;
    // На React Native нет navigator.clipboard — используем Clipboard
    // (expo-clipboard не всегда установлен, fallback через Share)
    if (Platform.OS === "web") {
      navigator.clipboard?.writeText(data.address);
    } else {
      handleShare();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Ionicons name="shield-checkmark" size={22} color={Colors.success} />
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            {/* QR-код */}
            <View style={styles.qrContainer}>
              {data?.available && data.qrUrl ? (
                <Image
                  source={{ uri: data.qrUrl }}
                  style={styles.qrImage}
                  contentFit="contain"
                />
              ) : (
                <View style={styles.qrPlaceholder}>
                  <Ionicons name="cloud-offline" size={48} color={Colors.textMuted} />
                  <Text style={styles.qrPlaceholderText}>
                    Приватный канал поддержки пока недоступен
                  </Text>
                  <Text style={styles.qrPlaceholderHint}>
                    Используйте обычный чат в приложении
                  </Text>
                </View>
              )}
              {data?.available && (
                <View style={styles.qrBadge}>
                  <Ionicons name="shield-checkmark" size={10} color={Colors.background} />
                  <Text style={styles.qrBadgeText}>E2E</Text>
                </View>
              )}
            </View>

            {/* Описание */}
            <Text style={styles.modalDescription}>{description}</Text>

            {/* Инструкция */}
            {data?.instructions && (
              <View style={styles.instructionsBox}>
                <Text style={styles.instructionsTitle}>Как подключиться:</Text>
                <View style={styles.instructionsList}>
                  <InstructionStep number={1} text={data.instructions.step1} />
                  <InstructionStep number={2} text={data.instructions.step2} />
                  <InstructionStep number={3} text={data.instructions.step3} />
                  <InstructionStep number={4} text={data.instructions.step4} />
                </View>
              </View>
            )}

            {/* Адрес */}
            {data?.address && (
              <View style={styles.addressBox}>
                <Text style={styles.addressLabel}>Адрес (для ручного ввода):</Text>
                <Text style={styles.addressText} selectable>
                  {data.address}
                </Text>
              </View>
            )}

            {/* Кнопки */}
            {data?.available && (
              <View style={styles.actionsRow}>
                <Pressable style={styles.actionButton} onPress={handleCopyAddress}>
                  <Ionicons name="copy" size={16} color={Colors.text} />
                  <Text style={styles.actionButtonText}>Поделиться адресом</Text>
                </Pressable>
                <Pressable style={styles.actionButton} onPress={handleOpenSimplexSite}>
                  <Ionicons name="open-outline" size={16} color={Colors.text} />
                  <Text style={styles.actionButtonText}>Установить SimpleX</Text>
                </Pressable>
              </View>
            )}

            {/* Предупреждение */}
            <View style={styles.warningBox}>
              <Ionicons name="warning" size={14} color={Colors.warning} />
              <Text style={styles.warningText}>
                Переписка E2E-шифрована. Маркетплейс не видит содержимое сообщений.
                Сохраняйте backup ключей — при потере устройства история не восстанавливается.
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InstructionStep({ number, text }: { number: number; text: string }) {
  return (
    <View style={styles.instructionStep}>
      <View style={styles.instructionNumber}>
        <Text style={styles.instructionNumberText}>{number}</Text>
      </View>
      <Text style={styles.instructionText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // === Compact ===
  compactButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: Colors.success,
    gap: 4,
  },
  compactText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    fontWeight: "500",
    marginLeft: 4,
  },

  // === Banner ===
  bannerContainer: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.success,
    ...Shadows.sm,
  },
  bannerRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  bannerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${Colors.success}20`, // 20 = 12% opacity
    alignItems: "center",
    justifyContent: "center",
  },
  bannerContent: {
    flex: 1,
  },
  bannerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: 4,
  },
  bannerTitle: {
    fontSize: FontSize.md,
    fontWeight: "700",
    color: Colors.text,
    flexShrink: 1,
  },
  e2eBadge: {
    backgroundColor: `${Colors.success}20`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  e2eBadgeText: {
    fontSize: FontSize.xs - 1,
    color: Colors.success,
    fontWeight: "700",
  },
  bannerDescription: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  bannerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.success,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: 6,
    alignSelf: "flex-start",
  },
  bannerButtonText: {
    color: Colors.background,
    fontSize: FontSize.sm,
    fontWeight: "600",
  },

  // === Card ===
  cardContainer: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: "center",
    ...Shadows.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    color: Colors.text,
  },
  cardDescription: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
  cardButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.success,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: 8,
  },
  cardButtonText: {
    color: Colors.background,
    fontSize: FontSize.md,
    fontWeight: "600",
  },

  // === Modal ===
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: "90%",
    paddingBottom: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    flex: 1,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: "700",
    color: Colors.text,
    flexShrink: 1,
  },
  modalScroll: {
    maxHeight: 600,
  },
  modalScrollContent: {
    padding: Spacing.md,
  },
  modalDescription: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.md,
    lineHeight: 20,
  },

  // === QR-код ===
  qrContainer: {
    alignSelf: "center",
    position: "relative",
    marginBottom: Spacing.md,
  },
  qrImage: {
    width: 220,
    height: 220,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.success,
  },
  qrBadge: {
    position: "absolute",
    top: -8,
    right: -8,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.success,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: BorderRadius.pill,
  },
  qrBadgeText: {
    color: Colors.background,
    fontSize: FontSize.xs - 1,
    fontWeight: "700",
  },
  qrPlaceholder: {
    width: 220,
    height: 220,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
  },
  qrPlaceholderText: {
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  qrPlaceholderHint: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginTop: 4,
  },

  // === Instructions ===
  instructionsBox: {
    backgroundColor: `${Colors.success}10`,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  instructionsTitle: {
    fontSize: FontSize.sm,
    fontWeight: "600",
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  instructionsList: {
    gap: Spacing.sm,
  },
  instructionStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  instructionNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.success,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  instructionNumberText: {
    color: Colors.background,
    fontSize: FontSize.xs,
    fontWeight: "700",
  },
  instructionText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    lineHeight: 19,
  },

  // === Address ===
  addressBox: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  addressLabel: {
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  addressText: {
    fontSize: FontSize.xs - 1,
    color: Colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // === Actions ===
  actionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionButtonText: {
    fontSize: FontSize.xs,
    color: Colors.text,
    fontWeight: "500",
  },

  // === Warning ===
  warningBox: {
    flexDirection: "row",
    gap: Spacing.xs,
    backgroundColor: `${Colors.warning}15`,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
  },
  warningText: {
    flex: 1,
    fontSize: FontSize.xs - 1,
    color: Colors.textMuted,
    lineHeight: 16,
  },

  // === Common ===
  disabled: {
    opacity: 0.5,
  },
});
