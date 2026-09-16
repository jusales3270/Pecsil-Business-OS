import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

/**
 * Encerra a sessão.
 *
 * Sair NUNCA pode falhar. A revogação no servidor é o caminho feliz, mas se o
 * token já é inválido (Supabase reconstruído, sessão expirada) ou o servidor
 * está fora do ar, `signOut()` lança — e antes isso virava erro 500, deixando
 * a pessoa presa dentro da aplicação sem conseguir sair.
 *
 * Agora a falha é engolida e os cookies de sessão são apagados de qualquer
 * forma: o resultado visível é sempre o mesmo, cair no login deslogado.
 */
export async function POST(request: NextRequest) {
  // Location relativo: atrás do proxy do Coolify o `request.url` enxerga o host
  // interno (localhost:3000), e um redirect absoluto mandaria o usuário para lá.
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Revogação no servidor indisponível; a limpeza local abaixo basta.
  }

  // Apaga qualquer cookie de sessão do Supabase que tenha sobrado, inclusive
  // os assinados com um segredo antigo — que o signOut() não consegue revogar.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
    }
  }

  return response;
}
