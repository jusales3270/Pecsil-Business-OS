import type { Ferramenta } from "./base.ts";
import { agoraSP } from "./tempo.ts";

/**
 * Datas por extenso → período exato (E5, 22/10/2026): "quarta-feira de cinzas do ano passado",
 * "mês retrasado", "segunda passada", "últimos 15 dias", "março de 2025". Regra fixa (sem modelo):
 * a SARA chama a ferramenta e usa o período devolvido, em vez de fazer a conta de cabeça.
 * Semana = segunda a domingo. Feriados nacionais; os móveis saem da Páscoa.
 */

export type Periodo = { de: string; ate: string; descricao: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dia = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d, 12));
const somar = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const br = (s: string) => s.split("-").reverse().join("/");
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0, 12)).getUTCDate();
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Domingo de Páscoa (algoritmo gregoriano anônimo). */
export function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), d2 = ((h + l - 7 * m + 114) % 31) + 1;
  return dia(ano, mes, d2);
}

/** Feriados nacionais (e o Carnaval, ponto facultativo) de um ano: nome normalizado → [de, até]. */
function feriados(ano: number): [RegExp, string, Date, Date][] {
  const p = pascoa(ano);
  return [
    [/\bquarta( feira)? de cinzas\b|\bcinzas\b/, "quarta-feira de cinzas", somar(p, -46), somar(p, -46)],
    [/\bcarnaval\b/, "Carnaval (segunda e terça)", somar(p, -48), somar(p, -47)],
    [/\bsexta( feira)? santa\b|\bpaixao\b/, "Sexta-feira Santa", somar(p, -2), somar(p, -2)],
    [/\bpascoa\b/, "Páscoa", p, p],
    [/\bcorpus christi\b/, "Corpus Christi", somar(p, 60), somar(p, 60)],
    [/\bconfraternizacao\b|\bano novo\b|\bprimeiro do ano\b/, "Confraternização Universal", dia(ano, 1, 1), dia(ano, 1, 1)],
    [/\btiradentes\b/, "Tiradentes", dia(ano, 4, 21), dia(ano, 4, 21)],
    [/\bdia do trabalho\b|\bdia do trabalhador\b|\bprimeiro de maio\b/, "Dia do Trabalho", dia(ano, 5, 1), dia(ano, 5, 1)],
    [/\bindependencia\b|\bsete de setembro\b/, "Independência", dia(ano, 9, 7), dia(ano, 9, 7)],
    [/\baparecida\b|\bdia das criancas\b|\bdoze de outubro\b/, "Nossa Senhora Aparecida", dia(ano, 10, 12), dia(ano, 10, 12)],
    [/\bfinados\b/, "Finados", dia(ano, 11, 2), dia(ano, 11, 2)],
    [/\bproclamacao\b|\brepublica\b/, "Proclamação da República", dia(ano, 11, 15), dia(ano, 11, 15)],
    [/\bconsciencia negra\b|\bzumbi\b/, "Dia da Consciência Negra", dia(ano, 11, 20), dia(ano, 11, 20)],
    [/\bvespera de natal\b/, "véspera de Natal", dia(ano, 12, 24), dia(ano, 12, 24)],
    [/\bnatal\b/, "Natal", dia(ano, 12, 25), dia(ano, 12, 25)],
  ];
}

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

/** Ano pedido na frase: "do ano passado", "retrasado", "de 2025", "deste ano"; sem nada, o deste ano. */
function anoDa(t: string, atual: number): { ano: number; explicito: boolean } {
  const n = /\b(19|20)\d{2}\b/.exec(t);
  if (n) return { ano: Number(n[0]), explicito: true };
  if (/\bano retrasado\b|\bha dois anos\b/.test(t)) return { ano: atual - 2, explicito: true };
  if (/\bano passado\b|\bultimo ano\b/.test(t)) return { ano: atual - 1, explicito: true };
  return { ano: atual, explicito: /\b(deste|este|desse|neste) ano\b/.test(t) };
}

export function resolverPeriodo(expressao: string, hojeIso: string = agoraSP().dia): Periodo | { erro: string } {
  const t = normal(expressao);
  if (!t) return { erro: "Diga a data ou o período." };
  const hoje = new Date(`${hojeIso}T12:00:00Z`);
  const a = hoje.getUTCFullYear(), m = hoje.getUTCMonth() + 1;
  const faixa = (de: Date, ate: Date, desc: string): Periodo => ({ de: iso(de), ate: iso(ate), descricao: `${desc}: ${br(iso(de))}${iso(de) === iso(ate) ? "" : ` a ${br(iso(ate))}`}` });
  const segunda = (d: Date) => somar(d, -((d.getUTCDay() + 6) % 7));
  const mesInteiro = (ano: number, mes: number, desc: string) => faixa(dia(ano, mes, 1), dia(ano, mes, ultimoDia(ano, mes)), desc);

  // Feriados (fixos e móveis), com o ano da frase.
  const { ano, explicito } = anoDa(t, a);
  for (const [re, nome, de, ate] of feriados(ano)) {
    if (!re.test(t)) continue;
    // Sem ano na frase e o feriado ainda não chegou: era o do ano passado ("no carnaval" em outubro = o deste ano).
    if (!explicito && iso(de) > hojeIso) { const [, , d1, d2] = feriados(ano - 1).find(([, n]) => n === nome)!; return faixa(d1, d2, `${nome} de ${ano - 1}`); }
    return faixa(de, ate, `${nome} de ${ano}`);
  }
  if (/^hoje\b/.test(t)) return faixa(hoje, hoje, "hoje");
  if (/\banteontem\b/.test(t)) return faixa(somar(hoje, -2), somar(hoje, -2), "anteontem");
  if (/\bontem\b/.test(t)) return faixa(somar(hoje, -1), somar(hoje, -1), "ontem");

  const ultimos = /\b(ultimos|ultimas) (\d{1,3}) (dias|semanas|meses)\b/.exec(t);
  if (ultimos) {
    const n = Number(ultimos[2]);
    const de = ultimos[3] === "dias" ? somar(hoje, -(n - 1)) : ultimos[3] === "semanas" ? somar(hoje, -(7 * n - 1)) : (() => { const d = new Date(hoje); d.setUTCMonth(d.getUTCMonth() - n); return somar(d, 1); })();
    return faixa(de, hoje, `últimos ${n} ${ultimos[3]}`);
  }
  if (/\bsemana retrasada\b/.test(t)) { const s = somar(segunda(hoje), -14); return faixa(s, somar(s, 6), "semana retrasada"); }
  if (/\bsemana passada\b|\bultima semana\b/.test(t)) { const s = somar(segunda(hoje), -7); return faixa(s, somar(s, 6), "semana passada"); }
  if (/\b(esta|essa|nesta) semana\b/.test(t)) return faixa(segunda(hoje), hoje, "esta semana");
  if (/\bmes retrasado\b/.test(t)) { const d = dia(a, m, 1); d.setUTCMonth(d.getUTCMonth() - 2); return mesInteiro(d.getUTCFullYear(), d.getUTCMonth() + 1, "mês retrasado"); }
  if (/\bmes passado\b|\bultimo mes\b/.test(t)) { const d = dia(a, m, 1); d.setUTCMonth(d.getUTCMonth() - 1); return mesInteiro(d.getUTCFullYear(), d.getUTCMonth() + 1, "mês passado"); }
  if (/\b(este|esse|neste) mes\b/.test(t)) return faixa(dia(a, m, 1), hoje, "este mês");
  const tri = Math.floor((m - 1) / 3);
  if (/\btrimestre passado\b|\bultimo trimestre\b/.test(t)) { const ta = tri === 0 ? a - 1 : a, tm = tri === 0 ? 10 : (tri - 1) * 3 + 1; return faixa(dia(ta, tm, 1), dia(ta, tm + 2, ultimoDia(ta, tm + 2)), "trimestre passado"); }
  if (/\b(este|esse|neste) trimestre\b/.test(t)) return faixa(dia(a, tri * 3 + 1, 1), hoje, "este trimestre");

  // Mês por nome: "março", "março do ano passado", "março de 2025" (sem ano e ainda por vir: o do ano passado).
  const mi = MESES.findIndex((nome) => new RegExp(`\\b${nome}\\b`).test(t));
  if (mi >= 0) {
    const mes = mi + 1;
    const anoMes = explicito ? ano : mes > m ? a - 1 : a;
    return mesInteiro(anoMes, mes, `${MESES[mi].replace("marco", "março")} de ${anoMes}`);
  }
  if (/\bano retrasado\b/.test(t)) return faixa(dia(a - 2, 1, 1), dia(a - 2, 12, 31), `ano de ${a - 2}`);
  if (/\bano passado\b|\bultimo ano\b/.test(t)) return faixa(dia(a - 1, 1, 1), dia(a - 1, 12, 31), `ano de ${a - 1}`);
  if (/\b(este|esse|neste) ano\b/.test(t)) return faixa(dia(a, 1, 1), hoje, `este ano (${a})`);

  // Dia da semana: "segunda passada", "última sexta", "sexta-feira" (a mais recente antes de hoje).
  const si = SEMANA.findIndex((nome) => new RegExp(`\\b${nome}\\b`).test(t));
  if (si >= 0) {
    let atras = (hoje.getUTCDay() - si + 7) % 7 || 7;
    if (/\bretrasad/.test(t)) atras += 7;
    const d = somar(hoje, -atras);
    return faixa(d, d, `${SEMANA[si].replace("terca", "terça").replace("sabado", "sábado")}${si >= 1 && si <= 5 ? "-feira" : ""}`);
  }
  // Data já escrita (dd/mm/aaaa).
  const dd = /\b(\d{1,2}) (\d{1,2}) (\d{4})\b/.exec(t);
  if (dd) { const d = dia(Number(dd[3]), Number(dd[2]), Number(dd[1])); return faixa(d, d, "data"); }
  return { erro: `Não reconheci "${expressao}". Use uma data (dd/mm/aaaa) ou um período como "mês passado", "últimos 30 dias", "Carnaval do ano passado".` };
}

/** Ferramenta comum a toda SARA: a data por extenso vira período exato (sem conta de cabeça). */
export const PERIODO: Ferramenta = {
  nome: "periodo", rotulo: "calculou o período", exige: [],
  descricao: "Transforma uma data ou período por extenso em datas exatas (de/até, AAAA-MM-DD): feriados (quarta-feira de cinzas, Carnaval, Páscoa, Corpus Christi, Natal…), 'mês retrasado', 'semana passada', 'segunda passada', 'últimos 15 dias', 'trimestre passado', 'março do ano passado'. Use ANTES de consultar quando a pessoa falar o período por extenso.",
  esquema: { type: "object", properties: { expressao: { type: "string", description: "Como a pessoa falou (ex.: 'quarta-feira de cinzas do ano passado')." } }, required: ["expressao"] },
  rodar: async (_sb, e) => ({ dados: resolverPeriodo(String(e.expressao ?? "")), fontes: [] }),
};
