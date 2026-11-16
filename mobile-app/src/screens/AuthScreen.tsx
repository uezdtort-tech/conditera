/**
 * Auth screen — login or register mode.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import type { RootStackParamList } from "@/navigation/AppNavigator";
import { useAppStore } from "@/store";
import { Colors, Spacing, FontSize, BorderRadius } from "@/theme";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type AuthRoute = RouteProp<RootStackParamList, "Auth">;

export function AuthScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<AuthRoute>();
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);

  const [mode, setMode] = useState<"login" | "register">(route.params?.mode || "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert("Заполните email и пароль");
      return;
    }
    if (mode === "register" && (!name || !phone)) {
      Alert.alert("Заполните все поля");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Пароль должен быть не менее 8 символов");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register({ email, password, name, phone });
      }
      navigation.goBack();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Logo */}
          <LinearGradient
            colors={[Colors.primary, Colors.accent]}
            style={styles.logo}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.logoText}>Уездный</Text>
            <Text style={styles.logoText}>кондитер</Text>
          </LinearGradient>

          <Text style={styles.welcomeTitle}>
            {mode === "login" ? "С возвращением!" : "Добро пожаловать!"}
          </Text>
          <Text style={styles.welcomeDesc}>
            {mode === "login"
              ? "Войдите в аккаунт, чтобы заказывать торты"
              : "Создайте аккаунт за 30 секунд"}
          </Text>

          {/* Form */}
          {mode === "register" && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Имя"
                value={name}
                onChangeText={setName}
                placeholderTextColor={Colors.textMuted}
              />
              <TextInput
                style={styles.input}
                placeholder="Телефон"
                value={phone}
                onChangeText={setPhone}
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
              />
            </>
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Пароль"
              value={password}
              onChangeText={setPassword}
              placeholderTextColor={Colors.textMuted}
              secureTextEntry={!showPassword}
            />
            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeBtn}
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={20}
                color={Colors.textMuted}
              />
            </Pressable>
          </View>

          <Pressable
            style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.submitBtnText}>
                {mode === "login" ? "Войти" : "Зарегистрироваться"}
              </Text>
            )}
          </Pressable>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>
              {mode === "login" ? "Нет аккаунта?" : "Уже есть аккаунт?"}
            </Text>
            <Pressable
              onPress={() => setMode(mode === "login" ? "register" : "login")}
            >
              <Text style={styles.switchBtn}>
                {mode === "login" ? "Регистрация" : "Вход"}
              </Text>
            </Pressable>
          </View>

          {/* Demo credentials hint */}
          <View style={styles.demoHint}>
            <Text style={styles.demoTitle}>Демо-аккаунты:</Text>
            <Text style={styles.demoText}>customer@demo.ru / demo123</Text>
            <Text style={styles.demoText}>admin@demo.ru / admin123</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  scroll: { padding: Spacing.lg, alignItems: "stretch" },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  logoText: {
    color: "white",
    fontSize: FontSize.lg,
    fontWeight: "700",
    textAlign: "center",
  },
  welcomeTitle: {
    fontSize: FontSize.xxl,
    fontWeight: "700",
    color: Colors.text,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  welcomeDesc: {
    fontSize: FontSize.md,
    color: Colors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  input: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    fontSize: FontSize.md,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  eyeBtn: { padding: Spacing.md },
  submitBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    alignItems: "center",
    marginTop: Spacing.md,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    color: "white",
    fontSize: FontSize.lg,
    fontWeight: "600",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.lg,
  },
  switchText: { color: Colors.textMuted, fontSize: FontSize.sm },
  switchBtn: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: "600" },
  demoHint: {
    marginTop: Spacing.xl,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
  },
  demoTitle: { fontSize: FontSize.xs, fontWeight: "600", color: Colors.text, marginBottom: 4 },
  demoText: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: "monospace" },
});
