import type { SupabaseClient } from "@supabase/supabase-js";
import { link, termo, type Ferramenta } from "./base.ts";

/**
 * Consultas da SARA que usam o Segundo Cérebro (etapa G3, docs/PLANO-WAR-ROOM-CEREBRO.md): a ficha do
 * fornecedor e do cliente (o que já foi comprado, pago, encomendado, a que preço, desde quando) e o
 * histórico de preço por item. Fora do War Room, cada número e cada ligação seguem a permissão da área
 * de quem pergunta: quem é do Compras não vê o que foi pago, quem é do Financeiro não vê os preços de compra.
 */

type Ligacao = {
  tipo: string; familia: string; de_origem: boolean; outro: { tipo: string; chave: string; nome: string; link: string | null };
  quantidade: number | null; total: number | null; primeira: string | null; ultima: string | null; resumo: Record<string, unknown>;
};
type Ficha = { no: { tipo: string; chave: string; nome: string; termos: string[]; resumo: Record<string, unknown> }; ligacoes: Ligacao[] } | null;

async function ficha(sb: SupabaseClient, tipo: "fornecedor" | "cliente", nome: string) {
  const t = termo(nome);
  if (t.length < 2) return { erro: "Diga o nome." } as const;
  const achados = await sb.rpc("cerebro_ficha_buscar", { p_tipo: tipo, p_termo: t });
  if (achados.error) throw new Error(achados.error.message);
  const lista = (achados.data ?? []) as { chave: string; nome: string }[];
  if (!lista.length) return { erro: `Não achei ${tipo === "fornecedor" ? "fornecedor" : "cliente"} com "${t}" (ou você não tem permissão para ver).` } as const;
  const f = await sb.rpc("cerebro_ficha", { p_tipo: tipo, p_chave: lista[0].chave });
  if (f.error) throw new Error(f.error.message);
  return { ficha: f.data as Ficha, outros: lista.slice(1).map((x) => x.nome) } as const;
}

const liga = (f: Ficha, tipo: string, limite = 25) => (f?.ligacoes ?? []).filter((l) => l.tipo === tipo).slice(0, limite);

export const FICHA_FORNECEDOR: Ferramenta = {
  nome: "ficha_fornecedor", rotulo: "ficha do fornecedor",
  exige: ["compras.cotacoes", "compras.realizadas", "compras.fornecedores", "compras.aprovacoes", "financeiro.pagar", "fundacao.cadastros"],
  descricao: "Tudo o que a empresa já fez com um fornecedor (pelo nome): o que ele vende e a que preço (compras desde jul/2026, com último, menor e maior preço por item), o que cotou, quanto já foi pago no histórico (desde 2002, do Financeiro) e em que contas, o que está em aberto, desde quando, a condição de pagamento e os documentos que o citam. Cada parte só vem se a pessoa tiver a permissão da área.",
  esquema: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] },
  rodar: async (sb, e) => {
    const r = await ficha(sb, "fornecedor", String(e.nome ?? ""));
    if ("erro" in r) return { dados: { erro: r.erro }, fontes: [] };
    const f = r.ficha;
    return {
      dados: {
        fornecedor: f?.no.nome, numeros: f?.no.resumo, categorias: f?.no.termos,
        vende: liga(f, "vendeu").map((l) => ({ item: l.outro.nome, compras: l.quantidade, total: l.total, de: l.primeira, ate: l.ultima, ultimo_preco: l.resumo?.ultimo_preco, menor_preco: l.resumo?.menor_preco, maior_preco: l.resumo?.maior_preco, unidade: l.resumo?.unidade })),
        cotou: liga(f, "cotou").map((l) => ({ item: l.outro.nome, cotacoes: l.quantidade, aprovadas: l.resumo?.aprovadas, rejeitadas: l.resumo?.rejeitadas, ultimo_valor: l.resumo?.ultimo_valor, ultima: l.ultima })),
        lancado_em: liga(f, "lancado_em").map((l) => ({ conta: l.outro.nome, titulos: l.quantidade, total: l.total, de: l.primeira, ate: l.ultima })),
        documentos: (f?.ligacoes ?? []).filter((l) => l.tipo === "cita").map((l) => l.outro.nome),
        ...(r.outros.length ? { outros_com_nome_parecido: r.outros } : {}),
      },
      fontes: [{ rotulo: "Compras › Fornecedores (ficha)", link: link("compras", "Fornecedores") }],
    };
  },
};

export const FICHA_CLIENTE: Ferramenta = {
  nome: "ficha_cliente", rotulo: "ficha do cliente",
  exige: ["comercial.clientes", "comercial.orcamentos", "financeiro.receber", "comercial.cobranca", "fundacao.cadastros"],
  descricao: "Tudo o que a empresa já fez com um cliente (pelo nome): quanto foi faturado e recebido no histórico (desde 2016), o que está em aberto e vencido, o atraso médio para pagar (em dias), as peças cadastradas, as que ele encomendou (OS) e em que contas os lançamentos entram. Cada parte só vem se a pessoa tiver a permissão da área.",
  esquema: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] },
  rodar: async (sb, e) => {
    const r = await ficha(sb, "cliente", String(e.nome ?? ""));
    if ("erro" in r) return { dados: { erro: r.erro }, fontes: [] };
    const f = r.ficha;
    return {
      dados: {
        cliente: f?.no.nome, numeros: f?.no.resumo,
        encomendou: liga(f, "encomendou").map((l) => ({ peca: l.outro.nome, os: l.quantidade, pecas: l.resumo?.pecas, de: l.primeira, ate: l.ultima, em_producao: l.resumo?.em_producao, abertas: l.resumo?.abertas })),
        pecas_cadastradas: (f?.ligacoes ?? []).filter((l) => l.tipo === "tem_peca").length,
        lancado_em: liga(f, "lancado_em").map((l) => ({ conta: l.outro.nome, titulos: l.quantidade, total: l.total, de: l.primeira, ate: l.ultima })),
        ...(r.outros.length ? { outros_com_nome_parecido: r.outros } : {}),
      },
      fontes: [{ rotulo: "Comercial › Clientes (ficha)", link: link("comercial", "clientes") }],
    };
  },
};

export const HISTORICO_PRECO: Ferramenta = {
  nome: "historico_de_preco", rotulo: "histórico de preço",
  exige: ["compras.cotacoes", "compras.realizadas", "compras.aprovacoes", "almoxarifado.recebimento", "almoxarifado.materiais"],
  descricao: "Histórico de preço de um item comprado (por parte do nome, sem acento): por fornecedor, o último, o menor e o maior preço, a unidade e a última compra, e as compras mais recentes com data, fornecedor e preço. Junta os nomes do mesmo item. Compras desde jul/2026. Use para \"quem vende mais barato\", \"o preço subiu?\", \"quando compramos por último\".",
  esquema: { type: "object", properties: { item: { type: "string" }, desde: { type: "string", description: "AAAA-MM-DD" } }, required: ["item"] },
  rodar: async (sb, e) => {
    const t = termo(e.item);
    if (t.length < 2) return { dados: { erro: "Diga o item." }, fontes: [] };
    const desde = typeof e.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.desde) ? e.desde : null;
    const { data, error } = await sb.rpc("cerebro_historico_preco", { p_termo: t, p_desde: desde, p_limite: 8 });
    if (error) throw new Error(error.message);
    const itens = (data ?? []) as unknown[];
    return { dados: itens.length ? { itens } : { itens: [], aviso: `Nenhuma compra com "${t}" no nome${desde ? ` desde ${desde}` : ""}.` }, fontes: [{ rotulo: "Compras › Realizadas", link: link("compras", "Realizadas") }] };
  },
};
