/**
 * Leitura do DANFE em PDF (a versão impressa da NF-e). O layout é o oficial, com
 * os mesmos rótulos em qualquer emissor; cada valor é lido logo abaixo do seu
 * rótulo, dentro da "caixa" dele. A chave de acesso (44 dígitos, com dígito
 * verificador) é a âncora: dela saem CNPJ do emitente, modelo, série e número,
 * então esses não dependem do layout.
 *
 * O PDF é menos seguro que o XML: tudo que vem daqui é marcado para conferência.
 * Itens e duplicatas não são lidos do PDF (vêm do XML ou são digitados).
 */
import type { ItemPdf } from "../arquivos/pdf-texto";
import type { Nfe } from "../almoxarifado/nfe-xml";

export class DanfeInvalido extends Error {}

export type Danfe = Nfe & { origem: "pdf"; camposNaoLidos: string[] };

const VALOR = /^\d{1,3}(\.\d{3})*,\d{2}$/;
const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const num = (t: string) => Number(t.replace(/\./g, "").replace(",", "."));
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9). */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

function linhas(itens: ItemPdf[]): ItemPdf[][] {
  const out: ItemPdf[][] = [];
  for (const it of [...itens].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const atual = out.at(-1);
    if (atual && Math.abs(atual[0].y - it.y) <= 2) atual.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

export function pareceDanfe(paginas: ItemPdf[][]): boolean {
  const t = norm((paginas[0] ?? []).map((i) => i.s).join(" "));
  return t.includes("DANFE") && t.includes("CHAVE DE ACESSO");
}

export function lerDanfe(paginas: ItemPdf[][]): Danfe {
  if (!pareceDanfe(paginas)) throw new DanfeInvalido("Este PDF não parece um DANFE (falta \"DANFE\" ou \"CHAVE DE ACESSO\").");
  const pagina = paginas[0];
  const todas = linhas(pagina);
  const textoTodo = todas.map((l) => l.map((i) => i.s).join(" ")).join("\n");

  // Chave: 44 dígitos, em geral em grupos de 4; precisa passar no dígito verificador.
  let chave = "";
  for (const m of textoTodo.matchAll(/(?:\d[\d ]{42,60}\d)/g)) {
    const so = m[0].replace(/\D/g, "");
    for (let i = 0; i + 44 <= so.length; i++) if (chaveValida(so.slice(i, i + 44))) { chave = so.slice(i, i + 44); break; }
    if (chave) break;
  }
  if (!chave) throw new DanfeInvalido("Não encontrei uma chave de acesso válida no DANFE.");

  /** Valor logo abaixo do rótulo, dentro da caixa dele (até o próximo rótulo da mesma linha). */
  const abaixo = (rotulo: string, filtro: (s: string) => boolean): string | null => {
    const alvo = norm(rotulo);
    for (const linha of todas) {
      const idx = linha.findIndex((i) => norm(i.s) === alvo);
      if (idx < 0) continue;
      const r = linha[idx];
      const limite = linha[idx + 1]?.x ?? Infinity;
      const candidatos = pagina
        .filter((i) => i.y < r.y - 2 && i.y > r.y - 16 && i.x >= r.x - 4 && i.x < limite && filtro(i.s.trim()))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      if (candidatos.length) return candidatos[0].s.trim();
    }
    return null;
  };
  const naoLidos: string[] = [];
  const valor = (rotulo: string, campo: string) => {
    const v = abaixo(rotulo, (s) => VALOR.test(s));
    if (v === null) { naoLidos.push(campo); return 0; }
    return num(v);
  };

  const emissaoTxt = abaixo("DATA DA EMISSÃO", (s) => DATA.test(s)) ?? abaixo("DATA DE EMISSÃO", (s) => DATA.test(s));
  if (!emissaoTxt) naoLidos.push("emissão");
  const destCnpj = (abaixo("CNPJ/CPF", (s) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(s)) ?? "").replace(/\D/g, "");
  const canhoto = textoTodo.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i);
  const nome = canhoto ? canhoto[1].trim() : "";
  if (!nome) naoLidos.push("nome do emitente");

  return {
    origem: "pdf",
    chave,
    numero: String(Number(chave.slice(25, 34))),
    serie: String(Number(chave.slice(22, 25))),
    emissao: emissaoTxt ? emissaoTxt.replace(DATA, "$3-$2-$1") : "",
    natureza: abaixo("NATUREZA DA OPERAÇÃO", (s) => /[A-Za-z]/.test(s)) ?? "",
    emitente: { cnpj: chave.slice(6, 20), nome, fantasia: "", uf: "" },
    destinatarioCnpj: destCnpj,
    valorProdutos: valor("VALOR TOTAL DOS PRODUTOS", "valor dos produtos"),
    valorNota: valor("VALOR TOTAL DA NOTA", "valor da nota"),
    baseIcms: valor("BASE DE CÁLCULO DO ICMS", "base do ICMS"),
    icms: valor("VALOR DO ICMS", "ICMS"),
    ipi: valor("VALOR DO IPI", "IPI"),
    itens: [],
    duplicatas: [],
    camposNaoLidos: naoLidos,
  };
}
