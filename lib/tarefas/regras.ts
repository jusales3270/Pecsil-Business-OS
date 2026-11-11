import { acharPessoa } from "../sara/documentos/documento.ts";

/**
 * Regras das tarefas (I-28, PLANO-SARA-FERRAMENTAS etapa 3), sem banco: testadas em tests/tarefas.test.mjs.
 * O modelo lê a reunião e propõe os itens com o responsável e o prazo como foram falados; a plataforma confere:
 * o nome vira uma pessoa ativa (ou fica para completar) e o prazo falado vira data.
 */

/** As áreas de uma tarefa (o módulo de quem responde por ela). */
export const AREAS_DAS_TAREFAS = ["financeiro", "compras", "almoxarifado", "fundicao", "comercial", "fiscal", "rh", "portaria", "producao", "ti", "qualidade"];

export type Situacao = "aberta" | "em_andamento" | "feita" | "devolvida" | "cancelada";
export const SITUACOES: Record<Situacao, string> = { aberta: "Aberta", em_andamento: "Em andamento", feita: "Feita", devolvida: "Devolvida", cancelada: "Cancelada" };

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dia = (hoje: string, n: number) => { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const valida = (a: number, m: number, d: number) => { const x = new Date(Date.UTC(a, m - 1, d, 12)); return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? iso(x) : null; };

/**
 * O prazo falado em data (AAAA-MM-DD), a partir de hoje (AAAA-MM-DD, Brasília). Null quando não dá para saber.
 * Entende: hoje, amanhã, depois de amanhã, o dia da semana (o próximo; "que vem" pula uma semana), "dia 20"
 * (este mês, ou o próximo se já passou), 20/11, 20/11/2026, 20 de novembro, AAAA-MM-DD, "em 3 dias",
 * "daqui a 2 semanas", "semana que vem" (a segunda-feira seguinte), "fim do mês" e "fim do dia" (hoje). Aceita
 * "pra"/"para" na frente e complemento atrás ("amanhã cedo", "sexta de manhã", "dia 20 sem falta").
 */
export function prazoDoTexto(texto: string | null | undefined, hoje: string): string | null {
  const t = sem(String(texto ?? "")).replace(/[,.!]+$/, "").replace(/^(?:para|pra) (?:o |a )?/, "ate ").replace(/ ?-feira\b/, "");
  if (!t) return null;
  const direto = prazoExato(t, hoje);
  if (direto) return direto;
  // Complemento depois do dia ("amanhã cedo", "sexta de manhã", "dia 20 sem falta"): tira até 3 palavras do fim.
  const palavras = t.split(" ");
  for (let n = 1; n <= 3 && palavras.length - n >= 1; n++) {
    const r = prazoExato(palavras.slice(0, -n).join(" "), hoje);
    if (r) return r;
  }
  return null;
}

function prazoExato(t: string, hoje: string): string | null {
  const [a, m, d] = hoje.split("-").map(Number);
  let x: RegExpExecArray | null;
  if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return valida(+x[1], +x[2], +x[3]);
  if (/^(ate )?hoje$/.test(t) || /^(?:ate )?(?:o )?fim do dia$/.test(t)) return hoje;
  if (/^(ate )?depois de amanha$/.test(t)) return dia(hoje, 2);
  if (/^(ate )?amanha$/.test(t)) return dia(hoje, 1);
  if ((x = /^(?:ate )?(?:o )?(?:dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t))) {
    const ano = x[3] ? (x[3].length === 2 ? 2000 + +x[3] : +x[3]) : a;
    const r = valida(ano, +x[2], +x[1]);
    return r && !x[3] && r < hoje ? valida(ano + 1, +x[2], +x[1]) : r;
  }
  if ((x = /^(?:ate )?(?:o )?(?:dia )?(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/.exec(t)) && MESES.includes(x[2])) {
    const mes = MESES.indexOf(x[2]) + 1, ano = x[3] ? +x[3] : a;
    const r = valida(ano, mes, +x[1]);
    return r && !x[3] && r < hoje ? valida(ano + 1, mes, +x[1]) : r;
  }
  if ((x = /^(?:ate )?(?:o )?dia (\d{1,2})$/.exec(t))) {
    const r = valida(a, m, +x[1]);
    if (r && r >= hoje) return r;
    return m === 12 ? valida(a + 1, 1, +x[1]) : valida(a, m + 1, +x[1]);
  }
  if ((x = /^(?:em|daqui a|dentro de) (\d{1,3}) (dia|dias|semana|semanas)$/.exec(t))) return dia(hoje, +x[1] * (x[2].startsWith("semana") ? 7 : 1));
  if (/^(?:ate )?(?:o )?fim do mes$/.test(t)) return iso(new Date(Date.UTC(a, m, 0, 12)));
  if (/^(?:na |ate a )?(?:proxima semana|semana que vem)$/.test(t)) { const hojeDia = new Date(`${hoje}T12:00:00Z`).getUTCDay(); return dia(hoje, ((8 - hojeDia) % 7) || 7); }
  if ((x = /^(?:ate |na |no )?(?:a |o )?(?:proxima |proximo )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira| feira)?( que vem| da semana que vem)?$/.exec(t))) {
    const alvo = SEMANA.indexOf(x[1]), hojeDia = new Date(`${hoje}T12:00:00Z`).getUTCDay();
    const n = ((alvo - hojeDia + 7) % 7) || 7;
    return dia(hoje, n + (x[2] ? 7 : 0));
  }
  return null;
}

export type Pessoa = { id: string; nome: string };
export type ItemProposto = { tarefa?: unknown; detalhe?: unknown; responsavel?: unknown; prazo?: unknown; area?: unknown };
export type ItemConferido = {
  titulo: string; detalhe: string | null;
  responsavel: Pessoa | null; responsavelFalado: string | null;
  prazo: string | null; prazoFalado: string | null;
  modulo: string | null;
  /** O que falta completar ou conferir (aparece no cartão). */
  avisos: string[];
};

const texto = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Confere os itens que o modelo leu da reunião. Responsável: a pessoa ativa com aquele nome; sem nome, quem
 * responde pela área (se for uma só); sem achar, fica para completar. Prazo: a data falada; sem data, fica para
 * completar. Nada é inventado: o que não dá para saber vira aviso.
 */
export function conferirItens(bruto: unknown, a: { pessoas: Pessoa[]; responsaveisDaArea: Record<string, Pessoa[]>; areas: string[]; hoje: string }): ItemConferido[] {
  const itens = (Array.isArray(bruto) ? bruto : []).slice(0, 40) as ItemProposto[];
  return itens.map((i) => {
    const titulo = texto(i.tarefa, 200);
    const modulo = a.areas.includes(texto(i.area, 30)) ? texto(i.area, 30) : null;
    const responsavelFalado = texto(i.responsavel, 80) || null;
    const prazoFalado = texto(i.prazo, 60) || null;
    const avisos: string[] = [];
    let responsavel: Pessoa | null = null;
    if (responsavelFalado) {
      const achou = acharPessoa(responsavelFalado, a.pessoas);
      if ("pessoa" in achou) responsavel = achou.pessoa;
      else avisos.push(`Não achei "${responsavelFalado}" entre as pessoas ativas: escolha o responsável.`);
    } else if (modulo && a.responsaveisDaArea[modulo]?.length === 1) {
      responsavel = a.responsaveisDaArea[modulo][0];
      avisos.push(`Responsável sugerido: quem responde pela área (${responsavel.nome}).`);
    } else avisos.push("Sem responsável: escolha quem faz.");
    const prazo = prazoDoTexto(prazoFalado, a.hoje);
    if (prazoFalado && !prazo) avisos.push(`Não entendi o prazo "${prazoFalado}": escolha a data.`);
    else if (!prazoFalado) avisos.push("Sem prazo: escolha a data.");
    else if (prazo && prazo < a.hoje) avisos.push("O prazo já passou: confira a data.");
    return { titulo, detalhe: texto(i.detalhe, 600) || null, responsavel, responsavelFalado, prazo, prazoFalado, modulo, avisos };
  }).filter((i) => i.titulo.length >= 3);
}

/** dd/mm (ou dd/mm/aaaa quando for de outro ano). */
export function dataCurta(isoData: string | null, hoje: string): string {
  if (!isoData) return "sem prazo";
  const [a, m, d] = isoData.split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/** A linha do item no cartão do Permitir: "Ligar para a Cristal · Ana · até 14/11 (sexta)". */
export function linhaDoItem(i: ItemConferido, hoje: string): string {
  return `${i.titulo} · ${i.responsavel?.nome ?? "sem responsável"} · ${i.prazo ? `até ${dataCurta(i.prazo, hoje)}` : "sem prazo"}${i.avisos.length ? ` (${i.avisos.join(" ")})` : ""}`;
}

/** Cobrança: lembrete na véspera (e no próprio dia, se criada em cima da hora) e cobrança da vencida a cada 2 dias, até 3 vezes. */
export const COBRANCA = { cadaDias: 2, maxCobrancas: 3 } as const;
export type TarefaCobravel = { prazo: string | null; situacao: string; lembrete_em: string | null; cobrancas: number; cobrado_em: string | null; responsavel_id: string | null };

export function oQueAvisar(t: TarefaCobravel, hoje: string, agora: Date = new Date()): "lembrete" | "cobranca" | null {
  if (!t.prazo || !t.responsavel_id || (t.situacao !== "aberta" && t.situacao !== "em_andamento")) return null;
  if (t.prazo >= hoje && t.prazo <= dia(hoje, 1) && !t.lembrete_em) return "lembrete";
  if (t.prazo < hoje && t.cobrancas < COBRANCA.maxCobrancas
    && (!t.cobrado_em || agora.getTime() - Date.parse(t.cobrado_em) >= COBRANCA.cadaDias * 86_400_000 - 3_600_000)) return "cobranca";
  return null;
}
