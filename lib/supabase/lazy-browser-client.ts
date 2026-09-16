"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./client";

/**
 * Cliente do navegador criado só no primeiro uso.
 *
 * Os módulos Compras e Portaria importam `supabase` no topo do arquivo. Criar o
 * cliente na importação derrubava a plataforma inteira (erro 500) quando o
 * Supabase não está configurado — o modo demonstrativo precisa continuar
 * abrindo. No navegador o `createBrowserClient` é singleton, então cada acesso
 * devolve a mesma instância, com a sessão do usuário.
 */
export const lazySupabaseBrowserClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = createSupabaseBrowserClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
