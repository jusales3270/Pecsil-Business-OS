/**
 * Relatório "Contas à Receber/Recebidas (Agrupado Por Cliente)" do sistema
 * antigo. A leitura é a de lib/finance/relatorio-titulos-parser.ts com as
 * colunas deste relatório; aqui ficam só os nomes do lado do recebível
 * (cliente) e a conferência ao centavo, que este relatório permite.
 */
import {
  LAYOUT_RECEBER,
  conferirRelatorio,
  isPlaceholder,
  legacyKeyOf,
  parseCents,
  parseDate,
  parseRelatorioTitulos,
  reviewReasons as reviewReasonsOf,
  type Allocation,
  type Report,
  type ReportTitle,
  type TextItem,
} from "./relatorio-titulos-parser";

export { isPlaceholder, parseCents, parseDate };
export type { Allocation, TextItem };

export type ParsedTitle = Omit<ReportTitle, "party"> & { client: string };

export type GroupTotals = { name: string; block: number; forecastCents: number; realCents: number; totalCents: number; page: number };

export type ParsedReport = {
  titles: ParsedTitle[];
  groups: GroupTotals[];
  grand: { forecastCents: number; realCents: number; totalCents: number } | null;
};

export function parseContasReceber(pages: readonly (readonly TextItem[])[]): ParsedReport {
  const report = parseRelatorioTitulos(pages, LAYOUT_RECEBER);
  return {
    titles: report.titles.map(({ party, ...title }) => ({ ...title, client: party })),
    groups: report.groups.map((group) => ({ name: group.name, block: group.block, forecastCents: group.forecast.issued ?? 0, realCents: group.real.issued ?? 0, totalCents: group.total.issued ?? 0, page: group.page })),
    grand: report.grand ? { forecastCents: report.grand.forecast.issued ?? 0, realCents: report.grand.real.issued ?? 0, totalCents: report.grand.total.issued ?? 0 } : null,
  };
}

/** Lista vazia = a leitura bate com o relatório ao centavo (grupos, total geral e rateio). */
export function conferir(report: ParsedReport): string[] {
  const amounts = (issued: number) => ({ issued, corrected: null, paid: null });
  const core: Report = {
    titles: report.titles.map(({ client, ...title }) => ({ ...title, party: client })),
    groups: report.groups.map((group) => ({ name: group.name, block: group.block, page: group.page, forecast: amounts(group.forecastCents), real: amounts(group.realCents), total: amounts(group.totalCents) })),
    grand: report.grand ? { forecast: amounts(report.grand.forecastCents), real: amounts(report.grand.realCents), total: amounts(report.grand.totalCents) } : null,
  };
  return conferirRelatorio(core, 0).problems;
}

/** Motivos para a equipe revisar o título depois da carga (lista vazia = nada a revisar). */
export function reviewReasons(title: ParsedTitle): string[] {
  return reviewReasonsOf({ ...title, party: title.client }, "cliente");
}

/** Chave estável do título para a carga poder rodar de novo sem duplicar. */
export function legacyKey(title: ParsedTitle, occurrence: number): string {
  return legacyKeyOf("cr", { ...title, party: title.client }, occurrence);
}
