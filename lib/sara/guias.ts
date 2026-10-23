import type { Ferramenta } from "./base.ts";
import type { Passo } from "./habilidades.ts";

/**
 * Guias da SARA (E3, 22/10/2026 — degrau 4): rotinas que a própria área escreve em português na
 * conversa. A SARA transforma em passos (consultas e ações) e a guia vai para aprovação de quem responde
 * pela área. Roda por atalho, por agenda (dias e hora, fuso de São Paulo) ou por evento da plataforma,
 * sempre COMO a pessoa que a criou (a sessão é dela). Ação dentro de guia pede "Permitir", a menos que a
 * área deixe pré-autorizada com limite. Aqui ficam as regras puras (sem banco), testadas em
 * tests/sara-guias.test.mjs; a execução fica em guias-executar.ts.
 */

export type Agenda = { tipo: "agenda"; dias: number[]; hora: string };
export type Gatilho = { tipo: "atalho" } | Agenda | { tipo: "evento"; evento: string };
/** O que a área deixou a SARA fazer sozinha numa guia (por ferramenta de ação). */
export type Limite = { sozinha?: boolean; max_por_dia?: number; max_itens?: number; horario?: { de: string; ate: string } };
export type Limites = Record<string, Limite>;
export type GuiaProposta = { nome: string; descricao: string; gatilhos: string[]; passos: Passo[]; formato: string | null; gatilho: Gatilho };

/** 0 = domingo … 6 = sábado (como getUTCDay). */
export const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENTO = /^[a-z_]+(\.[a-z_]+)+$/;
/** O Brasil não tem horário de verão desde 2019: São Paulo é sempre UTC−3. */
const SP_MS = 3 * 3600_000;

/** Próxima vez em que a agenda roda, depois de `agora` (ISO em UTC). */
export function proximaExecucao(agenda: Pick<Agenda, "dias" | "hora">, agora: Date = new Date()): Date | null {
  const dias = [...new Set(agenda.dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (!dias.length || !HORA.test(agenda.hora)) return null;
  const [h, m] = agenda.hora.split(":").map(Number);
  // Relógio de São Paulo como se fosse UTC, para contar dias e horas sem fuso.
  const sp = new Date(agora.getTime() - SP_MS);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + i, h, m));
    if (dias.includes(d.getUTCDay()) && d.getTime() > sp.getTime()) return new Date(d.getTime() + SP_MS);
  }
  return null;
}

/** "toda segunda e quinta às 08:00", "todo dia às 07:30", "quando: Material pedido pela Fundição". */
export function descreverGatilho(g: Gatilho, rotuloEvento?: (tipo: string) => string | undefined): string {
  if (g.tipo === "atalho") return "quando você pedir (atalho na SARA)";
  if (g.tipo === "evento") return `quando acontecer: ${rotuloEvento?.(g.evento) ?? g.evento}`;
  const dias = [...new Set(g.dias)].sort((a, b) => a - b);
  const quando = dias.length === 7 ? "todo dia" : dias.length === 5 && [1, 2, 3, 4, 5].every((d) => dias.includes(d)) ? "de segunda a sexta"
    : `toda ${dias.map((d) => DIAS[d]).join(", ").replace(/, ([^,]*)$/, " e $1")}`.replace("toda sábado", "todo sábado").replace("toda domingo", "todo domingo");
  return `${quando} às ${g.hora}`;
}

/** Minutos do dia em São Paulo ("08:30" → 510). */
const minutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/**
 * A ação pode ser feita sozinha? Só se a área marcou "sozinha" para a ferramenta e a entrada cabe nos
 * limites (itens, vezes no dia, horário). Sem limite: pede Permitir.
 */
export function dentroDoLimite(limite: Limite | undefined, entrada: Record<string, unknown>, feitasHoje: number, agora: Date = new Date()): { sozinha: boolean; motivo: string } {
  if (!limite?.sozinha) return { sozinha: false, motivo: "a área não deixou esta ação ser feita sozinha" };
  if (limite.max_por_dia != null && feitasHoje >= limite.max_por_dia) return { sozinha: false, motivo: `já foram ${feitasHoje} hoje (limite ${limite.max_por_dia})` };
  const itens = Array.isArray(entrada.itens) ? entrada.itens.length : null;
  if (limite.max_itens != null && itens != null && itens > limite.max_itens) return { sozinha: false, motivo: `${itens} itens (limite ${limite.max_itens})` };
  if (limite.horario && HORA.test(limite.horario.de) && HORA.test(limite.horario.ate)) {
    const sp = new Date(agora.getTime() - SP_MS);
    const agoraMin = sp.getUTCHours() * 60 + sp.getUTCMinutes();
    if (agoraMin < minutos(limite.horario.de) || agoraMin > minutos(limite.horario.ate)) return { sozinha: false, motivo: `fora do horário (${limite.horario.de} a ${limite.horario.ate})` };
  }
  return { sozinha: true, motivo: "dentro do limite aprovado pela área" };
}

/** Limites como a área definiu na tela: só ferramentas de ação conhecidas, números inteiros positivos. */
export function limparLimites(bruto: unknown, acoes: string[]): Limites {
  const saida: Limites = {};
  for (const [k, v] of Object.entries((bruto ?? {}) as Record<string, Limite>)) {
    if (!acoes.includes(k) || !v || typeof v !== "object") continue;
    const n = (x: unknown) => (Number.isInteger(Number(x)) && Number(x) > 0 && Number(x) <= 100 ? Number(x) : undefined);
    const horario = v.horario && HORA.test(String(v.horario.de)) && HORA.test(String(v.horario.ate)) && v.horario.de < v.horario.ate ? { de: v.horario.de, ate: v.horario.ate } : undefined;
    saida[k] = { sozinha: v.sozinha === true, ...(n(v.max_por_dia) ? { max_por_dia: n(v.max_por_dia) } : {}), ...(n(v.max_itens) ? { max_itens: n(v.max_itens) } : {}), ...(horario ? { horario } : {}) };
  }
  return saida;
}

/** Fica só o que é válido: passos com ferramentas que a pessoa tem (consultas ou ações), gatilho conhecido. */
export function validarGuia(p: unknown, permitidas: string[], eventos: string[]): GuiaProposta | { erro: string } {
  const x = (p ?? {}) as Record<string, unknown>;
  const nome = String(x.nome ?? "").trim().slice(0, 80), descricao = String(x.descricao ?? "").trim().slice(0, 600);
  if (nome.length < 3 || descricao.length < 3) return { erro: "A guia precisa de nome e descrição." };
  const passos = (Array.isArray(x.passos) ? x.passos : []).filter((s): s is Passo => Boolean(s) && permitidas.includes(String((s as Passo).ferramenta)))
    .slice(0, 8).map((s) => ({ ferramenta: s.ferramenta, para_que: String(s.para_que ?? "").slice(0, 200), ...(s.entrada && typeof s.entrada === "object" ? { entrada: s.entrada } : {}) }));
  if (!passos.length) return { erro: "A guia precisa de ao menos um passo com as suas consultas ou ações." };
  const q = (x.quando ?? {}) as Record<string, unknown>;
  let gatilho: Gatilho;
  if (q.tipo === "agenda") {
    const dias = (Array.isArray(q.dias) ? q.dias : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const hora = String(q.hora ?? "");
    if (!dias.length || !HORA.test(hora)) return { erro: "Diga os dias da semana e a hora (HH:MM) em que a guia roda." };
    gatilho = { tipo: "agenda", dias: [...new Set(dias)].sort((a, b) => a - b), hora };
  } else if (q.tipo === "evento") {
    const evento = String(q.evento ?? "");
    if (!EVENTO.test(evento) || !eventos.includes(evento)) return { erro: "Esse acontecimento não está na lista de eventos que você pode acompanhar." };
    gatilho = { tipo: "evento", evento };
  } else gatilho = { tipo: "atalho" };
  const gatilhos = (Array.isArray(x.gatilhos) ? x.gatilhos : []).map((g) => String(g).trim().slice(0, 160)).filter((g) => g.length >= 3).slice(0, 3);
  return { nome, descricao, gatilhos: gatilhos.length ? gatilhos : [nome], passos, formato: x.formato ? String(x.formato).slice(0, 600) : null, gatilho };
}

/**
 * Ferramenta da SARA para criar uma guia a partir do que a pessoa pediu. Não grava nada: a rota registra a
 * proposta, que vai para aprovação de quem responde pela área. Os eventos são os que a pessoa pode acompanhar.
 */
export function ferramentaCriarGuia(eventos: { tipo: string; rotulo: string }[]): Ferramenta {
  return {
    nome: "criar_guia", rotulo: "criou uma guia", exige: [],
    descricao: `Cria uma GUIA: uma rotina que roda sozinha, quando a pessoa pedir algo como "toda segunda às 8h, me mostre…", "todo dia de manhã, confira…", "sempre que o Compras aprovar um pedido, me avise…", "quando chegar nota, faça…". Antes, confirme com a pessoa o que falta (dias e hora, ou qual acontecimento). Passos: as SUAS consultas e ações, em ordem (ação dentro da guia prepara o cartão Permitir/Não permitir, salvo se a área autorizar). A guia vai para aprovação de quem responde pela área: diga isso à pessoa. Dias: 0 = domingo, 1 = segunda … 6 = sábado. Eventos que ela pode acompanhar: ${eventos.map((e) => `${e.tipo} (${e.rotulo})`).join("; ") || "nenhum"}.`,
    esquema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome curto (ex.: \"Vencimentos da semana\")." },
        descricao: { type: "string", description: "O que a guia faz, em uma frase." },
        quando: {
          type: "object", description: "Quando a guia roda.",
          properties: {
            tipo: { type: "string", enum: ["agenda", "evento", "atalho"] },
            dias: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "Agenda: dias da semana." },
            hora: { type: "string", description: "Agenda: HH:MM (horário de Brasília)." },
            evento: { type: "string", description: "Evento: o tipo exato da lista." },
          },
          required: ["tipo"],
        },
        passos: {
          type: "array", description: "Consultas e ações, em ordem.",
          items: { type: "object", properties: { ferramenta: { type: "string" }, para_que: { type: "string" }, entrada: { type: "object" } }, required: ["ferramenta", "para_que"] },
        },
        formato: { type: "string", description: "Como entregar o resultado (ex.: \"tabela por fornecedor com total\")." },
        gatilhos: { type: "array", items: { type: "string" }, description: "1 a 3 jeitos de a pessoa pedir isso na conversa." },
      },
      required: ["nome", "descricao", "quando", "passos"],
    },
    rodar: async (_sb, e) => ({ dados: { guia: String(e.nome ?? "").slice(0, 80), situacao: "enviada para aprovação de quem responde pela área" }, fontes: [] }),
  };
}

const DISPARO: Record<string, string> = { agenda: "pela agenda", evento: "por um acontecimento", manual: "porque você pediu (Rodar agora)" };

/** Resultado da execução anterior, que vai junto para a SARA comparar (até 6 mil caracteres). */
export type Anterior = { quando: string; texto: string };
const MAX_ANTERIOR = 6000;

/**
 * O pedido que a plataforma faz à SARA quando a guia roda sozinha (ninguém está conversando). A SARA não
 * lembra de nada entre uma chamada e outra: a memória é da plataforma, que manda junto o resultado da
 * execução anterior para ela dizer o que mudou.
 */
export function pedidoDaGuia(g: { nome: string; descricao: string; passos: Passo[]; formato: string | null }, disparo: string,
  evento?: { resumo?: string; tipo?: string; quem?: string; quando?: string } | null, anterior?: Anterior | null): string {
  const quandoAnterior = anterior ? new Date(anterior.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return [
    `Rode a guia «${g.nome}» (${DISPARO[disparo] ?? disparo}): ${g.descricao}`,
    evento?.resumo ? `Acontecimento que disparou: ${evento.resumo}${evento.quem ? ` (por ${evento.quem})` : ""}.` : "",
    `Passos: ${g.passos.map((p, i) => `${i + 1}) ${p.ferramenta}${p.entrada ? ` ${JSON.stringify(p.entrada)}` : ""} — ${p.para_que}`).join("; ")}.`,
    g.formato ? `Entregue: ${g.formato}.` : "",
    anterior
      ? `Resultado da execução anterior desta guia (${quandoAnterior}), só para comparar — os números de hoje vêm das consultas de agora:\n"""\n${anterior.texto.slice(0, MAX_ANTERIOR)}\n"""\nComece dizendo o que MUDOU desde ${quandoAnterior}: o que é novo, o que saiu ou foi resolvido e o que mudou de situação ou de valor. Se nada mudou, diga isso em uma frase. Depois, o resultado de hoje.`
      : "É a primeira execução desta guia: não há o que comparar.",
  ].filter(Boolean).join("\n");
}

/** Instrução do momento para a SARA quando a guia roda sem ninguém na conversa. */
export const REGRA_GUIA_SOZINHA = "Você está rodando uma GUIA sozinha: ninguém está conversando agora e ninguém vai responder. Não faça perguntas. Faça as consultas dos passos e prepare as ações dos passos (elas aparecem como cartão para a pessoa permitir depois, ou são feitas sozinhas se a área autorizou). Se faltar um dado para uma ação, não prepare a ação: diga o que faltou. Comece direto pelo resultado (sem cumprimento) e termine em uma frase com o que espera da pessoa, se houver.";
