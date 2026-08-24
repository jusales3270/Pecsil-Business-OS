import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfigStatus, requirePublicSupabaseConfig } from "./lib/supabase/config";

/**
 * Renova a sessão do Supabase a cada request e propaga os cookies.
 *
 * O `@supabase/ssr` exige esta etapa: no modelo serverless (Vercel) cada
 * request é isolado e a sessão precisa ser revalidada/renovada aqui, senão o
 * servidor não enxerga o usuário logado e a aplicação "entra e cai" para o
 * login. O ambiente antigo (vinext/Sites) tinha um proxy que fazia isso; na
 * Vercel esse papel é do `proxy` (o antigo `middleware`, renomeado no Next 16).
 */
export async function proxy(request: NextRequest) {
  // Sem credenciais públicas configuradas não há o que renovar — segue direto.
  if (!getSupabaseConfigStatus().publicConnectionReady) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const { url, publishableKey } = requirePublicSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Revalida e renova a sessão (grava os cookies atualizados na resposta).
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Roda em tudo, menos assets estáticos.
  matcher: [
    "/((?!_next/static|_next/image|favicon.png|favicon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
