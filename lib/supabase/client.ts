"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicSupabaseConfig, SUPABASE_AUTH_COOKIE } from "./config";

/**
 * Cliente do navegador, compartilhado por toda a plataforma (inclusive os
 * módulos Compras e Portaria), para que todas as consultas carreguem a sessão
 * do usuário logado e passem pelo RLS com a identidade real.
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = requirePublicSupabaseConfig();
  return createBrowserClient(url, publishableKey, {
    cookieOptions: { name: SUPABASE_AUTH_COOKIE },
  });
}
