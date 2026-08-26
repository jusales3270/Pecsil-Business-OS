import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../supabase/server";
import type { createSupabaseAdminClient } from "../supabase/admin";

export const ROLE_CODES = ["director", "manager", "operator", "employee", "admin"] as const;
export const SCOPE_TYPES = ["company", "module", "unit", "department", "team", "self"] as const;

export type RoleCode = (typeof ROLE_CODES)[number];
export type ScopeInput = {
  type: (typeof SCOPE_TYPES)[number];
  /** Unidade/departamento/equipe — para os escopos da estrutura. */
  entityId?: string | null;
  /** Código do módulo (rh, financeiro, compras...) — para o escopo de módulo. */
  moduleCode?: string | null;
  label?: string;
};

export type AdminAuth = { orgId: string; profileId: string; userId: string };
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Autoriza o chamador: precisa estar autenticado E ter permissão de
 * administração de acessos (core.access / admin) — na prática, o Proprietário
 * e o Administrador.
 *
 * Usa o cliente de SESSÃO de propósito: quem decide é o RLS/`has_permission`,
 * não este código. Só depois de passar por aqui é que a service role pode ser
 * usada pelas rotas.
 */
export async function authorize(): Promise<{ error: NextResponse } | AdminAuth> {
  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };

  const { data: allowed } = await session.rpc("has_permission", {
    requested_module: "core.access",
    requested_action: "admin",
  });
  if (!allowed) return { error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }) };

  const { data: orgId } = await session.rpc("current_organization_id");
  const { data: profileId } = await session.rpc("current_profile_id");
  if (!orgId || !profileId) {
    return { error: NextResponse.json({ error: "NO_PROFILE" }, { status: 403 }) };
  }
  return { orgId: orgId as string, profileId: profileId as string, userId: user.id };
}

/** Tabela da estrutura organizacional correspondente a cada tipo de escopo. */
const SCOPE_ENTITY_TABLE: Partial<Record<ScopeInput["type"], string>> = {
  unit: "units",
  department: "departments",
  team: "teams",
};

/**
 * Resolve (ou cria) o escopo de acesso.
 *
 * Valida que a entidade informada existe E pertence à organização: `entity_id`
 * é polimórfico e não tem chave estrangeira, então sem esta checagem seria
 * possível apontar um escopo para o departamento de outra empresa. Escopos de
 * unidade/departamento/equipe sem entidade são recusados — antes eles eram
 * gravados com `entity_id = null` e nunca casavam em nenhuma verificação.
 */
export async function resolveScope(
  admin: AdminClient,
  orgId: string,
  scope: ScopeInput,
): Promise<{ error: string } | { scopeId: string }> {
  const table = SCOPE_ENTITY_TABLE[scope.type];
  let entityId: string | null = null;
  let moduleCode: string | null = null;
  let derivedLabel: string | null = null;

  // Escopo de módulo: é o eixo principal de acesso da PecSil — a pessoa é
  // "Gestor do Financeiro", "Diretor do RH". Guarda module_code, não entity_id.
  if (scope.type === "module") {
    if (!scope.moduleCode) {
      return { error: "Escopo de módulo exige a seleção do módulo." };
    }
    const { data: mod } = await admin
      .from("modules")
      .select("code, name")
      .eq("code", scope.moduleCode)
      .maybeSingle();
    if (!mod) return { error: "Módulo não encontrado." };
    moduleCode = mod.code as string;
    derivedLabel = `Módulo ${mod.name as string}`;
  } else if (table) {
    if (!scope.entityId) {
      return { error: "Escopo de unidade, departamento ou equipe exige a seleção da entidade." };
    }
    const { data: entity } = await admin
      .from(table)
      .select("id, name")
      .eq("id", scope.entityId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!entity) return { error: "A entidade do escopo não pertence a esta organização." };
    entityId = entity.id as string;
    derivedLabel = entity.name as string;
  } else if (scope.type === "company") {
    entityId = orgId;
  }

  let query = admin
    .from("access_scopes")
    .select("id")
    .eq("organization_id", orgId)
    .eq("scope_type", scope.type)
    .limit(1);
  query = entityId ? query.eq("entity_id", entityId) : query.is("entity_id", null);
  query = moduleCode ? query.eq("module_code", moduleCode) : query.is("module_code", null);
  const { data: existing } = await query.maybeSingle();
  if (existing?.id) return { scopeId: existing.id as string };

  const label =
    derivedLabel ??
    scope.label?.trim() ??
    (scope.type === "company" ? "Toda a empresa" : "Próprio registro");

  const { data: created, error } = await admin
    .from("access_scopes")
    .insert({
      organization_id: orgId,
      scope_type: scope.type,
      entity_id: entityId,
      module_code: moduleCode,
      label,
    })
    .select("id")
    .single();
  if (error || !created) return { error: error?.message ?? "Não foi possível criar o escopo." };
  return { scopeId: created.id as string };
}

export type AuditEntry = {
  orgId: string;
  actorProfileId: string;
  actorUserId: string;
  eventType: string;
  entityType: "profile" | "user_role" | "access_scope";
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
