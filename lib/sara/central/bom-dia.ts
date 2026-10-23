import { semPensar } from "../base.ts";
import { conferirNumeros } from "./verificador.ts";

/**
 * Bom dia da SARA (E7, J2 — docs/PLANO-MINDMASTER.md). Às 7h, de segunda a sábado, cada pessoa com a SARA
 * liberada recebe um resumo do que importa HOJE para ela: os avisos dos módulos que ela usa, as decisões e
 * as ações esperando por ela e o que as guias dela fizeram. Tudo é colhido com a sessão dela (só o que ela
 * já vê). O texto é escrito pelo Haiku SÓ com esses fatos; se algum número não bater com eles (o mesmo
 * verificador da central), vale o texto montado pela plataforma. Aqui ficam as regras puras (sem banco),
 * testadas em tests/sara-bom-dia.test.mjs; a execução fica em bom-dia-executar.ts.
 */

/** Quando sai (fuso de São Paulo). Depois de `ate`, o dia que não saiu não sai mais (ninguém quer bom dia à tarde). */
export const BOM_DIA = { dias: [1, 2, 3, 4, 5, 6], hora: "07:00", ate: "11:00", maxItens: 12, modelo: "claude-haiku-5-5" } as const;

export type ItemBomDia = {
  tipo: "aviso" | "decisao" | "acao" | "guia" | "novidade";
  nivel: "urgente" | "aviso";
  modulo: string;
  area: string;
  titulo: string;
  detalhe?: string;
};

/** O Brasil não tem horário de verão desde 2019: São Paulo é sempre UTC−3. */
const SP_MS = 3 * 3600_000;
const minutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** O dia do Bom dia (AAAA-MM-DD em São Paulo) se agora está na janela dele; senão, null. */
export function janelaDoBomDia(agora: Date = new Date(), regra: { dias: readonly number[]; hora: string; ate: string } = BOM_DIA): { dia: string; semana: number } | null {
  const sp = new Date(agora.getTime() - SP_MS);
  const semana = sp.getUTCDay();
  const m = sp.getUTCHours() * 60 + sp.getUTCMinutes();
  if (!regra.dias.includes(semana) || m < minutos(regra.hora) || m >= minutos(regra.ate)) return null;
  return { dia: sp.toISOString().slice(0, 10), semana };
}

const PESO: Record<ItemBomDia["tipo"], number> = { aviso: 1, decisao: 0, acao: 0, guia: 2, novidade: 3 };

/** Urgentes primeiro; depois o que espera a pessoa (decisões e ações), guias, avisos e, por último, novidades. */
export function ordenarItens(itens: ItemBomDia[], max: number = BOM_DIA.maxItens): { itens: ItemBomDia[]; restantes: number } {
  const ordem = [...itens].sort((a, b) => (a.nivel === b.nivel ? PESO[a.tipo] - PESO[b.tipo] : a.nivel === "urgente" ? -1 : 1));
  return { itens: ordem.slice(0, max), restantes: Math.max(0, ordem.length - max) };
}

/** Onde o Bom dia fica (a conversa de qual SARA o sino abre): a área com mais urgentes; no empate, com mais itens; depois, a primeira da pessoa. */
export function moduloDoBomDia(itens: ItemBomDia[], areas: string[]): string | null {
  if (!areas.length) return null;
  const conta = (m: string, urgente: boolean) => itens.filter((i) => i.modulo === m && (!urgente || i.nivel === "urgente")).length;
  return [...areas].sort((a, b) => conta(b, true) - conta(a, true) || conta(b, false) - conta(a, false) || areas.indexOf(a) - areas.indexOf(b))[0];
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "2 urgentes · 1 decisão para você · 3 avisos": o corpo do aviso no sino. */
export function resumoDoBomDia(itens: ItemBomDia[]): string {
  const urgente = (i: ItemBomDia) => i.nivel === "urgente";
  const urg = itens.filter(urgente).length;
  const dec = itens.filter((i) => !urgente(i) && i.tipo === "decisao").length;
  const ac = itens.filter((i) => !urgente(i) && i.tipo === "acao").length;
  const resto = itens.length - urg - dec - ac;
  return [urg && plural(urg, "urgente", "urgentes"), dec && plural(dec, "decisão para você", "decisões para você"), ac && plural(ac, "ação esperando o Permitir", "ações esperando o Permitir"),
    resto > 0 && plural(resto, "aviso", "avisos")].filter(Boolean).join(" · ");
}

/** O texto que a plataforma monta sozinha (sem modelo): vale quando o modelo falha ou erra um número. */
export function textoDaPlataforma(a: { nome: string; data: string; semana: string; itens: ItemBomDia[]; restantes: number }): string {
  const ola = `Bom dia${a.nome ? `, ${a.nome}` : ""}! Hoje é ${a.semana}, ${a.data}.`;
  const urg = a.itens.filter((i) => i.nivel === "urgente");
  const linha = (i: ItemBomDia) => `- **${i.area}:** ${i.titulo}${i.detalhe ? `. ${i.detalhe}` : ""}`;
  const partes = [ola];
  if (urg.length) partes.push(`**Para tratar primeiro:**\n${urg.map(linha).join("\n")}`);
  const outros = a.itens.filter((i) => i.nivel !== "urgente");
  if (outros.length) partes.push(`${urg.length ? "**Também hoje:**" : "**Para hoje:**"}\n${outros.map(linha).join("\n")}`);
  if (a.restantes) partes.push(`E mais ${plural(a.restantes, "item", "itens")} nos avisos da SARA de cada módulo.`);
  partes.push("Se quiser, pergunte aqui sobre qualquer um deles.");
  return partes.join("\n\n");
}

export const REGRA_BOM_DIA = `Você escreve o "Bom dia" da SARA para uma pessoa da empresa: o resumo do que importa HOJE para ela.
- Use SÓ os fatos da lista. Não invente número, nome, valor, prazo nem situação; não some nem arredonde valores.
- Comece com "Bom dia, <nome>!" e o dia. Depois, em tópicos curtos: primeiro o urgente, depois o que espera por ela (decisões, ações para permitir), depois o resto.
- Cada tópico começa com a área em negrito. No máximo 12 tópicos e 170 palavras no total.
- Se houver algo urgente, diga em uma frase por onde começar (o mais importante), sem dar ordem a ninguém: a decisão é da pessoa.
- Termine com: "Se quiser, pergunte aqui sobre qualquer um deles."
- Português do Brasil, tom de colega prestativa. Sem cumprimentar duas vezes e sem emojis.`;

export type Escrito = { texto: string; modelo: string; tokensEntrada: number; tokensSaida: number; daPlataforma: boolean; semFonte: string[] };

/**
 * O texto do Bom dia: o Haiku escreve com os fatos; o verificador confere cada número com eles. Falhou,
 * demorou ou errou um número: vale o texto da plataforma (o Bom dia sai igual, só menos fluido).
 */
export async function escreverBomDia(a: { chave: string; buscar?: typeof fetch; nome: string; data: string; semana: string; itens: ItemBomDia[]; restantes: number }): Promise<Escrito> {
  const reserva = (semFonte: string[] = [], tokensEntrada = 0, tokensSaida = 0): Escrito => ({ texto: textoDaPlataforma(a), modelo: "plataforma", tokensEntrada, tokensSaida, daPlataforma: true, semFonte });
  if (!a.chave) return reserva();
  const fatos = a.itens.map((i, k) => `${k + 1}. [${i.nivel === "urgente" ? "URGENTE" : i.tipo === "decisao" ? "DECISÃO" : i.tipo === "acao" ? "AÇÃO PARA PERMITIR" : i.tipo === "guia" ? "GUIA" : i.tipo === "novidade" ? "NOVIDADE" : "AVISO"}] ${i.area}: ${i.titulo}${i.detalhe ? `. ${i.detalhe}` : ""}`).join("\n");
  try {
    const r = await (a.buscar ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", "x-api-key": a.chave, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: BOM_DIA.modelo, max_tokens: 700, thinking: semPensar(BOM_DIA.modelo), system: REGRA_BOM_DIA,
        messages: [{ role: "user", content: `Pessoa: ${a.nome || "(sem nome)"}\nHoje: ${a.semana}, ${a.data}\n${a.restantes ? `Há mais ${a.restantes} itens menos importantes fora da lista (diga só que existem).\n` : ""}Fatos:\n${fatos}` }],
      }),
    });
    const j = await r.json().catch(() => null) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null;
    const texto = (j?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    const ent = Number(j?.usage?.input_tokens ?? 0), sai = Number(j?.usage?.output_tokens ?? 0);
    if (!r.ok || texto.length < 20) return reserva([], ent, sai);
    // Todo número do texto tem de estar nos fatos (o dia de hoje conta como fato).
    const c = conferirNumeros(texto, [fatos, `${a.data} ${a.restantes}`]);
    if (c.semFonte.length) return reserva(c.semFonte, ent, sai);
    return { texto, modelo: BOM_DIA.modelo, tokensEntrada: ent, tokensSaida: sai, daPlataforma: false, semFonte: [] };
  } catch { return reserva(); }
}
