"use client";

/**
 * ProfileSettings — единый компонент настроек профиля для всех ролей (v2.0, strict typed, TanStack mutations).
 *
 * Включает:
 *   - редактирование базовых данных (имя, аватар, телефон) — useUpdateProfile + useUploadAvatar
 *   - смену пароля — useChangePassword
 *   - адреса доставки — useCreateAddress + useDeleteAddress
 *   - удаление аккаунта — useDeleteAccount
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store";
import { serverLogout, csrfFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import type { LucideIcon } from "lucide-react";
import {
  User as UserIcon, MapPin, Lock, Shield, Bell, Trash2,
  Camera, Save, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateProfile, useCreateAddress, useDeleteAddress,
  useChangePassword, useDeleteAccount, useUploadAvatar,
} from "@/lib/use-dashboard-data";

// ==================== Types ====================
interface AddressItem {
  id: string;
  text: string;
}

interface NotificationPrefs {
  email: boolean;
  push: boolean;
  telegram: boolean;
  sms: boolean;
}

interface ActiveSession {
  id: string;
  auth_method: string;
  user_agent: string | null;
  ip_address: string | null;
  device_label: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  isCurrent: boolean;
}

interface SecurityEvent {
  id: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface ProfileSettingsProps {
  /** Optional override for user (defaults to useAppStore user) */
  user?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    avatar?: string;
    bio?: string;
    addresses?: AddressItem[];
    tfaEnabled?: boolean;
  };
  /** Override logout function */
  onLogout?: () => void;
  /** Override open auth modal */
  onOpenAuth?: () => void;
}

// ==================== Component ====================
export function ProfileSettings({ user: userProp, onLogout, onOpenAuth }: ProfileSettingsProps): React.JSX.Element {
  const router = useRouter();
  const storeUser = useAppStore((s) => s.user);
  const storeLogout = useAppStore((s) => s.logout);
  const storeSetAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  const user = userProp || (storeUser as unknown as ProfileSettingsProps["user"]);
  const setAuthModalOpen = onOpenAuth || storeSetAuthModalOpen;

  // Единый logout: сервер чистит httpOnly cookies (cd_session/cd_refresh) +
  // sessionStorage cd_access_token, затем сбрасываем store и редиректим на главную.
  const handleLogout = React.useCallback(async (): Promise<void> => {
    await serverLogout();
    storeLogout();
    router.push("/");
    router.refresh();
  }, [storeLogout, router]);
  const logout = onLogout || handleLogout;

  // Mutations
  const updateProfile = useUpdateProfile();
  const createAddress = useCreateAddress();
  const deleteAddress = useDeleteAddress();
  const changePassword = useChangePassword();
  const deleteAccount = useDeleteAccount();
  const uploadAvatar = useUploadAvatar();

  // Локальное состояние формы
  const [name, setName] = React.useState(user?.name || "");
  const [phone, setPhone] = React.useState(user?.phone || "");
  const [bio, setBio] = React.useState((user as { bio?: string })?.bio || "");
  const [avatar, setAvatar] = React.useState(user?.avatar || "");

  // Адреса (для CUSTOMER)
  const [addresses, setAddresses] = React.useState<AddressItem[]>(
    (user as { addresses?: AddressItem[] })?.addresses || []
  );
  const [newAddress, setNewAddress] = React.useState("");

  // Уведомления
  const [notifications, setNotifications] = React.useState<NotificationPrefs>({
    email: true,
    push: false,
    telegram: false,
    sms: false,
  });

  // Смена пароля
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  // Удаление аккаунта
  const [deleteConfirm, setDeleteConfirm] = React.useState("");

  // Активные устройства и журнал безопасности аккаунта.
  const [activeSessions, setActiveSessions] = React.useState<ActiveSession[]>([]);
  const [securityEvents, setSecurityEvents] = React.useState<SecurityEvent[]>([]);
  const [securityLoading, setSecurityLoading] = React.useState(false);
  const [securityError, setSecurityError] = React.useState<string | null>(null);
  const [revokingSession, setRevokingSession] = React.useState<string | null>(null);

  // Загружаем канонический профиль с сервера: dashboard-store содержит
  // неполный набор полей и может гидратироваться позже, чем эта вкладка.
  React.useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();
    const loadProfile = async (): Promise<void> => {
      try {
        const response = await fetch("/api/profile", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Не удалось загрузить профиль");
        const payload = await response.json() as {
          profile?: { name?: string | null; phone?: string | null; bio?: string | null; avatar_url?: string | null };
          addresses?: AddressItem[];
        };
        if (controller.signal.aborted) return;
        setName(payload.profile?.name || "");
        setPhone(payload.profile?.phone || "");
        setBio(payload.profile?.bio || "");
        setAvatar(payload.profile?.avatar_url || "");
        setAddresses(payload.addresses || []);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Не блокируем редактирование, если профильный API временно недоступен.
        setName(user.name || "");
        setPhone(user.phone || "");
        setBio((user as { bio?: string }).bio || "");
        setAvatar(user.avatar || "");
        setAddresses((user as { addresses?: AddressItem[] }).addresses || []);
        console.error("[profile-settings] profile load failed:", error);
      }
    };
    void loadProfile();
    return () => controller.abort();
  }, [user?.id]);

  const loadSecurityData = React.useCallback(async (): Promise<void> => {
    if (!user?.id) return;
    setSecurityLoading(true);
    setSecurityError(null);
    try {
      const [sessionsResponse, eventsResponse] = await Promise.all([
        fetch("/api/auth/sessions", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/auth/security-events", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (!sessionsResponse.ok) throw new Error("Не удалось загрузить активные сеансы");
      if (!eventsResponse.ok) throw new Error("Не удалось загрузить журнал безопасности");
      const sessionsPayload = await sessionsResponse.json() as { sessions?: ActiveSession[] };
      const eventsPayload = await eventsResponse.json() as { events?: SecurityEvent[] };
      setActiveSessions(sessionsPayload.sessions ?? []);
      setSecurityEvents(eventsPayload.events ?? []);
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "Ошибка загрузки безопасности");
    } finally {
      setSecurityLoading(false);
    }
  }, [user?.id]);

  React.useEffect(() => {
    void loadSecurityData();
  }, [loadSecurityData]);

  const handleRevokeSession = async (sessionId: string): Promise<void> => {
    setRevokingSession(sessionId);
    try {
      const response = await csrfFetch(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось завершить сеанс");
      toast.success("Сеанс завершён");
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка завершения сеанса");
    } finally {
      setRevokingSession(null);
    }
  };

  const handleRevokeOtherSessions = async (): Promise<void> => {
    setRevokingSession("others");
    try {
      const response = await csrfFetch("/api/auth/sessions", { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось завершить остальные сеансы");
      const payload = await response.json() as { revoked?: number };
      toast.success(`Завершено сеансов: ${payload.revoked ?? 0}`);
      await loadSecurityData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка завершения сеансов");
    } finally {
      setRevokingSession(null);
    }
  };

  const securityEventLabel = (eventType: string): string => ({
    new_device_session: "Вход с нового устройства",
    session_created: "Создан новый сеанс",
    session_revoked: "Сеанс завершён",
    refresh_replay_detected: "Обнаружено повторное использование токена",
  }[eventType] || eventType);

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Button onClick={() => setAuthModalOpen(true)}>Войти</Button>
      </div>
    );
  }

  const handleSaveProfile = (): void => {
    updateProfile.mutate({ name, phone, bio, avatar });
  };

  const handleChangePassword = (): void => {
    if (newPassword !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Пароль должен быть не менее 8 символов");
      return;
    }
    changePassword.mutate({ oldPassword, newPassword });
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Файл слишком большой (макс. 5 МБ)");
      return;
    }
    // Optimistic preview; replace it with the persisted URL after upload.
    const previousAvatar = avatar;
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
    uploadAvatar.mutate(file, {
      onSuccess: (result: { avatarUrl: string }) => setAvatar(result.avatarUrl),
      onError: () => setAvatar(previousAvatar),
    });
  };

  const handleAddAddress = (): void => {
    if (!newAddress.trim()) return;
    // Optimistic add
    const tempId = Date.now().toString();
    setAddresses([...addresses, { id: tempId, text: newAddress }]);
    // Real create
    createAddress.mutate(
      { text: newAddress },
      {
        onSuccess: (data: { id?: string }) => {
          if (data.id) {
            setAddresses((prev) =>
              prev.map((a) => (a.id === tempId ? { ...a, id: data.id as string } : a))
            );
          }
        },
        onError: () => {
          setAddresses((prev) => prev.filter((a) => a.id !== tempId));
        },
      }
    );
    setNewAddress("");
  };

  const handleRemoveAddress = (id: string): void => {
    // Optimistic remove
    const prev = addresses;
    setAddresses(addresses.filter((a) => a.id !== id));
    deleteAddress.mutate(id, {
      onError: () => {
        setAddresses(prev);
      },
    });
  };

  const handleDeleteAccount = (): void => {
    if (deleteConfirm !== user.email) {
      toast.error("Введите ваш email для подтверждения");
      return;
    }
    deleteAccount.mutate(user.email);
  };

  const tfaEnabled = (user as { tfaEnabled?: boolean }).tfaEnabled === true;
  const isSaving = updateProfile.isPending || uploadAvatar.isPending;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Настройки профиля</h1>

      {/* Базовая информация */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <UserIcon className="h-5 w-5 text-primary" />
          Базовая информация
        </h3>
        <Separator />
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatar} alt={name} />
              <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <label className="absolute -bottom-1 -right-1 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
                disabled={uploadAvatar.isPending}
              />
              <div className={`w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white shadow-lg ${uploadAvatar.isPending ? "opacity-50" : ""}`}>
                <Camera className="h-4 w-4" />
              </div>
            </label>
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <Label htmlFor="name">Имя</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как вас зовут"
              />
            </div>
            <div>
              <Label htmlFor="phone">Телефон</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 (000) 000-00-00"
              />
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="bio">О себе</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Расскажите немного о себе"
            rows={3}
          />
        </div>
        <Button onClick={handleSaveProfile} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? "Сохранение..." : "Сохранить"}
        </Button>
      </Card>

      {/* Адреса доставки (для CUSTOMER) */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          Адреса доставки
        </h3>
        <Separator />
        <div className="space-y-2">
          {addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Адресов пока нет</p>
          ) : (
            addresses.map((addr) => (
              <div
                key={addr.id}
                className="flex items-center gap-2 p-3 border border-border rounded"
              >
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-sm">{addr.text}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveAddress(addr.id)}
                  disabled={deleteAddress.isPending}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Введите новый адрес"
            onKeyDown={(e) => e.key === "Enter" && handleAddAddress()}
            disabled={createAddress.isPending}
          />
          <Button onClick={handleAddAddress} disabled={createAddress.isPending}>
            {createAddress.isPending ? "..." : "Добавить"}
          </Button>
        </div>
      </Card>

      {/* Смена пароля */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          Смена пароля
        </h3>
        <Separator />
        <div className="space-y-3">
          <div>
            <Label htmlFor="oldPassword">Текущий пароль</Label>
            <Input
              id="oldPassword"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <Label htmlFor="newPassword">Новый пароль</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Минимум 8 символов"
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">Повторите новый пароль</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button
            onClick={handleChangePassword}
            variant="outline"
            disabled={changePassword.isPending}
          >
            {changePassword.isPending ? "Изменение..." : "Изменить пароль"}
          </Button>
        </div>
      </Card>

      {/* 2FA */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Двухфакторная аутентификация
        </h3>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">2FA через TOTP</p>
            <p className="text-xs text-muted-foreground">
              Google Authenticator, Authy, 1Password
            </p>
          </div>
          <Badge variant="outline">
            {tfaEnabled ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />
                Включена
              </>
            ) : (
              "Не включена"
            )}
          </Badge>
        </div>
        {!tfaEnabled && (
          <Button variant="outline" onClick={() => toast.info("Откройте TFASettings")}>
            Настроить 2FA
          </Button>
        )}
      </Card>

      {/* Устройства, сеансы и мониторинг передачи аккаунта */}
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Устройства и безопасность аккаунта
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRevokeOtherSessions()}
            disabled={securityLoading || revokingSession !== null || activeSessions.filter((session) => !session.isCurrent).length === 0}
          >
            {revokingSession === "others" ? "Завершаем..." : "Завершить остальные сеансы"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Для защиты персонального аккаунта одновременно действует только один сеанс: при входе на другом устройстве предыдущий автоматически завершается. Входы с новых устройств и повторное использование токенов фиксируются в журнале и вызывают предупреждение. Если вход выполнили не вы, немедленно смените пароль и проверьте 2FA. Не передавайте пароль и коды подтверждения другим людям.
        </p>
        <Separator />
        {securityLoading ? (
          <p className="text-sm text-muted-foreground">Загружаем сеансы...</p>
        ) : securityError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">{securityError}</p>
            <Button size="sm" variant="outline" onClick={() => void loadSecurityData()}>Повторить</Button>
          </div>
        ) : activeSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Активных сеансов не найдено.</p>
        ) : (
          <div className="space-y-3">
            {activeSessions.map((session) => (
              <div key={session.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{session.device_label || "Неизвестное устройство"}</span>
                    {session.isCurrent && <Badge variant="secondary">Текущий сеанс</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    IP: {session.ip_address || "не определён"} · Вход: {new Date(session.created_at).toLocaleString("ru-RU")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Активность: {new Date(session.last_seen_at).toLocaleString("ru-RU")} · Метод: {session.auth_method}
                  </p>
                  {session.user_agent && (
                    <p className="text-[11px] text-muted-foreground break-all mt-1">{session.user_agent}</p>
                  )}
                </div>
                {!session.isCurrent && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRevokeSession(session.id)}
                    disabled={revokingSession !== null}
                  >
                    {revokingSession === session.id ? "Завершаем..." : "Завершить"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        <Separator />
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Последние события безопасности</h4>
          {securityEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">Событий пока нет.</p>
          ) : securityEvents.slice(0, 10).map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-3 text-xs">
              <div className="min-w-0">
                <p className="font-medium">{securityEventLabel(event.event_type)}</p>
                <p className="text-muted-foreground">
                  {new Date(event.created_at).toLocaleString("ru-RU")} · {event.ip_address || "IP неизвестен"}
                </p>
              </div>
              <Badge variant={event.severity === "critical" ? "destructive" : "outline"}>
                {event.severity === "critical" ? "Критично" : event.severity === "warning" ? "Внимание" : "Инфо"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Уведомления */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Уведомления
        </h3>
        <Separator />
        <div className="space-y-2">
          {([
            { key: "email" as const, label: "Email-уведомления" },
            { key: "push" as const, label: "Push-уведомления (браузер)" },
            { key: "telegram" as const, label: "Telegram-уведомления" },
            { key: "sms" as const, label: "SMS-уведомления (платно)" },
          ] as { key: keyof NotificationPrefs; label: string }[]).map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer p-2 hover:bg-accent rounded"
            >
              <input
                type="checkbox"
                checked={notifications[key]}
                onChange={(e) =>
                  setNotifications({
                    ...notifications,
                    [key]: e.target.checked,
                  })
                }
                className="w-4 h-4"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </Card>

      {/* Опасная зона: удаление аккаунта */}
      <Card className="p-5 space-y-4 border-destructive">
        <h3 className="font-semibold flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Опасная зона
        </h3>
        <Separator />
        <div>
          <p className="text-sm mb-2">
            Удаление аккаунта — необратимое действие. Все ваши данные будут
            помечены как удалённые (soft delete). Заказы и платежи останутся в
            базе для отчётности.
          </p>
          <Label htmlFor="deleteConfirm">
            Введите ваш email ({user.email}) для подтверждения:
          </Label>
          <Input
            id="deleteConfirm"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={user.email}
            className="mb-2"
          />
          <Button
            variant="destructive"
            onClick={handleDeleteAccount}
            disabled={deleteConfirm !== user.email || deleteAccount.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {deleteAccount.isPending ? "Удаление..." : "Удалить аккаунт"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
