import { dataBR, dias, hoje, link, plural, termo, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";
import { buscarMateriais, linhaDoPedido, pedidosDeMaterial } from "./almoxarifado.ts";
import { jaRefeitos, refazerPedido } from "../acoes.ts";

/**
 * SARA da Fundição: os pedidos de material da Fundição (só os da origem FUNDICAO — quem é da Fundição
 * não vê preço nem cotação do Compras) e o catálogo de materiais. Quem decide é o Guilherme.
 */

const M = "fundicao";
const PODE = ["fundicao.pedidos"];
const abrir: Abrir = { modulo: M, secao: null, rotulo: "Fundição › Pedidos de material" };
const fonte = { rotulo: "Fundição › Pedidos de material", link: link(M) };

const ferramentas: Ferramenta[] = [
  {
    nome: "fundicao_pedidos", rotulo: "pedidos da Fundição", exige: PODE,
    descricao: "Pedidos de material da Fundição por situação (padrão: em andamento): número, situação (com o Compras, aprovado, a caminho, recebido…), urgência, precisa até, há quantos dias, itens e motivo de cancelamento.",
    esquema: { type: "object", properties: { situacao: { type: "string", enum: ["em_andamento", "com_compras", "a_caminho", "recebidos", "rejeitados_cancelados", "todos"] } } },
    rodar: async (sb, e) => {
      const mapa: Record<string, string[] | undefined> = {
        em_andamento: ["aberta", "em_cotacao", "aprovada", "comprada", "parcial"], com_compras: ["aberta", "em_cotacao"], a_caminho: ["comprada", "parcial"],
        recebidos: ["recebida"], rejeitados_cancelados: ["rejeitada", "cancelada"], todos: undefined,
      };
      const chave = String(e.situacao ?? "em_andamento");
      const h = hoje();
      const lista = (await pedidosDeMaterial(sb, { origem: "FUNDICAO", status: mapa[chave] ?? mapa.em_andamento, dias: chave === "recebidos" || chave === "todos" ? 90 : undefined }))
        .map((p) => linhaDoPedido(p, h));
      return { dados: { situacao: chave, quantidade: lista.length, pedidos: lista.slice(0, 30) }, fontes: [fonte] };
    },
  },
  {
    nome: "fundicao_materiais", rotulo: "catálogo de materiais", exige: PODE,
    descricao: "Busca no catálogo de materiais pelo código ou pela descrição (para pedir o material certo). Não informa saldo.",
    esquema: { type: "object", properties: { busca: { type: "string" }, limite: { type: "integer" } }, required: ["busca"] },
    rodar: buscarMateriais,
  },
];

// Biblioteca de desenhos (P-11): peças, revisões, se já foram fundidas e as anotações da Fundição.
ferramentas.push({
  nome: "fundicao_biblioteca", rotulo: "Biblioteca de desenhos", exige: ["fundicao.biblioteca"],
  descricao: "Busca na Biblioteca de desenhos pela peça (código do artigo), descrição, cliente ou código do desenho: tipo, revisão, data da revisão, se é a revisão atual, quando foi fundida (e em quais OS) e as anotações da Fundição da peça.",
  esquema: { type: "object", properties: { busca: { type: "string" } }, required: ["busca"] },
  rodar: async (sb, e) => {
    const t = termo(e.busca);
    if (t.length < 2) return { dados: { erro: "Diga a peça, o cliente ou o código do desenho." }, fontes: [] };
    const { data, error } = await sb.from("fundicao_desenhos")
      .select("artigo_codigo, artigo_chave, artigo_descricao, cliente_nome, tipo, codigo, revisao, data_revisao, ultima_fundicao_em, fundicao_prevista, os_codigos, origem, removido_na_forja_em")
      .or(["artigo_codigo", "artigo_descricao", "cliente_nome", "codigo"].map((c) => `${c}.ilike.%${t}%`).join(","))
      .is("removido_na_forja_em", null).order("artigo_chave").limit(40);
    if (error) throw new Error(error.message);
    const linhas = data ?? [];
    const chaves = [...new Set(linhas.map((l) => l.artigo_chave))].slice(0, 15);
    const { data: notas } = chaves.length ? await sb.from("fundicao_notas").select("artigo_chave, texto, autor_nome, created_at").in("artigo_chave", chaves).order("created_at", { ascending: false }).limit(30) : { data: [] };
    const fonteBib = { rotulo: "Fundição › Biblioteca", link: link(M, "Biblioteca") };
    return {
      dados: {
        busca: t, pecas: chaves.map((k) => {
          const ds = linhas.filter((l) => l.artigo_chave === k);
          return {
            peca: ds[0].artigo_codigo, descricao: ds[0].artigo_descricao, cliente: ds[0].cliente_nome,
            fundida_em: ds.map((d) => d.ultima_fundicao_em).filter(Boolean).sort().at(-1) ?? null, fundicao_prevista: ds.some((d) => d.fundicao_prevista),
            os: [...new Set(ds.flatMap((d) => d.os_codigos ?? []))],
            desenhos: ds.map((d) => ({ tipo: d.tipo, codigo: d.codigo, revisao: d.revisao, data_revisao: d.data_revisao, acervo_da_fundicao: d.origem === "acervo" })),
            anotacoes: (notas ?? []).filter((n) => n.artigo_chave === k).map((n) => ({ texto: n.texto, autor: n.autor_nome, em: n.created_at })),
          };
        }),
      },
      fontes: [fonteBib],
    };
  },
});

const telas: Tela[] = [
  { id: "fundicao_pedidos", modulo: M, secao: "Pedidos de material", rotulo: "Fundição › Pedidos de material", exige: PODE, serve: "pedir material e acompanhar os pedidos" },
  { id: "fundicao_biblioteca", modulo: M, secao: "Biblioteca", rotulo: "Fundição › Biblioteca", exige: ["fundicao.biblioteca"], serve: "ver os desenhos das peças, as revisões e as anotações da Fundição" },
];

const regras: Agente["regras"] = [
  {
    exige: PODE,
    gerar: async (sb, c) => {
      const saida: Alerta[] = [];
      const ativos = await pedidosDeMaterial(sb, { origem: "FUNDICAO", status: ["aberta", "em_cotacao", "aprovada", "comprada", "parcial", "rejeitada"] });
      const atrasados = ativos.filter((p) => p.status !== "rejeitada" && p.precisa_ate && p.precisa_ate <= c.hoje);
      if (atrasados.length) saida.push({
        chave: `fundicao.precisa_ate:${atrasados.map((p) => p.numero).join(",")}`, nivel: "urgente",
        titulo: `${plural(atrasados.length, "pedido passou", "pedidos passaram")} da data em que o material era preciso`,
        detalhe: atrasados.slice(0, 3).map((p) => `nº ${p.numero} (precisava até ${dataBR(p.precisa_ate!)})`).join(" · ") + ". Fale com o Compras.",
        abrir,
      });
      // Degrau 3: cada pedido rejeitado (os 5 mais recentes) vira um aviso com "Refazer o pedido" pronto.
      const rejeitados = ativos.filter((p) => p.status === "rejeitada");
      // Já refeito (existe pedido "Refaz o pedido nº X"): o aviso fica, sem a ação (para não refazer duas vezes).
      const refeitos = jaRefeitos(ativos);
      for (const p of rejeitados.slice(0, 5)) saida.push({
        chave: `fundicao.rejeitado:${p.numero}`, nivel: "urgente",
        titulo: `Pedido nº ${p.numero} rejeitado pelo Compras`,
        detalhe: `${p.cancel_reason ? `Motivo: ${p.cancel_reason}. ` : ""}Se ainda precisar, refaça com os mesmos itens.`,
        abrir, propor: refeitos.has(p.numero) ? undefined : refazerPedido(p, "pedir_material_fundicao"),
      });
      if (rejeitados.length > 5) saida.push({
        chave: `fundicao.rejeitados:${rejeitados.slice(5).map((p) => p.numero).join(",")}`, nivel: "urgente",
        titulo: `Mais ${plural(rejeitados.length - 5, "pedido rejeitado", "pedidos rejeitados")} pelo Compras`,
        detalhe: "Veja o motivo e faça um pedido novo, se ainda precisar.",
        abrir,
      });
      const comCompras = ativos.filter((p) => p.status === "aberta" || p.status === "em_cotacao");
      if (comCompras.length) saida.push({
        chave: `fundicao.com_compras:${comCompras.map((p) => `${p.numero}`).join(",")}`, nivel: "aviso",
        titulo: `${plural(comCompras.length, "pedido", "pedidos")} com o Compras`,
        detalhe: comCompras.slice(0, 3).map((p) => `nº ${p.numero} há ${dias(p.created_at, c.hoje)} dia(s)`).join(" · "),
        abrir,
      });
      const caminho = ativos.filter((p) => p.status === "comprada" || p.status === "parcial");
      if (caminho.length) saida.push({
        chave: `fundicao.a_caminho:${caminho.map((p) => p.numero).join(",")}`, nivel: "aviso",
        titulo: `${plural(caminho.length, "pedido comprado", "pedidos comprados")} a caminho`, detalhe: caminho.slice(0, 3).map((p) => `nº ${p.numero}`).join(" · "), abrir,
      });
      return saida;
    },
  },
];

const MANUAL = `Você é a SARA da Fundição do Business OS.
A tela "Pedidos de material" mostra os pedidos da Fundição: fazer um pedido (itens, quantidade, urgência, precisa até), acompanhar (com o Compras → aprovado → comprado/a caminho → recebido) e cancelar.
Quem é da Fundição não vê preço, cotação nem OC do Compras: fale só dos pedidos e da situação de cada um.
Quem decide: Guilherme na Fundição; aprovar a cotação é do Domingo e do Ricardo; o recebimento é do Almoxarifado (Henrique).`;

export const fundicao: Agente = {
  sara: {
    modulo: M, nome: "SARA da Fundição", rotulo: "Fundição", feature: M, permissao: "fundicao.sara", manual: MANUAL,
    ferramentas: ferramentas.map((f) => f.nome), telas,
    sugestoes: ["Como estão os meus pedidos de material?", "Algum pedido já está a caminho?", "Qual o código do material para areia de moldagem?", "Como faço um pedido urgente?"],
  },
  ferramentas, regras,
};
