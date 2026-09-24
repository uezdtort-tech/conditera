/**
 * VerificationBannerScreen — экран статуса модерации кондитера в mobile-app.
 *
 * Показывает:
 *  - pending: "Профиль на модерации" с подсказками
 *  - approved: "Подтверждён" (с конфетти)
 *  - rejected: "Отклонён" с причиной + кнопка повторной отправки
 *  - needs_revision: "Запрошены правки" с причиной + кнопка
 *
 * Pull-to-refresh обновляет статус.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

interface VerificationInfo {
  status: "pending" | "approved" | "rejected" | "needs_revision";
  rejectionReason?: string | null;
  verifiedAt?: string | null;
  canPublish: boolean;
  businessName?: string;
}

export function VerificationBannerScreen() {
  const [info, setInfo] = useState<VerificationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("http://localhost:3000/api/confectioner/status", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setInfo(data);
      }
    } catch (e) {
      console.error("loadStatus error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleResubmit = async () => {
    Alert.alert(
      "Повторная отправка",
      "Отправить профиль на повторную модерацию?",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Отправить",
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await fetch("http://localhost:3000/api/confectioner/resubmit", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
              });
              if (res.ok) {
                Alert.alert("✓", "Профиль отправлен на повторную модерацию");
                loadStatus();
              } else {
                const err = await res.json();
                Alert.alert("Ошибка", err.error || "Не удалось отправить");
              }
            } catch (e) {
              Alert.alert("Ошибка", "Нет соединения с сервером");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!info) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.muted} />
        <Text style={styles.emptyText}>Не удалось загрузить статус</Text>
      </View>
    );
  }

  // Конфигурация по статусам
  const configs = {
    pending: {
      icon: "time-outline" as const,
      color: "#f59e0b",
      bg: "#fffbeb",
      title: "Профиль на модерации",
      message:
        "Ваш профиль ожидает подтверждения администратора. Обычно это занимает 1-2 рабочих дня.\n\nПока ждёте — можете заполнить профиль подробнее: добавить портфолио, описать специализации, настроить способы оплаты.",
    },
    approved: {
      icon: "checkmark-circle" as const,
      color: "#10b981",
      bg: "#ecfdf5",
      title: "Профиль подтверждён! 🎉",
      message:
        "Ваш профиль подтверждён администратором. Теперь вам доступно:\n\n✓ Публикация товаров в каталоге\n✓ Принятие заказов\n✓ Запрос выплат\n✓ Участие в акциях",
    },
    rejected: {
      icon: "close-circle" as const,
      color: "#ef4444",
      bg: "#fef2f2",
      title: "Профиль отклонён",
      message:
        `Причина:\n${info.rejectionReason || "не указана"}\n\n` +
        "Вы можете исправить профиль и отправить его на повторную модерацию.",
    },
    needs_revision: {
      icon: "create-outline" as const,
      color: "#3b82f6",
      bg: "#eff6ff",
      title: "Запрошены правки",
      message:
        `Что нужно исправить:\n${info.rejectionReason || "уточните детали"}\n\n` +
        "После внесения правок — отправьте профиль на повторную модерацию.",
    },
  };

  const c = configs[info.status];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={loadStatus} colors={[Colors.primary]} />
      }
    >
      {/* Hero card */}
      <View style={[styles.heroCard, { backgroundColor: c.bg }]}>
        <Ionicons name={c.icon} size={56} color={c.color} />
        <Text style={[styles.heroTitle, { color: c.color }]}>{c.title}</Text>
        <Text style={styles.heroMessage}>{c.message}</Text>
      </View>

      {/* Business info */}
      {info.businessName && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Бизнес</Text>
          <Text style={styles.infoValue}>{info.businessName}</Text>
        </View>
      )}

      {/* Verified date */}
      {info.verifiedAt && (
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Дата подтверждения</Text>
          <Text style={styles.infoValue}>
            {new Date(info.verifiedAt).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Text>
        </View>
      )}

      {/* Action button */}
      {(info.status === "rejected" || info.status === "needs_revision") && (
        <Pressable
          style={[styles.actionButton, submitting && styles.actionButtonDisabled]}
          onPress={handleResubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="send" size={18} color="#fff" />
              <Text style={styles.actionButtonText}>Отправить на повторную модерацию</Text>
            </>
          )}
        </Pressable>
      )}

      {/* Tip для pending */}
      {info.status === "pending" && (
        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={Colors.primary} />
          <Text style={styles.tipText}>
            Совет: заполните профиль полностью — это ускорит модерацию и повысит шансы на
            авто-подтверждение через DaData (для ИП и ООО с активным статусом).
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.background,
  },
  emptyText: {
    marginTop: Spacing.md,
    color: Colors.muted,
    fontSize: FontSize.md,
  },
  heroCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  heroTitle: {
    fontSize: FontSize.xl,
    fontWeight: "bold",
    marginTop: Spacing.md,
    textAlign: "center",
  },
  heroMessage: {
    fontSize: FontSize.md,
    color: Colors.text,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  infoCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoLabel: {
    fontSize: FontSize.xs,
    color: Colors.muted,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: "600",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
    gap: 8,
  },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: {
    color: "#fff",
    fontSize: FontSize.md,
    fontWeight: "600",
  },
  tipCard: {
    flexDirection: "row",
    backgroundColor: Colors.primary + "15",
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
    gap: 8,
  },
  tipText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
});
