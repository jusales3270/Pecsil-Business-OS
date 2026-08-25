import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import {
  ROLE_CODES,
  SCOPE_TYPES,
  authorize,
  resolveScope,
  writeAudit,
  type RoleCode,
  type ScopeInput,
} from "../../../../../lib/auth/admin-users";

export const dynamic = "force-dynamic";

const STATUSES = ["active", "blocked", "disabled"] as const;
type Status = (typeof STATUSES)[number];

/** Banimento longo no Auth. Bloquear só o perfil não encerra a sessão em curso. */
const BAN_FOREVER = "876000h";

type PatchBody = {
  fullName?: string;
  roleCode?: string;
  scope?: ScopeInput;
  status?: string;
  password?: string;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { orgId, profileId: actorProfileId, userId: actorUserId } = auth;
  const { id: targetId } = await context.params;

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // --- Alvo: precisa existir NESTA organização ------------------------------
  // 404 (e não 403) de propósito: não confirmar a existência de perfis de
  // outras organizações.
  const { data: target } = await admin
    .from("profiles")
    .select("id, user_id, email, full_name, status, organization_id")
    .eq("id", targetId)
    .maybeSingle();
  if (!target || target.organization_id !== orgId) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }

  const changesAccess =
    body.roleCode !== undefined || body.scope !== undefined || body.status !== undefined;

  // --- Proteção 1: o Proprietário não é administrável por esta rota ---------
  const { data: targetGrants } = await admin
    .from("user_roles")
    .select("valid_until, role:roles(code)")
    .eq("profile_id", targetId);
  const targetActive = (targetGrants ?? []).filter(
    (grant) => !grant.valid_until || new Date(grant.valid_until) > new Date(),
  );
  const targetIsOwner = targetActive.some(
    (grant) => (grant.role as { code?: string } | null)?.code === "owner",
  );
  if (targetIsOwner) {
    return NextResponse.json(
      { error: "O Proprietário não pode ser alterado por esta rota." },
      { status: 403 },
    );
  }

  // --- Proteção 2: ninguém altera o próprio papel, escopo ou situação -------
  if (targetId === actorProfileId && changesAccess) {
    return NextResponse.json(
      { error: "Você não pode alterar o próprio papel ou situação." },
      { status: 409 },
    );
  }

  // --- Proteção 3: não deixar a organização sem administrador ---------------
  if (changesAccess) {
    const losesAdmin =
      (body.status !== undefined && body.status !== "active") ||
      (body.roleCode !== undefined && body.roleCode !== "admin");
    const targetIsAdmin = targetActive.some(
      (grant) => (grant.role as { code?: string } | null)?.code === "admin",
    );
    if (losesAdmin && targetIsAdmin && (await countAdmins(admin, orgId)) <= 1) {
      return NextResponse.json(
        { error: "Este é o último Administrador ativo; promova outro antes de alterá-lo." },
        { status: 409 },
      );
    }
  }

  const applied: string[] = [];

  // --- Nome ----------------------------------------------------------------
  if (body.fullName !== undefined) {
    const fullName = body.fullName.trim();
    if (!fullName) return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
    const { error } = await admin.from("profiles").update({ full_name: fullName }).eq("id", targetId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.auth.admin.updateUserById(target.user_id, {
      user_metadata: { full_name: fullName },
    });
    applied.push("fullName");
  }

  // --- Situação ------------------------------------------------------------
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) {
      return NextResponse.json({ error: "Situação inválida." }, { status: 400 });
    }
    const status = body.status as Status;
    const { error } = await admin.from("profiles").update({ status }).eq("id", targetId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Duas camadas: o perfil não-ativo faz current_profile_id() retornar nulo
    // (o RLS deixa de liberar qualquer linha), e o banimento no Auth encerra o
    // acesso mesmo com uma sessão já emitida.
    await admin.auth.admin.updateUserById(target.user_id, {
      ban_duration: status === "active" ? "none" : BAN_FOREVER,
    });
    await writeAudit(admin, {
      orgId,
      actorProfileId,
      actorUserId,
      eventType: "core.access.user.status_change",
      entityType: "profile",
      entityId: targetId,
      metadata: { email: target.email, before: target.status, after: status },
    });
    applied.push("status");
  }

  // --- Papel e escopo: expira o vínculo atual e concede o novo -------------
  if (body.roleCode !== undefined || body.scope !== undefined) {
    const roleCode = body.roleCode;
    if (!roleCode || !ROLE_CODES.includes(roleCode as RoleCode)) {
      return NextResponse.json({ error: "Papel inválido." }, { status: 400 });
    }
    const scope = body.scope;
    if (!scope || !SCOPE_TYPES.includes(scope.type)) {
      return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
    }

    const { data: role } = await admin
      .from("roles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("code", roleCode)
      .maybeSingle();
    if (!role) {
      return NextResponse.json({ error: "Papel não encontrado na organização." }, { status: 400 });
    }

    const resolved = await resolveScope(admin, orgId, scope);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }

    // Preserva o histórico: expira em vez de apagar.
    await admin
      .from("user_roles")
      .update({ valid_until: new Date().toISOString() })
      .eq("profile_id", targetId)
      .is("valid_until", null);

    // upsert ressuscita um vínculo idêntico já expirado, em vez de violar a
    // unicidade (profile_id, role_id, scope_id).
    const { error: grantError } = await admin.from("user_roles").upsert(
      {
        profile_id: targetId,
        role_id: role.id,
        scope_id: resolved.scopeId,
        valid_from: new Date().toISOString(),
        valid_until: null,
        granted_by: actorProfileId,
      },
      { onConflict: "profile_id,role_id,scope_id" },
    );
    if (grantError) return NextResponse.json({ error: grantError.message }, { status: 500 });

    await writeAudit(admin, {
      orgId,
      actorProfileId,
      actorUserId,
      eventType: "core.access.user.role_change",
      entityType: "user_role",
      entityId: targetId,
      metadata: { email: target.email, roleCode, scopeType: scope.type },
    });
    applied.push("role");
  }

  // --- Senha definida pelo administrador -----------------------------------
  if (body.password !== undefined) {
    if (body.password.length < 8) {
      return NextResponse.json(
        { error: "A senha deve ter ao menos 8 caracteres." },
        { status: 400 },
      );
    }
    const { error } = await admin.auth.admin.updateUserById(target.user_id, {
      password: body.password,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit(admin, {
      orgId,
      actorProfileId,
      actorUserId,
      eventType: "core.access.user.password_reset",
      entityType: "profile",
      entityId: targetId,
      // Nunca registrar a senha, nem o tamanho.
      metadata: { email: target.email },
    });
    applied.push("password");
  }

  if (applied.length === 0) {
    return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });
  }
  return NextResponse.json({ id: targetId, applied });
}

/**
 * Desativação (soft delete).
 *
 * Nunca apaga o perfil: `profiles.id` é referenciado por `audit_logs`,
 * `employees`, `documents` e pelos campos `*_by_profile_id`, quase todos com
 * `on delete set null` — apagar reescreveria silenciosamente a trilha de
 * auditoria. Desativar preserva a história e encerra o acesso do mesmo jeito.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { id: targetId } = await context.params;

  return PATCH(
    new Request(request.url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    }),
    { params: Promise.resolve({ id: targetId }) },
  );
}

/** Quantos perfis ativos ainda têm concessão vigente de core.access/admin. */
async function countAdmins(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
): Promise<number> {
  const { data } = await admin
    .from("user_roles")
    .select("profile_id, valid_until, role:roles!inner(code), profile:profiles!inner(status, organization_id)")
    .eq("profile.organization_id", orgId)
    .eq("profile.status", "active")
    .in("role.code", ["owner", "admin"]);

  const holders = new Set(
    (data ?? [])
      .filter((grant) => !grant.valid_until || new Date(grant.valid_until) > new Date())
      .map((grant) => grant.profile_id as string),
  );
  return holders.size;
}
