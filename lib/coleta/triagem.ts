/**
 * Triagem da coleta de arquivos (Segundo Cérebro, Etapa 2). Roda no navegador, no próprio
 * computador da pessoa — nada sobe para decidir. Só por regra: o Clef entra depois, e só
 * nos casos que ficarem em dúvida (e com o uso ligado pelo proprietário).
 *
 * D2 do proprietário: ignorar sempre pastas de sistema, de programas e de fotos/vídeos
 * pessoais. Documento de colaborador (holerite, férias, atestado…) não sobe pela coleta: vai
 * pelo RH (LGPD). Nome com CPF também é tratado como do RH.
 */
import type { TipoArquivo } from "../arquivos/detectar.ts";
import { cpfValido } from "../decisao/guard.ts";

export const LIMITE_COLETA = 9_500_000;

export type MotivoIgnorado = "sistema" | "programa" | "midia" | "temporario" | "compactado" | "grande";
export const ROTULO_IGNORADO: Record<MotivoIgnorado, string> = {
  sistema: "pasta de sistema ou de programas",
  programa: "programa ou atalho",
  midia: "foto, vídeo ou música pessoal",
  temporario: "arquivo temporário",
  compactado: "arquivo compactado (abra e colete o conteúdo)",
  grande: "maior que 9,5 MB",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const PASTAS_SISTEMA = new Set(["appdata", "program files", "program files (x86)", "programdata", "windows", "$recycle.bin", "system volume information", "node_modules", ".git", ".cache", "temp", "tmp", "$windows.~bt", "recovery"]);
const PASTAS_MIDIA = new Set(["imagens", "pictures", "fotos", "photos", "videos", "musicas", "music", "camera roll", "screenshots", "capturas de tela", "whatsapp images", "whatsapp video"]);
const EXT_PROGRAMA = new Set(["exe", "dll", "msi", "lnk", "url", "sys", "bat", "cmd", "ini", "inf", "cab", "iso", "db"]);
const EXT_MIDIA = new Set(["mp3", "mp4", "mov", "avi", "mkv", "wav", "wma", "wmv", "m4a", "flac", "3gp"]);
const EXT_COMPACTADO = new Set(["zip", "rar", "7z", "tar", "gz"]);

export const extensao = (nome: string) => {
  const i = nome.lastIndexOf(".");
  return i > 0 ? norm(nome.slice(i + 1)) : "";
};

/** Deve ser ignorado? `caminho` é o relativo à pasta escolhida (ex.: "Fotos/2024/a.jpg"). */
export function ignorar(caminho: string, nome: string, tamanho: number): MotivoIgnorado | null {
  const pastas = caminho.split("/").slice(0, -1).map(norm);
  if (pastas.some((p) => PASTAS_SISTEMA.has(p) || p.startsWith("."))) return "sistema";
  if (pastas.some((p) => PASTAS_MIDIA.has(p))) return "midia";
  const ext = extensao(nome);
  if (nome.startsWith("~$") || nome.startsWith(".") || ext === "tmp" || ext === "temp" || norm(nome) === "thumbs.db" || norm(nome) === "desktop.ini") return "temporario";
  if (EXT_PROGRAMA.has(ext)) return "programa";
  if (EXT_MIDIA.has(ext)) return "midia";
  if (EXT_COMPACTADO.has(ext)) return "compactado";
  if (tamanho > LIMITE_COLETA) return "grande";
  return null;
}

export type Classificacao = {
  setor: string | null;
  confianca: "regra" | "duvida";
  /** Documento de colaborador: não sobe pela coleta. */
  rh?: boolean;
  /** Parece pessoal: não sobe (a pessoa pode desmarcar a marca). */
  pessoal?: boolean;
  motivo: string;
};

const RH = /\b(holerite|contra ?cheque|folha de pagamento|recibo de pagamento de salario|ferias|atestado|aso|admissao|admissional|demissao|demissional|rescisao|ctps|carteira de trabalho|curriculo|exame (medico|periodico|admissional)|cid|ficha de epi|ponto eletronico|cartao de ponto|vale transporte|fgts|inss do funcionario)\b/;
const PESSOAL = /\b(pessoal|particular|familia|minhas fotos|receita medica|declaracao de imposto de renda pessoa fisica)\b/;
const REGRAS: { setor: string; re: RegExp; motivo: string }[] = [
  { setor: "financeiro", re: /\b(extrato|conciliacao|boleto|fatura|duplicata|comprovante|pagamento|recibo|dre|fluxo de caixa|contas a (pagar|receber)|itau|bradesco|santander|banco do brasil|caixa economica|sicoob|sicredi|emprestimo|finimp|cambio)\b/, motivo: "nome de documento financeiro" },
  { setor: "fiscal", re: /\b(danfe|nota fiscal|nf-?e|nfse|nf|icms|ipi|sped|livro fiscal|apuracao)\b/, motivo: "nome de nota ou documento fiscal" },
  { setor: "compras", re: /\b(orcamento|cotacao|pedido de compra|ordem de compra|oc|fornecedor|proforma|pro-forma)\b/, motivo: "nome de cotação ou pedido de compra" },
  { setor: "comercial", re: /\b(proposta comercial|proposta|pedido de venda|cliente|tabela de precos|catalogo)\b/, motivo: "nome de documento comercial" },
  { setor: "almoxarifado", re: /\b(estoque|inventario|almoxarifado|requisicao de material|entrada de material)\b/, motivo: "nome de estoque ou almoxarifado" },
  { setor: "fundicao", re: /\b(fundicao|corrida|vazamento|forno|liga metalica|analise quimica|espectrometria)\b/, motivo: "nome de documento da fundição" },
  { setor: "producao", re: /\b(ordem de servico|os|producao|usinagem|desenho tecnico|programa cnc)\b/, motivo: "nome de documento da produção" },
];

/** Setor sugerido para um arquivo, pelo tipo detectado no conteúdo e pelo nome (e pasta). */
export function classificar({ nome, pasta = "", tipo = "desconhecido" }: { nome: string; pasta?: string; tipo?: TipoArquivo }): Classificacao {
  const texto = norm(`${pasta} ${nome}`).replace(/[_.-]+/g, " ");
  const digitos = (nome.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g) ?? []).map((m) => m.replace(/\D/g, ""));
  if (digitos.some((d) => cpfValido(d))) return { setor: null, confianca: "regra", rh: true, motivo: "o nome tem um CPF: documento de pessoa" };
  if (RH.test(texto)) return { setor: null, confianca: "regra", rh: true, motivo: "documento de colaborador" };
  if (PESSOAL.test(texto)) return { setor: null, confianca: "regra", pessoal: true, motivo: "parece pessoal" };
  if (tipo === "ofx") return { setor: "financeiro", confianca: "regra", motivo: "extrato bancário (OFX)" };
  if (tipo === "nfe-xml") return { setor: "fiscal", confianca: "regra", motivo: "XML de nota fiscal eletrônica" };
  for (const r of REGRAS) if (r.re.test(texto)) return { setor: r.setor, confianca: "regra", motivo: r.motivo };
  return { setor: null, confianca: "duvida", motivo: "o nome não diz o setor" };
}
