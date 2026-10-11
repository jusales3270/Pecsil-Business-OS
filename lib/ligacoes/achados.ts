/**
 * O que um documento cita e que pode ligá-lo ao banco (Segundo Cérebro, Etapa 4). Só regra
 * exata, sem IA: CNPJ com dígito verificador, chave de acesso de NF-e e números que vêm depois
 * de um prefixo claro ("NF", "cotação nº", "OC", "OS"). Número solto nunca liga.
 * Sem dependência de servidor (testável).
 */
import { chavesDeAcesso } from "../leitura/conteudo.ts";

export type Achados = { cnpjs: string[]; chaves: string[]; nfs: string[]; cotacoes: number[]; os: string[] };

export function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0, peso = base.length - 7;
    for (const c of base) { soma += Number(c) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

const N = String.raw`(?:n[º°o.]?|n[úu]mero)?\s*[:#.]?\s*`;
const unicos = <T,>(xs: T[]) => [...new Set(xs)];
const semZeros = (n: string) => n.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export function achados(texto: string): Achados {
  const cnpjs = unicos([...texto.matchAll(/(?<![\d./-])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d./-])/g)].map((m) => m[0].replace(/\D/g, "")).filter(cnpjValido));
  // NF: "NF 2045", "NF-e nº 000.002.045", "Nota Fiscal Nº 30719".
  const nfs = unicos([...texto.matchAll(new RegExp(String.raw`\b(?:nf-?e?|nota fiscal(?: eletr[oô]nica)?)\s*${N}(\d{1,3}(?:\.\d{3}){1,2}|\d{1,9})\b`, "gi"))].map((m) => semZeros(m[1])).filter((n) => n !== "0"));
  // Cotação / OC: "cotação nº 234", "Ordem de Compra 234", "pedido de compra 234", "OC 234" (OC só em maiúsculas).
  const cotacoes = unicos([
    ...texto.matchAll(new RegExp(String.raw`\b(?:cota[cç][aã]o|ordem de compra|pedido de compra)\s*${N}(\d{1,7})\b`, "gi")),
    ...texto.matchAll(new RegExp(String.raw`\bO\.?C\.?\s*${N}(\d{1,7})\b`, "g")),
  ].map((m) => Number(semZeros(m[1]))).filter((n) => n > 0));
  // OS: "OS 12676", "O.S. 12676" (só em maiúsculas: "os" é artigo) ou "ordem de serviço 12676".
  const os = unicos([
    ...texto.matchAll(new RegExp(String.raw`\bordem de servi[cç]o\s*${N}(\d{4,6})\b`, "gi")),
    ...texto.matchAll(new RegExp(String.raw`\bO\.?S\.?\s*${N}(\d{4,6})\b`, "g")),
  ].map((m) => semZeros(m[1])));
  return { cnpjs, chaves: chavesDeAcesso(texto), nfs, cotacoes, os };
}

export const algumAchado = (a: Achados) => Boolean(a.cnpjs.length || a.chaves.length || a.nfs.length || a.cotacoes.length || a.os.length);
