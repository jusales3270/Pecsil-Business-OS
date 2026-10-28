/**
 * Relatório de EPIs (RH › Relatórios, 28/10/2026): o documento que comprova se o colaborador está em dia
 * com os EPIs exigidos para a função dele, com as entregas do período e a assinatura de recebimento.
 *
 * A regra é a mesma de RH › Saúde e segurança › Exigências por função (rh_exigencias_pendencias), só que
 * na data de referência do relatório (o fim do período, nunca depois de hoje):
 *   nunca entregue   nenhuma entrega daquele EPI até a data;
 *   vencido          última entrega + validade (dias) antes da data;
 *   a vencer         vence em até 30 dias;
 *   em dia           o resto (EPI exigido sem validade conta como em dia depois da 1ª entrega).
 * Entrega sem assinatura no período também é pendência: sem ela não há prova do recebimento.
 * Função sem EPIs exigidos cadastrados: o relatório não afirma que a pessoa está em dia.
 * Regras puras (sem banco), testadas em tests/rh-epi-relatorio.test.mjs.
 */

export const JANELA_A_VENCER_DIAS = 30;

export type EntregaEpi = {
  id: string; employeeId: string; itemId: string; item: string; ca: string | null;
  quantidade: number; entregueEm: string; assinadoEm: string | null; metodo: string | null;
};
export type ExigenciaEpi = { positionId: string; itemId: string; item: string; ca: string | null; validadeDias: number | null };
export type ColaboradorEpi = { id: string; nome: string; setor: string | null; funcao: string | null; positionId: string | null; ativo: boolean };

export type SituacaoExigencia = "em_dia" | "a_vencer" | "vencido" | "nunca_entregue";
export type SituacaoGeral = "em_dia" | "pendente" | "sem_exigencias";
export type FiltroSituacao = "" | SituacaoGeral;

export type Filtros = { de: string; ate: string; colaborador?: string; item?: string; setor?: string; situacao?: FiltroSituacao };

export type LinhaExigencia = { itemId: string; item: string; ca: string | null; validadeDias: number | null; ultima: string | null; vence: string | null; situacao: SituacaoExigencia };
export type FichaEpi = ColaboradorEpi & { entregas: EntregaEpi[]; exigencias: LinhaExigencia[]; semAssinatura: number; situacao: SituacaoGeral };
export type RelatorioEpi = {
  de: string; ate: string; referencia: string;
  fichas: FichaEpi[];
  resumo: { colaboradores: number; emDia: number; pendentes: number; semExigencias: number; entregas: number; semAssinatura: number };
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const dataValida = (s: unknown): s is string => typeof s === "string" && DATA.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const somar = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** Situação de um EPI exigido na data de referência, pelas entregas da pessoa (de qualquer período). */
export function situacaoDaExigencia(ex: Pick<ExigenciaEpi, "itemId" | "validadeDias">, entregas: Pick<EntregaEpi, "itemId" | "entregueEm">[], referencia: string): { ultima: string | null; vence: string | null; situacao: SituacaoExigencia } {
  const ultima = entregas.filter((e) => e.itemId === ex.itemId && e.entregueEm <= referencia).map((e) => e.entregueEm).sort().pop() ?? null;
  if (!ultima) return { ultima: null, vence: null, situacao: "nunca_entregue" };
  const vence = ex.validadeDias ? somar(ultima, ex.validadeDias) : null;
  if (vence && vence < referencia) return { ultima, vence, situacao: "vencido" };
  if (vence && vence <= somar(referencia, JANELA_A_VENCER_DIAS)) return { ultima, vence, situacao: "a_vencer" };
  return { ultima, vence, situacao: "em_dia" };
}

export function situacaoGeral(exigencias: { situacao: SituacaoExigencia }[], semAssinatura: number): SituacaoGeral {
  if (!exigencias.length) return "sem_exigencias";
  return semAssinatura > 0 || exigencias.some((e) => e.situacao === "vencido" || e.situacao === "nunca_entregue") ? "pendente" : "em_dia";
}

/**
 * Monta o relatório. Entra quem tem entrega no período (do EPI filtrado) ou, se ativo, EPI exigido pela
 * função; um colaborador escolhido sempre entra. A situação usa todas as entregas até a referência.
 */
export function montarRelatorio(a: { colaboradores: ColaboradorEpi[]; exigencias: ExigenciaEpi[]; entregas: EntregaEpi[]; filtros: Filtros; hoje: string }): RelatorioEpi {
  const { de, ate } = a.filtros;
  const referencia = ate < a.hoje ? ate : a.hoje;
  const porFuncao = new Map<string, ExigenciaEpi[]>();
  for (const ex of a.exigencias) porFuncao.set(ex.positionId, [...(porFuncao.get(ex.positionId) ?? []), ex]);
  const porPessoa = new Map<string, EntregaEpi[]>();
  for (const e of a.entregas) porPessoa.set(e.employeeId, [...(porPessoa.get(e.employeeId) ?? []), e]);
  const doItem = (itemId: string) => !a.filtros.item || itemId === a.filtros.item;

  const fichas: FichaEpi[] = [];
  for (const c of a.colaboradores) {
    if (a.filtros.colaborador && c.id !== a.filtros.colaborador) continue;
    if (a.filtros.setor && (c.setor ?? "") !== a.filtros.setor) continue;
    const todas = porPessoa.get(c.id) ?? [];
    const entregas = todas.filter((e) => e.entregueEm >= de && e.entregueEm <= ate && doItem(e.itemId))
      .sort((x, y) => x.entregueEm.localeCompare(y.entregueEm) || x.item.localeCompare(y.item, "pt-BR"));
    const exigidas = (c.positionId ? porFuncao.get(c.positionId) ?? [] : []).filter((ex) => doItem(ex.itemId));
    if (!a.filtros.colaborador && !entregas.length && !(c.ativo && exigidas.length)) continue;
    const exigencias = exigidas.map((ex) => ({ itemId: ex.itemId, item: ex.item, ca: ex.ca, validadeDias: ex.validadeDias, ...situacaoDaExigencia(ex, todas, referencia) }))
      .sort((x, y) => x.item.localeCompare(y.item, "pt-BR"));
    const semAssinatura = entregas.filter((e) => !e.assinadoEm).length;
    const situacao = situacaoGeral(exigencias, semAssinatura);
    if (a.filtros.situacao && situacao !== a.filtros.situacao) continue;
    fichas.push({ ...c, entregas, exigencias, semAssinatura, situacao });
  }
  fichas.sort((x, y) => (x.setor ?? "~").localeCompare(y.setor ?? "~", "pt-BR") || x.nome.localeCompare(y.nome, "pt-BR"));
  return {
    de, ate, referencia, fichas,
    resumo: {
      colaboradores: fichas.length,
      emDia: fichas.filter((f) => f.situacao === "em_dia").length,
      pendentes: fichas.filter((f) => f.situacao === "pendente").length,
      semExigencias: fichas.filter((f) => f.situacao === "sem_exigencias").length,
      entregas: fichas.reduce((s, f) => s + f.entregas.length, 0),
      semAssinatura: fichas.reduce((s, f) => s + f.semAssinatura, 0),
    },
  };
}

export const ROTULO_EXIGENCIA: Record<SituacaoExigencia, string> = { em_dia: "Em dia", a_vencer: "Em dia · vence em até 30 dias", vencido: "Vencido", nunca_entregue: "Nunca entregue" };
export const ROTULO_GERAL: Record<SituacaoGeral, string> = { em_dia: "Em dia", pendente: "Com pendência", sem_exigencias: "Sem EPIs exigidos cadastrados" };
