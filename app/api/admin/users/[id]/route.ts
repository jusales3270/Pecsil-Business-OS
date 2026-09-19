import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { authorize, replaceGrants, writeAudit } from "../../../../../lib/auth/admin-users";
import { normalizeGrants } from "../../../../../modules/access-catalog";

export const dynamic = "force-dynamic";

const STATUSES = ["active", "blocked", "disabled"] as const;
type Status = (typeof STATUSES)[number];

/** Banimento longo no Auth. Bloquear só o perfil não encerra a sessão em curso. */
const BAN_FOREVER = "876000h";

type PatchBody = {
  grants?: unknown;
  status?: string;
  password?: string;
};

/**
 * Altera o acesso de um usuário: permissões por funcionalidade, situação
 * (ativo/bloqueado/desativado) ou senha. Só o proprietário; o proprietário em
 * si não é editável por aqui, e ninguém altera o próprio acesso.
 */
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

  // 404 (e não 403) de propósito: não confirmar perfis de outras organizações.
  const { data: target } = await admin
    .from("profiles")
    .select("id, user_id, email, full_name, status, organization_id, is_owner")
    .eq("id", targetId)
    .maybeSingle();
  if (!target || target.organization_id !== orgId) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }
  if (target.is_owner) {
    return NextResponse.json({ error: "O acesso do proprietário não é alterado por aqui." }, { status: 403 });
  }
  if (targetId === actorProfileId) {
    return NextResponse.json({ error: "Você não pode alterar o próprio acesso." }, { status: 409 });
  }

  const applied: string[] = [];

  // --- Permissões por funcionalidade -----------------------------------------
  if (body.grants !== undefined) {
    const grants = normalizeGrants(body.grants);
    const saved = await replaceGrants(admin, { orgId, profileId: targetId, grantedBy: actorProfileId }, grants);
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 500 });
    await writeAudit(admin, {
      orgId,
      actorProfileId,
      actorUserId,
      eventType: "core.access.user.grants_change",
      entityType: "user_feature_grants",
      entityId: targetId,
      metadata: { email: target.email, before: saved.before, after: grants },
    });
    applied.push("grants");
  }

  // --- Situação ----------------------------------------------------------------
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

  // --- Senha definida pelo proprietário ---------------------------------------
  if (body.password !== undefined) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 });
    }
    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: body.password });
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
 * `employees`, `documents` e pelos campos `*_by_profile_id` — apagar
 * reescreveria a trilha de auditoria. Desativar encerra o acesso do mesmo jeito.
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
