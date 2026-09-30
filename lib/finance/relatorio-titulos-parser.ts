/**
 * Leitura dos relatórios de títulos do sistema antigo — "Contas à Pagar/Pagas
 * (Agrupado Por Fornecedor)" e "Contas à Receber/Recebidas (Agrupado Por
 * Cliente)" — a partir do texto posicionado do PDF (trechos com x, y e largura
 * por página). Sem banco e sem PDF aqui: quem extrai o texto é o script de
 * carga.
 *
 * Os dois relatórios são a mesma grade, com as colunas em posições diferentes
 * (`Layout`). Cada título começa na linha da data de lançamento e vai até o
 * próximo; a coluna diz o que é cada trecho:
 *
 *   26/48     caixas Pago · Prev. ("þ" marcada, "¨" vazia)
 *   datas     lançamento · vencimento · pagamento
 *   nome      fornecedor ou cliente (razão social)
 *   histórico (várias linhas) · documento · tipo
 *   direita   valor do lançamento · corrigido · pago (alinhados pela direita)
 *   75        "Obs.:" e "Plano de Contas" (uma linha por conta do rateio)
 *
 * O nome do grupo fica em x≈22 e se repete no topo de cada página; um título
 * pode continuar na página seguinte, então a leitura é um fluxo só. Depois do
 * último título do grupo vêm "Previsões", "Sem Previsões" e "Total do Grupo" —
 * usados em `conferir` para provar que a leitura bate com o relatório.
 */

export type TextItem = { x: number; y: number; w: number; s: string };

export type Layout = {
  issueX: number;
  dueX: number;
  /** Coluna da data de pagamento (nula no relatório que só traz em aberto). */
  paidX: number | null;
  nameX: number;
  historyX: number;
  documentX: number;
  /** Largura a partir da qual a linha foi cortada no meio da palavra. */
  nameFull: number;
  historyFull: number;
  documentFull: number;
};

export const LAYOUT_RECEBER: Layout = { issueX: 101.3, dueX: 151.5, paidX: null, nameX: 249, historyX: 442.4, documentX: 551.2, nameFull: 9999, historyFull: 100, documentFull: 44 };
export const LAYOUT_PAGAR: Layout = { issueX: 75, dueX: 125.3, paidX: 174, nameX: 224.3, historyX: 438.7, documentX: 549.7, nameFull: 205, historyFull: 100, documentFull: 44 };

export type Allocation = { code: string | null; name: string; cents: number };

export type ReportTitle = {
  group: string;
  /** Bloco de totais a que o título pertence (ordem do relatório). */
  block: number;
  party: string;
  issueDate: string;
  dueDate: string;
  paidDate: string | null;
  history: string;
  document: string;
  documentType: string;
  cents: number;
  correctedCents: number;
  paidCents: number;
  forecast: boolean;
  paid: boolean;
  notes: string;
  allocations: Allocation[];
  page: number;
};

/** Valores de uma linha de total; nulo = o relatório não imprimiu aquela coluna. */
export type Amounts = { issued: number | null; corrected: number | null; paid: number | null };

export type GroupTotals = { name: string; block: number; forecast: Amounts; real: Amounts; total: Amounts; page: number };

export type Report = {
  titles: ReportTitle[];
  groups: GroupTotals[];
  grand: { forecast: Amounts; real: Amounts; total: Amounts } | null;
};

const DATE = /^\d{2}\/\d{2}\/\d{2}$/;
const MONEY = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
/** Acima disto é o cabeçalho das colunas; abaixo de 30, o rodapé da página. */
const TOP = 500;
const BOTTOM = 30;
const LABELS = new Set(["Previsões", "Sem Previsões", "Total do Grupo", "Total de Previsões", "Total Sem Previsões", "Total Geral"]);

const near = (value: number, target: number, tolerance = 3) => Math.abs(value - target) <= tolerance;

export function parseCents(text: string): number {
  const negative = text.trim().startsWith("-");
  return (negative ? -1 : 1) * Number(text.replace(/\D/g, ""));
}

/** "25/08/26" → "2026-08-25". O relatório só usa dois dígitos; tudo é 20xx. */
export function parseDate(text: string): string {
  const [day, month, year] = text.split("/");
  return `20${year}-${month}-${day}`;
}

type Placed = TextItem & { page: number; /** Posição no fluxo: cresce de cima para baixo, página após página. */ g: number };

/**
 * Junta linhas de um campo quebrado pelo relatório. Linha que ocupa a largura
 * toda foi cortada no meio da palavra ("CADILL" + "AC"): cola direto, salvo
 * depois de pontuação. Linha curta terminou de propósito: vai com `gap`.
 */
function joinLines(lines: readonly TextItem[], fullWidth: number, gap = " "): string {
  let out = "";
  lines.forEach((line, index) => {
    if (index === 0) { out = line.s; return; }
    const previous = lines[index - 1];
    const cut = previous.w >= fullWidth && !/[:.,;)]$/.test(previous.s);
    out += (cut ? "" : previous.w >= fullWidth ? " " : gap) + line.s;
  });
  return out.replace(/[ \t]+/g, " ").trim();
}

/** Coluna pelo lado direito do número (os valores são alinhados à direita). */
function amountsOf(row: readonly TextItem[]): Amounts {
  const amounts: Amounts = { issued: null, corrected: null, paid: null };
  for (const item of row) {
    if (item.x < 630 || !MONEY.test(item.s)) continue;
    const right = item.x + item.w;
    if (right < 712) amounts.issued = parseCents(item.s);
    else if (right < 778) amounts.corrected = parseCents(item.s);
    else amounts.paid = parseCents(item.s);
  }
  return amounts;
}

export function parseRelatorioTitulos(pages: readonly (readonly TextItem[])[], layout: Layout): Report {
  const items: Placed[] = [];
  pages.forEach((page, index) => {
    for (const item of page) {
      if (!item.s.trim() || item.y >= TOP || item.y <= BOTTOM) continue;
      items.push({ ...item, page: index + 1, g: index * 1000 + (600 - item.y) });
    }
  });
  items.sort((a, b) => a.g - b.g || a.x - b.x);
  const sameRow = (a: Placed, b: Placed, tolerance = 1.6) => a.page === b.page && near(a.y, b.y, tolerance);
  const rowOf = (anchor: Placed) => items.filter((item) => sameRow(item, anchor, 1));

  type Mark = { kind: "group" | "title" | "totals" | "grand"; item: Placed };
  const marks: Mark[] = [];
  for (const item of items) {
    if (near(item.x, 21.7, 1.5) && !LABELS.has(item.s)) marks.push({ kind: "group", item });
    else if (near(item.x, layout.issueX, 1.5) && DATE.test(item.s)) marks.push({ kind: "title", item });
    else if (item.s === "Previsões") marks.push({ kind: "totals", item });
    else if (item.s === "Total de Previsões") marks.push({ kind: "grand", item });
  }

  const titles: ReportTitle[] = [];
  const groups: GroupTotals[] = [];
  let grand: Report["grand"] = null;
  let group = "";
  let block = 0;
  /** O nome repetido no topo da página não abre grupo novo: só depois de um bloco de totais. */
  let afterTotals = true;
  const repeated = new Set<Placed>();
  // 1ª passada: decide quais cabeçalhos são só repetição, para não cortarem um título.
  {
    let current = "";
    let closed = true;
    for (const mark of marks) {
      if (mark.kind === "group") {
        if (!closed && mark.item.s.trim() === current) repeated.add(mark.item);
        else { current = mark.item.s.trim(); closed = false; }
      } else if (mark.kind === "totals") closed = true;
    }
  }
  const boundaries = marks.filter((mark) => !repeated.has(mark.item));

  boundaries.forEach((mark, index) => {
    if (mark.kind === "group") { group = mark.item.s.trim(); afterTotals = false; return; }
    const labelRow = (label: string, from: Placed, reach: number) => {
      const found = items.find((item) => item.s === label && item.page === from.page && item.y <= from.y + 0.5 && item.y > from.y - reach);
      return found ? amountsOf(rowOf(found)) : { issued: null, corrected: null, paid: null };
    };
    if (mark.kind === "totals") {
      groups.push({ name: group, block, forecast: amountsOf(rowOf(mark.item)), real: labelRow("Sem Previsões", mark.item, 12), total: labelRow("Total do Grupo", mark.item, 22), page: mark.item.page });
      block += 1;
      afterTotals = true;
      return;
    }
    if (mark.kind === "grand") {
      grand = { forecast: amountsOf(rowOf(mark.item)), real: labelRow("Total Sem Previsões", mark.item, 14), total: labelRow("Total Geral", mark.item, 26) };
      return;
    }
    // Título sem nome de grupo antes dele (último grupo do relatório de recebíveis).
    if (afterTotals) { group = ""; afterTotals = false; }

    const next = boundaries[index + 1];
    const end = next ? next.item.g - 3 : Infinity;
    const blockItems = items.filter((item) => item.g >= mark.item.g - 1.5 && item.g < end && !repeated.has(item));
    const onRow = (item: Placed) => sameRow(item, mark.item);
    const column = (x: number, tolerance: number) => blockItems.filter((item) => near(item.x, x, tolerance));
    const box = (x: number) => blockItems.find((item) => onRow(item) && near(item.x, x, 2) && (item.s === "þ" || item.s === "¨"))?.s === "þ";
    const dateAt = (x: number | null) => (x === null ? null : blockItems.find((item) => onRow(item) && near(item.x, x, 1.5) && DATE.test(item.s))?.s ?? null);
    const amounts = amountsOf(blockItems.filter(onRow));

    const obsLabel = blockItems.find((item) => item.s === "Obs.:");
    const accountLabels = blockItems.filter((item) => item.s === "Plano de Contas");
    const firstAccount = accountLabels[0]?.g ?? Infinity;
    // Tudo o que é do título (nome, histórico, documento, observação) vem antes da primeira conta.
    const head = (item: Placed) => item.g < firstAccount - 2;
    const headEnd = Math.min(firstAccount, obsLabel?.g ?? Infinity);
    const beforeObs = (item: Placed) => item.g < headEnd - 2;
    const notes = obsLabel
      ? joinLines(blockItems.filter((item) => item.x > 98 && item.x < 106 && item.g >= obsLabel.g - 1 && head(item) && !DATE.test(item.s) && item.s !== "Obs.:"), 690, "\n")
      : "";

    const allocations: Allocation[] = accountLabels.map((label, position) => {
      const until = accountLabels[position + 1]?.g ?? label.g + 12;
      const text = blockItems.filter((item) => item.x > 136 && item.x < 142 && item.g >= label.g - 0.5 && item.g < Math.min(until, label.g + 12)).map((item) => item.s).join(" ");
      const amount = blockItems.find((item) => sameRow(item, label, 0.6) && item.x > 330 && item.x < 380 && MONEY.test(item.s));
      const match = text.match(/^(\d{2,3}(?:\.\d{2,3}){0,2})\s*-\s*(.+)$/);
      return { code: match ? match[1] : null, name: match ? match[2].trim() : text.trim(), cents: amount ? parseCents(amount.s) : 0 };
    });

    const issued = amounts.issued ?? 0;
    const due = dateAt(layout.dueX);
    titles.push({
      group,
      block,
      party: joinLines(column(layout.nameX, 1).filter(beforeObs), layout.nameFull, " "),
      issueDate: parseDate(mark.item.s),
      dueDate: due ? parseDate(due) : parseDate(mark.item.s),
      paidDate: (() => { const paid = dateAt(layout.paidX); return paid ? parseDate(paid) : null; })(),
      history: joinLines(column(layout.historyX, 1).filter(beforeObs), layout.historyFull, " "),
      document: joinLines(column(layout.documentX, 1.5).filter(beforeObs), layout.documentFull, " ").replace(/\s*SERVIÇOS GERADOS:\s*$/, "").trim(),
      documentType: blockItems.find((item) => onRow(item) && item.x > 606 && item.x < 614)?.s.trim() ?? "",
      cents: issued,
      correctedCents: amounts.corrected ?? issued,
      paidCents: amounts.paid ?? 0,
      forecast: box(48),
      paid: box(26.3),
      notes,
      allocations,
      page: mark.item.page,
    });
  });

  return { titles, groups, grand };
}

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

export type Conferencia = {
  /** Divergência que impede a carga. */
  problems: string[];
  /** Diferença de centavos dentro da tolerância (o relatório soma valor não arredondado). */
  notices: string[];
};

/**
 * Prova que a leitura bate com o relatório: soma dos títulos de cada bloco
 * contra as linhas de total que o relatório imprime, soma geral contra "Total
 * Geral" e rateio de cada título contra o valor dele.
 *
 * `centsPerTitle` é a folga por título: o relatório de contas a pagar soma
 * valores não arredondados e erra 1 ou 2 centavos em alguns grupos. Zero exige
 * igualdade ao centavo.
 */
export function conferirRelatorio(report: Report, centsPerTitle = 0): Conferencia {
  const problems: string[] = [];
  const notices: string[] = [];
  const check = (label: string, read: number, printed: number | null, count: number) => {
    if (printed === null || read === printed) return;
    const message = `${label} ${money(read)} ≠ relatório ${money(printed)}`;
    if (Math.abs(read - printed) <= centsPerTitle * count) notices.push(message);
    else problems.push(message);
  };
  const sumOf = (list: readonly ReportTitle[]) => ({
    issued: list.reduce((acc, title) => acc + title.cents, 0),
    corrected: list.reduce((acc, title) => acc + title.correctedCents, 0),
    paid: list.reduce((acc, title) => acc + title.paidCents, 0),
  });

  const byBlock = new Map<number, ReportTitle[]>();
  for (const title of report.titles) byBlock.set(title.block, [...(byBlock.get(title.block) ?? []), title]);
  for (const totals of report.groups) {
    const list = byBlock.get(totals.block) ?? [];
    byBlock.delete(totals.block);
    const label = totals.name || "(sem nome)";
    const forecast = sumOf(list.filter((title) => title.forecast));
    const real = sumOf(list.filter((title) => !title.forecast));
    const all = sumOf(list);
    check(`${label}: previsões lidas`, forecast.issued, totals.forecast.issued, list.length);
    check(`${label}: sem previsão lidas`, real.issued, totals.real.issued, list.length);
    check(`${label}: total lido`, all.issued, totals.total.issued, list.length);
    check(`${label}: corrigido lido`, all.corrected, totals.total.corrected, list.length);
    check(`${label}: pago lido`, all.paid, totals.total.paid, list.length);
  }
  const orphans = [...byBlock.values()].reduce((acc, list) => acc + list.length, 0);
  if (orphans) problems.push(`${orphans} título(s) sem bloco de totais do grupo.`);

  if (!report.grand) problems.push("Total Geral não encontrado.");
  else {
    const count = report.titles.length;
    check("Total de previsões lido", sumOf(report.titles.filter((title) => title.forecast)).issued, report.grand.forecast.issued, count);
    check("Total sem previsão lido", sumOf(report.titles.filter((title) => !title.forecast)).issued, report.grand.real.issued, count);
    const all = sumOf(report.titles);
    check("Total geral lido", all.issued, report.grand.total.issued, count);
    check("Total geral pago lido", all.paid, report.grand.total.paid, count);
  }
  for (const title of report.titles) {
    const who = `${title.party || title.group} doc ${title.document || "—"} (pág. ${title.page})`;
    const issue = allocationIssue(title);
    if (issue) (centsPerTitle > 0 ? notices : problems).push(`Rateio ≠ valor: ${who}: ${money(issue.allocated)} ≠ ${money(title.cents)}`);
    if (!title.cents) problems.push(`Título sem valor: ${who}.`);
    if (title.paid && !title.paidCents) problems.push(`Marcado como pago, sem valor pago: ${who}.`);
    if (!title.paid && title.paidCents) problems.push(`Valor pago em título não marcado como pago: ${who}.`);
  }
  return { problems, notices };
}

/**
 * O rateio tem de somar o valor do título — ou o valor PAGO, quando o título foi
 * pago a maior e o relatório rateia juros e tarifa em contas próprias. Nulo =
 * confere; senão, quanto o rateio soma.
 */
export function allocationIssue(title: Pick<ReportTitle, "allocations" | "cents" | "paid" | "paidCents">): { allocated: number; diff: number } | null {
  const allocated = title.allocations.reduce((acc, allocation) => acc + allocation.cents, 0);
  if (allocated === title.cents || (title.paid && allocated === title.paidCents)) return null;
  return { allocated, diff: allocated - title.cents };
}

/** Valor simbólico: nota recusada/cancelada/refaturada mantida com centavos ou R$ 1,00 no sistema antigo. */
export const isPlaceholder = (title: Pick<ReportTitle, "cents">) => title.cents <= 100;

/** Motivos para a equipe revisar o título depois da carga (lista vazia = nada a revisar). */
export function reviewReasons(title: Pick<ReportTitle, "dueDate" | "issueDate" | "party" | "allocations" | "notes" | "paid">, partyLabel = "cliente"): string[] {
  const reasons: string[] = [];
  if (title.dueDate < title.issueDate) reasons.push("Vencimento anterior ao lançamento");
  if (!title.party.trim()) reasons.push(`Sem ${partyLabel}`);
  if (title.allocations.some((allocation) => !allocation.code && allocation.cents !== 0) || !title.allocations.some((allocation) => allocation.code)) reasons.push("Sem conta do plano");
  // Observação de baixa ou cancelamento só chama atenção em título que continua em aberto.
  if (!title.paid && /\b(CANCELAD|RECUSAD)/i.test(title.notes)) reasons.push("Observação diz cancelada/recusada");
  if (!title.paid && /\b(BAIXEI|LIQUIDEI|PGTO EFETUADO|VALOR DEPOSITADO)/i.test(title.notes)) reasons.push("Observação diz que já foi liquidado");
  return reasons;
}

/** Chave estável do título para a carga poder rodar de novo sem duplicar. */
export function legacyKeyOf(prefix: string, title: Pick<ReportTitle, "group" | "party" | "issueDate" | "dueDate" | "document" | "cents">, occurrence: number): string {
  return [prefix, title.group, title.party, title.issueDate, title.dueDate, title.document, title.cents, occurrence].join("|");
}
