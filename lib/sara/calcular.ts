import type { Ferramenta } from "./base.ts";

/**
 * Calculadora da SARA: a conta é feita pela plataforma, não "de cabeça" pelo modelo (19/10/2026: o
 * Haiku entendeu "30 dias + 3 por ano × 5 anos" e escreveu 35 em vez de 45). Aceita números, + - * /,
 * ^ (potência), parênteses e vírgula ou ponto decimal. Sem eval: análise própria, só aritmética.
 */
type Token = { t: "num"; v: number } | { t: "op"; v: string } | { t: "(" } | { t: ")" };

function tokens(expr: string): Token[] {
  const s = expr.replace(/\s+/g, "").replace(/(\d)\.(?=\d{3}(\D|$))/g, "$1").replace(/,/g, "."); // 1.000,50 → 1000.50
  const out: Token[] = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    const num = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    if ("+-*/^".includes(c)) {
      // sinal unário: no início, depois de operador ou de "("
      const ant = out[out.length - 1];
      if ((c === "-" || c === "+") && (!ant || ant.t === "op" || ant.t === "(")) { out.push({ t: "num", v: 0 }); }
      out.push({ t: "op", v: c }); i += 1; continue;
    }
    if (c === "(") { out.push({ t: "(" }); i += 1; continue; }
    if (c === ")") { out.push({ t: ")" }); i += 1; continue; }
    throw new Error(`caractere inválido: "${c}"`);
  }
  return out;
}

const PRIOR: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3 };

export function calcularExpressao(expr: string): number {
  if (!expr || expr.length > 300) throw new Error("expressão vazia ou longa demais");
  const saida: Token[] = [], pilha: Token[] = [];
  for (const k of tokens(expr)) {
    if (k.t === "num") saida.push(k);
    else if (k.t === "op") {
      while (pilha.length) {
        const topo = pilha[pilha.length - 1];
        if (topo.t !== "op") break;
        const direita = k.v === "^";
        if (PRIOR[topo.v] > PRIOR[k.v] || (PRIOR[topo.v] === PRIOR[k.v] && !direita)) saida.push(pilha.pop()!);
        else break;
      }
      pilha.push(k);
    } else if (k.t === "(") pilha.push(k);
    else {
      while (pilha.length && pilha[pilha.length - 1].t !== "(") saida.push(pilha.pop()!);
      if (!pilha.length) throw new Error("parênteses desbalanceados");
      pilha.pop();
    }
  }
  while (pilha.length) { const x = pilha.pop()!; if (x.t === "(") throw new Error("parênteses desbalanceados"); saida.push(x); }
  const p: number[] = [];
  for (const k of saida) {
    if (k.t === "num") { p.push(k.v); continue; }
    if (k.t !== "op") continue;
    const b = p.pop(), a = p.pop();
    if (a === undefined || b === undefined) throw new Error("expressão incompleta");
    p.push(k.v === "+" ? a + b : k.v === "-" ? a - b : k.v === "*" ? a * b : k.v === "/" ? a / b : a ** b);
  }
  if (p.length !== 1 || !Number.isFinite(p[0])) throw new Error("expressão inválida");
  return p[0];
}

export const CALCULAR: Ferramenta = {
  nome: "calcular", rotulo: "fez as contas", exige: [],
  descricao: "Faz contas exatas (soma, diferença, multiplicação, divisão, porcentagem, potência para juros compostos, dias). Use SEMPRE que a resposta tiver uma conta, e copie o resultado: não faça conta de cabeça. Pode mandar várias de uma vez. Ex.: {\"contas\": [{\"nome\": \"aviso prévio\", \"expressao\": \"30 + 3*5\"}, {\"nome\": \"montante\", \"expressao\": \"100000*(1+0,01)^12\"}]}",
  esquema: {
    type: "object",
    properties: { contas: { type: "array", items: { type: "object", properties: { nome: { type: "string" }, expressao: { type: "string" } }, required: ["expressao"] } } },
    required: ["contas"],
  },
  rodar: async (_sb, e) => {
    const contas = (Array.isArray(e.contas) ? e.contas : []).slice(0, 20) as { nome?: string; expressao?: string }[];
    const resultados = contas.map((c) => {
      try { const r = calcularExpressao(String(c.expressao ?? "")); return { nome: c.nome ?? null, expressao: c.expressao, resultado: Math.round(r * 1e6) / 1e6 }; }
      catch (err) { return { nome: c.nome ?? null, expressao: c.expressao, erro: err instanceof Error ? err.message : "inválida" }; }
    });
    return { dados: { resultados }, fontes: [] };
  },
};
