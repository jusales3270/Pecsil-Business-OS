/**
 * Leitura do histórico de funcionários (planilha da PecSil convertida em
 * Markdown, uma seção `## NOME` por colaborador).
 *
 * Só lê Férias e Afastamento; a seção de salário é ignorada de propósito.
 * Nada aqui adivinha: data que não é data, duração que não se entende e
 * motivo que não se classifica viram PROBLEMA com a linha do arquivo, para a
 * pessoa corrigir na planilha e importar de novo.
 *
 * Dado clínico (diagnóstico, CID, observação de saúde) sai separado em
 * `clinical` e nunca vai para o texto público da ausência. Mensagens de
 * problema também não carregam diagnóstico nem CID.
 */

export type AbsenceType =
  | "medical_certificate"
  | "attendance_statement"
  | "family_care"
  | "occupational_exam"
  | "legal_leave"
  | "justified_absence"
  | "inss_leave"
  | "work_accident"
  | "maternity_leave";

/** Tipos de saúde: o motivo escrito vai para o dado clínico, não para o público. */
export const HEALTH_TYPES: ReadonlySet<AbsenceType> = new Set([
  "medical_certificate",
  "attendance_statement",
  "family_care",
  "occupational_exam",
  "inss_leave",
  "work_accident",
  "maternity_leave",
]);

/** Texto público de cada tipo de saúde (o que `rh.ferias` em ver enxerga). */
export const PUBLIC_LABEL: Record<AbsenceType, string> = {
  medical_certificate: "Atestado médico",
  attendance_statement: "Consulta ou exame",
  family_care: "Acompanhamento de familiar",
  occupational_exam: "Exame ocupacional",
  legal_leave: "Ausência legal",
  justified_absence: "Ausência justificada",
  inss_leave: "Afastamento INSS",
  work_accident: "Acidente de trabalho",
  maternity_leave: "Licença-maternidade",
};

export interface Problem {
  line: number;
  section: "ferias" | "afastamento" | "colaborador";
  message: string;
  /** Bloqueia a gravação inteira (motivo sem classificação). */
  blocking?: boolean;
  /** Só aviso: a linha entra mesmo assim. */
  warning?: boolean;
}

export interface Duration {
  days: number;
  hours: number | null;
  dayPart: "manha" | "tarde" | null;
  note: string | null;
}

export interface Absence {
  line: number;
  type: AbsenceType;
  start: string;
  end: string;
  days: number;
  hours: number | null;
  dayPart: "manha" | "tarde" | null;
  reason: string;
  clinical: { cidCodes: string[]; diagnosis: string | null; note: string | null } | null;
  /** Conteúdo normalizado da linha, para a chave de reexecução. */
  fingerprint: string;
}

export interface VacationPeriod {
  acquisitionStart: string;
  acquisitionEnd: string;
  entitledDays: number;
  pecuniaryDays: number;
  expiresAt: string;
  gozos: { line: number; start: string; end: string; days: number }[];
}

export interface EmployeeHistory {
  name: string;
  tab: string | null;
  line: number;
  vacations: VacationPeriod[];
  absences: Absence[];
  duplicates: number;
}

export interface ParseResult {
  employees: EmployeeHistory[];
  problems: (Problem & { employee: string })[];
}

// --- Texto -------------------------------------------------------------------

export const semAcento = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (text: string) => semAcento(text).toLowerCase().replace(/\s+/g, " ").trim();

/** Nome do cadastro e da planilha na mesma forma: sem acento, caixa ou espaço duplo. */
export const normalizarNome = (text: string) =>
  semAcento(text).toUpperCase().replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();

// --- Datas -------------------------------------------------------------------

/** "dd/mm/aaaa" estrito e de calendário. Qualquer outra forma é `null`. */
export function parseData(raw: string): string | null {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const year = Number(y);
  if (year < 1980 || year > 2035) return null;
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

/** "dd/mm/aaaa a dd/mm/aaaa" (aceita "A", espaço duplo e "a28/05"). */
export function parseIntervalo(raw: string): { start: string; end: string } | null {
  const match = raw.trim().match(/^(\S+)\s*[aA]\s*(\d\S*)$/);
  if (!match) return null;
  const start = parseData(match[1]);
  const end = parseData(match[2]);
  if (!start || !end || end < start) return null;
  return { start, end };
}

const DIA = 86_400_000;
export const diasEntre = (start: string, end: string) =>
  Math.round((Date.parse(end) - Date.parse(start)) / DIA) + 1;
export const somarDias = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DIA).toISOString().slice(0, 10);
export function somarMeses(date: string, months: number) {
  const d = new Date(Date.parse(date));
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return alvo.toISOString().slice(0, 10);
}

// --- Duração -----------------------------------------------------------------

/**
 * "2 dias", "3h00", "2H50", "40 min", "Período tarde", "1 dia", vazio.
 * Vazio ou "dia todo" usam o intervalo de datas. Sufixo "compensou" ou
 * "justificado" vira observação.
 */
export function parseDuracao(raw: string, spanDays: number): Duration | { error: string } {
  let text = chave(raw);
  let note: string | null = null;
  const sufixo = text.match(/\s*-?\s*(compensou|compesnou|justificado(?: horas)?)$/);
  if (sufixo) {
    note = sufixo[1].startsWith("comp") ? "compensou" : "justificado";
    text = text.slice(0, sufixo.index).trim();
  }

  if (!text || /^(atestado )?dia( todo)?$/.test(text)) {
    return { days: spanDays, hours: null, dayPart: null, note };
  }

  const dias = text.match(/^(\d+)\s*dias?(?:\s*\(([^)]*)\))?$/);
  if (dias) {
    if (dias[2] && /\d/.test(dias[2]) && /dia/.test(dias[2])) return { error: "duração ambígua" };
    const days = Number(dias[1]);
    if (days <= 0) return { error: "duração zerada" };
    return { days, hours: null, dayPart: null, note: dias[2] ? [note, dias[2]].filter(Boolean).join(" · ") : note };
  }

  const horas = text.match(/^(\d{1,2})\s*(?:h|hr|hs|hh|horas?)\s*(\d{2})?$/);
  if (horas) {
    const total = Number(horas[1]) + (horas[2] ? Number(horas[2]) / 60 : 0);
    if (horas[2] && Number(horas[2]) >= 60) return { error: "minutos acima de 59" };
    if (total <= 0 || total > 24) return { error: "horas fora do intervalo" };
    if (spanDays > 1) return { error: "horas em mais de um dia" };
    return { days: 0, hours: Math.round(total * 100) / 100, dayPart: null, note };
  }

  const minutos = text.match(/^(\d{1,3})\s*(?:min|minutos?)$/);
  if (minutos) {
    const total = Number(minutos[1]) / 60;
    if (total <= 0 || total > 24) return { error: "minutos fora do intervalo" };
    return { days: 0, hours: Math.round(total * 100) / 100, dayPart: null, note };
  }

  const periodo = text.match(/^(?:periodo|perido|parte)(?: da)? (manha|tarde)$/);
  if (periodo) {
    if (spanDays > 1) return { error: "meio período em mais de um dia" };
    return { days: 0, hours: null, dayPart: periodo[1] as "manha" | "tarde", note };
  }

  return { error: "duração não reconhecida" };
}

// --- Classificação -----------------------------------------------------------

const REGRAS: [RegExp, AbsenceType][] = [
  [/\binss\b|auxilio doenca|pericia/, "inss_leave"],
  [/acidente de trabalho/, "work_accident"],
  [/licenca matern/, "maternity_leave"],
  [/obito|falecimento|casamento|nascimento|paternidade|doacao de sangue|alistamento/, "legal_leave"],
  [/eleitoral|testemunha|audiencia|forum|conselho tutelar|policia federal|\bcnh\b|habilitacao|prova|escolar|creche/, "justified_absence"],
  [/acomp|acompanhante|esposa|filh[ao]s?\b|familiar/, "family_care"],
  [/periodic|periodido|retorno ao trabalho|admissional|demissional/, "occupational_exam"],
  [/c\s*\/\s*afastamento|c afastamento|com afastamento|consulta\s*\/\s*afastamento|atestado|afastamento|cirurg|internacao|fratura/, "medical_certificate"],
  [/consulta|onsulta|exame|declaracao|delaracao|fisioterapia|dentista|odontolog|ondontolog|oftalmolog|ultrassom|ressonancia|mamografia|endoscopia|coleta|covid|vacinacao|realizacao|realizar|medicacao/, "attendance_statement"],
];

export function classificar(motivo: string): AbsenceType | null {
  const texto = chave(motivo);
  for (const [regra, tipo] of REGRAS) if (regra.test(texto)) return tipo;
  return null;
}

/** Linha que não é registro: separador de página da planilha. */
export const ehSeparador = (motivo: string) =>
  /^[x\-\s.]*$/i.test(motivo.trim()) || /pr[oó]xima p[aá]gina|^continua/i.test(motivo.trim());

/** Parte do motivo antes do parêntese: o que pode aparecer num relatório. */
export const rotuloSemDetalhe = (motivo: string) => motivo.split("(")[0].trim().slice(0, 60);

// --- CID ---------------------------------------------------------------------

/** "H102" → "H10.2"; "Z76.3" fica; "H57.1/T15" → dois. Inválidos voltam à parte. */
export function normalizarCid(raw: string): { codes: string[]; invalid: string[] } {
  const codes: string[] = [];
  const invalid: string[] = [];
  // "S/CID" é "sem CID"; "CID K08" e "Z 76.3" são o mesmo código escrito solto.
  if (/^s\s*\/\s*cid$/i.test(raw.trim())) return { codes, invalid };
  const texto = raw.replace(/\bcid\b/gi, " ").replace(/\b([A-Za-z])\s+(\d)/g, "$1$2");
  for (const parte of texto.split(/[/,;]+|\s+/).map((p) => p.trim()).filter(Boolean)) {
    const limpo = parte.toUpperCase().replace(/[.\s-]/g, "");
    const match = limpo.match(/^([A-Z])(\d{2})(\d?)$/);
    if (!match) {
      invalid.push(parte);
      continue;
    }
    const code = match[3] ? `${match[1]}${match[2]}.${match[3]}` : `${match[1]}${match[2]}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return { codes, invalid };
}

// --- Tabelas do Markdown -----------------------------------------------------

const celulas = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());

interface Linha {
  line: number;
  cells: Record<string, string>;
}

/** Linhas de dados de uma seção, com o cabeçalho que vier antes de cada uma. */
function linhasDaTabela(lines: { text: string; line: number }[]): Linha[] {
  const out: Linha[] = [];
  let header: string[] | null = null;
  for (const { text, line } of lines) {
    if (!text.startsWith("|")) continue;
    if (/^\|\s*-{3}/.test(text)) continue;
    const cells = celulas(text);
    const normalizadas = cells.map((cell) => chave(cell).replace(/\.$/, ""));
    if (normalizadas.includes("motivo") || normalizadas.includes("periodo aquisitivo")) {
      header = normalizadas;
      continue;
    }
    if (!header) continue;
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = cells[index] ?? "";
    });
    out.push({ line, cells: record });
  }
  return out;
}

// --- Férias ------------------------------------------------------------------

function lerFerias(rows: Linha[], employee: string, problems: ParseResult["problems"]) {
  const periodos = new Map<string, { start: string; end: string; rows: Linha[]; bad: boolean }>();
  const vistos = new Set<string>();
  let duplicates = 0;

  for (const row of rows) {
    const aquisitivo = row.cells["periodo aquisitivo"] ?? "";
    const gozo = row.cells["periodo de gozo"] ?? "";
    const dias = row.cells["dias"] ?? "";
    if (!aquisitivo && !gozo && !dias) continue;
    const assinatura = chave(`${aquisitivo}|${gozo}|${dias}`);
    if (vistos.has(assinatura)) {
      duplicates += 1;
      continue;
    }
    vistos.add(assinatura);

    const intervalo = parseIntervalo(aquisitivo);
    if (!intervalo) {
      problems.push({ employee, line: row.line, section: "ferias", message: "período aquisitivo com data inválida" });
      continue;
    }
    const key = intervalo.start;
    const periodo = periodos.get(key) ?? { ...intervalo, rows: [], bad: false };
    if (periodo.end !== intervalo.end) {
      problems.push({ employee, line: row.line, section: "ferias", message: "mesmo início de período aquisitivo com fim diferente" });
      periodo.bad = true;
    }
    periodo.rows.push(row);
    periodos.set(key, periodo);
  }

  const vacations: VacationPeriod[] = [];
  for (const periodo of periodos.values()) {
    const result: VacationPeriod = {
      acquisitionStart: periodo.start,
      acquisitionEnd: periodo.end,
      entitledDays: 30,
      pecuniaryDays: 0,
      expiresAt: somarMeses(periodo.end, 12),
      gozos: [],
    };
    let bad = periodo.bad;
    for (const row of periodo.rows) {
      const gozo = (row.cells["periodo de gozo"] ?? "").trim();
      const diasRaw = (row.cells["dias"] ?? "").trim();
      const erro = (message: string) => {
        problems.push({ employee, line: row.line, section: "ferias", message });
        bad = true;
      };
      if (/abono/i.test(gozo)) {
        const dias = Number(diasRaw);
        if (!Number.isInteger(dias) || dias <= 0 || dias > 10) erro("abono pecuniário com dias inválidos");
        else result.pecuniaryDays += dias;
        continue;
      }
      if (/abono/i.test(diasRaw)) {
        erro("gozo marcado como abono: confirmar se é gozo ou abono");
        continue;
      }
      if (!gozo) {
        if (diasRaw) erro("dias informados sem período de gozo");
        continue; // período aquisitivo ainda sem gozo
      }
      const intervalo = parseIntervalo(gozo);
      if (!intervalo) {
        erro("período de gozo com data inválida");
        continue;
      }
      const dias = diasEntre(intervalo.start, intervalo.end);
      if (diasRaw && Number(diasRaw) !== dias) {
        erro(`coluna DIAS (${diasRaw}) não bate com as datas do gozo (${dias})`);
        continue;
      }
      if (intervalo.start < periodo.start) {
        erro("gozo começa antes do período aquisitivo");
        continue;
      }
      result.gozos.push({ line: row.line, start: intervalo.start, end: intervalo.end, days: dias });
    }
    const usados = result.gozos.reduce((sum, gozo) => sum + gozo.days, 0) + result.pecuniaryDays;
    if (usados > result.entitledDays) {
      problems.push({
        employee,
        line: periodo.rows[0].line,
        section: "ferias",
        message: `período ${periodo.start.split("-").reverse().join("/")}: gozo + abono somam ${usados} dias (máximo 30)`,
      });
      bad = true;
    }
    if (result.pecuniaryDays > 10) bad = true;
    if (!bad) vacations.push(result);
  }
  return { vacations, duplicates };
}

// --- Afastamentos ------------------------------------------------------------

function lerAfastamentos(rows: Linha[], employee: string, problems: ParseResult["problems"]) {
  const absences: Absence[] = [];
  const vistos = new Set<string>();
  let duplicates = 0;

  for (const row of rows) {
    const motivo = (row.cells["motivo"] ?? "").trim();
    const inicio = (row.cells["data inicio"] ?? "").trim();
    const fim = (row.cells["data fim"] ?? "").trim();
    const duracao = (row.cells["dias"] ?? "").trim();
    const obs = (row.cells["obs"] ?? "").trim();
    const cid = (row.cells["cid"] ?? "").trim();

    if (!motivo && !inicio && !fim) continue;
    if (ehSeparador(motivo) && !parseData(inicio)) continue;

    const fingerprint = chave([motivo, inicio, fim, duracao, obs, cid].join("|"));
    if (vistos.has(fingerprint)) {
      duplicates += 1;
      continue;
    }
    vistos.add(fingerprint);

    const erro = (message: string, blocking = false) =>
      problems.push({ employee, line: row.line, section: "afastamento", message, blocking });
    const aviso = (message: string) =>
      problems.push({ employee, line: row.line, section: "afastamento", message, warning: true });

    const type = classificar(motivo);
    if (!type) {
      erro(`motivo sem classificação: "${rotuloSemDetalhe(motivo) || "(vazio)"}"`, true);
      continue;
    }
    const start = parseData(inicio);
    if (!start) {
      erro("data de início inválida");
      continue;
    }
    let end = fim ? parseData(fim) : null;
    if (fim && !end) {
      erro("data de fim inválida");
      continue;
    }
    if (end && end < start) {
      erro("data de fim antes do início");
      continue;
    }
    const spanDays = end ? diasEntre(start, end) : 1;
    const parsed = parseDuracao(duracao, spanDays);
    if ("error" in parsed) {
      erro(parsed.error);
      continue;
    }
    if (!end) end = parsed.days > 1 ? somarDias(start, parsed.days - 1) : start;

    const health = HEALTH_TYPES.has(type);
    const { codes, invalid } = normalizarCid(cid);
    const notasPublicas = [parsed.note, health ? null : obs || null].filter(Boolean);
    const reason = [health ? PUBLIC_LABEL[type] : motivo, ...notasPublicas].join(" · ");

    const notaClinica = [health && obs ? obs : null, invalid.length ? `CID não padronizado: ${invalid.join(", ")}` : null]
      .filter(Boolean)
      .join(" · ");
    const clinical =
      health || codes.length || invalid.length
        ? { cidCodes: codes, diagnosis: health ? motivo : null, note: notaClinica || null }
        : null;
    if (invalid.length) aviso("CID fora do padrão: guardado na observação clínica");

    absences.push({
      line: row.line,
      type,
      start,
      end,
      days: parsed.days,
      hours: parsed.hours,
      dayPart: parsed.dayPart,
      reason,
      clinical,
      fingerprint,
    });
  }
  return { absences, duplicates };
}

// --- Arquivo -----------------------------------------------------------------

export function parseHistorico(markdown: string): ParseResult {
  const lines = markdown.split(/\r?\n/);
  const employees: EmployeeHistory[] = [];
  const problems: ParseResult["problems"] = [];

  let atual: { name: string; tab: string | null; line: number; sections: Record<string, { text: string; line: number }[]> } | null = null;
  let secao: string | null = null;
  const fechar = () => {
    if (!atual) return;
    const ferias = lerFerias(linhasDaTabela(atual.sections.ferias ?? []), atual.name, problems);
    const afast = lerAfastamentos(linhasDaTabela(atual.sections.afastamento ?? []), atual.name, problems);
    employees.push({
      name: atual.name,
      tab: atual.tab,
      line: atual.line,
      vacations: ferias.vacations,
      absences: afast.absences,
      duplicates: ferias.duplicates + afast.duplicates,
    });
  };

  lines.forEach((text, index) => {
    const line = index + 1;
    const titulo = text.match(/^## (.+)$/);
    if (titulo) {
      fechar();
      atual = { name: titulo[1].trim(), tab: null, line, sections: {} };
      secao = null;
      return;
    }
    if (!atual) return;
    const aba = text.match(/^Aba: `(.+)`/);
    if (aba) atual.tab = aba[1];
    const sub = text.match(/^### (.+)$/);
    if (sub) {
      const nome = chave(sub[1]);
      secao = nome.includes("ferias") ? "ferias" : nome.includes("afastamento") ? "afastamento" : null;
      return;
    }
    if (secao) (atual.sections[secao] ??= []).push({ text: text.trim(), line });
  });
  fechar();
  return { employees, problems };
}
