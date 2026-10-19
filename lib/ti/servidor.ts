import "server-only";

import { NextResponse } from "next/server";
import { getServerSupabaseUrl } from "../supabase/config";
import { copiarParaPlataforma, lerPainel, paraCopiar } from "./vigia.mjs";

/**
 * Lado do servidor do módulo de TI: lê o painel do vigia na nuvem (com uma memória de 20 s,
 * para várias telas abertas não multiplicarem a leitura) e copia as quedas para ti_incidentes
 * (no máximo uma vez por minuto; a tarefa do sinal de vida também copia a cada minuto).
 */
type Lido = Awaited<ReturnType<typeof lerPainel>>;
let memoria: { em: number; dias: number; lido: Lido } | null = null;
let ultimaCopia = 0;

export async function painelDoVigia(dias = 400): Promise<Lido> {
  const agora = Date.now();
  if (memoria && agora - memoria.em < 20_000 && memoria.dias >= dias) return memoria.lido;
  const { VIGIA_URL, VIGIA_CHAVE, VIGIA_TOKEN, VIGIA_ALVO } = process.env;
  const lido = await lerPainel({ url: VIGIA_URL, chave: VIGIA_CHAVE, token: VIGIA_TOKEN, alvo: VIGIA_ALVO || undefined, dias });
  if (lido.ok) memoria = { em: agora, dias, lido };
  return lido;
}

/** Traz as quedas do vigia para a plataforma. Nunca lança: a tela segue com o que já foi copiado. */
export async function copiarQuedas(org: string | null): Promise<void> {
  if (!org || Date.now() - ultimaCopia < 60_000) return;
  ultimaCopia = Date.now();
  try {
    const lido = await painelDoVigia();
    if (!lido.ok) return;
    await copiarParaPlataforma({
      supabaseUrl: getServerSupabaseUrl(), chaveServico: process.env.SUPABASE_SERVICE_ROLE_KEY, org, incidentes: paraCopiar(lido.painel),
    });
  } catch (error) {
    console.error("TI: falha ao copiar as quedas do vigia", error instanceof Error ? error.message : error);
  }
}

/** Erro do banco → resposta: mensagens das funções do módulo (P0001) e de permissão vão para a tela. */
export function erroDoBanco(error: { code?: string; message: string }, padrao: string) {
  const claro = error.code === "P0001" || error.code === "42501";
  return NextResponse.json({ error: claro ? error.message : padrao }, { status: error.code === "42501" ? 403 : 400 });
}
