import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

const ROLE_CODES = ["director", "manager", "operator", "employee", "admin"] as const;
const SCOPE_TYPES = ["company", "unit", "department", "self"] as const;

type ScopeInput = {
  type: (typeof SCOPE_TYPES)[number];
  entityId?: string | null;
  label?: string;
};

/**
 * Autoriza o chamador: precisa estar autenticado E ter permissão de
 * administração de acessos (core.access / admin) — na prática, o Proprietário
 * e o Administrador. Retorna { orgId, profileId } ou uma resposta de erro.
 */
async function authorize() {
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
  return { orgId: orgId as string, profileId: profileId as string };
}

export async function GET() {
  const auth = await authorize();
  if (auth.error) return auth.error;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(
      "id, full_name, email, status, created_at, user_roles!profile_id(role:roles(code,name), scope:access_scopes(label,scope_type))",
    )
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = (data ?? []).map((p) => {
    const link = Array.isArray(p.user_roles) ? p.user_roles[0] : undefined;
    const role = link?.role as { code?: string; name?: string } | undefined;
    const scope = link?.scope as { label?: string; scope_type?: string } | undefined;
    return {
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      status: p.status,
      roleName: role?.name ?? "—",
      roleCode: role?.code ?? null,
      scopeLabel: scope?.label ?? "—",
    };
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { orgId, profileId } = auth;

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
  if (!roleCode || !ROLE_CODES.includes(roleCode as (typeof ROLE_CODES)[number])) {
    return NextResponse.json({ error: "Papel inválido." }, { status: 400 });
  }
  if (!scope || !SCOPE_TYPES.includes(scope.type)) {
    return NextResponse.json({ error: "Escopo inválido." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // 1) Papel
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("code", roleCode)
    .single();
  if (roleError || !role) {
    return NextResponse.json({ error: "Papel não encontrado na organização." }, { status: 400 });
  }

  // 2) Escopo (resolve ou cria)
  const scopeId = await resolveScope(admin, orgId, scope);
  if (!scopeId) {
    return NextResponse.json({ error: "Não foi possível resolver o escopo." }, { status: 400 });
  }

  // 3) Usuário no Auth
  const { data: createdUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authError || !createdUser?.user) {
    const already = authError?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      { error: already ? "Já existe um usuário com esse e-mail." : authError?.message ?? "Falha ao criar o usuário." },
      { status: already ? 409 : 500 },
    );
  }
  const userId = createdUser.user.id;

  // 4) Perfil  — se falhar, desfaz o usuário do Auth
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .insert({
      user_id: userId,
      organization_id: orgId,
      email,
      full_name: fullName,
      status: "active",
    })
    .select("id")
    .single();
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: profileError?.message ?? "Falha ao criar o perfil." }, { status: 500 });
  }

  // 5) Vínculo papel + escopo — se falhar, desfaz perfil e usuário
  const { error: linkError } = await admin.from("user_roles").insert({
    profile_id: profile.id,
    role_id: role.id,
    scope_id: scopeId,
    granted_by: profileId,
  });
  if (linkError) {
    await admin.from("profiles").delete().eq("id", profile.id);
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  return NextResponse.json({ id: profile.id, email, fullName }, { status: 201 });
}

async function resolveScope(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  scope: ScopeInput,
): Promise<string | null> {
  const entityId =
    scope.type === "company" ? orgId : scope.type === "self" ? null : scope.entityId ?? null;

  let query = admin
    .from("access_scopes")
    .select("id")
    .eq("organization_id", orgId)
    .eq("scope_type", scope.type)
    .limit(1);
  query = entityId ? query.eq("entity_id", entityId) : query.is("entity_id", null);
  const { data: existing } = await query.maybeSingle();
  if (existing?.id) return existing.id;

  const label =
    scope.label?.trim() ||
    (scope.type === "company"
      ? "Toda a empresa"
      : scope.type === "self"
        ? "Próprio registro"
        : "Escopo");
  const { data: created } = await admin
    .from("access_scopes")
    .insert({ organization_id: orgId, scope_type: scope.type, entity_id: entityId, label })
    .select("id")
    .single();
  return created?.id ?? null;
}
