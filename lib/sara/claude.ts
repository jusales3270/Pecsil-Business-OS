import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ferramenta } from "./ferramentas";
import { conversarCom, type MensagemHistorico, type RespostaSara, type Sistema } from "./laco";

/** A chave do Claude (ANTHROPIC_API_KEY) fica só no servidor (.env.local e Coolify). */
export function chaveConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function conversar(sb: SupabaseClient, a: { modelo: string; sistema: Sistema; historico: MensagemHistorico[]; pergunta: string; ferramentas: Ferramenta[] }): Promise<RespostaSara> {
  return conversarCom(sb, { ...a, chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "" });
}
