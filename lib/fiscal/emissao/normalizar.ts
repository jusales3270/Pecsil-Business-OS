/**
 * Nota que veio da tela → dados limpos (números como número, textos aparados, listas com limite).
 * Usado no servidor antes de gravar; o modelo de nota vazia e o item padrão servem à tela.
 */
import { lerNumeroBr } from "../../numero-br";
import type { DeclaracaoImportacao, ItemNfe, NotaNfe } from "./tipos";

const num = (v: unknown, padrao = 0) => lerNumeroBr(v, padrao);
const txt = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const umDe = <T extends string | number>(v: unknown, validos: readonly T[], padrao: T): T => (validos.includes(v as T) ? (v as T) : padrao);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** Número só quando veio um número (campo vazio continua "não informado", e não zero). */
const numOpc = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number.isFinite(lerNumeroBr(v, Number.NaN)) ? lerNumeroBr(v, 0) : undefined);
const data = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : "");
const chave44 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(0, 44);

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
      documento: /^\d{2,4}$/.test(txt(d.pais, 4)) && txt(d.pais, 4) !== "1058" ? txt(d.documento, 20).trim() : txt(d.documento, 20).replace(/\D/g, ""), nome: txt(d.nome, 60), indIE: umDe(num(d.indIE, 1), [1, 2, 9] as const, 1),
      ie: txt(d.ie, 20), email: txt(d.email, 60).trim(), logradouro: txt(d.logradouro, 60), numero: txt(d.numero, 60), complemento: txt(d.complemento, 60),
      bairro: txt(d.bairro, 60), codigoMunicipio: txt(d.codigoMunicipio, 7).replace(/\D/g, ""), municipio: txt(d.municipio, 60), uf: txt(d.uf, 2).toUpperCase(),
      cep: txt(d.cep, 9).replace(/\D/g, ""), fone: txt(d.fone, 20).replace(/\D/g, ""),
      // Exterior: país do BACEN e nome; o documento é a identificação estrangeira (letras e números, pode ir vazio).
      ...(/^\d{2,4}$/.test(txt(d.pais, 4)) && txt(d.pais, 4) !== "1058" ? { pais: txt(d.pais, 4), nomePais: txt(d.nomePais, 60).trim() || "EXTERIOR" } : {}),
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
        ...referenciaDoItem(i.dfeReferenciado),
        ...extrasDoItem(i),
      };
    }),
    frete: {
      modalidade: umDe(num(f.modalidade, 9), [0, 1, 2, 3, 4, 9] as const, 9), valor: num(f.valor),
      transportadora: t && txt(t.nome).trim() ? {
        documento: txt(t.documento, 20).replace(/\D/g, ""), nome: txt(t.nome, 60), ie: txt(t.ie, 20), uf: txt(t.uf, 2).toUpperCase(),
        ...(txt(t.endereco, 60).trim() ? { endereco: txt(t.endereco, 60).trim() } : {}), ...(txt(t.municipio, 60).trim() ? { municipio: txt(t.municipio, 60).trim() } : {}),
      } : null,
      veiculo: obj(f.veiculo) && txt(obj(f.veiculo)!.placa, 8).replace(/[^A-Z0-9]/gi, "")
        ? { placa: txt(obj(f.veiculo)!.placa, 8).replace(/[^A-Z0-9]/gi, "").toUpperCase(), uf: txt(obj(f.veiculo)!.uf, 2).toUpperCase(), ...(txt(obj(f.veiculo)!.rntc, 20).trim() ? { rntc: txt(obj(f.veiculo)!.rntc, 20).trim() } : {}) }
        : null,
      volumes: vol && (num(vol.quantidade) > 0 || txt(vol.especie).trim() || txt(vol.marca).trim() || txt(vol.numeracao).trim() || num(vol.pesoBruto) > 0)
        ? {
          quantidade: num(vol.quantidade), especie: txt(vol.especie, 60), pesoLiquido: num(vol.pesoLiquido), pesoBruto: num(vol.pesoBruto),
          ...(txt(vol.marca, 60).trim() ? { marca: txt(vol.marca, 60).trim() } : {}), ...(txt(vol.numeracao, 60).trim() ? { numeracao: txt(vol.numeracao, 60).trim() } : {}),
        }
        : null,
    },
    seguro: num(n.seguro), outrasDespesas: num(n.outrasDespesas),
    pagamento: {
      forma: txt(p.forma, 2) || "15",
      ...(Array.isArray(p.partes) && p.partes.length > 1
        ? { partes: p.partes.slice(0, 100).map((x) => { const y = obj(x) ?? {}; return { forma: txt(y.forma, 2) || "99", valor: num(y.valor) }; }) }
        : {}),
      duplicatas: (Array.isArray(p.duplicatas) ? p.duplicatas.slice(0, 60) : []).map((x) => {
        const u = (x ?? {}) as Record<string, unknown>;
        return { numero: txt(u.numero, 20), vencimento: txt(u.vencimento, 10), valor: num(u.valor) };
      }),
    },
    infoComplementar: txt(n.infoComplementar, 2000),
    referencia: txt(n.referencia, 60).replace(/\D/g, "") || undefined,
    ...extrasDaNota(n),
  };
}

/** Campos da nota além do básico (texto do fisco, outras notas referenciadas, exportação, país, total da DI). */
function extrasDaNota(n: Record<string, unknown>): Partial<NotaNfe> {
  const e = obj(n.exportacao);
  const refs = (Array.isArray(n.referencias) ? n.referencias : []).map(chave44).filter((r) => r.length === 44).slice(0, 500);
  const total = numOpc(n.valorTotalInformado);
  return {
    ...(txt(n.infoFisco, 2000).trim() ? { infoFisco: txt(n.infoFisco, 2000).trim() } : {}),
    ...(refs.length ? { referencias: [...new Set(refs)] } : {}),
    ...(typeof n.saidaEntrada === "string" && !Number.isNaN(Date.parse(n.saidaEntrada)) ? { saidaEntrada: n.saidaEntrada.slice(0, 30) } : {}),
    ...(e && txt(e.ufSaida, 2).trim() && txt(e.localExportacao, 60).trim()
      ? { exportacao: { ufSaida: txt(e.ufSaida, 2).toUpperCase(), localExportacao: txt(e.localExportacao, 60).trim(), ...(txt(e.localDespacho, 60).trim() ? { localDespacho: txt(e.localDespacho, 60).trim() } : {}) } }
      : {}),
    ...(typeof total === "number" && total >= 0 ? { valorTotalInformado: total } : {}),
  };
}

/** Campos do item além do básico (benefício fiscal, importação, exportação, valores informados). */
function extrasDoItem(i: Record<string, unknown>): Partial<ItemNfe> {
  const trib = obj(i.tributavel);
  const inf = obj(i.informado);
  const ii = obj(i.ii);
  const informado = inf
    ? Object.fromEntries((["vBC", "vICMS", "vBCIPI", "vIPI", "vBCPisCofins", "vPIS", "vBCCofins", "vCOFINS", "vBCIBSCBS", "vIBS", "vCBS"] as const).map((k) => [k, numOpc(inf[k])]).filter(([, v]) => typeof v === "number" && (v as number) >= 0))
    : {};
  const cBenef = txt(i.cBenef, 10).trim().toUpperCase();
  return {
    ...(i.icmsPorDentro === true ? { icmsPorDentro: true } : {}),
    ...(i.pisCofinsSemBase === true ? { pisCofinsSemBase: true } : {}),
    ...(i.ipiNaBaseIcms === true ? { ipiNaBaseIcms: true } : {}),
    ...([0, 1, 2].includes(Number(i.icmsModBC)) && i.icmsModBC !== null && i.icmsModBC !== "" ? { icmsModBC: Number(i.icmsModBC) as 0 | 1 | 2 } : {}),
    ...(obj(i.ipiDevolvido) ? { ipiDevolvido: { percentual: Math.min(100, Math.max(0, num(obj(i.ipiDevolvido)!.percentual))), valor: Math.max(0, num(obj(i.ipiDevolvido)!.valor)) } } : {}),
    ...(/^([!-ÿ]{8}|[!-ÿ]{10}|SEM CBENEF)$/.test(cBenef) ? { cBenef } : {}),
    ...(typeof numOpc(i.valorTotal) === "number" && numOpc(i.valorTotal)! >= 0 ? { valorTotal: numOpc(i.valorTotal) } : {}),
    ...(trib && txt(trib.unidade, 6).trim() ? { tributavel: { unidade: txt(trib.unidade, 6).toUpperCase(), quantidade: num(trib.quantidade), valorUnitario: num(trib.valorUnitario) } } : {}),
    ...(txt(i.infoAdicional, 500).trim() ? { infoAdicional: txt(i.infoAdicional, 500).trim() } : {}),
    ...(Object.keys(informado).length ? { informado } : {}),
    ...(ii ? { ii: { vBC: num(ii.vBC), vDespAdu: num(ii.vDespAdu), vII: num(ii.vII), vIOF: num(ii.vIOF) } } : {}),
    ...(Array.isArray(i.di) && i.di.length ? { di: i.di.slice(0, 100).map(declaracao).filter((x): x is DeclaracaoImportacao => Boolean(x)) } : {}),
    ...(Array.isArray(i.exportacao) && i.exportacao.length
      ? { exportacao: i.exportacao.slice(0, 500).map((x) => {
        const e = obj(x) ?? {};
        const ind = obj(e.indireta);
        return {
          ...(txt(e.drawback, 20).trim() ? { drawback: txt(e.drawback, 20).trim() } : {}),
          ...(ind ? { indireta: { registro: txt(ind.registro, 12).replace(/\D/g, ""), chave: chave44(ind.chave), quantidade: num(ind.quantidade) } } : {}),
        };
      }) }
      : {}),
  };
}

function declaracao(v: unknown): DeclaracaoImportacao | null {
  const x = obj(v);
  if (!x || !txt(x.numero, 15).trim()) return null;
  return {
    numero: txt(x.numero, 15).trim(), data: data(x.data), localDesembaraco: txt(x.localDesembaraco, 60).trim(), ufDesembaraco: txt(x.ufDesembaraco, 2).toUpperCase(),
    dataDesembaraco: data(x.dataDesembaraco), viaTransporte: num(x.viaTransporte, 1), ...(typeof numOpc(x.vAFRMM) === "number" ? { vAFRMM: numOpc(x.vAFRMM) } : {}),
    intermedio: num(x.intermedio, 1), ...(txt(x.documentoAdquirente, 20).replace(/\D/g, "") ? { documentoAdquirente: txt(x.documentoAdquirente, 20).replace(/\D/g, "") } : {}),
    ...(txt(x.ufTerceiro, 2).trim() ? { ufTerceiro: txt(x.ufTerceiro, 2).toUpperCase() } : {}), exportador: txt(x.exportador, 60).trim(),
    adicoes: (Array.isArray(x.adicoes) ? x.adicoes : []).slice(0, 999).map((a) => {
      const y = obj(a) ?? {};
      return { numero: num(y.numero, 1), sequencial: num(y.sequencial, 1), fabricante: txt(y.fabricante, 60).trim(), ...(numOpc(y.desconto) ? { desconto: numOpc(y.desconto) } : {}), ...(txt(y.drawback, 20).trim() ? { drawback: txt(y.drawback, 20).trim() } : {}) };
    }),
  };
}

/** Nota e item devolvidos (DFeReferenciado): nItem de 1 a 990; a chave incompleta fica, para a validação apontar. */
function referenciaDoItem(v: unknown): Pick<ItemNfe, "dfeReferenciado"> {
  if (!v || typeof v !== "object") return {};
  const r = v as Record<string, unknown>;
  const nItem = Math.trunc(Number(r.nItem));
  if (!(nItem >= 1 && nItem <= 990)) return {};
  const chave = String(r.chave ?? "").replace(/\D/g, "");
  return { dfeReferenciado: { nItem, ...(chave ? { chave: chave.slice(0, 44) } : {}) } };
}
