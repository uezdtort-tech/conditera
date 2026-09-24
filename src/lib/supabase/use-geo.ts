/**
 * use-geo.ts — TanStack Query hooks для геоданных (Модуль 5: Карта).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface ConfectionerGeo {
  id: string;
  confectioner_id: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  city: string | null;
  delivery_radius_km: number;
  working_hours: Record<string, unknown> | null;
  tasting_available: boolean;
  tasting_price: number;
  has_atelier: boolean;
  is_active: boolean;
  is_verified: boolean;
}

export interface Atelier {
  id: string;
  confectioner_geo_id: string;
  name: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  services: string[];
  photos: string[];
  working_hours: Record<string, unknown> | null;
  capacity: number;
  is_active: boolean;
}

export interface Tasting {
  id: string;
  atelier_id: string;
  date: string;
  start_time: string;
  end_time: string;
  max_participants: number;
  current_participants: number;
  price: number;
  status: string;
}

/** Поиск кондитеров в радиусе (через lat/lng) */
export function useConfectionersNearby(lat?: number, lng?: number, radiusKm: number = 20) {
  return useQuery<ConfectionerGeo[]>({
    queryKey: ["confectioners-nearby", lat, lng, radiusKm],
    queryFn: async () => {
      if (lat === undefined || lng === undefined) return [];
      const { data, error } = await supabaseBrowser
        .from("confectioner_geo")
        .select("*")
        .eq("is_active", true)
        .not("lat", "is", null)
        .not("lng", "is", null);
      if (error) throw new Error(error.message);
      const all = (data || []) as ConfectionerGeo[];
      return all.filter((c) => {
        if (!c.lat || !c.lng) return false;
        const distance = Math.sqrt(Math.pow(c.lat - lat, 2) + Math.pow(c.lng - lng, 2)) * 111;
        return distance <= radiusKm;
      });
    },
    enabled: lat !== undefined && lng !== undefined,
    staleTime: 60 * 1000,
  });
}

/** Все кондитеры с геоданными в городе */
export function useConfectionersByCity(city?: string) {
  return useQuery<ConfectionerGeo[]>({
    queryKey: ["confectioners-geo-city", city],
    queryFn: async () => {
      let query = supabaseBrowser.from("confectioner_geo").select("*").eq("is_active", true);
      if (city) query = query.eq("city", city);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as ConfectionerGeo[];
    },
    staleTime: 60 * 1000,
  });
}

/** Ателье кондитера */
export function useAteliers(confectionerGeoId?: string) {
  return useQuery<Atelier[]>({
    queryKey: ["ateliers", confectionerGeoId],
    queryFn: async () => {
      let query = supabaseBrowser.from("ateliers").select("*").eq("is_active", true);
      if (confectionerGeoId) query = query.eq("confectioner_geo_id", confectionerGeoId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as Atelier[];
    },
    enabled: true,
  });
}

/** Дегустации в ателье */
export function useTastings(atelierId?: string) {
  return useQuery<Tasting[]>({
    queryKey: ["tastings", atelierId],
    queryFn: async () => {
      let query = supabaseBrowser.from("tastings").select("*").in("status", ["scheduled", "full"]);
      if (atelierId) query = query.eq("atelier_id", atelierId);
      const { data, error } = await query.order("date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []) as Tasting[];
    },
  });
}

/** Обновить геоданные кондитера */
export function useUpdateConfectionerGeo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ConfectionerGeo> & { id: string }) => {
      const { data, error } = await supabaseBrowser.from("confectioner_geo").update(updates).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["confectioners-nearby"] });
      queryClient.invalidateQueries({ queryKey: ["confectioners-geo-city"] });
      toast.success("Геоданные обновлены");
    },
    onError: (error: Error) => toast.error("Ошибка", { description: error.message }),
  });
}

/** Забронировать дегустацию */
export function useBookTasting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tastingId, participantsCount = 1 }: { tastingId: string; participantsCount?: number }) => {
      const { data: { user } } = await supabaseBrowser.auth.getUser();
      if (!user) throw new Error("Не авторизован");
      const { data, error } = await supabaseBrowser.from("tasting_bookings").insert({
        tasting_id: tastingId, user_id: user.id, participants_count: participantsCount, status: "pending",
      }).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tastings"] });
      toast.success("Дегустация забронирована!");
    },
    onError: (error: Error) => toast.error("Ошибка", { description: error.message }),
  });
}
