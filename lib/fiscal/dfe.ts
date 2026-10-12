/**
 * Leitura dos documentos que a SEFAZ distribui contra o nosso CNPJ (Notas recebidas, 12/10/2026).
 *
 * Quatro formatos chegam na distribuição:
 *   resNFe        — resumo da nota (antes da ciência da operação);
 *   nfeProc       — a nota completa, autorizada (depois da ciência);
 *   resEvento     — resumo de um evento (cancelamento, carta de correção…);
 *   procEventoNFe — o evento completo.
 * Daqui sai o registro para `fiscal_dfe_registrar` e, para a nota completa, o arquivo a guardar em
 * Documentos. Texto puro, sem biblioteca: o XML não sai do servidor.
 */
import type { DocumentoDistribuido } from "./transmissor/contrato";

export type RegistroDfe = {
  tipo: "resumo" | "nota" | "evento";
  nsu: string;
  chave: string;
  emitente_cnpj?: string | null;
  emitente_nome?: string | null;
  emitente_ie?: string | null;
  valor?: number | null;
  emissao?: string | null;
  tipo_nf?: 0 | 1 | null;
  situacao?: "autorizada" | "denegada" | "cancelada";
  protocolo?: string | null;
  tp_evento?: string;
  descricao?: string | null;
  sequencia?: number | null;
  data_evento?: string | null;
  autor_cnpj?: string | null;
};

export type DfeLido = {
  registro: RegistroDfe;
  /** Só para a nota completa: o XML como veio (assinado), para Documentos. */
  arquivo: { nome: string; titulo: string; xml: string } | null;
};

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodificar = (t: string) => t.replace(/&(#\d+|[a-z]+);/gi, (inteiro, n: string) => (n[0] === "#" ? String.fromCodePoint(Number(n.slice(1))) : ENTIDADES[n.toLowerCase()] ?? inteiro)).trim();
const bloco = (xml: string, tag: string) => xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`))?.[1] ?? "";
const campo = (xml: string, tag: string) => { const v = decodificar(bloco(xml, tag)); return v || null; };
const valor = (xml: string, tag: string) => { const n = Number(campo(xml, tag)); return Number.isFinite(n) && campo(xml, tag) !== null ? Math.round(n * 100) / 100 : null; };
const tipoNf = (v: string | null) => (v === "0" ? 0 : v === "1" ? 1 : null);
const temRaiz = (xml: string, tag: string) => new RegExp(`<(?:\\w+:)?${tag}[\\s>]`).test(xml);

/** cSitNFe do resumo: 1 autorizada, 2 denegada, 3 cancelada. */
const SITUACAO_RESUMO: Record<string, RegistroDfe["situacao"]> = { "1": "autorizada", "2": "denegada", "3": "cancelada" };
/** cStat do protocolo da nota: 100/150 autorizada; 110/205/301/302/303 denegada. */
const situacaoDoProtocolo = (cStat: string | null): RegistroDfe["situacao"] =>
  cStat && ["110", "205", "301", "302", "303"].includes(cStat) ? "denegada" : "autorizada";

export function lerDocumentoDistribuido(doc: DocumentoDistribuido): DfeLido | null {
  const xml = doc.xml ?? "";
  const nsu = String(doc.nsu ?? "").replace(/\D/g, "").padStart(15, "0");
  if (!/^\d{15}$/.test(nsu) || nsu === "000000000000000") return null;

  if (temRaiz(xml, "procEventoNFe") || temRaiz(xml, "resEvento")) {
    const ev = temRaiz(xml, "procEventoNFe") ? bloco(bloco(xml, "evento"), "infEvento") || xml : xml;
    const ret = temRaiz(xml, "procEventoNFe") ? bloco(bloco(xml, "retEvento"), "infEvento") : xml;
    const chave = campo(ev, "chNFe");
    const tp = campo(ev, "tpEvento");
    if (!chave || !/^\d{44}$/.test(chave) || !tp || !/^\d{6}$/.test(tp)) return null;
    return {
      registro: {
        tipo: "evento", nsu, chave, tp_evento: tp,
        descricao: campo(bloco(ev, "detEvento"), "descEvento") ?? campo(ev, "xEvento"),
        sequencia: Number(campo(ev, "nSeqEvento") ?? "") || null,
        data_evento: campo(ev, "dhEvento") ?? campo(xml, "dhRecbto"),
        protocolo: campo(ret, "nProt"),
        autor_cnpj: campo(ev, "CNPJ") ?? campo(ev, "CPF"),
      },
      arquivo: null,
    };
  }

  if (temRaiz(xml, "resNFe")) {
    const chave = campo(xml, "chNFe");
    if (!chave || !/^\d{44}$/.test(chave)) return null;
    return {
      registro: {
        tipo: "resumo", nsu, chave,
        emitente_cnpj: campo(xml, "CNPJ") ?? campo(xml, "CPF"),
        emitente_nome: campo(xml, "xNome"),
        emitente_ie: campo(xml, "IE"),
        valor: valor(xml, "vNF"),
        emissao: campo(xml, "dhEmi"),
        tipo_nf: tipoNf(campo(xml, "tpNF")),
        situacao: SITUACAO_RESUMO[campo(xml, "cSitNFe") ?? "1"] ?? "autorizada",
        protocolo: campo(xml, "nProt"),
      },
      arquivo: null,
    };
  }

  if (temRaiz(xml, "nfeProc") || temRaiz(xml, "NFe")) {
    const inf = bloco(xml, "infNFe");
    const chave = xml.match(/<(?:\w+:)?infNFe[^>]*\sId="NFe(\d{44})"/)?.[1] ?? campo(bloco(xml, "infProt"), "chNFe");
    if (!chave || !/^\d{44}$/.test(chave)) return null;
    const ide = bloco(inf, "ide");
    const emit = bloco(inf, "emit");
    const prot = bloco(xml, "infProt");
    const numero = campo(ide, "nNF");
    const nome = campo(emit, "xNome");
    return {
      registro: {
        tipo: "nota", nsu, chave,
        emitente_cnpj: campo(emit, "CNPJ") ?? campo(emit, "CPF"),
        emitente_nome: nome,
        emitente_ie: campo(emit, "IE"),
        valor: valor(bloco(bloco(inf, "total"), "ICMSTot"), "vNF"),
        emissao: campo(ide, "dhEmi") ?? campo(ide, "dEmi"),
        tipo_nf: tipoNf(campo(ide, "tpNF")),
        situacao: situacaoDoProtocolo(campo(prot, "cStat")),
        protocolo: campo(prot, "nProt"),
      },
      arquivo: {
        nome: `NFe${chave}.xml`,
        titulo: `NF-e ${numero ?? chave.slice(25, 34).replace(/^0+/, "")}${nome ? ` · ${nome}` : ""}`.slice(0, 200),
        xml,
      },
    };
  }
  return null;
}

/** Regra da SEFAZ (NT 2014.002): sem documento novo (137) ou já no fim (ultNSU = maxNSU), só consultar de novo depois de 1 hora. */
export function proximaConsulta(r: { cStat: string; ultimoNsu: string | null; maxNsu: string | null }, agora = Date.now()): Date {
  const fim = r.cStat === "137" || (r.ultimoNsu !== null && r.ultimoNsu === r.maxNsu);
  return new Date(agora + (fim ? 61 : 1) * 60_000);
}
