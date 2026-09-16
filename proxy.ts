import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfigStatus, requireServerSupabaseConfig, SUPABASE_AUTH_COOKIE } from "./lib/supabase/config";

/**
 * Renova a sessão do Supabase a cada request e propaga os cookies.
 *
 * O `@supabase/ssr` exige esta etapa: no modelo serverless (Next.js/Vercel) cada
 * request é isolado e a sessão precisa ser revalidada/renovada no proxy/middleware,
 * senão o servidor não enxerga o usuário logado e a aplicação "entra e cai" para o login.
 */
export async function proxy(request: NextRequest) {
  // Sem credenciais públicas configuradas não há o que renovar — segue direto.
  if (!getSupabaseConfigStatus().publicConnectionReady) {
    return NextResponse.next({ request });
  }

  // Se não houver cookies de autenticação do Supabase na requisição,
  // não há sessão para renovar. Evita chamadas de rede lentas em rotas públicas.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  if (!hasAuthCookie) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const { url, publishableKey } = requireServerSupabaseConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Revalida a sessão com timeout seguro (máx. 3s) para não travar a aplicação
  // caso o servidor Supabase esteja temporariamente lento ou inacessível.
  try {
    const authTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("auth_timeout")), 3000),
    );
    await Promise.race([supabase.auth.getUser(), authTimeout]);
  } catch {
    return NextResponse.next({ request });
  }

  return supabaseResponse;
}

export const config = {
  // Roda em tudo, menos assets estáticos, mídias pesadas e o gateway `/sb` —
  // este só repassa ao Supabase, que valida o token por conta própria.
  matcher: [
    "/((?!_next/static|_next/image|sb/|favicon.ico|favicon.png|favicon.svg|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|mp4|webm|ogg|woff|woff2|ttf|eot)$).*)",
  ],
};
