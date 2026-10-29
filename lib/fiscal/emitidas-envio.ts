/**
 * Fiscal › Notas emitidas › "Enviar notas do mês": o que é cada arquivo que a pessoa arrastou (XML ou PDF das
 * notas que a empresa emitiu fora da plataforma, no GRV) e o que entra. Puro: recebe o que já foi lido de cada
 * arquivo e o que já está na plataforma. A gravação e a leitura (IBS/CBS, receita do Presumido) são do servidor.
 */
import { classificarCfop } from "../contabil/apuracao/receita";
import { bloco, lerIbsCbs, tag, textoXml } from "./ibs-cbs/leitura";

export type ArquivoLido =
  | { nome: string; tipo: "nfe"; chave: string | null; numero: string | null; serie: string | null; emissao: string | null; emitenteCnpj: string | null; destinatario: string | null; valor: number; tpNF: string | null; finNFe: string | null; porCfop: Record<string, number> }
  | { nome: string; tipo: "evento"; chave: string; evento: string; sequencia: string | null; data: string | null; texto: string | null; situacao?: string | null; protocolo?: string | null }
  | { nome: string; tipo: "danfe"; chave: string | null; numero: string | null; emissao: string | null; emitenteCnpj: string | null; destinatario: string | null; valor: number }
  | { nome: string; tipo: "erro"; erro: string };

/** Saída: venda (receita), exportação (receita fora do PIS/COFINS), remessa/retorno (não é receita), devolução. */
export type Natureza = "venda" | "exportacao" | "remessa" | "devolucao";

export type Situacao =
  | "saida" | "entrada_propria" | "evento" | "danfe"
  | "ja_na_plataforma" | "repetida_no_envio" | "outro_mes" | "outra_empresa" | "nao_reconhecido";

export type LinhaEnvio = {
  arquivo: string;
  situacao: Situacao;
  /** Entra (é guardado) no Confirmar. */
  entra: boolean;
  numero: string | null;
  chave: string | null;
  emissao: string | null;
  destinatario: string | null;
  valor: number | null;
  natureza?: Natureza;
  /** Mês da nota (AAAA-MM), quando é de outro mês. */
  mesDaNota?: string | null;
  /** Texto para a pessoa: o que é e por que entra ou não. */
  nota: string;
};

const DEVOLUCAO = /^[123]20[12]$/;
const EVENTOS: Record<string, string> = { "110110": "Carta de correção", "110111": "Cancelamento", "110112": "Cancelamento por substituição" };

/** Mês da nota pela chave de acesso (posições 3 a 6: AAMM). */
export const mesDaChave = (chave: string | null | undefined) => (chave && /^\d{44}$/.test(chave) ? `20${chave.slice(2, 4)}-${chave.slice(4, 6)}` : null);
/** Número da nota pela chave (posições 26 a 34). */
export const numeroDaChave = (chave: string | null | undefined) => (chave && /^\d{44}$/.test(chave) ? String(Number(chave.slice(25, 34))) : null);
/** CNPJ do emitente pela chave (posições 7 a 20). */
export const cnpjDaChave = (chave: string | null | undefined) => (chave && /^\d{44}$/.test(chave) ? chave.slice(6, 20) : null);

export function naturezaDaSaida(porCfop: Record<string, number>): Natureza {
  const cfops = Object.keys(porCfop);
  if (cfops.some((c) => DEVOLUCAO.test(c))) return "devolucao";
  const receita = cfops.filter((c) => classificarCfop(c));
  if (!receita.length) return "remessa";
  return receita.every((c) => c.startsWith("7")) ? "exportacao" : "venda";
}

const TEXTO_NATUREZA: Record<Natureza, string> = {
  venda: "Nota de saída: entra na receita do mês.",
  exportacao: "Exportação: entra na receita do IRPJ/CSLL e fica fora do PIS/COFINS.",
  remessa: "Remessa, retorno ou outra saída: guardada, mas não é receita.",
  devolucao: "Devolução: guardada e abatida da receita do mês.",
};

/**
 * Classifica os arquivos de um envio. `jaNaPlataforma`: chaves já lidas (ou emitidas pela plataforma).
 * `hashesJaGuardados`: o mesmo arquivo já guardado no Fiscal (índice igual ao de `lidos`).
 */
export function classificarEnvio(
  lidos: readonly ArquivoLido[],
  ctx: { mes: string; cnpjEmpresa: string; jaNaPlataforma: ReadonlySet<string>; arquivoJaGuardado: readonly boolean[] },
): LinhaEnvio[] {
  const vistas = new Set<string>();
  const xmlNoEnvio = new Set(lidos.flatMap((l) => (l.tipo === "nfe" && l.chave ? [l.chave] : [])));
  return lidos.map((l, i): LinhaEnvio => {
    const base = { arquivo: l.nome, numero: null as string | null, chave: null as string | null, emissao: null as string | null, destinatario: null as string | null, valor: null as number | null };
    if (l.tipo === "erro") return { ...base, situacao: "nao_reconhecido", entra: false, nota: l.erro };
    if (ctx.arquivoJaGuardado[i]) {
      const chave = l.chave ?? null;
      return { ...base, chave, numero: l.tipo === "evento" ? numeroDaChave(chave) : l.numero, situacao: "ja_na_plataforma", entra: false, nota: "Este mesmo arquivo já foi enviado antes: não entra de novo." };
    }
    if (l.tipo === "evento") {
      const numero = numeroDaChave(l.chave);
      const mes = mesDaChave(l.chave);
      const nome = EVENTOS[l.evento] ?? `Evento ${l.evento}`;
      const id = `evento:${l.chave}:${l.evento}:${l.sequencia ?? ""}`;
      const linha = { ...base, chave: l.chave, numero, emissao: l.data };
      if (cnpjDaChave(l.chave) !== ctx.cnpjEmpresa) return { ...linha, situacao: "outra_empresa", entra: false, nota: "Evento de nota de outra empresa: não entra aqui." };
      if (mes !== ctx.mes) return { ...linha, situacao: "outro_mes", entra: false, mesDaNota: mes, nota: `${nome} da NF ${numero}, que é de ${rotuloMes(mes)}: envie no mês da nota.` };
      if (vistas.has(id)) return { ...linha, situacao: "repetida_no_envio", entra: false, nota: "O mesmo evento está duas vezes neste envio: entra uma." };
      vistas.add(id);
      const cancel = l.evento !== "110110";
      return { ...linha, situacao: "evento", entra: true, nota: cancel ? `${nome} da NF ${numero}: guardado, e a nota sai da receita e das apurações.` : `${nome} da NF ${numero}: guardada junto da nota.${l.texto ? ` (${l.texto.slice(0, 120)})` : ""}` };
    }
    const linha = { ...base, chave: l.chave, numero: l.numero, emissao: l.emissao, destinatario: l.destinatario, valor: l.valor };
    const mes = l.emissao ? l.emissao.slice(0, 7) : mesDaChave(l.chave);
    const emitente = (l.emitenteCnpj ?? cnpjDaChave(l.chave) ?? "").replace(/\D/g, "");
    if (emitente !== ctx.cnpjEmpresa) return { ...linha, situacao: "outra_empresa", entra: false, nota: "Nota emitida por outra empresa (nota recebida): envie no Painel do ICMS." };
    if (mes !== ctx.mes) return { ...linha, situacao: "outro_mes", entra: false, mesDaNota: mes, nota: `Emitida em ${rotuloMes(mes)}: envie no mês da nota.` };
    if (l.tipo === "danfe") {
      const id = `danfe:${l.chave ?? l.numero}`;
      if (vistas.has(id)) return { ...linha, situacao: "repetida_no_envio", entra: false, nota: "O mesmo DANFE está duas vezes neste envio: entra um." };
      vistas.add(id);
      const temXml = Boolean(l.chave && (xmlNoEnvio.has(l.chave) || ctx.jaNaPlataforma.has(l.chave)));
      return { ...linha, situacao: "danfe", entra: true, nota: temXml ? "DANFE em PDF: guardado junto da nota." : "DANFE em PDF sem o XML desta nota: guardado, mas a receita só é lida do XML. Envie o XML também." };
    }
    if (l.chave && ctx.jaNaPlataforma.has(l.chave)) return { ...linha, situacao: "ja_na_plataforma", entra: false, nota: "Esta NF-e já está na plataforma: não entra de novo." };
    const id = l.chave ?? `${l.serie}:${l.numero}`;
    if (vistas.has(id)) return { ...linha, situacao: "repetida_no_envio", entra: false, nota: "A mesma NF-e está duas vezes neste envio: entra uma." };
    vistas.add(id);
    if (l.tpNF === "0" && l.finNFe !== "4") return { ...linha, situacao: "entrada_propria", entra: true, nota: "Nota de entrada emitida pela empresa (importação, compra sem nota do fornecedor ou ajuste): guardada, não é receita." };
    const natureza = naturezaDaSaida(l.porCfop);
    return { ...linha, situacao: "saida", entra: true, natureza, nota: TEXTO_NATUREZA[natureza] };
  });
}

/**
 * Números que faltam na sequência das notas do mês (série única da empresa), do menor ao maior número conhecido.
 * `soEvento`: números que têm evento (ex.: carta de correção) mas não o XML da nota.
 */
export function lacunasDaNumeracao(numeros: Iterable<string | number | null | undefined>, soEvento: Iterable<string | null | undefined> = []): { numero: number; soEvento: boolean }[] {
  const conhecidos = new Set<number>();
  for (const n of numeros) { const v = Number(n); if (Number.isInteger(v) && v > 0) conhecidos.add(v); }
  if (conhecidos.size < 2) return [];
  const eventos = new Set([...soEvento].map(Number));
  const ordem = [...conhecidos].sort((a, b) => a - b);
  const faltam: { numero: number; soEvento: boolean }[] = [];
  // Um buraco grande demais não é falta de nota (troca de série, numeração de outro sistema): não lista.
  if (ordem[ordem.length - 1] - ordem[0] > 2000) return [];
  for (let n = ordem[0] + 1; n < ordem[ordem.length - 1]; n++) if (!conhecidos.has(n)) faltam.push({ numero: n, soEvento: eventos.has(n) });
  return faltam;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const rotuloMes = (mes: string | null | undefined) => (mes && /^\d{4}-\d{2}$/.test(mes) ? `${MESES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}` : "outro mês");

/** Lê um XML de NF-e emitida (nota ou nota com protocolo). Null quando não é NF-e. */
export function lerNfeEmitida(nome: string, xml: string, cnpjEmpresa: string): ArquivoLido | null {
  const n = lerIbsCbs(xml, cnpjEmpresa);
  if (!n) return null;
  const inf = bloco(xml, "infNFe") ?? "";
  const ide = bloco(inf, "ide") ?? "";
  const dest = bloco(inf, "dest") ?? "";
  return {
    nome, tipo: "nfe", chave: n.chave, numero: n.numero, serie: tag(ide, "serie"), emissao: n.emissao, emitenteCnpj: n.emitenteCnpj,
    destinatario: textoXml(tag(dest, "xNome")), valor: n.vNF, tpNF: tag(ide, "tpNF"), finNFe: tag(ide, "finNFe"), porCfop: n.receita.porCfop,
  };
}

/** Lê um XML de evento da NF-e (carta de correção, cancelamento). Null quando não é evento. */
export function lerEventoNfe(nome: string, xml: string): ArquivoLido | null {
  const ev = bloco(xml, "infEvento");
  if (!ev || !/<(\w+:)?(procEventoNFe|evento)[\s>]/.test(xml)) return null;
  const chave = tag(ev, "chNFe");
  const evento = tag(ev, "tpEvento");
  if (!chave || !/^\d{44}$/.test(chave) || !evento) return null;
  const det = bloco(ev, "detEvento") ?? "";
  const ret = bloco(bloco(xml, "retEvento") ?? "", "infEvento") ?? "";
  return { nome, tipo: "evento", chave, evento, sequencia: tag(ev, "nSeqEvento"), data: (tag(ev, "dhEvento") ?? "").slice(0, 10) || null, texto: textoXml(tag(det, "xCorrecao") ?? tag(det, "xJust")), situacao: tag(ret, "cStat"), protocolo: tag(ret, "nProt") };
}

/** Situações do evento aceitas pela SEFAZ (registrado e vinculado, registrado sem vincular, fora de prazo). */
const EVENTO_ACEITO = new Set(["135", "136", "155"]);

/**
 * Cancelamento (110111 ou 110112, por substituição) aceito pela SEFAZ, lido do XML do evento: a nota sai das apurações.
 * Null quando não é cancelamento, quando não traz o retorno da SEFAZ ou quando a SEFAZ não aceitou.
 */
export function cancelamentoDoXml(xml: string): { chave: string; data: string | null; protocolo: string | null; justificativa: string | null } | null {
  const e = lerEventoNfe("", xml);
  if (!e || e.tipo !== "evento" || (e.evento !== "110111" && e.evento !== "110112") || !EVENTO_ACEITO.has(e.situacao ?? "")) return null;
  const inf = bloco(xml, "infEvento") ?? "";
  return { chave: e.chave, data: tag(inf, "dhEvento"), protocolo: e.protocolo ?? null, justificativa: e.texto };
}
