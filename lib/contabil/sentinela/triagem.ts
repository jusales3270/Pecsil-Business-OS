/**
 * Sentinela (N-02): triagem por regra. Decide, sem modelo, se um item novo pode mexer numa regra e em
 * qual parâmetro ou tese. Só o que passa aqui vai para a extração (e só texto público vai para fora).
 */

export type NivelFonte = "fonte_oficial" | "tribunal" | "dado_api" | "imprensa";
export type TeseVigiada = { id: string; tribunal: string; tema: string; situacao: string };
export type Triagem = { relevante: boolean; pontos: number; chaves: string[]; teses: string[]; motivos: string[] };

/** Assunto → parâmetros que ele pode mexer. Os nomes são as chaves de contabil_parametros. */
export const ASSUNTOS: { chaves: string[]; rotulo: string; padrao: RegExp }[] = [
  { chaves: ["salario_minimo"], rotulo: "salário mínimo", padrao: /sal[áa]rio[- ]m[íi]nimo/i },
  { chaves: ["inss_segurado_tabela", "salario_familia"], rotulo: "tabela do INSS", padrao: /contribui[çc][ãa]o (do|dos) segurad|tabela (de contribui[çc][ãa]o|do INSS)|portaria interministerial (MPS|MTP)|sal[áa]rio[- ]fam[íi]lia|teto (do INSS|previdenci)/i },
  { chaves: ["irrf_tabela_mensal", "irrf_reducao_lei_15270"], rotulo: "IRRF", padrao: /imposto (sobre a )?renda|IRRF|IRPF|tabela progressiva|Lei (n[º°o.]?\s*)?15\.?270|desconto simplificado/i },
  { chaves: ["dividendos_retencao_fonte"], rotulo: "dividendos", padrao: /dividendos|lucros distribu[íi]dos|tributa[çc][ãa]o m[íi]nima|IRPFM/i },
  { chaves: ["fgts"], rotulo: "FGTS", padrao: /\bFGTS\b/i },
  { chaves: ["prazo_esocial_fechamento"], rotulo: "eSocial", padrao: /eSocial|S-1299|leiaute S-1\.\d/i },
  { chaves: ["prazo_efd_reinf", "retencao_inss_11_cessao_mao_de_obra"], rotulo: "EFD-Reinf", padrao: /Reinf|R-20[0-9]{2}|R-40[0-9]{2}/i },
  { chaves: ["prazo_dctfweb"], rotulo: "DCTFWeb", padrao: /DCTF ?Web|M[óo]dulo de Inclus[ãa]o de Tributos/i },
  { chaves: ["prazo_efd_contribuicoes", "pis_cofins_aliquotas"], rotulo: "EFD-Contribuições", padrao: /EFD[- ]Contribui[çc][õo]es/i },
  { chaves: ["prazo_efd_icms_ipi", "gia_sp"], rotulo: "EFD ICMS/IPI", padrao: /EFD[- ]ICMS|SPED Fiscal|\bGIA\b|Bloco K/i },
  { chaves: ["prazo_ecd"], rotulo: "ECD", padrao: /\bECD\b|Escritura[çc][ãa]o Cont[áa]bil Digital/i },
  { chaves: ["prazo_ecf", "lucro_presumido_percentuais"], rotulo: "ECF", padrao: /\bECF\b|Escritura[çc][ãa]o Cont[áa]bil Fiscal/i },
  { chaves: ["lucro_presumido_percentuais"], rotulo: "Lucro Presumido", padrao: /lucro presumido|Lei Complementar (n[º°o.]?\s*)?224|LC 224|percentua(l|is) de presun[çc][ãa]o/i },
  { chaves: ["pis_cofins_aliquotas"], rotulo: "PIS/COFINS", padrao: /\bPIS\b|COFINS|Cofins|PIS\/Pasep/ },
  { chaves: ["reforma_2026_fase_teste", "reforma_2027", "reforma_aliquota_referencia", "reforma_2029_2033", "reforma_creditos_e_regimes"], rotulo: "reforma tributária", padrao: /\bIBS\b|\bCBS\b|Imposto Seletivo|split payment|pagamento cindido|Comit[êe] Gestor do (IBS|Imposto sobre Bens)|CGIBS|reforma tribut[áa]ria|Lei Complementar (n[º°o.]?\s*)?(214|227)|al[íi]quota de refer[êe]ncia|DeRE|apura[çc][ãa]o assistida/i },
  { chaves: ["retencao_irrf_tomador_pj", "retencao_csrf_tomador_pj", "retencao_inss_11_cessao_mao_de_obra"], rotulo: "retenções", padrao: /reten[çc][ãa]o na fonte|reten[çc][õo]es|CSRF|cess[ãa]o de m[ãa]o de obra|IN RFB (n[º°o.]?\s*)?2\.?110/i },
  { chaves: ["iss_regra_geral"], rotulo: "ISS", padrao: /\bISS\b|ISSQN|Lei Complementar (n[º°o.]?\s*)?116|NFS-e/i },
  { chaves: ["depreciacao_taxas_fiscais"], rotulo: "depreciação", padrao: /deprecia[çc][ãa]o|IN (RFB|SRF) (n[º°o.]?\s*)?1\.?700|CIAP/i },
  { chaves: ["fap_vigencia_2026", "fap_vigencia_2027"], rotulo: "FAP/RAT", padrao: /\bFAP\b|Fator Acident[áa]rio|\bRAT\b|GILRAT/i },
  { chaves: ["terceiros_base_calculo"], rotulo: "contribuições a terceiros", padrao: /contribui[çc][õo]es (a|devidas a) terceiros|Sistema S|20 sal[áa]rios[- ]m[íi]nimos|sal[áa]rio[- ]educa[çc][ãa]o/i },
  { chaves: ["codigos_darf", "vencimentos_federais"], rotulo: "DARF e vencimentos", padrao: /c[óo]digo(s)? de receita|\bDARF\b|agenda tribut[áa]ria|prazo de (recolhimento|vencimento)/i },
  { chaves: ["feriados_nacionais"], rotulo: "feriados", padrao: /feriado nacional|ponto facultativo/i },
  { chaves: ["reforma_2026_fase_teste"], rotulo: "NF-e", padrao: /Nota T[ée]cnica|NT 20\d\d\.\d{3}|leiaute da NF-?e|rejei[çc][ãa]o/i },
];

/** Tipos de ato que costumam mudar regra (valem pontos a mais). */
const ATO_NORMATIVO = /Instru[çc][ãa]o Normativa|IN RFB|Lei Complementar|Lei (n[º°o.]?\s*)?\d|Decreto|Portaria|Conv[êe]nio ICMS|Ajuste SINIEF|Ato COTEPE|Ato Conjunto|Ato T[ée]cnico Conjunto|Resolu[çc][ãa]o (CGIBS|do Senado|CGSN)|Solu[çc][ãa]o de Consulta|Ato Declarat[óo]rio|Parecer (SEI|PGFN)|Medida Provis[óo]ria|S[úu]mula/i;
/** Assunto que não é da empresa (e que a palavra "renda" ou "ISS" puxaria por engano). */
const FORA = /\b(ITR|DITR|aduaneir|leil[ãa]o|apreens[ãa]o|contrabando|bagagem|IRPF 20\d\d.*restitui|lote de restitui|concurso p[úu]blico|edital de licita)/i;

const numeroDoTema = (v: string) => v.replace(/\D/g, "");

/** Os temas citados no texto ("Tema 118", "Tema nº 1.390", "Tema Repetitivo 1416"). */
export function temasCitados(texto: string) {
  return [...texto.matchAll(/Tema(?:s)?\s*(?:de\s+)?(?:repetitivo|de repercuss[ãa]o geral|RG)?\s*(?:n[º°o.]?\s*)?(\d[\d.]{0,6})/gi)].map((m) => numeroDoTema(m[1]));
}

export function triar(item: { titulo: string; resumo: string }, nivel: NivelFonte, contexto: { teses: TeseVigiada[]; tribunal?: string | null }): Triagem {
  const texto = `${item.titulo}\n${item.resumo}`;
  const motivos: string[] = [];
  const chaves = new Set<string>();
  const teses = new Set<string>();
  let pontos = 0;
  if (FORA.test(item.titulo)) return { relevante: false, pontos: 0, chaves: [], teses: [], motivos: ["assunto fora do escopo da empresa"] };
  for (const a of ASSUNTOS) {
    if (!a.padrao.test(texto)) continue;
    const noTitulo = a.padrao.test(item.titulo);
    pontos += noTitulo ? 3 : 1;
    a.chaves.forEach((c) => chaves.add(c));
    motivos.push(`${a.rotulo}${noTitulo ? " (no título)" : ""}`);
  }
  if (ATO_NORMATIVO.test(texto)) { pontos += 2; motivos.push("cita ato normativo"); }
  const temas = new Set(temasCitados(texto));
  for (const t of contexto.teses) {
    if (!temas.has(numeroDoTema(t.tema))) continue;
    const tribunalBate = !contexto.tribunal || contexto.tribunal === t.tribunal || new RegExp(`\\b${t.tribunal}\\b`).test(texto);
    if (!tribunalBate) continue;
    teses.add(t.id);
    pontos += t.situacao === "firmada" ? 2 : 4;
    motivos.push(`tema ${t.tema} do ${t.tribunal}${t.situacao === "firmada" ? "" : " (vigiado: ainda pode mudar)"}`);
  }
  // Tribunal só interessa quando é tributário/trabalhista e cita tema ou súmula.
  if (nivel === "tribunal" && !teses.size && !/tribut|contribui[çc]|imposto|ICMS|PIS|COFINS|IRPJ|CSLL|previdenci|FGTS|trabalhist|repercuss[ãa]o geral|repetitivo|s[úu]mula/i.test(texto)) {
    return { relevante: false, pontos, chaves: [], teses: [], motivos: [...motivos, "julgamento sem assunto fiscal ou trabalhista"] };
  }
  const minimo = nivel === "imprensa" ? 5 : 3;
  return { relevante: pontos >= minimo && (chaves.size > 0 || teses.size > 0), pontos, chaves: [...chaves].slice(0, 6), teses: [...teses].slice(0, 4), motivos };
}
