/**
 * Nota fiscal enviada como arquivo (XML da NF-e ou DANFE em PDF): lê, reconhece o
 * fornecedor do cadastro e acha o pedido a caminho. Usado pelo Painel do ICMS
 * ("Enviar notas") e pelo recebimento do Almoxarifado. Só roda no servidor.
 */
import type { Nfe } from "../almoxarifado/nfe-xml";
import { NfeInvalida, lerNfe } from "../almoxarifado/nfe-xml.ts";
import { tipoDoArquivo } from "../arquivos/detectar.ts";
import { textoDoPdf } from "../arquivos/pdf-texto.ts";
import { nameSimilarity, normalizeName } from "../compras/fornecedores-core.ts";
import { lerDanfe, pareceDanfe } from "./danfe-pdf.ts";

export class NotaNaoReconhecida extends Error {}

export type NotaLida = {
  nfe: Nfe;
  origem: "xml" | "pdf";
  /** Texto do XML (guardado no recebimento); nulo quando veio do PDF. */
  xml: string | null;
  /** Campos que o PDF não trouxe (a pessoa preenche). */
  camposNaoLidos: string[];
};

export async function lerNotaDoArquivo(dados: Uint8Array): Promise<NotaLida> {
  const tipo = tipoDoArquivo(dados);
  if (tipo === "nfe-xml" || tipo === "xml") {
    const xml = new TextDecoder("utf-8").decode(dados);
    try {
      return { nfe: lerNfe(xml), origem: "xml", xml, camposNaoLidos: [] };
    } catch (e) {
      throw new NotaNaoReconhecida(e instanceof NfeInvalida ? e.message : "Não consegui ler o XML da nota.");
    }
  }
  if (tipo === "pdf") {
    const paginas = await textoDoPdf(dados, 30);
    if (!pareceDanfe(paginas)) throw new NotaNaoReconhecida("Este PDF não é um DANFE (a nota fiscal impressa).");
    const d = lerDanfe(paginas);
    const nfe: Nfe = { chave: d.chave, numero: d.numero, serie: d.serie, emissao: d.emissao, natureza: d.natureza, emitente: d.emitente, destinatarioCnpj: d.destinatarioCnpj, valorProdutos: d.valorProdutos, valorNota: d.valorNota, baseIcms: d.baseIcms, icms: d.icms, ipi: d.ipi, itens: d.itens, duplicatas: d.duplicatas };
    return { nfe, origem: "pdf", xml: null, camposNaoLidos: d.camposNaoLidos };
  }
  if (tipo === "ofx" || tipo === "xlsx" || tipo === "xls") throw new NotaNaoReconhecida("Este arquivo parece um extrato bancário. Extratos vão em Financeiro › Bancos e conciliação.");
  throw new NotaNaoReconhecida("Formato não reconhecido. Envie o XML da NF-e ou o DANFE em PDF.");
}

export type FornecedorCadastro = { id: string; name: string; tax_id: string | null };
export type FornecedorDaNota = { id: string; nome: string; porCnpj: boolean; gravarCnpj: boolean };

const FORMA = new Set(["ltda", "me", "epp", "eireli", "sa", "s", "a", "cia", "comercio", "industria", "ind", "com", "de", "da", "do", "e"]);
const nucleo = (n: string) => normalizeName(n).split(" ").filter((t) => t && !FORMA.has(t));
const prefixo = (a: string[], b: string[]) => a.length > 0 && a.length <= b.length && a.every((t, i) => t === b[i]);

/**
 * Fornecedor do cadastro: pelo CNPJ; sem CNPJ, pelo nome (o nome do cadastro é o
 * começo da razão social ou da fantasia, palavra por palavra, ou quase igual) — e aí
 * o CNPJ da nota pode ser gravado no cadastro, se ninguém mais o tiver.
 */
export function fornecedorDaNota(nfe: Nfe, cadastro: FornecedorCadastro[]): FornecedorDaNota | null {
  const cnpj = nfe.emitente.cnpj.replace(/\D/g, "");
  const porCnpj = cnpj ? cadastro.find((s) => (s.tax_id ?? "").replace(/\D/g, "") === cnpj) : undefined;
  if (porCnpj) return { id: porCnpj.id, nome: porCnpj.name, porCnpj: true, gravarCnpj: false };
  const nomes = [nfe.emitente.nome, nfe.emitente.fantasia].filter(Boolean).map(nucleo);
  const candidatos = cadastro.filter((s) => {
    const t = nucleo(s.name);
    if (!t.length || (t.length === 1 && t[0].length < 4)) return false;
    return nomes.some((n) => prefixo(t, n) || prefixo(n, t) || nameSimilarity(t.join(" "), n.join(" ")) >= 0.9);
  });
  if (candidatos.length !== 1) return null;
  const s = candidatos[0];
  return { id: s.id, nome: s.name, porCnpj: false, gravarCnpj: !s.tax_id && Boolean(cnpj) };
}

export type PedidoACaminho = { cotacaoId: number; fornecedor: string; supplierId: string | null; cnpj: string | null; totalComprado: number; jaRecebido: number };
export type PedidoDaNota = { cotacaoId: number; fornecedor: string; falta: number; motivo: "cnpj" | "fornecedor" | "nome"; valorConfere: boolean };

/** Pedidos a caminho que combinam com a nota (mesmo CNPJ, mesmo fornecedor do cadastro ou nome parecido). */
export function pedidosDaNota(nfe: Nfe, fornecedor: FornecedorDaNota | null, caminho: PedidoACaminho[]): PedidoDaNota[] {
  const cnpj = nfe.emitente.cnpj.replace(/\D/g, "");
  const nomes = [nfe.emitente.nome, nfe.emitente.fantasia].filter(Boolean).map((n) => normalizeName(n));
  const lista: PedidoDaNota[] = [];
  for (const c of caminho) {
    const falta = Math.max(0, c.totalComprado - c.jaRecebido);
    let motivo: PedidoDaNota["motivo"] | null = null;
    if (cnpj && c.cnpj && c.cnpj.replace(/\D/g, "") === cnpj) motivo = "cnpj";
    else if (fornecedor && c.supplierId === fornecedor.id) motivo = "fornecedor";
    else if (nomes.some((n) => nameSimilarity(normalizeName(c.fornecedor), n) >= 0.85 || n.startsWith(normalizeName(c.fornecedor)))) motivo = "nome";
    if (!motivo) continue;
    lista.push({ cotacaoId: c.cotacaoId, fornecedor: c.fornecedor, falta, motivo, valorConfere: Math.abs(falta - nfe.valorNota) <= Math.max(1, falta * 0.02) });
  }
  return lista.sort((a, b) => Number(b.valorConfere) - Number(a.valorConfere) || Math.abs(a.falta - nfe.valorNota) - Math.abs(b.falta - nfe.valorNota));
}
