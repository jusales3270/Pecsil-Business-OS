import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENTES } from "./agentes/index.ts";
import type { Abrir, Alerta, ContextoAlertas, Regra } from "./base.ts";
import { dias } from "./base.ts";
import { FERRAMENTAS } from "./ferramentas.ts";
import { SARAS } from "./modulos.ts";

export type { Alerta, ContextoAlertas, Nivel } from "./base.ts";

/**
 * Avisos da SARA em cada módulo (proprietário, 18/10/2026). Saem dos DADOS, calculados pela plataforma
 * com a sessão de quem está logado (o modelo não entra: não custa e não inventa). Dois níveis:
 *   urgente (vermelho)  ação a fazer já no módulo (ex.: conciliação pendente, extrato atrasado);
 *   aviso (azul)        compromissos, lembretes e novidades do módulo.
 * Cada aviso tem uma `chave` com a "impressão" da situação (quantidade, data…): depois que a pessoa
 * abre a SARA e vê, aquela chave deixa de pulsar; se a situação mudar, a chave muda e o aviso volta.
 */


const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string) => iso.split("-").reverse().join("/");
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
const tela = (secao: string): Abrir => ({ modulo: "financeiro", secao, rotulo: `Financeiro › ${secao}` });
/** Usa a mesma consulta das ferramentas da SARA (e as mesmas permissões). */
const rodar = async (sb: SupabaseClient, nome: string, entrada: Record<string, unknown> = {}) => {
  const f = FERRAMENTAS.find((x) => x.nome === nome);
  if (!f) throw new Error(`Consulta ${nome} não existe.`);
  return (await f.rodar(sb, entrada)).dados as Record<string, unknown>;
};
/** Extrato mais velho que isto já impede consolidar o mês. */
export const EXTRATO_ATRASADO_DIAS = 7;

const FINANCEIRO: Regra[] = [
  {
    // Conciliação e extratos: o que impede o financeiro de ficar consolidado.
    exige: ["financeiro.bancos"],
    gerar: async (sb, c) => {
      const d = await rodar(sb, "bancos_e_conciliacao");
      const contas = (d.contas ?? []) as { banco: string; a_conciliar: number; ultimo_extrato: string | null }[];
      const saida: Alerta[] = [];
      const pendentes = contas.filter((x) => x.a_conciliar > 0);
      const total = pendentes.reduce((s, x) => s + x.a_conciliar, 0);
      if (total > 0) saida.push({
        chave: `financeiro.conciliacao:${pendentes.map((x) => `${x.banco}=${x.a_conciliar}`).join(",")}`, nivel: "urgente",
        titulo: `Conciliação pendente: ${plural(total, "lançamento", "lançamentos")} do extrato`,
        detalhe: `${pendentes.map((x) => `${x.banco} ${x.a_conciliar.toLocaleString("pt-BR")}`).join(" · ")}. Concilie para deixar o Financeiro consolidado.`,
        abrir: tela("Bancos e conciliação"),
      });
      for (const x of contas) {
        if (!x.ultimo_extrato || dias(x.ultimo_extrato, c.hoje) <= EXTRATO_ATRASADO_DIAS) continue;
        saida.push({
          chave: `financeiro.extrato:${x.banco}:${x.ultimo_extrato}`, nivel: "urgente",
          titulo: `Extrato do ${x.banco} atrasado`,
          detalhe: `O último extrato importado vai até ${data(x.ultimo_extrato)} (${dias(x.ultimo_extrato, c.hoje)} dias). Importe o extrato novo para conciliar e o saldo ficar certo.`,
          abrir: tela("Bancos e conciliação"),
        });
      }
      return saida;
    },
  },
  {
    // Caixa negativo nos próximos 7 dias (cenário pelo vencimento).
    exige: ["financeiro.fluxo", "financeiro.relatorios"],
    gerar: async (sb, c) => {
      const d = await rodar(sb, "fluxo_de_caixa_90_dias", { cenario: "base" });
      const dia = d.primeiro_dia_negativo as string | null;
      if (!dia || dias(c.hoje, dia) > 7) return [];
      const menor = d.menor_saldo as { valor?: number; data?: string } | number | null;
      const valor = typeof menor === "number" ? menor : menor?.valor;
      return [{
        chave: `financeiro.caixa_negativo:${dia}`, nivel: "urgente",
        titulo: dia <= c.hoje ? "O caixa já fica negativo" : `O caixa fica negativo em ${data(dia)}`,
        detalhe: `Pelo vencimento, o saldo dos bancos não cobre as saídas${valor != null ? ` (menor saldo ${brl(valor)})` : ""}. Confira as baixas e as datas no Fluxo de caixa.`,
        abrir: tela("Fluxo de caixa"),
      }];
    },
  },
  {
    // Contas a pagar: vencidas (urgente), a vencer em 7 dias e em aprovação (avisos).
    exige: ["financeiro.pagar"],
    gerar: async (sb, c) => {
      const [venc, semana, aprov] = await Promise.all([
        rodar(sb, "contas_a_pagar", { situacao: "vencidas", limite: 1 }),
        rodar(sb, "contas_a_pagar", { situacao: "a_vencer", dias: 7, limite: 1 }),
        rodar(sb, "contas_a_pagar", { situacao: "em_aprovacao", limite: 1 }),
      ]);
      const saida: Alerta[] = [];
      const n = (x: Record<string, unknown>) => Number(x.quantidade ?? 0), t = (x: Record<string, unknown>) => Number(x.total ?? 0);
      if (n(venc) > 0) saida.push({
        chave: `financeiro.vencidas:${n(venc)}`, nivel: "urgente",
        titulo: `${plural(n(venc), "conta a pagar vencida", "contas a pagar vencidas")} em aberto`,
        detalhe: `Somam ${brl(t(venc))}. Dê baixa no que já foi pago e trate o que ainda falta pagar.`,
        abrir: tela("Contas a pagar"),
      });
      if (n(semana) > 0) saida.push({
        chave: `financeiro.a_pagar_7d:${c.hoje}`, nivel: "aviso",
        titulo: `${plural(n(semana), "conta vence", "contas vencem")} nos próximos 7 dias`,
        detalhe: `Somam ${brl(t(semana))} a pagar.`,
        abrir: tela("Contas a pagar"),
      });
      if (n(aprov) > 0) saida.push({
        chave: `financeiro.aprovacao:${n(aprov)}:${t(aprov)}`, nivel: "aviso",
        titulo: `${plural(n(aprov), "conta aguardando", "contas aguardando")} aprovação`,
        detalhe: `Somam ${brl(t(aprov))}. A aprovação segue as alçadas de cada faixa de valor.`,
        abrir: tela("Contas a pagar"),
      });
      return saida;
    },
  },
  {
    exige: ["financeiro.receber"],
    gerar: async (sb, c) => {
      const semana = await rodar(sb, "contas_a_receber", { situacao: "a_vencer", dias: 7, limite: 1 });
      const n = Number(semana.quantidade ?? 0);
      return n > 0 ? [{
        chave: `financeiro.a_receber_7d:${c.hoje}`, nivel: "aviso",
        titulo: `${plural(n, "recebimento previsto", "recebimentos previstos")} nos próximos 7 dias`,
        detalhe: `Somam ${brl(Number(semana.total ?? 0))} a receber.`,
        abrir: tela("Contas a receber"),
      }] : [];
    },
  },
];

export const REGRAS: Record<string, Regra[]> = { financeiro: FINANCEIRO, ...Object.fromEntries(AGENTES.map((a) => [a.sara.modulo, a.regras])) };

/**
 * Novidades do módulo nos últimos 14 dias (já filtradas por quem pode ver), num aviso só: volta a
 * pulsar quando sai uma novidade nova. Vale para todo módulo da equipe.
 */
function novidades(modulo: string, rotulo: string, c: ContextoAlertas): Alerta[] {
  const recentes = (c.novidades ?? []).filter((x) => dias(x.data, c.hoje) <= 14).sort((a, b) => b.data.localeCompare(a.data));
  if (!recentes.length) return [];
  const mais = recentes.length > 3 ? ` e mais ${recentes.length - 3}` : "";
  return [{
    chave: `${modulo}.novidades:${recentes[0].id}`, nivel: "aviso",
    titulo: recentes.length === 1 ? `Novidade no módulo ${rotulo}` : `${recentes.length} novidades no módulo ${rotulo}`,
    detalhe: `${recentes.slice(0, 3).map((x) => x.titulo).join(" · ")}${mais}. Veja tudo em Atualizar.`,
  }];
}

/** Avisos do módulo para a pessoa: só as regras que ela pode ver; uma regra que falhar não derruba as outras. Urgentes primeiro. */
export async function alertasDo(modulo: string, sb: SupabaseClient, c: ContextoAlertas): Promise<Alerta[]> {
  const regras = (REGRAS[modulo] ?? []).filter((r) => !r.exige.length || r.exige.some(c.pode));
  const lotes = await Promise.all(regras.map((r) => r.gerar(sb, c).catch((e) => { console.error("[sara] aviso falhou", e instanceof Error ? e.message : e); return [] as Alerta[]; })));
  if (SARAS[modulo]) lotes.push(novidades(modulo, SARAS[modulo].rotulo, c));
  return lotes.flat().sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "urgente" ? -1 : 1));
}
