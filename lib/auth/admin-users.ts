import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../supabase/server";
import type { createSupabaseAdminClient } from "../supabase/admin";
import type { AccessGrants } from "../../modules/access-catalog";

export type AdminAuth = { orgId: string; profileId: string; userId: string };
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Autoriza o chamador: só o PROPRIETÁRIO administra usuários e acessos.
 *
 * Usa o cliente de SESSÃO de propósito: quem decide é o banco (`is_owner`),
 * não este código. Só depois de passar por aqui é que a service role pode ser
 * usada pelas rotas.
 */
export async function authorize(): Promise<{ error: NextResponse } | AdminAuth> {
  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };

  const { data: isOwner } = await session.rpc("is_owner");
  if (isOwner !== true) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };

  const { data: orgId } = await session.rpc("current_organization_id");
  const { data: profileId } = await session.rpc("current_profile_id");
  if (!orgId || !profileId) {
    return { error: NextResponse.json({ error: "NO_PROFILE" }, { status: 403 }) };
  }
  return { orgId: orgId as string, profileId: profileId as string, userId: user.id };
}

/** Permissões gravadas de um perfil, no formato funcionalidade → nível. */
export async function readGrants(admin: AdminClient, profileId: string): Promise<AccessGrants> {
  const { data } = await admin
    .from("user_feature_grants")
    .select("feature_code, level")
    .eq("profile_id", profileId);
  return Object.fromEntries((data ?? []).map((row) => [row.feature_code, row.level])) as AccessGrants;
}

/**
 * Substitui o conjunto de permissões do perfil pelo informado: remove o que
 * saiu, grava o que entrou ou mudou de nível. Devolve o antes, para auditoria.
 */
export async function replaceGrants(
  admin: AdminClient,
  target: { orgId: string; profileId: string; grantedBy: string },
  grants: AccessGrants,
): Promise<{ before: AccessGrants } | { error: string }> {
  const before = await readGrants(admin, target.profileId);
  const removed = Object.keys(before).filter((code) => !(code in grants));

  if (removed.length) {
    const { error } = await admin
      .from("user_feature_grants")
      .delete()
      .eq("profile_id", target.profileId)
      .in("feature_code", removed);
    if (error) return { error: error.message };
  }

  const rows = Object.entries(grants)
    .filter(([code, level]) => before[code] !== level)
    .map(([feature_code, level]) => ({
      organization_id: target.orgId,
      profile_id: target.profileId,
      feature_code,
      level,
      granted_by: target.grantedBy,
    }));
  if (rows.length) {
    const { error } = await admin.from("user_feature_grants").upsert(rows, { onConflict: "profile_id,feature_code" });
    if (error) return { error: error.message };
  }
  return { before };
}

export type AuditEntry = {
  orgId: string;
  actorProfileId: string;
  actorUserId: string;
  eventType: string;
  entityType: "profile" | "user_feature_grants";
  entityId: string;
  riskLevel?: "normal" | "monitored" | "sensitive";
  metadata?: Record<string, unknown>;
};

/**
 * Registra a operação de credencial em `audit_logs`.
 *
 * Escrita pela aplicação (e não por trigger) porque o ator só é conhecido aqui:
 * as operações de identidade rodam com a service role, e nela `auth.uid()` e
 * `current_profile_id()` são nulos — um trigger gravaria auditoria sem autor.
 *
 * Nunca lança: uma falha de auditoria não pode deixar uma mudança de credencial
 * pela metade. O erro é registrado no log do servidor.
 */
export async function writeAudit(admin: AdminClient, entry: AuditEntry): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    organization_id: entry.orgId,
    actor_user_id: entry.actorUserId,
    actor_profile_id: entry.actorProfileId,
    module_code: "core.access",
    event_type: entry.eventType,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    risk_level: entry.riskLevel ?? "sensitive",
    metadata: entry.metadata ?? {},
  });
  if (error) console.error("Falha ao registrar auditoria de credencial:", error.message);
}
