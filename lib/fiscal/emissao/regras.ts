/**
 * Regras da plataforma conferidas ANTES do esquema da SEFAZ — o que o esquema não pega: CFOP
 * coerente com o destino, documentos com dígito verificador, CST compatível com o regime, totais e
 * duplicatas fechando centavo a centavo. Puro e testável. Mensagens para quem está treinando.
 */
import { ibsCbsTributa, icmsDestaca, r2, totaisDaNota, valorDoItem } from "./calculo";
import { exterior } from "./destino";
import { emailsValidos } from "./email";
export { emailsValidos };
import { dvChave, idDestino } from "./xml";
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
export const CST_PIS_COFINS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "49", "50", "51", "52", "53", "54", "55", "56", "60", "61", "62", "63", "64", "65", "66", "67", "70", "71", "72", "73", "74", "75", "98", "99"];
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

function problemasDoItem(i: ItemNfe, k: number, crt: number, tipo: 0 | 1, destino: 1 | 2 | 3, finalidade: NotaNfe["finalidade"]): Problema[] {
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
  // Nota complementar ou de ajuste (ex.: crédito do CIAP) pode ter valor de produto zero.
  const ajuste = finalidade === 2 || finalidade === 3;
  if (!(i.quantidade > 0)) add("quantidade", "quantidade tem de ser maior que zero.");
  if (!(i.valorUnitario > 0) && !ajuste) add("valorUnitario", "valor unitário tem de ser maior que zero.");
  if (i.desconto < 0 || i.desconto > valorDoItem(i)) add("desconto", "desconto maior que o valor do item.");
  if (typeof i.valorTotal === "number" && Math.abs(i.valorTotal - r2(i.quantidade * i.valorUnitario)) > 0.01 + i.quantidade * 0.00005) {
    add("valorTotal", `o valor do item (${i.valorTotal.toFixed(2)}) não fecha com quantidade × valor unitário (${(i.quantidade * i.valorUnitario).toFixed(2)}).`);
  }
  // Exportação e importação: a SEFAZ exige os grupos próprios.
  if (cfop.startsWith("7501") && !(i.exportacao ?? []).some((x) => x.indireta?.chave)) add("exportacao", "CFOP 7501 (exportação de mercadoria recebida com fim de exportação) pede a nota de remessa e a quantidade exportada.");
  if (tipo === 0 && cfop.startsWith("3") && !(i.di ?? []).length) add("di", "entrada do exterior (CFOP 3xxx) pede a declaração de importação (DI/DUIMP) com as adições.");
  if ((i.di ?? []).some((d) => !d.numero || !d.data || !d.dataDesembaraco || !d.localDesembaraco || !d.ufDesembaraco || !d.exportador || !d.adicoes.length)) {
    add("di", "declaração de importação incompleta: número, data, local, UF e data do desembaraço, exportador e ao menos uma adição.");
  }
  const simples = crt === 1 || crt === 2 || crt === 4;
  if (simples ? !CSOSN_SIMPLES.includes(i.icmsCst) : !CST_ICMS_NORMAL.includes(i.icmsCst)) {
    add("icmsCst", simples ? `no Simples Nacional o ICMS usa CSOSN (${CSOSN_SIMPLES.join(", ")}).` : `no regime normal o ICMS usa CST (${CST_ICMS_NORMAL.join(", ")}).`);
  }
  const icmsInformado = typeof i.informado?.vICMS === "number";
  // CST 90 ("outras") pode ir sem alíquota, sem destaque (devolução de material de uso e consumo, por exemplo).
  if ((icmsDestaca(i.icmsCst) || i.icmsCst === "101") && i.icmsCst !== "90" && !(i.icmsAliquota > 0) && !icmsInformado) add("icmsAliquota", "o CST/CSOSN escolhido pede a alíquota do ICMS.");
  if (i.icmsCst === "20" && !(i.icmsReducaoBase > 0 && i.icmsReducaoBase < 100)) add("icmsReducaoBase", "CST 20 pede o % de redução da base.");
  const ipiValidos = tipo === 1 ? CST_IPI_SAIDA : CST_IPI_ENTRADA;
  if (!ipiValidos.includes(i.ipiCst)) add("ipiCst", `CST do IPI de ${tipo === 1 ? "saída" : "entrada"}: ${ipiValidos.join(", ")}.`);
  for (const [campo, rotulo] of [["pisCst", "PIS"], ["cofinsCst", "COFINS"]] as const) {
    if (!CST_PIS_COFINS.includes(i[campo])) add(campo, `CST do ${rotulo} inválido.`);
    else if (i[campo] === "03") add(campo, `CST 03 do ${rotulo} (por quantidade) ainda não é emitido pela plataforma.`);
  }
  if (i.ibsCbsCst) {
    const cst = so(i.ibsCbsCst);
    if (!CST_IBS_CBS.includes(cst)) add("ibsCbsCst", `CST ${i.ibsCbsCst} do IBS/CBS ainda não é emitido pela plataforma (aceitos: ${CST_IBS_CBS.join(", ")}); os outros pedem grupos de redução ou diferimento.`);
    const cClass = so(i.cClassTrib);
    if (!/^\d{6}$/.test(cClass)) add("cClassTrib", "a classificação tributária (cClassTrib) tem 6 dígitos.");
    else if (!cClass.startsWith(cst)) add("cClassTrib", `a classificação ${cClass} não é do CST ${cst}: os 3 primeiros dígitos têm de ser o CST.`);
    if (ibsCbsTributa(cst) && !((i.cbsAliquota ?? 0) > 0)) add("cbsAliquota", "o CST do IBS/CBS tributa e falta a alíquota da CBS.");
  }
  return p;
}

/**
 * Devolução (finalidade 4), NT 2025.002 v1.52, grupo VC: cada item aponta a nota e o item devolvidos
 * (DFeReferenciado; obrigatório e sem refNFe desde 03/11/2026, RV VC02-14 e VC03-20); a mesma nota e item não se
 * repetem (VC02-20); todas as notas referenciadas são do mesmo emitente (VC02-40), que é o destinatário desta ou a
 * própria empresa (nota de entrada que ela emitiu; VC02-50). A chave tem dígito verificador.
 */
export function problemasDaDevolucao(nota: NotaNfe, emitente: Partial<Emitente> | null): Problema[] {
  const p: Problema[] = [];
  const vistos = new Set<string>();
  const emitentes = new Set<string>();
  nota.itens.forEach((i, k) => {
    const campo = `itens.${k}.dfeReferenciado`;
    const chave = so(i.dfeReferenciado?.chave ?? nota.referencia);
    if (!/^\d{44}$/.test(chave)) { p.push({ campo, mensagem: `Item ${k + 1}: informe a chave da NF-e devolvida (44 dígitos).` }); return; }
    if (!chaveValida(chave)) { p.push({ campo, mensagem: `Item ${k + 1}: a chave da NF-e devolvida não confere (dígito verificador).` }); return; }
    if (!i.dfeReferenciado?.nItem) { p.push({ campo, mensagem: `Item ${k + 1}: informe o número do item na nota devolvida.` }); return; }
    const par = `${chave}#${i.dfeReferenciado.nItem}`;
    if (vistos.has(par)) p.push({ campo, mensagem: `Item ${k + 1}: o item ${i.dfeReferenciado.nItem} da nota devolvida já foi referenciado em outro item.` });
    vistos.add(par);
    emitentes.add(chave.slice(6, 20));
  });
  if (emitentes.size > 1) p.push({ campo: "referencia", mensagem: "Devolução: todas as notas devolvidas têm de ser do mesmo emitente." });
  const [doc] = [...emitentes];
  const proprio = so(emitente?.cnpj), destinatario = so(nota.destinatario.documento);
  if (emitentes.size === 1 && doc !== proprio && doc !== destinatario.padStart(14, "0")) {
    p.push({ campo: "referencia", mensagem: "Devolução: a nota devolvida tem de ser do destinatário desta nota (ou uma nota de entrada da própria empresa)." });
  }
  return p;
}

/** Chave de acesso com o dígito verificador certo (módulo 11). */
export const chaveValida = (chave: string) => /^\d{44}$/.test(so(chave)) && dvChave(so(chave).slice(0, 43)) === Number(so(chave)[43]);

/** CST de IBS/CBS que a plataforma emite hoje: tributação integral (000) e não incidência/imunidade (410). */
export const CST_IBS_CBS = ["000", "410"];

/** Alíquotas legais do IBS/CBS em vigor na data da emissão (parâmetro legal, em fração: 0,009 = 0,9%). */
export type IbsCbsLegal = { cbs: number; ibs: number; norma: string; aConferir: boolean };

const pct = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;

/**
 * IBS/CBS conferido contra a lei em vigor: alíquota da máscara × parâmetro legal, e nota de saída
 * do regime normal sem o grupo. Só avisa: em 2026 a SEFAZ de produção ainda não rejeita (rejeição suspensa pelo Ato
 * Técnico Conjunto RFB/CGIBS 1/2026). A de homologação JÁ rejeita: lá a falta do grupo é erro (servidor.ts).
 */
export function avisosIbsCbs(nota: NotaNfe, crt: number, legal: IbsCbsLegal | null): Problema[] {
  const avisos: Problema[] = [];
  const normal = crt === 3;
  if (normal && nota.tipo === 1 && nota.itens.length && !nota.itens.some((i) => i.ibsCbsCst)) {
    avisos.push({ campo: "itens", mensagem: "Nenhum item leva o grupo IBS/CBS: no regime normal ele é obrigatório desde 03/08/2026 (a SEFAZ de produção ainda não rejeita; a de homologação já rejeita). Confira a máscara de impostos." });
  }
  if (!legal) {
    if (nota.itens.some((i) => ibsCbsTributa(i.ibsCbsCst))) avisos.push({ campo: "itens", mensagem: "Não há parâmetro legal de IBS/CBS em vigor nesta data: as alíquotas da máscara não foram conferidas." });
    return avisos;
  }
  const cbs = r2(legal.cbs * 100), ibs = r2(legal.ibs * 100);
  nota.itens.forEach((i, k) => {
    if (!ibsCbsTributa(i.ibsCbsCst)) return;
    if (r2(i.cbsAliquota ?? 0) !== cbs || r2(i.ibsAliquota ?? 0) !== ibs) {
      avisos.push({ campo: `itens.${k}.cbsAliquota`, mensagem: `Item ${k + 1}: a máscara usa CBS ${pct(i.cbsAliquota ?? 0)} e IBS ${pct(i.ibsAliquota ?? 0)}; a lei em vigor (${legal.norma}) manda CBS ${pct(cbs)} e IBS ${pct(ibs)}.` });
    }
  });
  if (legal.aConferir) avisos.push({ campo: "itens", mensagem: "As alíquotas legais do IBS/CBS ainda estão a conferir em Fiscal › Parâmetros legais." });
  return avisos;
}

export function validarNota(nota: NotaNfe, emitente: Partial<Emitente> | null): { erros: Problema[]; avisos: Problema[] } {
  const erros: Problema[] = [...problemasDoEmitente(emitente)];
  const avisos: Problema[] = [];
  const d = nota.destinatario;
  const doc = so(d.documento);
  const fora = exterior(d.pais);
  if (!nota.natureza.trim()) erros.push({ campo: "natureza", mensagem: "Informe a natureza da operação." });
  if (fora) {
    // Exterior: identificação estrangeira (pode ir vazia), país do BACEN, sem município, UF ou CEP do Brasil.
    if (!/^\d{2,4}$/.test(so(d.pais))) erros.push({ campo: "destinatario.pais", mensagem: "Destinatário no exterior: informe o código do país (tabela do BACEN)." });
    if (!d.nomePais?.trim()) erros.push({ campo: "destinatario.nomePais", mensagem: "Destinatário no exterior: informe o nome do país." });
    if (d.indIE !== 9) erros.push({ campo: "destinatario.indIE", mensagem: "Destinatário no exterior não tem inscrição estadual: use 9 (não contribuinte)." });
    if (!/^[A-Za-z0-9.\-/ ]{0,20}$/.test(d.documento)) erros.push({ campo: "destinatario.documento", mensagem: "Identificação estrangeira: até 20 letras ou números." });
  } else if (doc.length === 14 ? !cnpjValido(doc) : doc.length === 11 ? !cpfValido(doc) : true) erros.push({ campo: "destinatario.documento", mensagem: "Destinatário: CNPJ ou CPF inválido." });
  if (!d.nome.trim()) erros.push({ campo: "destinatario.nome", mensagem: "Destinatário: falta o nome." });
  if (!d.logradouro.trim() || !d.numero.trim() || !d.bairro.trim() || (!d.municipio.trim() && !fora)) erros.push({ campo: "destinatario.endereco", mensagem: "Destinatário: endereço incompleto (logradouro, número, bairro e município)." });
  if (!fora) {
    if (!/^\d{7}$/.test(so(d.codigoMunicipio))) erros.push({ campo: "destinatario.codigoMunicipio", mensagem: "Destinatário: código IBGE do município com 7 dígitos." });
    if (!UFS.includes(d.uf.toUpperCase())) erros.push({ campo: "destinatario.uf", mensagem: "Destinatário: UF inválida." });
    if (!/^\d{8}$/.test(so(d.cep))) erros.push({ campo: "destinatario.cep", mensagem: "Destinatário: CEP com 8 dígitos." });
  }
  if (d.indIE === 1 && !/^\d{2,14}$/.test(so(d.ie))) erros.push({ campo: "destinatario.ie", mensagem: "Destinatário contribuinte: informe a inscrição estadual." });
  // Venda ao consumidor pede o total aproximado de tributos (Lei 12.741/2012), que a plataforma ainda não calcula.
  const venda = nota.itens.some((i) => /^[567]1\d\d$/.test(so(i.cfop)));
  if (nota.consumidorFinal && nota.tipo === 1 && nota.finalidade === 1 && venda) {
    erros.push({ campo: "consumidorFinal", mensagem: "Venda a consumidor final pede o total aproximado de tributos (Lei 12.741/2012), que a plataforma ainda não calcula: fale com o Fiscal." });
  }
  // No exterior o destinatário é sempre "não contribuinte" (9) e a operação não é a consumidor final (exportação, importação).
  if (d.indIE === 9 && !nota.consumidorFinal && !fora) erros.push({ campo: "consumidorFinal", mensagem: "Destinatário não contribuinte do ICMS: a operação tem de ser marcada como consumidor final." });
  if (doc.length === 11 && d.indIE === 1) erros.push({ campo: "destinatario.indIE", mensagem: "Pessoa física (CPF) em geral não é contribuinte do ICMS: confira o indicador da IE." });
  // E-mail é opcional na NF-e: inválido não trava a nota, sai sem ele (e o aviso pede para corrigir o cadastro).
  if (d.email && !emailsValidos(d.email)) avisos.push({ campo: "destinatario.email", mensagem: "Destinatário: o e-mail parece inválido e a nota sai sem ele; corrija no cadastro do cliente." });
  if (nota.finalidade === 2 && !/^\d{44}$/.test(so(nota.referencia))) erros.push({ campo: "referencia", mensagem: "Nota complementar: informe a chave da NF-e complementada." });
  if (nota.finalidade === 4) erros.push(...problemasDaDevolucao(nota, emitente));

  if (!nota.itens.length) erros.push({ campo: "itens", mensagem: "Inclua ao menos um item." });
  const destino = idDestino(emitente?.uf ?? "", d.uf, d.pais);
  nota.itens.forEach((i, k) => erros.push(...problemasDoItem(i, k, emitente?.crt ?? 3, nota.tipo, destino, nota.finalidade)));
  if (nota.tipo === 1 && destino === 3 && !(nota.exportacao?.ufSaida && nota.exportacao.localExportacao)) {
    erros.push({ campo: "exportacao", mensagem: "Exportação: informe a UF e o local de embarque da mercadoria." });
  }
  if (typeof nota.valorTotalInformado === "number" && !nota.itens.some((i) => i.informado)) {
    erros.push({ campo: "valorTotalInformado", mensagem: "Total informado só vale em nota com valores informados (importação pela DI)." });
  }

  const totais = totaisDaNota(nota);
  const formas = Object.keys(FORMAS_PAGAMENTO);
  if (!formas.includes(nota.pagamento.forma)) erros.push({ campo: "pagamento.forma", mensagem: "Escolha a forma de pagamento." });
  const dups = nota.pagamento.duplicatas;
  if (dups.length) {
    const soma = r2(dups.reduce((a, x) => a + (x.valor || 0), 0));
    if (soma !== totais.vNF) erros.push({ campo: "pagamento.duplicatas", mensagem: `As duplicatas somam R$ ${soma.toFixed(2).replace(".", ",")} e a nota vale R$ ${totais.vNF.toFixed(2).replace(".", ",")}: têm de fechar centavo a centavo.` });
    if (dups.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.vencimento))) erros.push({ campo: "pagamento.duplicatas", mensagem: "Toda duplicata precisa de vencimento." });
  }
  if (nota.pagamento.forma === "15" && !dups.length) avisos.push({ campo: "pagamento.duplicatas", mensagem: "Pagamento por boleto sem duplicatas: confira se é à vista." });
  const partes = nota.pagamento.partes ?? [];
  if (partes.length) {
    const soma = r2(partes.reduce((a, x) => a + (x.valor || 0), 0));
    if (partes.some((x) => !formas.includes(x.forma))) erros.push({ campo: "pagamento.partes", mensagem: "Pagamento em partes: escolha a forma de cada parte." });
    if (!partes.every((x) => x.forma === "90") && soma !== totais.vNF) erros.push({ campo: "pagamento.partes", mensagem: `As partes do pagamento somam R$ ${soma.toFixed(2).replace(".", ",")} e a nota vale R$ ${totais.vNF.toFixed(2).replace(".", ",")}.` });
  }
  if (totais.vNF <= 0 && nota.finalidade !== 3) erros.push({ campo: "totais", mensagem: "O valor da nota tem de ser maior que zero." });
  if ([1, 2].includes(nota.frete.modalidade) && !nota.frete.transportadora?.nome) avisos.push({ campo: "frete", mensagem: "Frete por conta do destinatário/terceiros sem transportadora informada." });
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
