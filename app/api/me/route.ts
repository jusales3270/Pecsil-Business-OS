import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { getSupabaseConfigStatus } from "../../../lib/supabase/config";

export const dynamic = "force-dynamic";

/**
 * Identidade do usuário autenticado.
 *
 * Monta o mesmo formato que o frontend já consome (`ModuleAccessContext`),
 * porém a partir do banco: papel, permissões (`modulo.acao`) e escopo reais.
 * Usa o cliente de SESSÃO — o RLS decide o que pode ser lido; este código não
 * usa a service role e não confia em nada vindo do navegador.
 */
export async function GET() {
  if (!getSupabaseConfigStatus().publicConnectionReady) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) {
    // Regra: se o servidor de autenticação RESPONDEU, a sessão não vale —
    // ausente, expirada ou assinada com outro segredo (o caso de um Supabase
    // reconstruído). Todos são "faça login de novo" → 401.
    //
    // Só falha de REDE é transitória → 503, para um pisco do servidor não
    // expulsar quem está de fato logado. Antes isto olhava status 400/401 e,
    // com um token inválido devolvendo outro status, a aplicação caía no modo
    // demonstrativo em vez de mandar para o login — com o usuário achando que
    // estava logado enquanto nada salvava.
    const falhaDeRede =
      authError.name === "AuthRetryableFetchError" || !authError.status;
    return falhaDeRede
      ? NextResponse.json({ error: "AUTH_UNAVAILABLE" }, { status: 503 })
      : NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!auth.user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // `avatar_path` só existe depois da migration 202608260001. Enquanto ela não
  // for aplicada, o perfil é lido sem essa coluna — o código não pode depender
  // de uma migration pendente, senão a aplicação inteira cai.
  const BASE_COLUMNS = "id, full_name, email, status, organization_id";
  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`${BASE_COLUMNS}, avatar_path`)
    .eq("user_id", auth.user.id)
    .maybeSingle<ProfileRow>();

  if (profileError?.code === "42703") {
    ({ data: profile, error: profileError } = await supabase
      .from("profiles")
      .select(BASE_COLUMNS)
      .eq("user_id", auth.user.id)
      .maybeSingle<ProfileRow>());
  }

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  // Sem perfil ativo o usuário não pertence a nenhuma organização (ou foi
  // bloqueado): trata como não autenticado para a aplicação.
  if (!profile || profile.status !== "active") {
    return NextResponse.json({ error: "NO_ACTIVE_PROFILE" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: grants, error: grantsError } = await admin
    .from("user_roles")
    .select(
      "valid_until, role:roles(code, name, role_permissions(module_code, action, granted)), scope:access_scopes(scope_type, entity_id, module_code, label)",
    )
    .eq("profile_id", profile.id);

  if (grantsError) {
    return NextResponse.json({ error: grantsError.message }, { status: 500 });
  }

  const active = (grants ?? []).filter(
    (grant) => !grant.valid_until || new Date(grant.valid_until) > new Date(),
  );

  const permissions = new Set<string>();
  const scopes: { type: string; referenceId?: string; moduleCode?: string }[] = [];
  const roleNames: string[] = [];
  const roleCodes: string[] = [];

  for (const grant of active) {
    const role = grant.role as
      | { code?: string; name?: string; role_permissions?: { module_code: string; action: string; granted: boolean }[] }
      | null;
    if (role?.code) roleCodes.push(role.code);
    const scope = grant.scope as
      | { scope_type?: string; entity_id?: string | null; module_code?: string | null; label?: string }
      | null;

    if (role?.name) roleNames.push(role.name);
    for (const permission of role?.role_permissions ?? []) {
      if (permission.granted) permissions.add(`${permission.module_code}.${permission.action}`);
    }
    if (scope?.scope_type) {
      scopes.push({
        type: scope.scope_type,
        ...(scope.entity_id ? { referenceId: scope.entity_id } : {}),
        ...(scope.module_code ? { moduleCode: scope.module_code } : {}),
      });
    }
  }

  const scopeLabels = active
    .map((grant) => (grant.scope as { label?: string } | null)?.label)
    .filter((label): label is string => Boolean(label));

  return NextResponse.json({
    userId: auth.user.id,
    profileId: profile.id,
    organizationId: profile.organization_id,
    email: profile.email,
    name: profile.full_name,
    // Bucket público: a URL é direta e estável, sem precisar reassinar.
    avatarUrl: profile.avatar_path
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${profile.avatar_path}`
      : null,
    avatarPath: profile.avatar_path ?? null,
    initials: initialsOf(profile.full_name),
    // Um usuário pode ter mais de um vínculo; o primeiro papel é o principal.
    // O nome vem em português ("Proprietário", "Colaborador", ...) porque a
    // interface compara o papel por nome em alguns pontos.
    role: roleNames[0] ?? "Sem papel",
    roles: roleNames,
    roleCode: roleCodes[0] ?? null,
    scopeLabel: scopeLabels[0] ?? "Sem escopo",
    // O Proprietário recebe curinga: seu papel é ter tudo, inclusive módulos
    // que ainda nem existem. Os demais recebem a lista explícita do banco.
    permissions: roleCodes.includes("owner") ? ["*"] : [...permissions],
    scopes,
  });
}

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  status: string;
  organization_id: string;
  avatar_path?: string | null;
};

function initialsOf(fullName: string) {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
