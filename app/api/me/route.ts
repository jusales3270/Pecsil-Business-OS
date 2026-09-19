import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getSupabaseConfigStatus } from "../../../lib/supabase/config";
import { derivePermissions, isAccessExpired } from "../../../modules/access-catalog";
import { readSessionAccess } from "../../../lib/auth/session-access";

export const dynamic = "force-dynamic";

/**
 * Identidade do usuário autenticado.
 *
 * Monta o `ModuleAccessContext` a partir do banco: se é o proprietário e quais
 * funcionalidades (com nível) foram liberadas a este usuário. Usa o cliente de
 * SESSÃO — o RLS decide o que pode ser lido; nada vem do navegador.
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
  const BASE_COLUMNS = "id, full_name, email, status, organization_id, access_expires_at";
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
  // Terceiro com validade vencida: a conta existe, mas o acesso acabou.
  if (isAccessExpired(profile.access_expires_at)) {
    return NextResponse.json({ error: "ACCESS_EXPIRED", expiresAt: profile.access_expires_at }, { status: 403 });
  }

  // Acesso do USUÁRIO: proprietário ou funcionalidades liberadas uma a uma.
  let access;
  try {
    access = await readSessionAccess(supabase, profile.id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ACCESS_UNAVAILABLE" }, { status: 500 });
  }
  const { isOwner, grants } = access;

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
    role: isOwner ? "Proprietário" : "Usuário",
    roles: [isOwner ? "Proprietário" : "Usuário"],
    roleCode: isOwner ? "owner" : null,
    scopeLabel: "Pecsil Molds for Glass",
    isOwner,
    grants,
    // O Proprietário recebe curinga: tem tudo, inclusive módulos futuros.
    permissions: isOwner ? ["*"] : derivePermissions(grants),
    // Sem recorte por setor: o acesso vale para a empresa toda.
    scopes: [{ type: "company", referenceId: profile.organization_id }],
  });
}

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  status: string;
  organization_id: string;
  access_expires_at?: string | null;
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
