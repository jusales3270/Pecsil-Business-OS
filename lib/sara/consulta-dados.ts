import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ferramenta, Resultado } from "./base.ts";
import { CATALOGO, type TabelaCatalogo, type TipoColuna } from "./catalogo.ts";

/**
 * consultar_dados — a SARA lê qualquer tabela do catálogo que a pessoa pode ver, com filtros,
 * período, agrupamento e somas, sem depender de uma consulta pronta para cada pergunta.
 * Lê com a sessão de quem pergunta (RLS) e só as colunas do catálogo. Agrega no servidor:
 * ao modelo vai o resultado, não a tabela inteira.
 */

const OPS = ["igual", "diferente", "contem", "comeca", "maior", "maior_igual", "menor", "menor_igual", "entre", "em", "vazio", "preenchido"] as const;
type Op = (typeof OPS)[number];
type Filtro = { campo: string; op: Op; valor?: unknown; ate?: unknown };
type Pedido = {
  tabela: string; colunas?: string[]; filtros?: Filtro[]; periodo?: { de?: string; ate?: string; campo?: string };
  agrupar_por?: string[]; somar?: string[]; media?: string[]; ordenar?: { campo: string; desc?: boolean }; limite?: number;
};

const PAGINA = 1000;
const MAX_LINHAS = 20_000;
const PARTES_DATA = ["dia", "semana", "mes", "ano"] as const;

/** "data:mes" → coluna "data" agrupada por mês. */
function separar(campo: string) {
  const [col, parte] = campo.split(":");
  return { col, parte: (PARTES_DATA as readonly string[]).includes(parte ?? "") ? (parte as (typeof PARTES_DATA)[number]) : null };
}

function inicioDaSemana(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

function chaveData(v: unknown, parte: (typeof PARTES_DATA)[number] | null) {
  if (v == null) return "—";
  const s = String(v);
  if (!parte || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  if (parte === "dia") return s.slice(0, 10);
  if (parte === "mes") return s.slice(0, 7);
  if (parte === "ano") return s.slice(0, 4);
  return `semana de ${inicioDaSemana(s)}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const diaSeguinte = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** Valida o pedido contra o catálogo. Devolve o erro em português para o modelo corrigir. */
export function validar(p: Pedido, t: TabelaCatalogo): string | null {
  const cols = new Set([...Object.keys(t.colunas), ...Object.keys(t.rel ?? {})]);
  const base = (c: string) => separar(c).col;
  const lista = (nome: string, xs?: string[]) => (xs ?? []).filter((c) => !cols.has(base(c))).map((c) => `${nome} "${c}"`);
  const ruins = [
    ...lista("coluna", p.colunas), ...lista("agrupar_por", p.agrupar_por),
    ...(p.somar ?? []).filter((c) => t.colunas[c] !== "numero").map((c) => `somar "${c}" (não é número)`),
    ...(p.media ?? []).filter((c) => t.colunas[c] !== "numero").map((c) => `media "${c}" (não é número)`),
    ...(p.filtros ?? []).filter((x) => !(t.colunas[x.campo] || t.rel?.[x.campo]) || !(OPS as readonly string[]).includes(x.op)).map((x) => `filtro "${x.campo}" ${x.op}`),
  ];
  if ((p.agrupar_por ?? []).length > 2) ruins.push("agrupar_por aceita no máximo 2 campos");
  if (p.periodo && !(p.periodo.campo ?? t.data)) ruins.push("esta tabela não tem coluna de data padrão: diga periodo.campo");
  if (p.periodo?.campo && t.colunas[p.periodo.campo] !== "data") ruins.push(`periodo.campo "${p.periodo.campo}" não é data`);
  if (!ruins.length) return null;
  return `Pedido inválido para ${t.tabela}: ${ruins.join("; ")}. Colunas: ${Object.entries(t.colunas).map(([c, tp]) => `${c} (${tp})`).join(", ")}${t.rel ? `; nomes: ${Object.keys(t.rel).join(", ")}` : ""}.`;
}

/** Monta o select: colunas do catálogo + nomes legíveis pelas chaves estrangeiras. */
function montarSelect(t: TabelaCatalogo, precisa: Set<string>, filtrados: Set<string>) {
  const partes = [...precisa].filter((c) => t.colunas[c]);
  // Nome legível usado em filtro: junção "inner", para o filtro valer sobre as linhas.
  for (const [alias, r] of Object.entries(t.rel ?? {})) {
    if (!precisa.has(alias) && !filtrados.has(alias)) continue;
    const inner = filtrados.has(alias) ? "!inner" : "";
    // Dois saltos (baixa → parcela → título): a tabela do meio entra com o apelido do nome, a final como "r".
    partes.push(r.via ? `${alias}:${r.via.tabela}!${r.via.fk}${inner}(r:${r.tabela}!${r.fk}${inner}(${r.campo}))` : `${alias}:${r.tabela}!${r.fk}${inner}(${r.campo})`);
  }
  return partes.length ? partes.join(",") : Object.keys(t.colunas).slice(0, 1).join(",");
}

function achatar(linha: Record<string, unknown>, t: TabelaCatalogo) {
  const o: Record<string, unknown> = { ...linha };
  for (const [alias, r] of Object.entries(t.rel ?? {})) {
    const v = o[alias];
    const fim = r.via && v && typeof v === "object" ? (v as Record<string, unknown>).r : v;
    o[alias] = fim && typeof fim === "object" ? (fim as Record<string, unknown>)[r.campo] ?? null : r.via ? null : v;
  }
  // Lista fechada: sai com o nome da tela (a SARA não traduz código por conta própria).
  for (const [c, mapa] of Object.entries(t.opcoes ?? {})) if (typeof o[c] === "string" && mapa[o[c] as string]) o[c] = mapa[o[c] as string];
  return o;
}

const sem = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Filtro em coluna de lista fechada: aceita código ou nome; "contém"/"começa" viram a lista de códigos que batem. */
export function traduzirFiltro(x: Filtro, t: TabelaCatalogo): Filtro {
  const mapa = t.opcoes?.[x.campo];
  if (!mapa) return x;
  const codigo = (v: unknown) => { const s = sem(String(v ?? "")); return Object.keys(mapa).find((k) => sem(k) === s || sem(mapa[k]) === s) ?? String(v ?? ""); };
  if (x.op === "contem" || x.op === "comeca") {
    const s = sem(String(x.valor ?? ""));
    const batem = Object.keys(mapa).filter((k) => (x.op === "contem" ? sem(mapa[k]).includes(s) || sem(k).includes(s) : sem(mapa[k]).startsWith(s) || sem(k).startsWith(s)));
    return { campo: x.campo, op: "em", valor: batem.length ? batem : ["__nenhum__"] };
  }
  if (x.op === "em") return { ...x, valor: (Array.isArray(x.valor) ? x.valor : [x.valor]).map(codigo) };
  if (x.op === "igual" || x.op === "diferente") return { ...x, valor: codigo(x.valor) };
  return x;
}

export function agregar(linhas: Record<string, unknown>[], p: Pedido) {
  const grupos = new Map<string, { chave: Record<string, string>; quantidade: number; somas: Record<string, number>; n: Record<string, number> }>();
  const campos = p.agrupar_por ?? [];
  const numericas = [...new Set([...(p.somar ?? []), ...(p.media ?? [])])];
  for (const l of linhas) {
    const chave = Object.fromEntries(campos.map((c) => { const { col, parte } = separar(c); return [c, chaveData(l[col], parte)]; }));
    const k = JSON.stringify(chave);
    let g = grupos.get(k);
    if (!g) { g = { chave, quantidade: 0, somas: {}, n: {} }; grupos.set(k, g); }
    g.quantidade += 1;
    for (const c of numericas) {
      const v = Number(l[c]);
      if (l[c] != null && Number.isFinite(v)) { g.somas[c] = (g.somas[c] ?? 0) + v; g.n[c] = (g.n[c] ?? 0) + 1; }
    }
  }
  const saida = [...grupos.values()].map((g) => ({
    ...g.chave, quantidade: g.quantidade,
    ...Object.fromEntries((p.somar ?? []).map((c) => [`soma_${c}`, r2(g.somas[c] ?? 0)])),
    ...Object.fromEntries((p.media ?? []).map((c) => [`media_${c}`, g.n[c] ? r2(g.somas[c] / g.n[c]) : null])),
  }));
  const porCampo = p.ordenar?.campo;
  // Agrupado por data (dia/semana/mês/ano) e sem ordem pedida: em ordem cronológica.
  const campoData = campos.find((c) => separar(c).parte);
  const chaveOrdem = porCampo ? (porCampo in (saida[0] ?? {}) ? porCampo : `soma_${porCampo}` in (saida[0] ?? {}) ? `soma_${porCampo}` : null)
    : campoData ?? (p.somar?.[0] ? `soma_${p.somar[0]}` : "quantidade");
  const desc = p.ordenar ? p.ordenar.desc !== false : !campoData;
  if (chaveOrdem) saida.sort((a, b) => {
    const x = (a as Record<string, unknown>)[chaveOrdem], y = (b as Record<string, unknown>)[chaveOrdem];
    const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return desc ? -cmp : cmp;
  });
  return saida;
}

async function ler(sb: SupabaseClient, t: TabelaCatalogo, p: Pedido) {
  const precisa = new Set<string>([
    ...(p.colunas ?? []), ...(p.agrupar_por ?? []).map((c) => separar(c).col), ...(p.somar ?? []), ...(p.media ?? []),
    ...(!p.colunas?.length && !p.agrupar_por?.length && !p.somar?.length ? Object.keys(t.colunas).concat(Object.keys(t.rel ?? {})) : []),
  ]);
  const filtrados = new Set((p.filtros ?? []).map((x) => x.campo).filter((c) => t.rel?.[c]));
  const select = montarSelect(t, precisa, filtrados);
  const alvo = (campo: string) => (t.rel?.[campo] ? (t.rel[campo].via ? `${campo}.r.${t.rel[campo].campo}` : `${campo}.${t.rel[campo].campo}`) : campo);
  const linhas: Record<string, unknown>[] = [];
  let truncado = false;
  for (let de = 0; de < MAX_LINHAS; de += PAGINA) {
    let q = sb.from(t.tabela).select(select);
    for (const x of t.fixo ?? []) q = x.op === "vazio" ? q.is(x.campo, null) : q.eq(x.campo, x.valor as never);
    const campoData = p.periodo ? (p.periodo.campo ?? t.data!) : null;
    if (campoData && p.periodo?.de) q = q.gte(campoData, p.periodo.de);
    // "até" inclui o dia inteiro: vale para data, data com hora e o texto AAAA-MM-DD da Portaria.
    if (campoData && p.periodo?.ate) q = /^\d{4}-\d{2}-\d{2}$/.test(p.periodo.ate) ? q.lt(campoData, diaSeguinte(p.periodo.ate)) : q.lte(campoData, p.periodo.ate);
    for (const f0 of p.filtros ?? []) {
      const f1 = traduzirFiltro(f0, t);
      const x = { ...f1, campo: alvo(f1.campo) };
      const v = x.valor as never;
      switch (x.op) {
        case "igual": q = q.eq(x.campo, v); break;
        case "diferente": q = q.neq(x.campo, v); break;
        case "contem": q = q.ilike(x.campo, `%${String(x.valor ?? "").replace(/[%_]/g, " ")}%`); break;
        case "comeca": q = q.ilike(x.campo, `${String(x.valor ?? "").replace(/[%_]/g, " ")}%`); break;
        case "maior": q = q.gt(x.campo, v); break;
        case "maior_igual": q = q.gte(x.campo, v); break;
        case "menor": q = q.lt(x.campo, v); break;
        case "menor_igual": q = q.lte(x.campo, v); break;
        case "entre": q = q.gte(x.campo, v).lte(x.campo, x.ate as never); break;
        case "em": q = q.in(x.campo, (Array.isArray(x.valor) ? x.valor : [x.valor]) as never[]); break;
        case "vazio": q = q.is(x.campo, null); break;
        case "preenchido": q = q.not(x.campo, "is", null); break;
      }
    }
    if (p.ordenar && t.colunas[p.ordenar.campo] && !p.agrupar_por?.length) q = q.order(p.ordenar.campo, { ascending: p.ordenar.desc === false });
    const { data, error } = await q.range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as unknown as Record<string, unknown>[];
    linhas.push(...pagina.map((l) => achatar(l, t)));
    if (pagina.length < PAGINA) break;
    if (de + PAGINA >= MAX_LINHAS) truncado = true;
  }
  return { linhas, truncado };
}

export async function executarConsulta(sb: SupabaseClient, t: TabelaCatalogo, p: Pedido): Promise<Resultado> {
  const erro = validar(p, t);
  if (erro) return { dados: { erro }, fontes: [] };
  const { linhas, truncado } = await ler(sb, t, p);
  const limite = Math.min(Math.max(Number(p.limite) || 50, 1), 200);
  const resumo = {
    tabela: t.rotulo, periodo: p.periodo ?? null, filtros: p.filtros ?? [], linhas_lidas: linhas.length,
    ...(truncado ? { aviso: `Mais de ${MAX_LINHAS} linhas: o resultado é parcial. Reduza o período ou filtre.` } : {}),
  };
  if (p.agrupar_por?.length || p.somar?.length || p.media?.length) {
    const grupos = agregar(linhas, p);
    const totais = Object.fromEntries((p.somar ?? []).map((c) => [`soma_${c}`, r2(linhas.reduce((s, l) => s + (Number(l[c]) || 0), 0))]));
    return { dados: { ...resumo, total_de_linhas: linhas.length, ...totais, grupos: p.agrupar_por?.length ? grupos.slice(0, limite) : undefined, grupos_no_total: p.agrupar_por?.length ? grupos.length : undefined }, fontes: [t.fonte] };
  }
  return { dados: { ...resumo, linhas: linhas.slice(0, limite), ...(linhas.length > limite ? { observacao: `Mostrando ${limite} de ${linhas.length}. Agrupe ou filtre para ver o todo.` } : {}) }, fontes: [t.fonte] };
}

/** A ferramenta, montada para quem pergunta: só as tabelas que a pessoa pode ver, as do módulo primeiro. */
export function consultarDados(pode: (feature: string) => boolean, modulo: string): Ferramenta | null {
  const tabelas = CATALOGO.filter((t) => t.exige.some(pode)).sort((a, b) => Number(b.modulo === modulo) - Number(a.modulo === modulo));
  if (!tabelas.length) return null;
  const opc = (t: TabelaCatalogo, c: string) => (t.opcoes?.[c] ? ` [${Object.values(t.opcoes[c]).join(" | ")}]` : "");
  const desc = (t: TabelaCatalogo) => `- ${t.tabela} (${t.rotulo}; módulo ${t.modulo}${t.data ? `; data: ${t.data}` : ""}): ${t.descricao} Colunas: ${Object.entries(t.colunas).map(([c, tp]) => `${c}:${tp as TipoColuna}${opc(t, c)}`).join(", ")}${t.rel ? `. Nomes: ${Object.keys(t.rel).map((a) => `${a}${opc(t, a)}`).join(", ")}` : ""}.`;
  return {
    nome: "consultar_dados", rotulo: "consultou os dados", exige: [],
    descricao: `Consulta direta às tabelas que a pessoa pode ver (as do seu módulo e as de outros módulos com permissão). Use quando nenhuma consulta pronta responde exatamente (outro período, outro filtro, outra soma ou agrupamento). Filtra (op: ${OPS.join(", ")}), limita por período (de/ate em AAAA-MM-DD), agrupa (até 2 campos; datas com ":dia", ":semana", ":mes" ou ":ano", ex. "data:semana") e soma/tira média de colunas numéricas. Responde com os números calculados. Tabelas:\n${tabelas.map(desc).join("\n")}`,
    esquema: {
      type: "object",
      properties: {
        tabela: { type: "string", enum: tabelas.map((t) => t.tabela) },
        colunas: { type: "array", items: { type: "string" }, description: "Colunas para listar (sem agrupar)." },
        filtros: { type: "array", items: { type: "object", properties: { campo: { type: "string" }, op: { type: "string", enum: [...OPS] }, valor: {}, ate: {} }, required: ["campo", "op"] } },
        periodo: { type: "object", properties: { de: { type: "string" }, ate: { type: "string" }, campo: { type: "string" } } },
        agrupar_por: { type: "array", items: { type: "string" } },
        somar: { type: "array", items: { type: "string" } },
        media: { type: "array", items: { type: "string" } },
        ordenar: { type: "object", properties: { campo: { type: "string" }, desc: { type: "boolean" } } },
        limite: { type: "number" },
      },
      required: ["tabela"],
    },
    rodar: async (sb, e) => {
      const t = tabelas.find((x) => x.tabela === e.tabela);
      if (!t) return { dados: { erro: `Tabela "${String(e.tabela)}" indisponível para esta pessoa. Disponíveis: ${tabelas.map((x) => x.tabela).join(", ")}.` }, fontes: [] };
      return executarConsulta(sb, t, e as unknown as Pedido);
    },
  };
}
