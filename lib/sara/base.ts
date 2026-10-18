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
};

export type Nivel = "urgente" | "aviso";
export type Alerta = { chave: string; nivel: Nivel; titulo: string; detalhe: string; abrir?: Abrir };
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
