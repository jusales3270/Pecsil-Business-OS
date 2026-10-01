/**
 * Campos editáveis de uma nota no Painel do ICMS: o que vem do corpo da
 * requisição vira colunas de fiscal_icms_entries, só com o que foi enviado.
 */
export type IcmsEntradaBody = {
  competencia?: string; emitida?: string | null; recebida?: string | null;
  fornecedor?: string; fantasia?: string | null; cnpj?: string | null;
  nfe?: string | null; serie?: string | null; chave?: string | null;
  valor?: number; vlrCobrado?: number; baseIcms?: number; icms?: number; ipi?: number;
  tipo?: string | null; fundicao?: boolean; usinagem?: boolean; administrativo?: boolean;
  xmlOk?: boolean; lancado?: boolean; autorizado?: boolean; obs?: string | null;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (valor: string | null | undefined) => (valor && valor.trim() ? valor.trim() : null);
const dinheiro = (valor: unknown) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null;
};

export function icmsColunas(body: IcmsEntradaBody): { colunas: Record<string, unknown> } | { erro: string } {
  const c: Record<string, unknown> = {};
  if (body.competencia !== undefined) {
    if (!/^\d{4}-\d{2}(-01)?$/.test(body.competencia)) return { erro: "Mês de competência inválido." };
    c.competencia = body.competencia.length === 7 ? `${body.competencia}-01` : body.competencia;
  }
  for (const [campo, coluna] of [["emitida", "emitida"], ["recebida", "recebida"]] as const) {
    const valor = body[campo];
    if (valor === undefined) continue;
    if (valor && !DATA.test(valor)) return { erro: `Data inválida em ${campo}.` };
    c[coluna] = valor || null;
  }
  if (body.fornecedor !== undefined) {
    if (!body.fornecedor.trim()) return { erro: "Informe o fornecedor." };
    c.fornecedor = body.fornecedor.trim();
  }
  for (const [campo, coluna] of [["fantasia", "fantasia"], ["nfe", "nfe"], ["serie", "serie"], ["tipo", "tipo"], ["obs", "obs"]] as const) {
    if (body[campo] !== undefined) c[coluna] = texto(body[campo]);
  }
  if (body.cnpj !== undefined) c.cnpj = texto(body.cnpj)?.replace(/\D/g, "") || null;
  if (body.chave !== undefined) {
    const chave = (body.chave ?? "").replace(/\D/g, "");
    if (chave && chave.length !== 44) return { erro: "A chave de acesso tem 44 dígitos." };
    c.chave = chave || null;
  }
  for (const [campo, coluna] of [["valor", "valor"], ["vlrCobrado", "vlr_cobrado"], ["baseIcms", "base_icms"], ["icms", "icms"], ["ipi", "ipi"]] as const) {
    if (body[campo] === undefined) continue;
    const valor = dinheiro(body[campo]);
    if (valor === null || valor < 0) return { erro: `Valor inválido em ${campo}.` };
    c[coluna] = valor;
  }
  for (const [campo, coluna] of [["fundicao", "fundicao"], ["usinagem", "usinagem"], ["administrativo", "administrativo"], ["xmlOk", "xml_ok"], ["lancado", "lancado"], ["autorizado", "autorizado"]] as const) {
    if (typeof body[campo] === "boolean") c[coluna] = body[campo];
  }
  return { colunas: c };
}

export const ICMS_COLUNAS = "id, competencia, emitida, recebida, fornecedor, fantasia, cnpj, nfe, serie, chave, valor, vlr_cobrado, base_icms, icms, ipi, tipo, fundicao, usinagem, administrativo, xml_ok, lancado, autorizado, obs, origem, receipt_id, created_by_name, created_at";
