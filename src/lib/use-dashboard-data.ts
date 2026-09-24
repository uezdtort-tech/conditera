/**
 * use-dashboard-data.ts — TanStack Query hooks для дашбордов (v2.0 + mutations).
 *
 * Содержит:
 *   - Query hooks: useSupplierData, useCourierData, useAdminData (чтение)
 *   - Mutation hooks: useUpdateProfile, useCreateAddress, useDeleteAddress,
 *     useChangePassword, useDeleteAccount, useCreateOrder, useUpdateOrderStatus,
 *     useCreatePayoutRequest, useApprovePayout, useUploadAvatar
 *
 * Все мутации автоматически инвалидируют связанные queries через queryClient.invalidateQueries.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ==================== Types ====================
export interface SupplierStats {
  totalProducts: number;
  totalStockValue: number;
  lowStockItems: number;
  totalOrders: number;
  activeOrders: number;
  revenue: number;
  companyName: string | null;
  rating: number;
  isActive: boolean;
}

export interface SupplierData {
  stats: SupplierStats;
  supplier?: {
    businessName: string;
    avatar: string;
    location: { city: string; region: string };
    minOrder: number;
    deliveryTime: string;
    rating: number;
    legalInfo: { status: string; documentsVerified: boolean };
    deliveryRegions: string[];
    deliveryOptions: string[];
  };
  orders?: Array<{
    id: string;
    number: string;
    customer: string;
    items: number;
    total: number;
    status: string;
    date: string;
  }>;
  revenue?: Array<{ month: string; value: number }>;
  products?: Array<{
    id: string;
    title: string;
    price: number;
    inStock: number;
    unit: string;
    image: string;
  }>;
  stub?: boolean;
}

export interface CourierData {
  stats: {
    activeDeliveries: number;
    completedToday: number;
    earningsToday: number;
    earningsMonth: number;
    rating: number;
  };
  activeDeliveries: Array<{
    id: string;
    orderId: string;
    customer: string;
    address: string;
    status: string;
    deliveryTime: string;
    distance: string;
  }>;
  history: Array<{
    id: string;
    orderId: string;
    customer: string;
    completedAt: string;
    earnings: number;
    rating: number;
  }>;
  stub?: boolean;
}

export interface AdminData {
  stats: {
    totalUsers: number;
    newUsersToday: number;
    totalOrders: number;
    revenueToday: number;
    revenueMonth: number;
    activeTickets: number;
    pendingPayouts: number;
    fraudAlerts: number;
  };
  recentOrders: Array<{
    id: string;
    number: string;
    customer: string;
    total: number;
    status: string;
    date: string;
  }>;
  revenue: Array<{ month: string; value: number }>;
  stub?: boolean;
}

// ==================== Hooks ====================

/** Загрузка данных для SupplierDashboard */
export function useSupplierData() {
  return useQuery<SupplierData>({
    queryKey: ["supplier-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/supplier/dashboard");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<SupplierData>;
    },
    staleTime: 30 * 1000,
  });
}

/** Загрузка данных для CourierDashboard */
export function useCourierData() {
  return useQuery<CourierData>({
    queryKey: ["courier-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/courier/dashboard");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<CourierData>;
    },
    staleTime: 30 * 1000,
  });
}

/** Загрузка данных для AdminDashboard */
export function useAdminData() {
  return useQuery<AdminData>({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<AdminData>;
    },
    staleTime: 30 * 1000,
  });
}

// ==================== Mutation Types ====================
export interface UpdateProfileInput {
  name?: string;
  phone?: string;
  bio?: string;
  avatar?: string;
}

export interface CreateAddressInput {
  text: string;
}

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

export interface CreateOrderInput {
  productId: string;
  quantity: number;
  deliveryAddress?: string;
  deliveryDate?: string;
  comment?: string;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  status: "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "IN_DELIVERY" | "DELIVERED" | "COMPLETED" | "CANCELLED";
  comment?: string;
}

export interface CreatePayoutInput {
  amount: number;
  method: "card" | "sbp" | "invoice";
  bankDetails?: string;
}

// ==================== Mutation Hooks ====================

/** Обновление профиля пользователя */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProfileInput) => {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["courier-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success("Профиль обновлён");
    },
    onError: (error: Error) => {
      toast.error("Ошибка обновления профиля", { description: error.message });
    },
  });
}

/** Создание адреса доставки */
export function useCreateAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAddressInput) => {
      const res = await fetch("/api/profile/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Адрес добавлен");
    },
    onError: (error: Error) => {
      toast.error("Ошибка добавления адреса", { description: error.message });
    },
  });
}

/** Удаление адреса доставки */
export function useDeleteAddress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (addressId: string) => {
      const res = await fetch(`/api/profile/addresses?id=${addressId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Адрес удалён");
    },
    onError: (error: Error) => {
      toast.error("Ошибка удаления адреса", { description: error.message });
    },
  });
}

/** Смена пароля */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) => {
      const res = await fetch("/api/profile/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Пароль изменён");
    },
    onError: (error: Error) => {
      toast.error("Ошибка смены пароля", { description: error.message });
    },
  });
}

/** Удаление аккаунта (soft delete) */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (confirmEmail: string) => {
      const res = await fetch("/api/profile/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Аккаунт удалён");
      // Redirect to home after short delay
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.location.href = "/";
        }
      }, 1500);
    },
    onError: (error: Error) => {
      toast.error("Ошибка удаления аккаунта", { description: error.message });
    },
  });
}

/** Загрузка аватара (multipart form-data) */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ avatarUrl: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-dashboard"] });
      toast.success("Аватар загружен");
    },
    onError: (error: Error) => {
      toast.error("Ошибка загрузки аватара", { description: error.message });
    },
  });
}

/** Создание заказа */
export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrderInput) => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-dashboard"] });
      toast.success("Заказ создан");
    },
    onError: (error: Error) => {
      toast.error("Ошибка создания заказа", { description: error.message });
    },
  });
}

/** Обновление статуса заказа (для кондитера, курьера, админа) */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOrderStatusInput) => {
      const res = await fetch(`/api/orders/${input.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: input.status, comment: input.comment }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["courier-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-dashboard"] });
      toast.success(`Заказ ${variables.orderId}: статус → ${variables.status}`);
    },
    onError: (error: Error) => {
      toast.error("Ошибка обновления статуса", { description: error.message });
    },
  });
}

/** Запрос выплаты (для кондитеров и поставщиков) */
export function useCreatePayoutRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePayoutInput) => {
      const res = await fetch("/api/payouts/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-dashboard"] });
      toast.success("Запрос на выплату отправлен");
    },
    onError: (error: Error) => {
      toast.error("Ошибка запроса выплаты", { description: error.message });
    },
  });
}

/** Одобрение выплаты (для админа/инспектора) */
export function useApprovePayout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ payoutId, action }: { payoutId: string; action: "approve" | "reject" }) => {
      const res = await fetch(`/api/admin/payouts/${payoutId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success(`Выплата ${variables.payoutId}: ${variables.action === "approve" ? "одобрена" : "отклонена"}`);
    },
    onError: (error: Error) => {
      toast.error("Ошибка изменения статуса выплаты", { description: error.message });
    },
  });
}

/** Бан/разбан пользователя (для админа) */
export function useToggleUserBan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, banned }: { userId: string; banned: boolean }) => {
      const res = await fetch(`/api/admin/users/${userId}/${banned ? "unban" : "ban"}`, {
        method: "POST",
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
      toast.success(`Пользователь ${variables.banned ? "разбанен" : "забанен"}`);
    },
    onError: (error: Error) => {
      toast.error("Ошибка изменения статуса пользователя", { description: error.message });
    },
  });
}
