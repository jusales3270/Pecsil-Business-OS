import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Cliente administrativo (service role). IGNORA o RLS e pode usar a API de
 * administração do Auth (criar usuários). Use SOMENTE no servidor, e apenas
 * depois de autorizar o chamador (ex.: via has_permission na sessão real).
 * Nunca exponha a service role key no navegador.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Configuração administrativa do Supabase ausente.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
