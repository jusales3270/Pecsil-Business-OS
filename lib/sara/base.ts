import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Base comum da equipe de SARAs (uma por módulo): os tipos das consultas, das telas, dos avisos e da
 * definição de cada agente, e as funções auxiliares. Cada agente vive em lib/sara/agentes/<modulo>.ts
 * e só importa daqui (sem import circular com ferramentas.ts, modulos.ts e alertas.ts).
 */

export type Fonte = { rotulo: string; link: string };
/** Registro exato a abrir dentro da tela (hoje: título do Financeiro, na aba onde ele está). */
export type Registro = { tipo: "titulo"; id: string; direcao: "payable" | "receivable"; aba: "aberto" | "previsoes" | "quitados"; mes: string | null };
export type Abrir = { modulo: string; secao: string | null; rotulo: string; registro?: Registro };
export type Resultado = { dados: unknown; fontes: Fonte[]; abrir?: Abrir };
export type Ferramenta = {
  nome: string;
  /** Como a consulta aparece para quem usa ("Consultou: cotações pendentes"). */
  rotulo?: string;
  descricao: string;
  /** Basta uma destas funcionalidades (nível "ver"). */
  exige: string[];
  esquema: Record<string, unknown>;
  rodar: (sb: SupabaseClient, entrada: Record<string, unknown>) => Promise<Resultado>;
  /**
   * Ferramenta que GRAVA (E1, 22/10/2026). A SARA não executa: `preparar` confere a entrada e monta o
   * resumo do cartão "Permitir / Não permitir"; `rodar` só roda depois que a pessoa permitiu, com a sessão
   * dela (a função do banco confere a permissão de novo). `exige` passa a valer no nível indicado.
   */
  acao?: Acao;
  /**
   * Pode rodar junto com as outras chamadas da mesma rodada (E7: a SARA central pergunta a várias SARAs
   * de módulo ao mesmo tempo). As demais seguem uma de cada vez, na ordem.
   */
  paralela?: boolean;
};

export type Proposta = { resumo: string; detalhes: string[]; risco?: "normal" | "alto" };
export type Acao = {
  nivel: "operar" | "aprovar";
  /** Módulos cuja SARA oferece a ação ("todos" = qualquer SARA, ex.: abrir chamado de TI). */
  modulos: string[] | "todos";
  preparar: (sb: SupabaseClient, entrada: Record<string, unknown>) => Promise<Proposta | { erro: string }>;
};

/** Tela que a SARA pode abrir para a pessoa (só se ela tiver a funcionalidade). */
export type Tela = { id: string; modulo: string; secao?: string; rotulo: string; exige: string[]; serve: string };
export type SaraModulo = {
  modulo: string;
  /** Nome interno do agente ("SARA do Financeiro"); para quem usa é só "SARA". */
  nome: string;
  /** Nome do módulo para as mensagens ("Financeiro"). */
  rotulo: string;
  feature: string;
  /** Funcionalidade que libera a SARA para a pessoa (Pessoas e Acessos, na lista do módulo). */
  permissao: string;
  manual: string;
  ferramentas: string[];
  telas: Tela[];
  sugestoes: string[];
  /**
   * Modelo próprio do módulo, quando o proprietário autorizou um mais capaz (19/10/2026: só a TI, com o
   * Sonnet, por ser técnica). Sem ele, o Haiku. Uma linha em sara_modulos continua valendo por cima.
   */
  modelo?: "claude-haiku-5-5" | "claude-sonnet-5-5";
  /** Tamanho máximo de cada resposta (padrão 1.500 tokens). */
  maxTokens?: number;
  /** Quem conversa é técnico (a TI): linguagem técnica, passos e comandos completos, no lugar de "curto e sem jargão". */
  tecnico?: boolean;
  /** A SARA central (E7): não consulta direto; pergunta às SARAs dos módulos e o verificador confere os números. */
  central?: boolean;
};

export type Nivel = "urgente" | "aviso";
/**
 * Degrau 3 (22/10/2026): o aviso já traz a ação pronta ("Refazer o pedido"). No toque, a SARA prepara o
 * cartão com essa entrada e a pessoa decide (Permitir / Não permitir). Só aparece para quem tem a ação.
 */
export type ProporAcao = { ferramenta: string; entrada: Record<string, unknown>; rotulo: string };
export type Alerta = { chave: string; nivel: Nivel; titulo: string; detalhe: string; abrir?: Abrir; propor?: ProporAcao };
export type ContextoAlertas = { pode: (feature: string) => boolean; hoje: string; novidades?: { id: string; data: string; titulo: string }[] };
export type Regra = { exige: string[]; gerar: (sb: SupabaseClient, c: ContextoAlertas) => Promise<Alerta[]> };

/** Um agente da equipe: a SARA do módulo, as consultas dela e as regras dos avisos. */
export type Agente = { sara: SaraModulo; ferramentas: Ferramenta[]; regras: Regra[] };

/**
 * Desligar o "pensamento" do modelo: o Haiku aceita { type: "disabled" }; o Sonnet 5.5 recusa e pede
 * { type: "between_tools" } (não pensa antes de responder; o que escreve entre consultas volta como
 * bloco de pensamento, que a SARA já ignora).
 */
export const semPensar = (modelo: string) => (/haiku/i.test(modelo) ? { type: "disabled" } : { type: "between_tools" });

export const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const maisDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const reais = (v: number) => Math.round(v * 100) / 100;
export const num = (v: unknown, padrao: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao; };
export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
export const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
export const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
/** Texto livre vindo do modelo, limpo para usar num filtro ilike. */
export const termo = (v: unknown) => String(v ?? "").replace(/[%_,()]/g, " ").trim().slice(0, 80);
export const link = (modulo: string, secao?: string) => `/?module=${modulo}${secao ? `&secao=${encodeURIComponent(secao)}` : ""}`;
/** Conta exata (sem o limite de 1.000 linhas): só o cabeçalho da resposta. */
export async function contar(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
