/**
 * Carga do cadastro de materiais exportado do GRV (docs/PLANO-ALMOXARIFADO.md, M1).
 *
 * Cada planilha (Matéria-prima, Embalagem, Produto intermediário, Material de uso e consumo) tem as
 * mesmas colunas: código interno, item, unidade, família, grupo, custo, NCM, plano de contas, tipo do
 * item e saldo. Aqui só se prepara a linha (puro, testável); quem grava é
 * scripts/import-almoxarifado-materiais.mjs.
 *
 * O grupo vem do código (`8-10-00953` → prefixo 8, grupo 10), não da coluna "Grupo": a coluna erra em
 * alguns itens. O saldo do GRV vai só como referência (saldo_grv): o estoque abre com contagem (M4).
 */

export type Celula = string | number | null;

export type Familia = "materia_prima" | "embalagem" | "produto_intermediario" | "uso_consumo" | "outro";

export const FAMILIAS: Record<Familia, string> = {
  materia_prima: "Matéria-prima",
  embalagem: "Embalagem",
  produto_intermediario: "Produto intermediário",
  uso_consumo: "Material de uso e consumo",
  outro: "Outros",
};

/** "01 - MATERIA PRIMA" → materia_prima (pelo número da família no GRV). */
export function familiaDoGrv(texto: Celula): Familia {
  const n = String(texto ?? "").trim().slice(0, 2);
  return n === "01" ? "materia_prima" : n === "02" ? "embalagem" : n === "06" ? "produto_intermediario" : n === "07" ? "uso_consumo" : "outro";
}

/** Grafias diferentes da mesma unidade viram uma só (PC e PÇ são peça; MT e M são metro). */
const UNIDADES: Record<string, string> = { PC: "PÇ", PCS: "PÇ", MT: "M", MTS: "M", NENHUM: "UN", "": "UN" };
export function unidadePadrao(texto: Celula): string {
  const u = String(texto ?? "").trim().toUpperCase();
  return UNIDADES[u] ?? u.slice(0, 8);
}

/** Número como o GRV exporta: 70,2 · 8488,857 · 2875 · 1.234,5. */
export function numeroGrv(v: Celula): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
}

export const limpar = (v: Celula, max: number) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** "8-10-00953" → { prefixo: "8", grupo: "10", sequencia: 953 }. Código fora do padrão: sem grupo. */
export function grupoDoCodigo(codigo: string): { prefixo: string; grupo: string; sequencia: number } | null {
  const m = /^([0-9A-Z]{1,6})-([0-9A-Z]{1,6})-(\d{1,5})$/.exec(codigo.trim().toUpperCase());
  return m ? { prefixo: m[1], grupo: m[2], sequencia: Number(m[3]) } : null;
}

export type Pendencia = "sem_ncm" | "custo_zero" | "tipo_diverge" | "plano_suspeito" | "sem_plano" | "unidade_ajustada";
export const PENDENCIAS: Record<Pendencia, string> = {
  sem_ncm: "Sem NCM",
  custo_zero: "Sem custo",
  tipo_diverge: "Tipo fiscal diferente da família",
  plano_suspeito: "Plano de contas a conferir",
  sem_plano: "Sem plano de contas",
  unidade_ajustada: "Unidade padronizada",
};

/** Tipo do item do SPED (01 Matéria-prima, 02 Embalagem, 06 Intermediário, 07 Uso e consumo…) esperado por família. */
const TIPO_DA_FAMILIA: Record<Familia, string | null> = { materia_prima: "01", embalagem: "02", produto_intermediario: "06", uso_consumo: "07", outro: null };
// Plano de contas que não combina com material comprado para estoque (achado na análise de 15/10).
const PLANOS_SUSPEITOS = new Set(["DESPESAS DE VIAGEM"]);

export type MaterialPreparado = {
  codigo: string;
  descricao: string;
  familia: Familia;
  grupo: { prefixo: string; codigo: string; nome: string | null } | null;
  sequencia: number | null;
  grupo_nome: string | null;
  subgrupo: string | null;
  unidade: string;
  unidade_compra: string | null;
  ncm: string | null;
  plano_contas: string | null;
  tipo_item: string | null;
  custo_referencia: number;
  saldo_grv: number;
  controla_estoque: boolean;
  ativo: boolean;
  pendencias: Pendencia[];
};

export type RegrasCarga = {
  /** Famílias inteiras que controlam saldo (decisão A2). */
  familiasComEstoque: ReadonlySet<Familia>;
  /** Grupos (pelo nome do GRV) que controlam saldo mesmo fora dessas famílias (ex.: EPI, Produção). */
  gruposComEstoque: ReadonlySet<string>;
  /** Códigos já comprados ou cotados na plataforma: nunca entram inativos. */
  comprados: ReadonlySet<string>;
};

/**
 * Uma linha da planilha → material. Inativo (decisão A1/A7): ativo imobilizado, ou sem saldo, sem
 * custo e nunca comprado na plataforma. Inativo continua no catálogo e pode ser reativado.
 */
export function prepararMaterial(linha: Record<string, Celula>, regras: RegrasCarga): MaterialPreparado | null {
  const codigo = limpar(linha["Código Interno"], 30)?.toUpperCase().replace(/\s/g, "") ?? "";
  const descricao = limpar(linha["*Item"], 200);
  if (!codigo || !descricao || !/^[0-9A-Z][0-9A-Z.\-/]{0,29}$/.test(codigo)) return null;

  const familia = familiaDoGrv(linha["*Família"]);
  const g = grupoDoCodigo(codigo);
  const grupoNome = limpar(linha["Grupo"], 60)?.toUpperCase() ?? null;
  const unidadeOriginal = String(linha["*Unidade de Inventário (Estoque)"] ?? "").trim().toUpperCase();
  const unidade = unidadePadrao(unidadeOriginal);
  const compra = String(linha["Unidade para Compra Padrão"] ?? "").trim();
  const ncmTexto = String(linha["Numero NCM"] ?? "").replace(/\D/g, "");
  const ncm = ncmTexto.length === 8 ? ncmTexto : null;
  const plano = limpar(linha["Plano de Contas"], 60)?.toUpperCase() ?? null;
  const tipo = limpar(linha["Tipo do Item"], 60);
  const custo = Math.max(0, numeroGrv(linha["Valor Custo Un. Inventário (?)"]));
  const saldo = numeroGrv(linha["Estoque Meu Disponível"]);

  const pendencias: Pendencia[] = [];
  if (!ncm) pendencias.push("sem_ncm");
  if (custo === 0) pendencias.push("custo_zero");
  const tipoNum = tipo?.slice(0, 2) ?? null;
  const esperado = TIPO_DA_FAMILIA[familia];
  if (tipoNum && esperado && tipoNum !== esperado) pendencias.push("tipo_diverge");
  if (!plano) pendencias.push("sem_plano");
  else if (PLANOS_SUSPEITOS.has(plano)) pendencias.push("plano_suspeito");
  if (unidade !== unidadeOriginal) pendencias.push("unidade_ajustada");

  // Decisão A7: ativo imobilizado entra inativo e sem estoque, pelo tipo do item OU pela família 08 do GRV.
  const imobilizado = tipoNum === "08" || String(linha["*Família"] ?? "").trim().startsWith("08");
  const ativo = !imobilizado && (saldo > 0 || custo > 0 || regras.comprados.has(codigo));
  const controla = !imobilizado && (regras.familiasComEstoque.has(familia) || (grupoNome !== null && regras.gruposComEstoque.has(grupoNome)));

  return {
    codigo, descricao, familia,
    grupo: g ? { prefixo: g.prefixo, codigo: g.grupo, nome: grupoNome } : null,
    sequencia: g?.sequencia ?? null,
    grupo_nome: grupoNome,
    subgrupo: limpar(linha["Sub Grupo 1"], 60)?.toUpperCase() ?? null,
    unidade,
    unidade_compra: compra ? unidadePadrao(compra) : null,
    ncm,
    plano_contas: plano,
    tipo_item: tipo,
    custo_referencia: Math.round(custo * 10000) / 10000,
    saldo_grv: Math.round(saldo * 10000) / 10000,
    controla_estoque: controla,
    ativo,
    pendencias,
  };
}

/**
 * Grupos a criar: um por prefixo-grupo do código. Nome e família pela maioria dos itens (a coluna
 * "Grupo" erra em poucos); próximo número depois do maior código conhecido.
 */
export function gruposDaCarga(materiais: readonly MaterialPreparado[], regras: Pick<RegrasCarga, "familiasComEstoque" | "gruposComEstoque">) {
  const porChave = new Map<string, { prefixo: string; codigo: string; nomes: Map<string, number>; familias: Map<Familia, number>; maior: number }>();
  for (const m of materiais) {
    if (!m.grupo) continue;
    const chave = `${m.grupo.prefixo}-${m.grupo.codigo}`;
    const g = porChave.get(chave) ?? { prefixo: m.grupo.prefixo, codigo: m.grupo.codigo, nomes: new Map(), familias: new Map(), maior: 0 };
    if (m.grupo.nome) g.nomes.set(m.grupo.nome, (g.nomes.get(m.grupo.nome) ?? 0) + 1);
    g.familias.set(m.familia, (g.familias.get(m.familia) ?? 0) + 1);
    g.maior = Math.max(g.maior, m.sequencia ?? 0);
    porChave.set(chave, g);
  }
  const maioria = <K,>(mapa: Map<K, number>) => [...mapa.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return [...porChave.values()].map((g) => {
    const nome = maioria(g.nomes) ?? `GRUPO ${g.prefixo}-${g.codigo}`;
    const familia = maioria(g.familias) ?? "outro";
    return {
      prefixo: g.prefixo, codigo: g.codigo, nome, familia,
      proximo: Math.min(g.maior + 1, 99999),
      controla_estoque: regras.familiasComEstoque.has(familia) || regras.gruposComEstoque.has(nome),
    };
  }).sort((a, b) => a.prefixo.localeCompare(b.prefixo) || a.codigo.localeCompare(b.codigo));
}
