/**
 * Regras da plataforma conferidas ANTES do esquema da SEFAZ — o que o esquema não pega: CFOP
 * coerente com o destino, documentos com dígito verificador, CST compatível com o regime, totais e
 * duplicatas fechando centavo a centavo. Puro e testável. Mensagens para quem está treinando.
 */
import { calcularItens, calcularTotais, icmsDestaca, r2 } from "./calculo";
import { idDestino } from "./xml";
import type { Emitente, ItemNfe, NotaNfe } from "./tipos";

export type Problema = { campo: string; mensagem: string };

const so = (t: string | null | undefined) => String(t ?? "").replace(/\D/g, "");

export function cnpjValido(c: string): boolean {
  const d = so(c);
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { let s = 0; let p = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
export function cpfValido(c: string): boolean {
  const d = so(c);
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export const CST_ICMS_NORMAL = ["00", "20", "40", "41", "50", "51", "90"];
export const CSOSN_SIMPLES = ["101", "102", "103", "300", "400"];
export const CST_IPI_SAIDA = ["50", "51", "52", "53", "54", "55", "99"];
export const CST_IPI_ENTRADA = ["00", "01", "02", "03", "04", "05", "49"];
export const CST_PIS_COFINS = ["01", "02", "04", "05", "06", "07", "08", "09", "49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "70", "71", "72", "73", "74", "75", "98", "99"];
export const FORMAS_PAGAMENTO: Record<string, string> = { "01": "Dinheiro", "15": "Boleto", "17": "PIX", "18": "Transferência / depósito", "90": "Sem pagamento", "99": "Outros" };
const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

/** O emitente da Configuração fiscal tem tudo que a NF-e exige? */
export function problemasDoEmitente(e: Partial<Emitente> | null): Problema[] {
  if (!e) return [{ campo: "emitente", mensagem: "Preencha a Configuração fiscal (dados do emitente)." }];
  const p: Problema[] = [];
  const falta = (campo: string, rotulo: string) => p.push({ campo: `emitente.${campo}`, mensagem: `Configuração fiscal: falta ${rotulo}.` });
  if (!cnpjValido(e.cnpj ?? "")) falta("cnpj", "o CNPJ (ou está inválido)");
  if (!e.razaoSocial?.trim()) falta("razaoSocial", "a razão social");
  if (!so(e.ie) && e.ie !== "ISENTO") falta("ie", "a inscrição estadual");
  if (!e.crt) falta("crt", "o regime tributário (CRT)");
  if (!e.logradouro?.trim()) falta("logradouro", "o logradouro");
  if (!e.numero?.trim()) falta("numero", "o número do endereço");
  if (!e.bairro?.trim()) falta("bairro", "o bairro");
  if (!/^\d{7}$/.test(so(e.codigoMunicipio))) falta("codigoMunicipio", "o código IBGE do município (7 dígitos)");
  if (!e.municipio?.trim()) falta("municipio", "o município");
  if (!UFS.includes((e.uf ?? "").toUpperCase())) falta("uf", "a UF");
  if (!/^\d{8}$/.test(so(e.cep))) falta("cep", "o CEP");
  return p;
}

function problemasDoItem(i: ItemNfe, k: number, crt: number, tipo: 0 | 1, destino: 1 | 2 | 3): Problema[] {
  const p: Problema[] = [];
  const n = `Item ${k + 1}`;
  const add = (campo: string, mensagem: string) => p.push({ campo: `itens.${k}.${campo}`, mensagem: `${n}: ${mensagem}` });
  if (!i.descricao.trim()) add("descricao", "falta a descrição.");
  if (!/^\d{8}$/.test(so(i.ncm))) add("ncm", "o NCM tem 8 dígitos.");
  const cfop = so(i.cfop);
  if (!/^\d{4}$/.test(cfop)) add("cfop", "o CFOP tem 4 dígitos.");
  else {
    const esperado = tipo === 1 ? { 1: "5", 2: "6", 3: "7" }[destino] : { 1: "1", 2: "2", 3: "3" }[destino];
    const onde = destino === 1 ? "dentro do estado" : destino === 2 ? "para outro estado" : "com o exterior";
    if (cfop[0] !== esperado) add("cfop", `operação de ${tipo === 1 ? "saída" : "entrada"} ${onde} usa CFOP começando por ${esperado} (está ${cfop}).`);
  }
  if (!(i.quantidade > 0)) add("quantidade", "quantidade tem de ser maior que zero.");
  if (!(i.valorUnitario > 0)) add("valorUnitario", "valor unitário tem de ser maior que zero.");
  if (i.desconto < 0 || i.desconto > r2(i.quantidade * i.valorUnitario)) add("desconto", "desconto maior que o valor do item.");
  const simples = crt === 1 || crt === 2 || crt === 4;
  if (simples ? !CSOSN_SIMPLES.includes(i.icmsCst) : !CST_ICMS_NORMAL.includes(i.icmsCst)) {
    add("icmsCst", simples ? `no Simples Nacional o ICMS usa CSOSN (${CSOSN_SIMPLES.join(", ")}).` : `no regime normal o ICMS usa CST (${CST_ICMS_NORMAL.join(", ")}).`);
  }
  if ((icmsDestaca(i.icmsCst) || i.icmsCst === "101") && !(i.icmsAliquota > 0)) add("icmsAliquota", "o CST/CSOSN escolhido pede a alíquota do ICMS.");
  if (i.icmsCst === "20" && !(i.icmsReducaoBase > 0 && i.icmsReducaoBase < 100)) add("icmsReducaoBase", "CST 20 pede o % de redução da base.");
  const ipiValidos = tipo === 1 ? CST_IPI_SAIDA : CST_IPI_ENTRADA;
  if (!ipiValidos.includes(i.ipiCst)) add("ipiCst", `CST do IPI de ${tipo === 1 ? "saída" : "entrada"}: ${ipiValidos.join(", ")}.`);
  for (const [campo, rotulo] of [["pisCst", "PIS"], ["cofinsCst", "COFINS"]] as const) {
    if (!CST_PIS_COFINS.includes(i[campo])) add(campo, `CST do ${rotulo} inválido.`);
  }
  return p;
}

export function validarNota(nota: NotaNfe, emitente: Partial<Emitente> | null): { erros: Problema[]; avisos: Problema[] } {
  const erros: Problema[] = [...problemasDoEmitente(emitente)];
  const avisos: Problema[] = [];
  const d = nota.destinatario;
  const doc = so(d.documento);
  if (!nota.natureza.trim()) erros.push({ campo: "natureza", mensagem: "Informe a natureza da operação." });
  if (doc.length === 14 ? !cnpjValido(doc) : doc.length === 11 ? !cpfValido(doc) : true) erros.push({ campo: "destinatario.documento", mensagem: "Destinatário: CNPJ ou CPF inválido." });
  if (!d.nome.trim()) erros.push({ campo: "destinatario.nome", mensagem: "Destinatário: falta o nome." });
  if (!d.logradouro.trim() || !d.numero.trim() || !d.bairro.trim() || !d.municipio.trim()) erros.push({ campo: "destinatario.endereco", mensagem: "Destinatário: endereço incompleto (logradouro, número, bairro e município)." });
  if (!/^\d{7}$/.test(so(d.codigoMunicipio))) erros.push({ campo: "destinatario.codigoMunicipio", mensagem: "Destinatário: código IBGE do município com 7 dígitos." });
  if (!UFS.includes(d.uf.toUpperCase())) erros.push({ campo: "destinatario.uf", mensagem: "Destinatário: UF inválida." });
  if (!/^\d{8}$/.test(so(d.cep))) erros.push({ campo: "destinatario.cep", mensagem: "Destinatário: CEP com 8 dígitos." });
  if (d.indIE === 1 && !/^\d{2,14}$/.test(so(d.ie))) erros.push({ campo: "destinatario.ie", mensagem: "Destinatário contribuinte: informe a inscrição estadual." });
  if (d.indIE === 9 && !nota.consumidorFinal) erros.push({ campo: "consumidorFinal", mensagem: "Destinatário não contribuinte do ICMS: a operação tem de ser marcada como consumidor final." });
  if (doc.length === 11 && d.indIE === 1) erros.push({ campo: "destinatario.indIE", mensagem: "Pessoa física (CPF) em geral não é contribuinte do ICMS: confira o indicador da IE." });
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) erros.push({ campo: "destinatario.email", mensagem: "Destinatário: e-mail inválido." });
  if (nota.finalidade === 4 && !/^\d{44}$/.test(so(nota.referencia))) erros.push({ campo: "referencia", mensagem: "Nota de devolução: informe a chave da NF-e devolvida." });

  if (!nota.itens.length) erros.push({ campo: "itens", mensagem: "Inclua ao menos um item." });
  const destino = idDestino(emitente?.uf ?? "", d.uf, d.pais);
  nota.itens.forEach((i, k) => erros.push(...problemasDoItem(i, k, emitente?.crt ?? 3, nota.tipo, destino)));

  const totais = calcularTotais(calcularItens(nota));
  const formas = Object.keys(FORMAS_PAGAMENTO);
  if (!formas.includes(nota.pagamento.forma)) erros.push({ campo: "pagamento.forma", mensagem: "Escolha a forma de pagamento." });
  const dups = nota.pagamento.duplicatas;
  if (dups.length) {
    const soma = r2(dups.reduce((a, x) => a + (x.valor || 0), 0));
    if (soma !== totais.vNF) erros.push({ campo: "pagamento.duplicatas", mensagem: `As duplicatas somam R$ ${soma.toFixed(2).replace(".", ",")} e a nota vale R$ ${totais.vNF.toFixed(2).replace(".", ",")}: têm de fechar centavo a centavo.` });
    if (dups.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.vencimento))) erros.push({ campo: "pagamento.duplicatas", mensagem: "Toda duplicata precisa de vencimento." });
  }
  if (nota.pagamento.forma === "15" && !dups.length) avisos.push({ campo: "pagamento.duplicatas", mensagem: "Pagamento por boleto sem duplicatas: confira se é à vista." });
  if (totais.vNF <= 0) erros.push({ campo: "totais", mensagem: "O valor da nota tem de ser maior que zero." });
  if (nota.frete.modalidade !== 9 && !nota.frete.transportadora?.nome && nota.frete.modalidade !== 0) avisos.push({ campo: "frete", mensagem: "Frete por conta do destinatário/terceiros sem transportadora informada." });
  return { erros, avisos };
}

/** Modelos de operação para agilizar o treino (o Jefferson confirma CFOP e impostos). */
export const MODELOS_OPERACAO: { id: string; rotulo: string; natureza: string; cfopDentro: string; cfopFora: string; tipo: 0 | 1; finalidade: 1 | 4 }[] = [
  { id: "venda", rotulo: "Venda de produção própria", natureza: "VENDA DE PRODUCAO DO ESTABELECIMENTO", cfopDentro: "5101", cfopFora: "6101", tipo: 1, finalidade: 1 },
  { id: "revenda", rotulo: "Venda de mercadoria de terceiros", natureza: "VENDA DE MERCADORIA ADQUIRIDA DE TERCEIROS", cfopDentro: "5102", cfopFora: "6102", tipo: 1, finalidade: 1 },
  { id: "remessa_ind", rotulo: "Remessa para industrialização", natureza: "REMESSA PARA INDUSTRIALIZACAO", cfopDentro: "5901", cfopFora: "6901", tipo: 1, finalidade: 1 },
  { id: "retorno_ind", rotulo: "Retorno de industrialização", natureza: "RETORNO DE MERCADORIA UTILIZADA NA INDUSTRIALIZACAO", cfopDentro: "5902", cfopFora: "6902", tipo: 1, finalidade: 1 },
  { id: "conserto", rotulo: "Remessa para conserto", natureza: "REMESSA PARA CONSERTO OU REPARO", cfopDentro: "5915", cfopFora: "6915", tipo: 1, finalidade: 1 },
  { id: "devolucao_compra", rotulo: "Devolução de compra", natureza: "DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO", cfopDentro: "5201", cfopFora: "6201", tipo: 1, finalidade: 4 },
];
