/**
 * Transmissor de NF-e — serviço separado (Pecsil Business OS, Fiscal, 12/10/2026).
 *
 * É a ÚNICA peça que conversa com a SEFAZ. Usa a biblioteca NFeWizard (GPL-3.0); por isso este
 * serviço é um programa à parte, com licença GPL-3.0 e código aberto próprio, e a plataforma fala
 * com ele por uma API interna (sem domínio público, só na rede interna do Coolify). Trocar por
 * uma API paga = trocar este serviço, sem mexer na plataforma (contrato em lib/fiscal/transmissor).
 *
 * Segurança:
 *  - toda chamada (menos /saude) exige o cabeçalho x-transmissor-secret (TRANSMISSOR_SECRET, 32+);
 *  - o certificado A1 (pfx em base64 + senha) chega A CADA chamada e só existe em memória; a
 *    biblioteca o passa ao openssl por arquivos temporários que ela mesma apaga;
 *  - a biblioteca registra a configuração (com o certificado e a senha!) no log interno dela:
 *    toda saída "[winston] …" é descartada abaixo, ANTES de importar a biblioteca;
 *  - nada do pedido é registrado em log; os erros devolvidos não trazem o certificado.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 1) Silenciar o log da biblioteca (vaza certificado e senha). Precisa vir antes do import.
for (const nivel of ["error", "warn", "log", "info", "debug"]) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith("[winston]")) return;
    original(...args);
  };
}
const { default: NFeWizardMod, NFE_SchemaValidate } = await import("nfewizard-io");
const NFeWizard = NFeWizardMod.default ?? NFeWizardMod;
const { NFE_GerarDanfe } = await import("@nfewizard/danfe");
const { default: forge } = await import("node-forge");

const VERSAO = "0.1.0";
const SEGREDO = process.env.TRANSMISSOR_SECRET?.trim() ?? "";
const PORTA = Number(process.env.PORT || 3100);
const LIMITE_CORPO = 6 * 1024 * 1024;

/** Código IBGE da UF (cUF / cUFAutor / cOrgao). */
export const UF_IBGE = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};

export class ErroDoPedido extends Error {
  constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; }
}

export function segredoConfere(recebido, esperado = SEGREDO) {
  if (!esperado || esperado.length < 32 || !recebido) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Configuração da biblioteca para UMA chamada (nada é guardado entre chamadas). */
export function configDaChamada(p, pastaTemporaria) {
  const uf = String(p.uf ?? "").toUpperCase();
  if (!UF_IBGE[uf]) throw new ErroDoPedido("UF_INVALIDA", "UF do emitente inválida.");
  const cnpj = String(p.cnpj ?? "").replace(/\D/g, "");
  if (cnpj.length !== 14) throw new ErroDoPedido("CNPJ_INVALIDO", "CNPJ do emitente inválido.");
  if (!p.certificado?.pfx || !p.certificado?.senha) throw new ErroDoPedido("SEM_CERTIFICADO", "Certificado A1 não informado.");
  const ambiente = p.ambiente === "producao" ? 1 : 2;
  return {
    ambiente,
    cUF: UF_IBGE[uf],
    cnpj,
    config: {
      dfe: {
        pathCertificado: Buffer.from(String(p.certificado.pfx), "base64"),
        senhaCertificado: String(p.certificado.senha),
        UF: uf,
        CPFCNPJ: cnpj,
        baixarXMLDistribuicao: false,
        armazenarXMLAutorizacao: false,
        armazenarXMLConsulta: false,
        armazenarXMLRetorno: false,
        armazenarRetornoEmJSON: false,
        pathXMLDistribuicao: pastaTemporaria,
      },
      nfe: { ambiente, versaoDF: "4.00" },
      lib: { log: { exibirLogNoConsole: false, armazenarLogs: false }, useForSchemaValidation: "validateSchemaJsBased", connection: { timeout: 30_000 } },
    },
  };
}

/** Data e hora no fuso de Brasília (-03:00, sem horário de verão desde 2019), como a SEFAZ pede. */
export const agora = (ms = Date.now()) => new Date(ms - 3 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "-03:00");

/** Primeiro valor de uma chave em qualquer profundidade do retorno da biblioteca. */
function acharChave(obj, chave, profundidade = 0) {
  if (!obj || typeof obj !== "object" || profundidade > 8) return undefined;
  if (chave in obj) return Array.isArray(obj[chave]) ? obj[chave][0] : obj[chave];
  for (const v of Object.values(obj)) { const achado = acharChave(v, chave, profundidade + 1); if (achado !== undefined) return achado; }
  return undefined;
}

/** Resposta padronizada da SEFAZ: código e motivo à vista, o retorno da biblioteca em "bruto". */
export function respostaSefaz(r) {
  const cStat = acharChave(r, "cStat");
  const motivo = acharChave(r, "xMotivo") ?? (typeof r?.xMotivo === "string" ? r.xMotivo : undefined);
  return { cStat: cStat == null ? null : String(cStat), motivo: motivo == null ? null : String(motivo), bruto: r };
}

/**
 * Distribuição de documentos, lida do XML de retorno (a biblioteca descarta o NSU de cada
 * documento e tira a assinatura; aqui cada documento sai como veio da SEFAZ, assinado).
 */
export function normalizarDistribuicao(r) {
  const xml = typeof r?.data?.xml === "string" ? r.data.xml : "";
  const campo = (nome) => xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`))?.[1] ?? null;
  const documentos = [...xml.matchAll(/<docZip\b([^>]*)>([^<]+)<\/docZip>/g)].map(([, atributos, base64]) => ({
    nsu: atributos.match(/NSU="(\d+)"/)?.[1] ?? null,
    schema: atributos.match(/schema="([^"]+)"/)?.[1] ?? null,
    xml: gunzipSync(Buffer.from(base64.trim(), "base64")).toString("utf8"),
  }));
  return {
    cStat: campo("cStat") ?? (documentos.length ? "138" : "137"),
    motivo: campo("xMotivo") ?? (typeof r?.xMotivo === "string" ? r.xMotivo : null),
    ultimoNsu: campo("ultNSU"),
    maxNsu: campo("maxNSU"),
    documentos,
  };
}

async function comBiblioteca(p, fn, formatar = respostaSefaz) {
  const pasta = mkdtempSync(join(tmpdir(), "transmissor-"));
  try {
    const c = configDaChamada(p, pasta);
    const w = new NFeWizard();
    await w.NFE_LoadEnvironment({ config: c.config });
    return formatar(await fn(w, c));
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/**
 * Dados públicos do certificado A1: titular, CNPJ, validade e emissor. Também confere a senha.
 * No e-CNPJ da ICP-Brasil o nome comum é "RAZAO SOCIAL:CNPJ"; se não for, o CNPJ vem do campo
 * próprio da ICP-Brasil (OID 2.16.76.1.3.3) dentro do nome alternativo.
 */
export function lerCertificado(pfxBase64, senha) {
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(String(pfxBase64 ?? ""))), false, String(senha ?? ""));
  } catch (e) {
    const msg = String(e?.message ?? "");
    throw new ErroDoPedido("CERTIFICADO_INVALIDO", /mac|password|integrity/i.test(msg) ? "Senha do certificado incorreta." : "Arquivo de certificado inválido (esperado um .pfx/.p12 A1).");
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  if (!chaves.length) throw new ErroDoPedido("CERTIFICADO_SEM_CHAVE", "O arquivo não traz a chave privada (é preciso o A1 completo, .pfx).");
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean);
  // O do titular é o que não é de autoridade certificadora.
  const cert = certs.find((c) => !c.getExtension("basicConstraints")?.cA) ?? certs[0];
  if (!cert) throw new ErroDoPedido("CERTIFICADO_INVALIDO", "O arquivo não traz o certificado.");
  const nomeComum = String(cert.subject.getField("CN")?.value ?? "");
  let cnpj = nomeComum.match(/:(\d{14})$/)?.[1] ?? null;
  if (!cnpj) {
    // OID 2.16.76.1.3.3 (06 05 60 4c 01 03 03) seguido do CNPJ em texto
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const i = der.indexOf("\x06\x05\x60\x4c\x01\x03\x03");
    cnpj = i >= 0 ? der.slice(i, i + 40).match(/\d{14}/)?.[0] ?? null : null;
  }
  return {
    titular: nomeComum.replace(/:\d{11,14}$/, "").trim() || null,
    cnpj,
    validade: cert.validity.notAfter.toISOString(),
    inicio: cert.validity.notBefore.toISOString(),
    emissor: String(cert.issuer.getField("CN")?.value ?? "") || null,
  };
}

/** As operações. Cada uma recebe o corpo do pedido e devolve um objeto JSON. */
export const OPERACOES = {
  status: (p) => comBiblioteca(p, (w) => w.NFE_ConsultaStatusServico()),

  certificado: async (p) => {
    if (!p.certificado?.pfx || !p.certificado?.senha) throw new ErroDoPedido("SEM_CERTIFICADO", "Certificado A1 não informado.");
    return lerCertificado(p.certificado.pfx, p.certificado.senha);
  },

  validar: async (p) => {
    if (!p.xml) throw new ErroDoPedido("SEM_XML", "XML não informado.");
    // Pelo esquema oficial (enviNFe 4.00), sem certificado: o validador independente da biblioteca.
    // Aceita a <NFe> ou a nota autorizada (<nfeProc>), da qual tira a <NFe>.
    const nfe = String(p.xml).match(/<NFe[\s>][\s\S]*<\/NFe>/)?.[0] ?? String(p.xml);
    try {
      return await NFE_SchemaValidate(nfe, "NFeAutorizacao", { validator: "validateSchemaJsBased" });
    } catch (e) {
      // O validador "lança" o próprio relatório quando acha erro: é resultado, não falha.
      if (e && typeof e === "object" && "errors" in e) return e;
      throw e;
    }
  },

  autorizar: (p) => comBiblioteca(p, (w) => {
    if (!p.nfe && !p.xml) throw new ErroDoPedido("SEM_NOTA", "Nota não informada.");
    return w.NFE_Autorizacao(p.xml ? String(p.xml) : p.nfe);
  }),

  consultar: (p) => comBiblioteca(p, (w) => w.NFE_ConsultaProtocolo(String(p.chave ?? ""))),

  evento: (p) => comBiblioteca(p, (w, c) => {
    const base = { idLote: Date.now() % 1_000_000_000, cOrgao: c.cUF, tpAmb: c.ambiente, CNPJ: c.cnpj, chNFe: String(p.chave ?? ""), dhEvento: p.dhEvento ?? agora(), nSeqEvento: Number(p.sequencia ?? 1) };
    if (p.tipo === "cancelamento") {
      if (String(p.justificativa ?? "").trim().length < 15) throw new ErroDoPedido("JUSTIFICATIVA", "A justificativa precisa de ao menos 15 caracteres.");
      return w.NFE_Cancelamento({ ...base, tpEvento: "110111", detEvento: { descEvento: "Cancelamento", nProt: String(p.protocolo ?? ""), xJust: String(p.justificativa) } });
    }
    if (p.tipo === "carta") {
      if (String(p.correcao ?? "").trim().length < 15) throw new ErroDoPedido("CORRECAO", "A correção precisa de ao menos 15 caracteres.");
      return w.NFE_CartaDeCorrecao({ ...base, tpEvento: "110110", detEvento: { descEvento: "Carta de Correcao", xCorrecao: String(p.correcao), xCondUso: "A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida." } });
    }
    if (p.tipo === "ciencia") {
      // Manifestação do destinatário: o órgão é o Ambiente Nacional (91).
      return w.NFE_CienciaDaOperacao({ ...base, cOrgao: 91, tpEvento: "210210", detEvento: { descEvento: "Ciencia da Operacao" } });
    }
    throw new ErroDoPedido("EVENTO_INVALIDO", "Tipo de evento inválido.");
  }),

  inutilizar: (p) => comBiblioteca(p, (w, c) => {
    if (String(p.justificativa ?? "").trim().length < 15) throw new ErroDoPedido("JUSTIFICATIVA", "A justificativa precisa de ao menos 15 caracteres.");
    return w.NFE_Inutilizacao({ cUF: c.cUF, CNPJ: c.cnpj, ano: String(p.ano), mod: "55", serie: String(p.serie), nNFIni: String(p.inicio), nNFFin: String(p.fim), xJust: String(p.justificativa) });
  }),

  distribuicao: (p) => comBiblioteca(p, (w, c) => (p.chave
    ? w.NFE_DistribuicaoDFePorChave({ cUFAutor: c.cUF, CNPJ: c.cnpj, consChNFe: { chNFe: String(p.chave) } })
    : w.NFE_DistribuicaoDFePorUltNSU({ cUFAutor: c.cUF, CNPJ: c.cnpj, distNSU: { ultNSU: String(p.ultimoNsu ?? "0").padStart(15, "0") } })), normalizarDistribuicao),

  cadastro: (p) => comBiblioteca(p, (w) => w.NFE_ConsultaCadastro({ uf: p.ufConsulta ? String(p.ufConsulta) : undefined, cnpj: String(p.cnpjConsulta ?? "").replace(/\D/g, "") })),

  danfe: async (p) => {
    if (!p.xml) throw new ErroDoPedido("SEM_XML", "XML autorizado não informado.");
    const pasta = mkdtempSync(join(tmpdir(), "danfe-"));
    try {
      const saida = join(pasta, "danfe.pdf");
      await NFE_GerarDanfe({ data: String(p.xml), outputPath: saida });
      await arquivoPronto(saida); // a biblioteca devolve antes de terminar de gravar o PDF
      return { pdf: readFileSync(saida).toString("base64") };
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  },
};

/** Espera o arquivo existir e parar de crescer (até 15 s). */
async function arquivoPronto(caminho, prazoMs = 15_000) {
  const fim = Date.now() + prazoMs;
  let anterior = -1;
  while (Date.now() < fim) {
    const tamanho = existsSync(caminho) ? statSync(caminho).size : -1;
    if (tamanho > 0 && tamanho === anterior) return;
    anterior = tamanho;
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error("O DANFE não ficou pronto a tempo.");
}

/** Erro sem o certificado nem a senha (a biblioteca pode incluí-los na mensagem). */
export function erroLimpo(e, p) {
  let msg = String(e?.message ?? e ?? "Falha no transmissor.");
  for (const segredo of [p?.certificado?.senha, p?.certificado?.pfx]) if (segredo) msg = msg.split(String(segredo)).join("[omitido]");
  return msg.replace(/-passin file:\S+/g, "-passin [omitido]").slice(0, 600);
}

const responder = (res, status, corpo) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(corpo)); };

export function criarServidor() {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/saude") return responder(res, 200, { ok: true, versao: VERSAO });
    const op = req.method === "POST" ? (req.url ?? "").replace(/^\/v1\//, "") : "";
    if (!OPERACOES[op]) return responder(res, 404, { ok: false, erro: { codigo: "NAO_EXISTE", mensagem: "Operação desconhecida." } });
    if (!segredoConfere(req.headers["x-transmissor-secret"])) return responder(res, 401, { ok: false, erro: { codigo: "NAO_AUTORIZADO", mensagem: "Segredo ausente ou errado." } });
    let tamanho = 0;
    const partes = [];
    req.on("data", (c) => { tamanho += c.length; if (tamanho > LIMITE_CORPO) req.destroy(); else partes.push(c); });
    req.on("end", async () => {
      let p = {};
      try { p = JSON.parse(Buffer.concat(partes).toString("utf8") || "{}"); } catch { return responder(res, 400, { ok: false, erro: { codigo: "JSON_INVALIDO", mensagem: "Corpo inválido." } }); }
      try {
        const resultado = await OPERACOES[op](p);
        responder(res, 200, { ok: true, resultado });
      } catch (e) {
        const mensagem = erroLimpo(e, p);
        // 656 = consumo indevido: a SEFAZ bloqueia por 1 hora quem consulta demais. Código próprio
        // para quem chama recuar, em vez de insistir.
        const codigo = e instanceof ErroDoPedido ? e.codigo : /consumo indevido/i.test(mensagem) ? "CONSUMO_INDEVIDO" : "FALHA";
        responder(res, e instanceof ErroDoPedido ? 400 : 502, { ok: false, erro: { codigo, mensagem } });
      }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (SEGREDO.length < 32) { console.error("TRANSMISSOR_SECRET ausente ou curto (mínimo 32 caracteres)."); process.exit(1); }
  criarServidor().listen(PORTA, () => console.log(`Transmissor de NF-e ${VERSAO} na porta ${PORTA}`));
}
