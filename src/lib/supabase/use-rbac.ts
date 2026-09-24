/**
 * use-rbac.ts — RBAC (Role-Based Access Control) hooks.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabaseBrowser } from "@/lib/supabase/browser";

export interface Permission {
  id: string;
  name: string;
  slug: string;
  module: string;
  description: string | null;
  is_system: boolean;
}

export interface RolePermission {
  id: string;
  role: string;
  permission_id: string;
  permission?: Permission;
}

export function usePermissions(module?: string) {
  return useQuery<Permission[]>({
    queryKey: ["permissions", module],
    queryFn: async () => {
      let query = supabaseBrowser.from("permissions").select("*");
      if (module) query = query.eq("module", module);
      const { data, error } = await query.order("module", { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []) as Permission[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useRolePermissions(role?: string) {
  return useQuery<RolePermission[]>({
    queryKey: ["role-permissions", role],
    queryFn: async () => {
      let query = supabaseBrowser
        .from("role_permissions")
        .select("*, permission:permissions(*)");
      if (role) query = query.eq("role", role);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []) as RolePermission[];
    },
    enabled: Boolean(role) || true,
  });
}

export function useAssignPermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ role, permissionId }: { role: string; permissionId: string }) => {
      const { data, error } = await supabaseBrowser
        .from("role_permissions")
        .insert({ role, permission_id: permissionId })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      toast.success("Разрешение назначено");
    },
    onError: (error: Error) => toast.error("Ошибка", { description: error.message }),
  });
}

export function useRevokePermission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ role, permissionId }: { role: string; permissionId: string }) => {
      const { error } = await supabaseBrowser
        .from("role_permissions")
        .delete()
        .eq("role", role)
        .eq("permission_id", permissionId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      toast.success("Разрешение отозвано");
    },
  });
}
