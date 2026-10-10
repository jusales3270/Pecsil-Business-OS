/**
 * Filtro de saída do modelo de decisão (PLANO-JEV, seção 2, regra 5): antes de qualquer
 * texto sair para o Clef, procura dado pessoal. Achou, não envia — e o bloqueio vira
 * registro, não erro silencioso. CNPJ passa (é empresa).
 *
 * Para não bloquear número de nota, pedido ou valor, CPF e PIS só contam com dígito
 * verificador válido, e CID só perto de palavra de saúde.
 */

export type ResultadoFiltro = { ok: true; motivos: [] } | { ok: false; motivos: string[] };

const soDigitos = (s: string) => s.replace(/\D/g, "");

export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

export function pisValido(pis: string): boolean {
  const d = soDigitos(pis);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0);
  const resto = 11 - (soma % 11);
  const dv = resto >= 10 ? 0 : resto;
  return dv === Number(d[10]);
}

const CPF_FORMATADO = /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d])/g;
const PIS_FORMATADO = /(?<![\d.])\d{3}\.\d{5}\.\d{2}-\d(?![\d])/g;
const ONZE_DIGITOS = /(?<![\d./-])\d{11}(?![\d./-])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Telefone com separador típico: (11) 98765-4321, 11 98765-4321, +55 11 3456-7890.
const TELEFONE = /(?:\+55\s?)?(?:\(\d{2}\)\s?|\b\d{2}[\s-])9?\d{4}-\d{4}\b/;
const SAUDE = /\b(cid|atestado|diagn[oó]stico|afastamento m[eé]dico|laudo|exame|doen[cç]a)\b/i;
const CID = /\b[A-TV-Z]\d{2}(?:\.\d)?\b/;

export function filtrarEstado(texto: string): ResultadoFiltro {
  const motivos = new Set<string>();
  for (const m of texto.matchAll(CPF_FORMATADO)) if (cpfValido(m[0])) motivos.add("CPF");
  for (const m of texto.matchAll(PIS_FORMATADO)) if (pisValido(m[0])) motivos.add("PIS");
  for (const m of texto.matchAll(ONZE_DIGITOS)) {
    if (cpfValido(m[0])) motivos.add("CPF");
    else if (pisValido(m[0])) motivos.add("PIS");
  }
  if (EMAIL.test(texto)) motivos.add("e-mail");
  if (TELEFONE.test(texto)) motivos.add("telefone");
  if (SAUDE.test(texto) && CID.test(texto)) motivos.add("dado de saúde (CID)");
  return motivos.size ? { ok: false, motivos: [...motivos] } : { ok: true, motivos: [] };
}
