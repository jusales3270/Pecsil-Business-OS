import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ferramenta } from "./ferramentas";
import { verificarEscopo, type Veredito } from "./escopo";
import { conversarCom, type Anexo, type Imagem, type MensagemHistorico, type Pesquisa, type RespostaSara, type Sistema } from "./laco";

/** A chave do Claude (ANTHROPIC_API_KEY) fica só no servidor (.env.local e Coolify). */
export function chaveConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function conversar(sb: SupabaseClient, a: { modelo: string; sistema: Sistema; historico: MensagemHistorico[]; pergunta: string; ferramentas: Ferramenta[]; todasAsConsultas?: string[]; sinal?: AbortSignal; pesquisa?: Pesquisa | null; maxTokens?: number; imagem?: Imagem | null; anexo?: Anexo | null; rodadas?: number }): Promise<RespostaSara> {
  return conversarCom(sb, { ...a, chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "" });
}

/** Verificador de escopo (chamada separada, só classifica DENTRO/FORA). */
export function verificar(a: { empresa: string; pergunta: string; contexto?: string | null; tema?: string | null }): Promise<Veredito> {
  return verificarEscopo({ ...a, chave: process.env.ANTHROPIC_API_KEY?.trim() ?? "" });
}
