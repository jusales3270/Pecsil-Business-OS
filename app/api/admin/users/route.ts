import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import {
  ROLE_CODES,
  SCOPE_TYPES,
  authorize,
  resolveScope,
  ensureRolePermissionsForModule,
  writeAudit,
  type RoleCode,
  type ScopeInput,
} from "../../../../lib/auth/admin-users";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorize();
  if ("error" in auth) return auth.error;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(
      "id, user_id, full_name, email, status, created_at, user_roles!profile_id(valid_until, role:roles(code,name), scope:access_scopes(label,scope_type,module_code,entity_id))",
    )
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data ?? []).map((profile) => {
    const grants = Array.isArray(profile.user_roles) ? profile.user_roles : [];
    // Só o vínculo vigente descreve o acesso atual; os expirados são histórico.
    const active =
      grants.find((grant) => !grant.valid_until || new Date(grant.valid_until) > new Date()) ??
      grants[0];
    const role = active?.role as { code?: string; name?: string } | undefined;
    const scope = active?.scope as
      | { label?: string; scope_type?: string; module_code?: string | null; entity_id?: string | null }
      | undefined;
    return {
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      status: profile.status,
      roleName: role?.name ?? "—",
      roleCode: role?.code ?? null,
      scopeLabel: scope?.label ?? "—",
      scopeType: scope?.scope_type ?? null,
      moduleCode: scope?.module_code ?? null,
      entityId: scope?.entity_id ?? null,
    };
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { orgId, profileId, userId: actorUserId } = auth;

  let body: {
    fullName?: string;
    email?: string;
    password?: string;
    roleCode?: string;
    scope?: ScopeInput;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const fullName = body.fullName?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const roleCode = body.roleCode;
  const scope = body.scope;

  if (!fullName || !email || !password) {
    return NextResponse.json({ error: "Nome, e-mail e senha são obrigatórios." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "A senha deve ter ao menos 8 caracteres." }, { status: 400 });
  }
  if (!roleCode || !ROLE_CODES.includes(roleCode as RoleCode)) {
    return NextResponse.json({ error: "Papel inválido." }, { status: 400 });
  }
  if (!scope || !SCOPE_TYPES.includes(scope.type)) {
    return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("code", roleCode)
    .single();
  if (roleError || !role) {
    return NextResponse.json({ error: "Papel não encontrado na organização." }, { status: 400 });
  }

  const resolved = await resolveScope(admin, orgId, scope);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authError || !createdUser?.user) {
    const already = authError?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      {
        error: already
          ? "Já existe um usuário com esse e-mail."
          : authError?.message ?? "Falha ao criar o usuário.",
      },
      { status: already ? 409 : 500 },
    );
  }
  const newUserId = createdUser.user.id;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({
      user_id: newUserId,
      organization_id: orgId,
      email,
      full_name: fullName,
      status: "active",
    })
    .select("id")
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json(
      { error: profileError?.message ?? "Falha ao criar o perfil." },
      { status: 500 },
    );
  }

  const { error: linkError } = await admin.from("user_roles").insert({
    profile_id: profile.id,
    role_id: role.id,
    scope_id: resolved.scopeId,
    granted_by: profileId,
  });
  if (linkError) {
    await admin.from("profiles").delete().eq("id", profile.id);
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  if (scope.type === "module" && scope.moduleCode) {
    await ensureRolePermissionsForModule(admin, role.id, roleCode, scope.moduleCode);
  }

  await writeAudit(admin, {
    orgId,
    actorProfileId: profileId,
    actorUserId,
    eventType: "core.access.user.create",
    entityType: "profile",
    entityId: profile.id,
    riskLevel: "monitored",
    metadata: { email, fullName, roleCode, scopeType: scope.type },
  });

  return NextResponse.json({ id: profile.id, email, fullName }, { status: 201 });
}
