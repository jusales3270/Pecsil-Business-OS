import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Autosserviço do próprio perfil: nome e foto.
 *
 * Usa o cliente de SESSÃO — quem autoriza é o RLS (`profiles_update_self`), e o
 * gatilho `profiles_protect_self` garante que e-mail, organização e situação
 * não mudem por aqui, mesmo que alguém forje a requisição. E-mail/login é
 * deliberadamente imutável neste fluxo.
 */
export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: { fullName?: string; avatarPath?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.fullName !== undefined) {
    const fullName = body.fullName.trim();
    if (fullName.length < 2) {
      return NextResponse.json({ error: "Informe um nome com ao menos 2 caracteres." }, { status: 400 });
    }
    if (fullName.length > 120) {
      return NextResponse.json({ error: "Nome muito longo." }, { status: 400 });
    }
    patch.full_name = fullName;
  }

  if (body.avatarPath !== undefined) {
    // Só aceita caminho dentro da própria pasta — o RLS do Storage já garante
    // isso na gravação do arquivo; aqui evita apontar para a pasta de outro.
    if (body.avatarPath !== null) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!profile || !body.avatarPath.startsWith(`${profile.id}/`)) {
        return NextResponse.json({ error: "Caminho de imagem inválido." }, { status: 400 });
      }
    }
    patch.avatar_path = body.avatarPath;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada a alterar." }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(patch).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mantém o nome também nos metadados do Auth, para ficarem coerentes.
  if (patch.full_name) {
    await supabase.auth.updateUser({ data: { full_name: patch.full_name } });
  }

  return NextResponse.json({ ok: true });
}
