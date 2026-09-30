/**
 * Leitura do relatório "Contas à Receber/Recebidas (Agrupado Por Cliente)" do
 * sistema antigo, a partir do texto posicionado do PDF (uma lista de trechos
 * com x, y e largura por página). Sem banco e sem PDF aqui: quem extrai o texto
 * é scripts/import-contas-receber-pdf.mjs.
 *
 * O relatório é uma grade fixa. Cada título começa na linha da data de
 * lançamento (x≈101) e vai até o próximo; a coluna diz o que é cada trecho:
 *
 *   26/48/69  caixas Pago · Prev. · Baixa c/ Cnab ("þ" marcada, "¨" vazia)
 *   101/151   lançamento · vencimento        249  cliente (razão social)
 *   442       histórico (várias linhas)      551  documento   610  tipo
 *   640–715   valor do lançamento            75   "Obs.:" / "Plano de Contas"
 *
 * O nome do grupo (apelido do cliente) fica em x≈22 e se repete no topo de
 * cada página. Depois do último título do grupo vêm "Previsões", "Sem
 * Previsões" e "Total do Grupo" — usados em `conferir` para provar que a
 * leitura bate com o relatório ao centavo.
 */

export type TextItem = { x: number; y: number; w: number; s: string };

export type Allocation = { code: string | null; name: string; cents: number };

export type ParsedTitle = {
  group: string;
  client: string;
  issueDate: string;
  dueDate: string;
  history: string;
  document: string;
  documentType: string;
  cents: number;
  forecast: boolean;
  paid: boolean;
  notes: string;
  allocations: Allocation[];
  page: number;
};

export type GroupTotals = { name: string; forecastCents: number; realCents: number; totalCents: number; page: number };

export type ParsedReport = {
  titles: ParsedTitle[];
  groups: GroupTotals[];
  grand: { forecastCents: number; realCents: number; totalCents: number } | null;
};

const DATE = /^\d{2}\/\d{2}\/\d{2}$/;
const MONEY = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
/** Abaixo disto é o cabeçalho das colunas; o rodapé da página fica abaixo de 30. */
const TOP = 500;
const BOTTOM = 30;

const near = (value: number, target: number, tolerance = 3) => Math.abs(value - target) <= tolerance;

export function parseCents(text: string): number {
  const negative = text.trim().startsWith("-");
  const digits = text.replace(/\D/g, "");
  return (negative ? -1 : 1) * Number(digits);
}

/** "25/08/26" → "2026-08-25". O relatório só usa dois dígitos; tudo é 20xx. */
export function parseDate(text: string): string {
  const [day, month, year] = text.split("/");
  return `20${year}-${month}-${day}`;
}

/**
 * Junta linhas de um campo quebrado pelo relatório. Linha que ocupa a largura
 * toda foi cortada no meio da palavra ("CADILL" + "AC"): cola direto, salvo
 * depois de pontuação. Linha curta terminou de propósito: vai com `gap`.
 */
function joinLines(lines: TextItem[], fullWidth: number, gap = " "): string {
  let out = "";
  lines.forEach((line, index) => {
    if (index === 0) { out = line.s; return; }
    const previous = lines[index - 1];
    const cut = previous.w >= fullWidth && !/[:.,;)]$/.test(previous.s);
    out += (cut ? "" : previous.w >= fullWidth ? " " : gap) + line.s;
  });
  return out.replace(/[ \t]+/g, " ").trim();
}

const LABELS = new Set(["Previsões", "Sem Previsões", "Total do Grupo", "Total de Previsões", "Total Sem Previsões", "Total Geral"]);

export function parseContasReceber(pages: readonly (readonly TextItem[])[]): ParsedReport {
  const titles: ParsedTitle[] = [];
  const groups: GroupTotals[] = [];
  let grand: ParsedReport["grand"] = null;
  let group = "";

  pages.forEach((raw, pageIndex) => {
    const page = pageIndex + 1;
    const items = raw.filter((item) => item.s.trim() && item.y < TOP && item.y > BOTTOM);
    const moneyOn = (y: number) => items.filter((item) => near(item.y, y, 1) && item.x > 640 && MONEY.test(item.s)).sort((a, b) => a.x - b.x);

    // Totais do grupo e do relatório (linha do rótulo → valores à direita).
    const valueOf = (label: string) => {
      const item = items.find((candidate) => candidate.s === label);
      return item ? parseCents(moneyOn(item.y)[0]?.s ?? "0") : null;
    };

    // Marcos da página, de cima para baixo: cabeçalho de grupo, início de título, totais.
    type Mark = { y: number; kind: "group" | "title" | "totals"; item: TextItem };
    const marks: Mark[] = [];
    for (const item of items) {
      if (near(item.x, 21.7, 1.5) && !LABELS.has(item.s)) marks.push({ y: item.y, kind: "group", item });
      else if (near(item.x, 101.3, 1.5) && DATE.test(item.s)) marks.push({ y: item.y, kind: "title", item });
      else if (item.s === "Previsões") marks.push({ y: item.y, kind: "totals", item });
    }
    marks.sort((a, b) => b.y - a.y);
    // Título sem grupo acima dele na página (último grupo do relatório, sem nome).
    const firstTitle = marks.find((mark) => mark.kind === "title");
    const firstGroup = marks.find((mark) => mark.kind === "group");
    if (firstTitle && (!firstGroup || firstGroup.y < firstTitle.y)) group = "";

    marks.forEach((mark, index) => {
      if (mark.kind === "group") { group = mark.item.s.trim(); return; }
      if (mark.kind === "totals") {
        const forecastCents = parseCents(moneyOn(mark.y)[0]?.s ?? "0");
        const realLabel = items.find((item) => item.s === "Sem Previsões" && item.y < mark.y && item.y > mark.y - 12);
        const totalLabel = items.find((item) => item.s === "Total do Grupo" && item.y < mark.y && item.y > mark.y - 22);
        groups.push({
          name: group,
          forecastCents,
          realCents: realLabel ? parseCents(moneyOn(realLabel.y)[0]?.s ?? "0") : 0,
          totalCents: totalLabel ? parseCents(moneyOn(totalLabel.y)[0]?.s ?? "0") : 0,
          page,
        });
        return;
      }

      // Bloco do título: da linha da data (a caixa fica 1,1 abaixo) até o próximo marco.
      const next = marks[index + 1];
      const floor = next ? next.y + 4 : BOTTOM;
      const block = items.filter((item) => item.y <= mark.y + 1 && item.y > floor);
      const row = (item: TextItem) => near(item.y, mark.y, 1.6);
      const column = (x: number, tolerance = 2.5) => block.filter((item) => near(item.x, x, tolerance)).sort((a, b) => b.y - a.y);
      const box = (x: number) => block.find((item) => near(item.x, x, 2) && row(item) && (item.s === "þ" || item.s === "¨"))?.s === "þ";

      const due = block.find((item) => near(item.x, 151.5, 1.5) && row(item) && DATE.test(item.s));
      const value = block.filter((item) => row(item) && item.x > 640 && item.x < 716 && MONEY.test(item.s))[0];

      const obsLabel = block.find((item) => item.s === "Obs.:");
      const accountLabels = block.filter((item) => item.s === "Plano de Contas").sort((a, b) => b.y - a.y);
      const firstAccountY = accountLabels[0]?.y ?? -1;
      // A observação fica entre a linha do título e a primeira conta, em x≈100.
      const notes = obsLabel
        ? joinLines(block.filter((item) => near(item.x, 100.4, 1.2) && item.y < mark.y - 2 && item.y > firstAccountY + 2 && !DATE.test(item.s)).sort((a, b) => b.y - a.y), 690, "\n")
        : "";

      const allocations: Allocation[] = accountLabels.map((label, position) => {
        const until = accountLabels[position + 1]?.y ?? label.y - 12;
        const text = block.filter((item) => item.x > 136 && item.x < 142 && item.y <= label.y + 0.5 && item.y > Math.max(until, label.y - 12)).sort((a, b) => b.y - a.y).map((item) => item.s).join(" ");
        const amount = block.find((item) => near(item.y, label.y, 0.6) && item.x > 330 && item.x < 380 && MONEY.test(item.s));
        const match = text.match(/^(\d{2}(?:\.\d{2,3}){0,2})\s*-\s*(.+)$/);
        return { code: match ? match[1] : null, name: match ? match[2].trim() : text.trim(), cents: amount ? parseCents(amount.s) : 0 };
      });

      const historyFloor = Math.max(firstAccountY, obsLabel?.y ?? -1);
      const above = (item: TextItem) => item.y > historyFloor + 2 || historyFloor < 0;
      const document = joinLines(column(551.2, 1.5).filter(above), 44, " ").replace(/\s*SERVIÇOS GERADOS:\s*$/, "").trim();

      titles.push({
        group,
        client: joinLines(column(249, 1).filter(above), 9999, " "),
        issueDate: parseDate(mark.item.s),
        dueDate: due ? parseDate(due.s) : parseDate(mark.item.s),
        history: joinLines(column(442.4, 1).filter(above), 100, " "),
        document,
        documentType: block.find((item) => near(item.x, 610.1, 1.5) && row(item))?.s.trim() ?? "",
        cents: value ? parseCents(value.s) : 0,
        forecast: box(48),
        paid: box(26.3),
        notes,
        allocations,
        page,
      });
    });

    const total = valueOf("Total Geral");
    if (total !== null) grand = { forecastCents: valueOf("Total de Previsões") ?? 0, realCents: valueOf("Total Sem Previsões") ?? 0, totalCents: total };
  });

  return { titles, groups, grand };
}

/**
 * Prova que a leitura bate com o relatório: soma dos títulos de cada grupo
 * contra "Previsões / Sem Previsões / Total do Grupo", soma geral contra "Total
 * Geral" e rateio de cada título contra o valor dele. Lista vazia = tudo confere.
 */
export function conferir(report: ParsedReport): string[] {
  const problems: string[] = [];
  const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  // Os grupos saem na ordem do relatório; um título pertence ao próximo bloco de totais.
  let cursor = 0;
  const ordered = report.titles;
  for (const totals of report.groups) {
    let forecast = 0;
    let real = 0;
    while (cursor < ordered.length && ordered[cursor].group === totals.name && (ordered[cursor].page <= totals.page)) {
      if (ordered[cursor].forecast) forecast += ordered[cursor].cents; else real += ordered[cursor].cents;
      cursor += 1;
    }
    const label = totals.name || "(sem nome)";
    if (forecast !== totals.forecastCents) problems.push(`${label}: previsões lidas ${money(forecast)} ≠ relatório ${money(totals.forecastCents)}`);
    if (real !== totals.realCents) problems.push(`${label}: sem previsão lidas ${money(real)} ≠ relatório ${money(totals.realCents)}`);
    if (forecast + real !== totals.totalCents) problems.push(`${label}: total lido ${money(forecast + real)} ≠ relatório ${money(totals.totalCents)}`);
  }
  if (cursor !== ordered.length) problems.push(`${ordered.length - cursor} título(s) sem bloco de totais do grupo.`);
  if (!report.grand) problems.push("Total Geral não encontrado.");
  else {
    const sum = (filter: (title: ParsedTitle) => boolean) => ordered.filter(filter).reduce((acc, title) => acc + title.cents, 0);
    if (sum((t) => t.forecast) !== report.grand.forecastCents) problems.push(`Total de previsões lido ${money(sum((t) => t.forecast))} ≠ ${money(report.grand.forecastCents)}`);
    if (sum((t) => !t.forecast) !== report.grand.realCents) problems.push(`Total sem previsão lido ${money(sum((t) => !t.forecast))} ≠ ${money(report.grand.realCents)}`);
    if (sum(() => true) !== report.grand.totalCents) problems.push(`Total geral lido ${money(sum(() => true))} ≠ ${money(report.grand.totalCents)}`);
  }
  for (const title of ordered) {
    const allocated = title.allocations.reduce((acc, allocation) => acc + allocation.cents, 0);
    if (allocated !== title.cents) problems.push(`Rateio ≠ valor: ${title.client || title.group} doc ${title.document || "—"} (pág. ${title.page}): ${money(allocated)} ≠ ${money(title.cents)}`);
    if (!title.cents) problems.push(`Título sem valor na pág. ${title.page} (${title.client}).`);
  }
  return problems;
}

/** Valor simbólico: nota recusada/cancelada/refaturada mantida com centavos ou R$ 1,00 no sistema antigo. */
export const isPlaceholder = (title: Pick<ParsedTitle, "cents">) => title.cents <= 100;

/** Motivos para a equipe revisar o título depois da carga (lista vazia = nada a revisar). */
export function reviewReasons(title: ParsedTitle): string[] {
  const reasons: string[] = [];
  if (title.dueDate < title.issueDate) reasons.push("Vencimento anterior ao lançamento");
  if (!title.client.trim()) reasons.push("Sem cliente");
  if (title.allocations.some((allocation) => !allocation.code && allocation.cents !== 0) || !title.allocations.some((allocation) => allocation.code)) reasons.push("Sem conta do plano");
  if (/\b(CANCELAD|RECUSAD)/i.test(title.notes)) reasons.push("Observação diz cancelada/recusada");
  if (/\b(BAIXEI|LIQUIDEI|PGTO EFETUADO|VALOR DEPOSITADO)/i.test(title.notes)) reasons.push("Observação diz que já foi liquidado");
  return reasons;
}

/** Chave estável do título para a carga poder rodar de novo sem duplicar. */
export function legacyKey(title: ParsedTitle, occurrence: number): string {
  return ["cr", title.group, title.client, title.issueDate, title.dueDate, title.document, title.cents, occurrence].join("|");
}
