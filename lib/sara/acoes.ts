import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBR, hoje, link, termo, type Ferramenta, type Proposta } from "./base.ts";

/**
 * Ações da SARA (E1, 22/10/2026): o que ela pode FAZER, sempre com o "Permitir" da pessoa.
 *
 * Cada ação chama a mesma função do banco que a tela usa (ela confere a permissão de quem permitiu):
 * a SARA não ganha poder nenhum além do que a pessoa já tem. `preparar` não grava nada — confere a
 * entrada, acha o material no catálogo e monta o resumo do cartão. As primeiras são de baixo risco;
 * aprovar título, conciliar e cancelar só entram com o "sim" da área (Ana, Kaylane/Ricardo, Henrique…).
 */

type ItemEntrada = { material?: string; descricao?: string; quantidade?: number; unidade?: string; observacao?: string };
type ItemPedido = { produto: string; quantidade: number; unidade: string; observacao: string; material_id: string | null };

const ESQUEMA_ITENS = {
  type: "array", minItems: 1, maxItems: 20,
  items: {
    type: "object",
    properties: {
      material: { type: "string", description: "Código do material no catálogo (ex.: 0102.0034), quando a pessoa disser ou você achar no catálogo." },
      descricao: { type: "string", description: "O que é o material, como a pessoa falou (obrigatório se não houver código)." },
      quantidade: { type: "number" },
      unidade: { type: "string", description: "UN, KG, M, L, PC, CX, M³…" },
      observacao: { type: "string" },
    },
    required: ["quantidade"],
  },
};

/** Acha cada item no catálogo pelo código (o material entra ligado) ou fica pela descrição. */
async function itensDoCatalogo(sb: SupabaseClient, itens: unknown): Promise<{ itens: ItemPedido[] } | { erro: string }> {
  const lista = (Array.isArray(itens) ? itens : []) as ItemEntrada[];
  if (!lista.length) return { erro: "Diga ao menos um item, com a quantidade." };
  if (lista.length > 20) return { erro: "No máximo 20 itens por pedido." };
  const saida: ItemPedido[] = [];
  for (const it of lista) {
    const q = Number(it.quantidade);
    if (!(q > 0)) return { erro: `Falta a quantidade de "${it.descricao ?? it.material ?? "um item"}". Pergunte à pessoa.` };
    let produto = String(it.descricao ?? "").trim();
    let unidade = String(it.unidade ?? "").trim().toUpperCase();
    let material: string | null = null;
    const codigo = termo(it.material);
    if (codigo) {
      const { data, error } = await sb.rpc("almoxarifado_materiais_buscar", { p_q: codigo, p_ativos: true, p_limite: 5 });
      if (error) throw new Error(error.message);
      const achado = ((data ?? []) as { id: string; codigo: string; descricao: string; unidade: string | null }[])
        .find((m) => m.codigo.replace(/\W/g, "").toUpperCase() === codigo.replace(/\W/g, "").toUpperCase());
      if (!achado) return { erro: `O material ${codigo} não está no catálogo. Procure pela descrição (consulta do catálogo) ou peça pela descrição.` };
      material = achado.id;
      produto = `${achado.codigo} · ${achado.descricao}`;
      unidade ||= (achado.unidade ?? "").toUpperCase();
    }
    if (!produto) return { erro: "Cada item precisa do código do catálogo ou da descrição." };
    saida.push({ produto: produto.slice(0, 200), quantidade: q, unidade: (unidade || "UN").slice(0, 6), observacao: String(it.observacao ?? "").slice(0, 300), material_id: material });
  }
  return { itens: saida };
}

const linhaItem = (i: ItemPedido) => `${i.quantidade.toLocaleString("pt-BR")} ${i.unidade} · ${i.produto}${i.observacao ? ` (${i.observacao})` : ""}${i.material_id ? "" : " · fora do catálogo"}`;
const dataValida = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= hoje() ? v : null);

function resumoDoPedido(quem: string, itens: ItemPedido[], e: Record<string, unknown>): Proposta {
  const precisa = dataValida(e.precisa_ate);
  return {
    resumo: `Pedir material ao Compras pelo ${quem}: ${itens.length} ${itens.length === 1 ? "item" : "itens"}${e.urgente ? ", URGENTE" : ""}${precisa ? `, precisa até ${dataBR(precisa)}` : ""}.`,
    detalhes: [...itens.map(linhaItem), ...(e.observacao ? [`Observação: ${String(e.observacao).slice(0, 300)}`] : [])],
  };
}

const ESQUEMA_PEDIDO = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: {
    itens: ESQUEMA_ITENS,
    urgente: { type: "boolean", description: "Só se a pessoa disser que está parando o trabalho." },
    precisa_ate: { type: "string", description: "Data em que a produção precisa do material (AAAA-MM-DD), se a pessoa disser." },
    observacao: { type: "string", description: "Observação para o Compras." },
    ...extra,
  },
  required: ["itens"],
});

const PEDIR_MATERIAL: Ferramenta = {
  nome: "pedir_material", rotulo: "preparou um pedido de material", exige: ["almoxarifado.solicitacoes"],
  descricao: "PREPARA um pedido de material do Almoxarifado ao Compras (a pessoa confirma no cartão). Use os códigos do catálogo quando souber. Pergunte antes o que faltar: quantidade, unidade, divisão (Usinagem ou Fundição).",
  esquema: ESQUEMA_PEDIDO({ divisao: { type: "string", enum: ["USINAGEM", "FUNDICAO"], description: "Para onde vai o material." } }),
  acao: {
    nivel: "operar", modulos: ["almoxarifado"],
    preparar: async (sb, e) => {
      const r = await itensDoCatalogo(sb, e.itens);
      if ("erro" in r) return r;
      const p = resumoDoPedido("Almoxarifado", r.itens, e);
      return { ...p, resumo: p.resumo.replace(":", ` para a ${e.divisao === "FUNDICAO" ? "Fundição" : "Usinagem"}:`) };
    },
  },
  rodar: async (sb, e) => {
    const r = await itensDoCatalogo(sb, e.itens);
    if ("erro" in r) throw new Error(r.erro);
    const { data, error } = await sb.rpc("almoxarifado_criar_solicitacao", {
      p_divisao: e.divisao === "FUNDICAO" ? "FUNDICAO" : "USINAGEM", p_urgencia: e.urgente ? "urgente" : "normal",
      p_observacao: String(e.observacao ?? "").slice(0, 500), p_itens: r.itens, p_precisa_ate: dataValida(e.precisa_ate),
    });
    if (error) throw new Error(error.message);
    const numero = (data as { numero?: number } | null)?.numero;
    return { dados: { feito: `Pedido de material${numero ? ` nº ${numero}` : ""} enviado ao Compras.`, numero }, fontes: [{ rotulo: "Almoxarifado › Solicitações", link: link("almoxarifado", "Solicitações") }],
      abrir: { modulo: "almoxarifado", secao: "Solicitações", rotulo: "Almoxarifado › Solicitações" } };
  },
};

const PEDIR_MATERIAL_FUNDICAO: Ferramenta = {
  nome: "pedir_material_fundicao", rotulo: "preparou um pedido de material", exige: ["fundicao.pedidos"],
  descricao: "PREPARA um pedido de material da Fundição ao Compras (a pessoa confirma no cartão). Use os códigos do catálogo quando souber. Pergunte antes o que faltar (quantidade, unidade).",
  esquema: ESQUEMA_PEDIDO(),
  acao: {
    nivel: "operar", modulos: ["fundicao"],
    preparar: async (sb, e) => {
      const r = await itensDoCatalogo(sb, e.itens);
      return "erro" in r ? r : resumoDoPedido("painel da Fundição", r.itens, e);
    },
  },
  rodar: async (sb, e) => {
    const r = await itensDoCatalogo(sb, e.itens);
    if ("erro" in r) throw new Error(r.erro);
    const { data, error } = await sb.rpc("fundicao_criar_pedido", {
      p_urgencia: e.urgente ? "urgente" : "normal", p_observacao: String(e.observacao ?? "").slice(0, 500), p_itens: r.itens, p_precisa_ate: dataValida(e.precisa_ate),
    });
    if (error) throw new Error(error.message);
    const numero = (data as { numero?: number } | null)?.numero;
    return { dados: { feito: `Pedido de material${numero ? ` nº ${numero}` : ""} enviado ao Compras.`, numero }, fontes: [{ rotulo: "Fundição › Pedidos de material", link: link("fundicao", "Pedidos de material") }],
      abrir: { modulo: "fundicao", secao: "Pedidos de material", rotulo: "Fundição › Pedidos de material" } };
  },
};

const PRIORIDADES = ["baixa", "normal", "alta", "urgente"];
async function categoriasTi(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb.from("ti_regras").select("categorias").maybeSingle();
  return ((data?.categorias ?? []) as string[]).filter(Boolean);
}

const ABRIR_CHAMADO_TI: Ferramenta = {
  nome: "abrir_chamado_ti", rotulo: "preparou um chamado de TI", exige: [],
  descricao: "PREPARA um chamado para a TI (computador, impressora, rede, sistema, acesso…); a pessoa confirma no cartão. Qualquer pessoa pode abrir. Escolha a categoria da lista; se não souber, pergunte.",
  esquema: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Em poucas palavras o que aconteceu." },
      descricao: { type: "string", description: "O problema, como a pessoa contou." },
      categoria: { type: "string", description: "Uma das categorias da TI (se errar, a resposta traz a lista)." },
      prioridade: { type: "string", enum: PRIORIDADES },
      local: { type: "string", description: "Onde (setor, sala, máquina), se a pessoa disser." },
    },
    required: ["titulo", "descricao", "categoria"],
  },
  acao: {
    nivel: "operar", modulos: "todos",
    preparar: async (sb, e) => {
      const cats = await categoriasTi(sb);
      if (!cats.length) return { erro: "As regras dos chamados de TI ainda não foram configuradas pelo supervisor de TI." };
      const cat = cats.find((c) => c.toLowerCase() === String(e.categoria ?? "").trim().toLowerCase());
      if (!cat) return { erro: `Categoria inválida. Use uma destas: ${cats.join(", ")}.` };
      if (String(e.titulo ?? "").trim().length < 3 || String(e.descricao ?? "").trim().length < 3) return { erro: "Falta dizer o que aconteceu." };
      const prio = PRIORIDADES.includes(String(e.prioridade)) ? String(e.prioridade) : "normal";
      return {
        resumo: `Abrir chamado de TI: ${String(e.titulo).trim().slice(0, 140)} (${cat}, prioridade ${prio}).`,
        detalhes: [String(e.descricao).trim().slice(0, 400), ...(e.local ? [`Local: ${String(e.local).slice(0, 120)}`] : [])],
      };
    },
  },
  rodar: async (sb, e) => {
    const cats = await categoriasTi(sb);
    const cat = cats.find((c) => c.toLowerCase() === String(e.categoria ?? "").trim().toLowerCase()) ?? String(e.categoria ?? "");
    const { data, error } = await sb.rpc("ti_abrir_chamado", {
      p_titulo: String(e.titulo ?? ""), p_descricao: String(e.descricao ?? ""), p_categoria: cat,
      p_prioridade: PRIORIDADES.includes(String(e.prioridade)) ? String(e.prioridade) : "normal", p_local: String(e.local ?? ""),
    });
    if (error) throw new Error(error.message);
    const numero = (data as { numero?: number } | null)?.numero;
    return { dados: { feito: `Chamado de TI${numero ? ` nº ${numero}` : ""} aberto. A TI foi avisada.`, numero }, fontes: [] };
  },
};

const ANOTAR_NA_BIBLIOTECA: Ferramenta = {
  nome: "anotar_na_biblioteca", rotulo: "preparou uma anotação na Biblioteca", exige: ["fundicao.biblioteca"],
  descricao: "PREPARA uma anotação da Fundição numa peça da Biblioteca de desenhos (ex.: massalote, contração, o que deu problema na última corrida); a pessoa confirma no cartão.",
  esquema: { type: "object", properties: { peca: { type: "string", description: "Código do artigo (peça)." }, texto: { type: "string" } }, required: ["peca", "texto"] },
  acao: {
    nivel: "operar", modulos: ["fundicao"],
    preparar: async (sb, e) => {
      const peca = String(e.peca ?? "").trim().toUpperCase();
      const texto = String(e.texto ?? "").trim();
      if (!peca || texto.length < 3) return { erro: "Diga a peça (código do artigo) e o que anotar." };
      const { count } = await sb.from("fundicao_desenhos").select("id", { count: "exact", head: true }).eq("artigo_chave", peca);
      if (!count) return { erro: `A peça ${peca} não está na Biblioteca. Confira o código com a consulta da Biblioteca.` };
      return { resumo: `Anotar na peça ${peca} (Biblioteca da Fundição).`, detalhes: [texto.slice(0, 600)] };
    },
  },
  rodar: async (sb, e) => {
    const { error } = await sb.rpc("fundicao_nota_gravar", { p_id: null, p_artigo_codigo: String(e.peca ?? ""), p_texto: String(e.texto ?? "") });
    if (error) throw new Error(error.message);
    return { dados: { feito: `Anotação gravada na peça ${String(e.peca ?? "").trim().toUpperCase()}.` }, fontes: [{ rotulo: "Fundição › Biblioteca", link: link("fundicao", "Biblioteca") }],
      abrir: { modulo: "fundicao", secao: "Biblioteca", rotulo: "Fundição › Biblioteca" } };
  },
};

export const ACOES: Ferramenta[] = [PEDIR_MATERIAL, PEDIR_MATERIAL_FUNDICAO, ABRIR_CHAMADO_TI, ANOTAR_NA_BIBLIOTECA];

/** Ações que a SARA deste módulo oferece a quem tem o nível exigido (vazio em `exige` = qualquer pessoa logada). */
export function acoesDaSara(modulo: string, pode: (feature: string, nivel: "operar" | "aprovar") => boolean): Ferramenta[] {
  return ACOES.filter((f) => f.acao && (f.acao.modulos === "todos" || f.acao.modulos.includes(modulo))
    && (!f.exige.length || f.exige.some((x) => pode(x, f.acao!.nivel))));
}
