/**
 * Leitura do DANFE em PDF (a versão impressa da NF-e). O layout é o oficial, com
 * os mesmos rótulos em qualquer emissor; cada valor é lido logo abaixo do seu
 * rótulo, dentro da "caixa" dele. A chave de acesso (44 dígitos, com dígito
 * verificador) é a âncora: dela saem CNPJ do emitente, modelo, série e número,
 * então esses não dependem do layout.
 *
 * O PDF é menos seguro que o XML: tudo que vem daqui é marcado para conferência.
 * Itens não são lidos do PDF; duplicatas só quando a soma fecha com o total da nota.
 */
import type { ItemPdf } from "../arquivos/pdf-texto";
import type { Nfe, NfeDuplicata } from "../almoxarifado/nfe-xml";

export class DanfeInvalido extends Error {}

export type Danfe = Nfe & { origem: "pdf"; camposNaoLidos: string[] };

const VALOR = /^\d{1,3}(\.\d{3})*,\d{2}$/;
const DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const num = (t: string) => Number(t.replace(/\./g, "").replace(",", "."));
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
/** Rótulo sem acento, espaço nem pontuação: "CNPJ / CPF" = "CNPJ/CPF". */
const chaveRotulo = (t: string) => norm(t).replace(/[^A-Z0-9]/g, "");

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

  /**
   * Valor logo abaixo do rótulo, dentro da caixa dele (até o próximo rótulo da mesma linha).
   * Cada emissor abrevia do seu jeito ("BASE DE CÁLCULO DO ICMS", "BASE DE CÁLC. DO ICMS"),
   * então o campo aceita uma lista de rótulos, comparados inteiros e sem pontuação —
   * "VALOR DO ICMS" nunca casa com "VALOR DO ICMS SUBST.". `abaixoDe` restringe a um bloco.
   */
  const abaixo = (rotulos: string | string[], filtro: (s: string) => boolean, abaixoDe = Infinity): string | null => {
    const alvos = new Set([rotulos].flat().map(chaveRotulo));
    for (const linha of todas) {
      if (linha[0].y >= abaixoDe) continue;
      const idx = linha.findIndex((i) => alvos.has(chaveRotulo(i.s)));
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
  const valor = (rotulos: string[], campo: string, reserva?: number) => {
    const v = abaixo(rotulos, (s) => VALOR.test(s));
    if (v !== null) return num(v);
    if (reserva !== undefined) return reserva;
    naoLidos.push(campo);
    return 0;
  };

  const emissaoTxt = abaixo(["DATA DA EMISSÃO", "DATA DE EMISSÃO"], (s) => DATA.test(s));
  if (!emissaoTxt) naoLidos.push("emissão");
  // O emitente também tem "CNPJ / CPF" (acima); o do destinatário fica abaixo do título do bloco.
  const tituloDest = pagina.find((i) => chaveRotulo(i.s).startsWith("DESTINATARIOREMETENTE"));
  const destCnpj = (abaixo(["CNPJ/CPF", "CNPJ"], (s) => CNPJ.test(s), tituloDest?.y ?? Infinity) ?? "").replace(/\D/g, "");
  if (!destCnpj) naoLidos.push("CNPJ do destinatário");
  const canhoto = textoTodo.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i);
  const nome = canhoto ? canhoto[1].trim() : "";
  if (!nome) naoLidos.push("nome do emitente");
  // Muitos canhotos repetem o total ("VALOR TOTAL: R$ 21.385,00"): reserva se a caixa não for lida.
  const totalCanhoto = textoTodo.match(/VALOR TOTAL:?\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);

  const valorNota = valor(["VALOR TOTAL DA NOTA", "V. TOTAL DA NOTA", "VALOR TOTAL NOTA", "V. TOTAL NOTA"], "valor da nota", totalCanhoto ? num(totalCanhoto[1]) : undefined);
  const duplicatas = lerDuplicatas(pagina, valorNota);
  if (duplicatas === null) naoLidos.push("duplicatas");

  return {
    origem: "pdf",
    chave,
    numero: String(Number(chave.slice(25, 34))),
    serie: String(Number(chave.slice(22, 25))),
    emissao: emissaoTxt ? emissaoTxt.replace(DATA, "$3-$2-$1") : "",
    natureza: abaixo("NATUREZA DA OPERAÇÃO", (s) => /[A-Za-z]/.test(s)) ?? "",
    emitente: { cnpj: chave.slice(6, 20), nome, fantasia: "", uf: "" },
    destinatarioCnpj: destCnpj,
    valorProdutos: valor(["VALOR TOTAL DOS PRODUTOS", "V. TOTAL PRODUTOS", "V. TOTAL DOS PRODUTOS", "VALOR TOTAL PRODUTOS"], "valor dos produtos"),
    valorNota,
    baseIcms: valor(["BASE DE CÁLCULO DO ICMS", "BASE DE CÁLC. DO ICMS", "BASE DE CALC. DO ICMS", "BASE CÁLC. ICMS", "BASE DE CÁLCULO ICMS"], "base do ICMS"),
    icms: valor(["VALOR DO ICMS", "VALOR ICMS", "V. ICMS"], "ICMS"),
    ipi: valor(["VALOR DO IPI", "VALOR TOTAL IPI", "VALOR TOTAL DO IPI", "V. TOTAL IPI", "VALOR IPI", "V. IPI"], "IPI"),
    itens: [],
    duplicatas: duplicatas ?? [],
    camposNaoLidos: naoLidos,
  };
}

/**
 * Duplicatas do bloco "FATURA / DUPLICATA" (entre ele e "CÁLCULO DO IMPOSTO"). Cada
 * vencimento leva o valor mais próximo dele e o número curto ao lado. Só vale se a
 * soma fechar com o total da nota; senão devolve null (a pessoa digita).
 * Bloco sem vencimento nenhum (pagamento à vista ou sem fatura) devolve [].
 */
function lerDuplicatas(pagina: ItemPdf[], valorNota: number): NfeDuplicata[] | null {
  const titulo = pagina.find((i) => /^FATURA/.test(chaveRotulo(i.s)));
  const imposto = pagina.find((i) => chaveRotulo(i.s) === "CALCULODOIMPOSTO");
  if (!titulo || !imposto || imposto.y >= titulo.y) return [];
  const bloco = pagina.filter((i) => i.y < titulo.y && i.y > imposto.y);
  const valorDe = (s: string) => s.trim().replace(/^R\$\s*/, "");
  const datas = bloco.filter((i) => DATA.test(i.s.trim()));
  const valores = bloco.filter((i) => VALOR.test(valorDe(i.s)));
  const numeros = bloco.filter((i) => /^\d[\d/.-]{0,14}$/.test(i.s.trim()) && !DATA.test(i.s.trim()) && !VALOR.test(i.s.trim()));
  if (!datas.length) return [];
  if (datas.length !== valores.length) return null;
  const dist = (a: ItemPdf, b: ItemPdf) => Math.hypot(a.x - b.x, a.y - b.y);
  const usados = new Set<ItemPdf>();
  const usadosNum = new Set<ItemPdf>();
  const lista: NfeDuplicata[] = [];
  for (const d of [...datas].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const v = valores.filter((i) => !usados.has(i)).sort((a, b) => dist(a, d) - dist(b, d))[0];
    if (!v || dist(v, d) > 80) return null;
    usados.add(v);
    const n = numeros.filter((i) => !usadosNum.has(i) && dist(i, d) <= 60).sort((a, b) => dist(a, d) - dist(b, d))[0];
    if (n) usadosNum.add(n);
    lista.push({ numero: n ? n.s.trim() : "", vencimento: d.s.trim().replace(DATA, "$3-$2-$1"), valor: num(valorDe(v.s)) });
  }
  const soma = lista.reduce((s, d) => s + d.valor, 0);
  if (Math.abs(soma - valorNota) > 0.01) return null;
  lista.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return lista.map((d, i) => ({ ...d, numero: d.numero || String(i + 1).padStart(3, "0") }));
}
