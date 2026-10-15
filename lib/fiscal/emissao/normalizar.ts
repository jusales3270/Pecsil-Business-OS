/**
 * Nota que veio da tela → dados limpos (números como número, textos aparados, listas com limite).
 * Usado no servidor antes de gravar; o modelo de nota vazia e o item padrão servem à tela.
 */
import { lerNumeroBr } from "../../numero-br";
import type { ItemNfe, NotaNfe } from "./tipos";

const num = (v: unknown, padrao = 0) => lerNumeroBr(v, padrao);
const txt = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const umDe = <T extends string | number>(v: unknown, validos: readonly T[], padrao: T): T => (validos.includes(v as T) ? (v as T) : padrao);

/** Item padrão do regime normal (CRT 3) — sugestões que o Jefferson confirma. */
export function itemPadrao(cfop = "5101", crt = 3): ItemNfe {
  const simples = crt === 1 || crt === 2 || crt === 4;
  return {
    codigo: "", descricao: "", ncm: "", cfop, unidade: "PC", quantidade: 1, valorUnitario: 0, desconto: 0, origem: 0,
    icmsCst: simples ? "102" : "00", icmsAliquota: simples ? 0 : cfop.startsWith("5") ? 18 : 12, icmsReducaoBase: 0,
    ipiCst: "50", ipiAliquota: 0, pisCst: simples ? "49" : "01", pisAliquota: simples ? 0 : 1.65, cofinsCst: simples ? "49" : "01", cofinsAliquota: simples ? 0 : 7.6,
  };
}

export function notaVazia(): NotaNfe {
  return {
    natureza: "VENDA DE PRODUCAO DO ESTABELECIMENTO", finalidade: 1, tipo: 1, consumidorFinal: false, presenca: 9,
    destinatario: { documento: "", nome: "", indIE: 1, ie: "", email: "", logradouro: "", numero: "", complemento: "", bairro: "", codigoMunicipio: "", municipio: "", uf: "", cep: "", fone: "" },
    itens: [itemPadrao()],
    frete: { modalidade: 9, valor: 0, transportadora: null, volumes: null },
    seguro: 0, outrasDespesas: 0,
    pagamento: { forma: "15", duplicatas: [] },
    infoComplementar: "",
  };
}

export function normalizarNota(v: unknown): NotaNfe {
  const n = (v ?? {}) as Record<string, unknown>;
  const d = (n.destinatario ?? {}) as Record<string, unknown>;
  const f = (n.frete ?? {}) as Record<string, unknown>;
  const t = (f.transportadora ?? null) as Record<string, unknown> | null;
  const vol = (f.volumes ?? null) as Record<string, unknown> | null;
  const p = (n.pagamento ?? {}) as Record<string, unknown>;
  const itens = Array.isArray(n.itens) ? n.itens.slice(0, 200) : [];
  return {
    natureza: txt(n.natureza, 60).toUpperCase(),
    finalidade: umDe(num(n.finalidade, 1), [1, 2, 3, 4] as const, 1),
    tipo: umDe(num(n.tipo, 1), [0, 1] as const, 1),
    consumidorFinal: Boolean(n.consumidorFinal),
    presenca: umDe(num(n.presenca, 9), [0, 1, 2, 9] as const, 9),
    destinatario: {
      documento: txt(d.documento, 20).replace(/\D/g, ""), nome: txt(d.nome, 60), indIE: umDe(num(d.indIE, 1), [1, 2, 9] as const, 1),
      ie: txt(d.ie, 20), email: txt(d.email, 60).trim(), logradouro: txt(d.logradouro, 60), numero: txt(d.numero, 60), complemento: txt(d.complemento, 60),
      bairro: txt(d.bairro, 60), codigoMunicipio: txt(d.codigoMunicipio, 7).replace(/\D/g, ""), municipio: txt(d.municipio, 60), uf: txt(d.uf, 2).toUpperCase(),
      cep: txt(d.cep, 9).replace(/\D/g, ""), fone: txt(d.fone, 20).replace(/\D/g, ""),
    },
    itens: itens.map((x) => {
      const i = (x ?? {}) as Record<string, unknown>;
      return {
        codigo: txt(i.codigo, 60), descricao: txt(i.descricao, 120), ncm: txt(i.ncm, 10).replace(/\D/g, ""), cfop: txt(i.cfop, 4).replace(/\D/g, ""),
        unidade: txt(i.unidade, 6).toUpperCase() || "UN", quantidade: num(i.quantidade), valorUnitario: num(i.valorUnitario), desconto: num(i.desconto),
        origem: umDe(num(i.origem), [0, 1, 2, 3, 4, 5, 6, 7, 8] as const, 0), icmsCst: txt(i.icmsCst, 3), icmsAliquota: num(i.icmsAliquota), icmsReducaoBase: num(i.icmsReducaoBase),
        ipiCst: txt(i.ipiCst, 2), ipiAliquota: num(i.ipiAliquota), pisCst: txt(i.pisCst, 2), pisAliquota: num(i.pisAliquota), cofinsCst: txt(i.cofinsCst, 2), cofinsAliquota: num(i.cofinsAliquota),
        ...(i.pisCofinsExcluiIcms === true ? { pisCofinsExcluiIcms: true } : {}),
        ...(/^\d{3}$/.test(txt(i.ipiEnquadramento, 3)) ? { ipiEnquadramento: txt(i.ipiEnquadramento, 3) } : {}),
        ...(/^\d{3}$/.test(txt(i.ibsCbsCst, 3)) ? { ibsCbsCst: txt(i.ibsCbsCst, 3), cClassTrib: txt(i.cClassTrib, 6).replace(/\D/g, ""), ibsAliquota: num(i.ibsAliquota), cbsAliquota: num(i.cbsAliquota) } : {}),
        ...(txt(i.mascara, 10).trim() ? { mascara: txt(i.mascara, 10).trim() } : {}),
        ...(typeof i.itemOrcamento === "string" && /^[0-9a-f-]{36}$/i.test(i.itemOrcamento) ? { itemOrcamento: i.itemOrcamento } : {}),
        ...(txt(i.pedidoCompra, 60).trim() ? { pedidoCompra: txt(i.pedidoCompra, 60).trim() } : {}),
        ...(txt(i.itemPedido, 20).trim() ? { itemPedido: txt(i.itemPedido, 20).trim() } : {}),
      };
    }),
    frete: {
      modalidade: umDe(num(f.modalidade, 9), [0, 1, 2, 9] as const, 9), valor: num(f.valor),
      transportadora: t && txt(t.nome).trim() ? { documento: txt(t.documento, 20).replace(/\D/g, ""), nome: txt(t.nome, 60), ie: txt(t.ie, 20), uf: txt(t.uf, 2).toUpperCase() } : null,
      volumes: vol && num(vol.quantidade) > 0 ? { quantidade: num(vol.quantidade), especie: txt(vol.especie, 60), pesoLiquido: num(vol.pesoLiquido), pesoBruto: num(vol.pesoBruto) } : null,
    },
    seguro: num(n.seguro), outrasDespesas: num(n.outrasDespesas),
    pagamento: {
      forma: txt(p.forma, 2) || "15",
      duplicatas: (Array.isArray(p.duplicatas) ? p.duplicatas.slice(0, 60) : []).map((x) => {
        const u = (x ?? {}) as Record<string, unknown>;
        return { numero: txt(u.numero, 20), vencimento: txt(u.vencimento, 10), valor: num(u.valor) };
      }),
    },
    infoComplementar: txt(n.infoComplementar, 2000),
    referencia: txt(n.referencia, 60).replace(/\D/g, "") || undefined,
  };
}
