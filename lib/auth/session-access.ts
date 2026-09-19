import "server-only";

import type { createSupabaseServerClient } from "../supabase/server";
import { hasFeature, hasModuleAccess, normalizeGrants, type AccessGrants, type AccessLevel } from "../../modules/access-catalog";

type SessionClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type SessionAccess = {
  isOwner: boolean;
  grants: AccessGrants;
  can: (feature: string, level?: AccessLevel) => boolean;
  canModule: (moduleCode: string, level?: AccessLevel) => boolean;
};

/**
 * Acesso do usuário logado, lido com o cliente de SESSÃO: o RLS de
 * user_feature_grants só entrega as linhas do próprio usuário.
 */
export async function readSessionAccess(supabase: SessionClient, profileId?: string): Promise<SessionAccess> {
  // O proprietário lê as permissões de todos (para administrar): filtrar pelo
  // próprio perfil evita misturar as dele com as dos outros.
  const [ownerResult, profileResult] = await Promise.all([
    supabase.rpc("is_owner"),
    profileId ? Promise.resolve({ data: profileId, error: null }) : supabase.rpc("current_profile_id"),
  ]);
  if (ownerResult.error) throw new Error(ownerResult.error.message);
  if (profileResult.error || !profileResult.data) throw new Error(profileResult.error?.message ?? "NO_PROFILE");
  const grantsResult = await supabase
    .from("user_feature_grants")
    .select("feature_code, level")
    .eq("profile_id", profileResult.data as string);
  if (grantsResult.error) throw new Error(grantsResult.error.message);

  const isOwner = ownerResult.data === true;
  const grants = normalizeGrants(
    Object.fromEntries((grantsResult.data ?? []).map((row) => [row.feature_code, row.level])),
  );
  const access = { isOwner, grants };
  return {
    isOwner,
    grants,
    can: (feature, level = "ver") => hasFeature(access, feature, level),
    canModule: (moduleCode, level = "ver") => hasModuleAccess(access, moduleCode, level),
  };
}
