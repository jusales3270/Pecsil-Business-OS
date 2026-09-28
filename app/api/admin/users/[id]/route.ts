import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { authorize, replaceGrants, writeAudit } from "../../../../../lib/auth/admin-users";
import { endOfDayBrasilia, isAccessExpired, isJobTitle, normalizeGrants } from "../../../../../modules/access-catalog";

export const dynamic = "force-dynamic";

const STATUSES = ["active", "blocked", "disabled"] as const;
type Status = (typeof STATUSES)[number];

/** Banimento longo no Auth. Bloquear só o perfil não encerra a sessão em curso. */
const BAN_FOREVER = "876000h";

type PatchBody = {
  grants?: unknown;
  /** Só para terceiros: empresa prestadora e validade (AAAA-MM-DD ou null). */
  companyName?: string;
  accessExpiresAt?: string | null;
  /** Só para o administrativo: diretor, gerente, assistente ou estagiário. */
  jobTitle?: string;
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
    .select("id, user_id, email, full_name, status, organization_id, is_owner, account_type, company_name, job_title, access_expires_at")
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

  // --- Dados do terceiro: empresa e validade ------------------------------------
  if (body.companyName !== undefined || body.accessExpiresAt !== undefined) {
    if (target.account_type !== "terceiro") {
      return NextResponse.json({ error: "Empresa e validade são só de terceiros." }, { status: 400 });
    }
    const changes: { company_name?: string; access_expires_at?: string | null } = {};
    if (body.companyName !== undefined) {
      const companyName = body.companyName.trim();
      if (!companyName) return NextResponse.json({ error: "Informe a empresa prestadora." }, { status: 400 });
      changes.company_name = companyName;
    }
    if (body.accessExpiresAt !== undefined) {
      if (body.accessExpiresAt === null || body.accessExpiresAt === "") {
        changes.access_expires_at = null;
      } else {
        const expiresAt = endOfDayBrasilia(body.accessExpiresAt);
        if (!expiresAt) return NextResponse.json({ error: "Data de validade inválida." }, { status: 400 });
        if (isAccessExpired(expiresAt)) {
          return NextResponse.json({ error: "A validade precisa ser uma data futura." }, { status: 400 });
        }
        changes.access_expires_at = expiresAt;
      }
    }
    const { error } = await admin.from("profiles").update(changes).eq("id", targetId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit(admin, {
      orgId,
      actorProfileId,
      actorUserId,
      eventType: "core.access.user.validity_change",
      entityType: "profile",
      entityId: targetId,
      metadata: {
        email: target.email,
        before: { companyName: target.company_name, accessExpiresAt: target.access_expires_at },
        after: changes,
      },
    });
    applied.push("thirdParty");
  }

  // --- Cargo do administrativo ------------------------------------------------
  if (body.jobTitle !== undefined) {
    if (target.account_type !== "administrativo") {
      return NextResponse.json({ error: "Cargo é só do administrativo." }, { status: 400 });
    }
    if (!isJobTitle(body.jobTitle)) return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    const { error } = await admin.from("profiles").update({ job_title: body.jobTitle }).eq("id", targetId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writeAudit(admin, {
      orgId,
      actorProfileId,
      actorUserId,
      eventType: "core.access.user.job_title_change",
      entityType: "profile",
      entityId: targetId,
      metadata: { email: target.email, before: target.job_title, after: body.jobTitle },
    });
    applied.push("jobTitle");
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
 * Exclusão definitiva do usuário: apaga o login e o perfil. As permissões,
 * papéis e notificações vão junto; a ficha do RH fica sem acesso vinculado e
 * pode ganhar um novo. A trilha (audit_logs, module_events) não perde o autor:
 * guarda o id sem chave estrangeira, e este evento registra nome e e-mail.
 * Exige digitar o e-mail do usuário (confirmEmail), como as outras ações
 * destrutivas. Para só tirar o acesso, mantendo o cadastro, use "Desativado".
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { orgId, profileId: actorProfileId, userId: actorUserId } = auth;
  const { id: targetId } = await context.params;

  let body: { confirmEmail?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, user_id, email, full_name, organization_id, is_owner, account_type, company_name, job_title")
    .eq("id", targetId)
    .maybeSingle();
  if (!target || target.organization_id !== orgId) {
    return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  }
  if (target.is_owner) {
    return NextResponse.json({ error: "O proprietário não pode ser excluído." }, { status: 403 });
  }
  if (targetId === actorProfileId) {
    return NextResponse.json({ error: "Você não pode excluir o próprio usuário." }, { status: 409 });
  }
  if ((body.confirmEmail ?? "").trim().toLowerCase() !== String(target.email).toLowerCase()) {
    return NextResponse.json({ error: "Digite o e-mail do usuário para confirmar a exclusão." }, { status: 400 });
  }

  const { data: employee } = await admin.from("employees").select("id").eq("profile_id", targetId).maybeSingle();

  // Apagar o login apaga o perfil em cascata (profiles.user_id → auth.users).
  const { error } = await admin.auth.admin.deleteUser(target.user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit(admin, {
    orgId,
    actorProfileId,
    actorUserId,
    eventType: "core.access.user.delete",
    entityType: "profile",
    entityId: targetId,
    riskLevel: "sensitive",
    metadata: {
      email: target.email,
      fullName: target.full_name,
      userId: target.user_id,
      accountType: target.account_type,
      companyName: target.company_name,
      jobTitle: target.job_title,
      employeeId: employee?.id ?? null,
    },
  });

  return NextResponse.json({ id: targetId, deleted: true });
}
