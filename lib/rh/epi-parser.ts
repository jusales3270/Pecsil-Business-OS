/**
 * Leitura do relatório de entrega de EPI (exportação do ponto biométrico,
 * transcrita em Markdown: uma seção `## Nome` por funcionário, com CPF e
 * cargo, e uma tabela EPI | CA | Quantidade | Data Última Entrega | Assinatura).
 *
 * O CPF é lido só para casar a pessoa com o cadastro; ele nunca vai para as
 * tabelas de EPI nem para mensagens de problema. Nada aqui adivinha: data que
 * não é data vira PROBLEMA com a linha do arquivo.
 */

// Cópia deliberada de dois auxiliares de historico-parser.ts: o script de
// importação roda no Node sem o empacotador, e import entre arquivos .ts
// exigiria a extensão, que o TypeScript do app não aceita.
const semAcento = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** "dd/mm/aaaa" estrito e de calendário. Qualquer outra forma é `null`. */
function parseData(raw: string): string | null {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const year = Number(y);
  if (year < 1980 || year > 2035) return null;
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

export interface EpiDelivery {
  line: number;
  itemName: string;
  itemKey: string;
  caNumber: string | null;
  quantity: number;
  deliveredOn: string;
  signedOn: string | null;
  /** Conteúdo normalizado da linha, para a chave de reexecução. */
  fingerprint: string;
}

export interface EpiEmployee {
  name: string;
  /** Só dígitos; null quando o arquivo não traz. */
  cpf: string | null;
  role: string | null;
  line: number;
  deliveries: EpiDelivery[];
  duplicates: number;
}

export interface EpiProblem {
  employee: string;
  line: number;
  message: string;
}

export interface EpiParseResult {
  employees: EpiEmployee[];
  problems: EpiProblem[];
}

/** Nome do item na forma de chave: sem acento, caixa ou espaço duplo. */
export const chaveItem = (name: string) =>
  semAcento(name).toUpperCase().replace(/\s+/g, " ").trim();

/** "Assinado Biometricamente em 06/02/2026" → "2026-02-06"; vazio → null. */
export function parseAssinatura(raw: string): { signedOn: string | null } | { error: string } {
  const texto = raw.trim();
  if (!texto) return { signedOn: null };
  const data = texto.match(/(\d{2}\/\d{2}\/\d{4})\s*$/);
  const signedOn = data ? parseData(data[1]) : null;
  if (!signedOn) return { error: "assinatura sem data válida" };
  return { signedOn };
}

const celulas = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());

export function parseEntregasEpi(markdown: string): EpiParseResult {
  const lines = markdown.split(/\r?\n/);
  const employees: EpiEmployee[] = [];
  const problems: EpiProblem[] = [];
  let atual: (EpiEmployee & { vistos: Set<string> }) | null = null;

  const fechar = () => {
    if (!atual) return;
    const { vistos: _vistos, ...employee } = atual;
    void _vistos;
    employees.push(employee);
  };

  lines.forEach((text, index) => {
    const line = index + 1;
    const titulo = text.match(/^## (.+)$/);
    if (titulo) {
      fechar();
      atual = { name: titulo[1].trim(), cpf: null, role: null, line, deliveries: [], duplicates: 0, vistos: new Set() };
      return;
    }
    if (!atual) return;
    const cpf = text.match(/^- \*\*CPF:\*\*\s*(.*)$/);
    if (cpf) {
      const digitos = cpf[1].replace(/\D/g, "");
      atual.cpf = digitos.length === 11 ? digitos : null;
      if (cpf[1].trim() && !atual.cpf) problems.push({ employee: atual.name, line, message: "CPF com formato inesperado" });
      return;
    }
    const cargo = text.match(/^- \*\*Cargo:\*\*\s*(.*)$/);
    if (cargo) {
      atual.role = cargo[1].trim() || null;
      return;
    }
    if (!text.startsWith("|") || /^\|\s*-{3}/.test(text)) return;
    const cells = celulas(text);
    if (chaveItem(cells[0] ?? "") === "EPI") return; // cabeçalho
    const [itemRaw = "", caRaw = "", quantidadeRaw = "", dataRaw = "", assinaturaRaw = ""] = cells;

    const fingerprint = chaveItem([itemRaw, caRaw, quantidadeRaw, dataRaw, assinaturaRaw].join("|"));
    if (atual.vistos.has(fingerprint)) {
      atual.duplicates += 1;
      return;
    }
    atual.vistos.add(fingerprint);

    const erro = (message: string) => problems.push({ employee: atual!.name, line, message });
    const itemName = itemRaw.replace(/\s+/g, " ").trim();
    if (!itemName) return erro("linha sem EPI");
    const caNumber = caRaw.replace(/\D/g, "") || null;
    if (caRaw.trim() && !caNumber) return erro("CA com formato inesperado");
    const quantity = Number(quantidadeRaw);
    if (!Number.isInteger(quantity) || quantity <= 0) return erro("quantidade inválida");
    const deliveredOn = parseData(dataRaw);
    if (!deliveredOn) return erro("data de entrega inválida");
    const assinatura = parseAssinatura(assinaturaRaw);
    if ("error" in assinatura) return erro(assinatura.error);

    atual.deliveries.push({
      line,
      itemName,
      itemKey: chaveItem(itemName),
      caNumber,
      quantity,
      deliveredOn,
      signedOn: assinatura.signedOn,
      fingerprint,
    });
  });
  fechar();
  return { employees, problems };
}
