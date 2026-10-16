import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "../supabase/admin";

/**
 * Nomes de pessoas para o Financeiro (quem aprovou, quem estornou, quem pode aprovar). O RLS de
 * profiles só mostra a própria linha a quem não tem acesso a Pessoas, então o nome sai pelo
 * servidor: só id e nome, só da organização de quem pede. Chamar depois de autorizar a sessão.
 */
async function organizacaoDe(sessao: SupabaseClient) {
  const { data } = await sessao.rpc("current_organization_id");
  return typeof data === "string" ? data : null;
}

export async function nomesDePerfis(sessao: SupabaseClient, ids: string[]) {
  const org = await organizacaoDe(sessao);
  if (!org || !ids.length) return new Map<string, string>();
  const { data } = await createSupabaseAdminClient().from("profiles").select("id, full_name").eq("organization_id", org).in("id", ids);
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? "—"]));
}

/** Pessoas ativas que podem ser aprovadoras (sem contas de terceiros, como o escritório contábil). */
export async function pessoasAprovadoras(sessao: SupabaseClient) {
  const org = await organizacaoDe(sessao);
  if (!org) return [];
  const { data } = await createSupabaseAdminClient().from("profiles").select("id, full_name, account_type")
    .eq("organization_id", org).eq("status", "active").order("full_name");
  return (data ?? []).filter((p) => p.account_type !== "terceiro").map((p) => ({ id: p.id as string, nome: (p.full_name as string | null) ?? "—" }));
}
