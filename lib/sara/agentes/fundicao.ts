import { dataBR, dias, hoje, link, plural, type Abrir, type Agente, type Alerta, type Ferramenta, type Tela } from "../base.ts";
import { buscarMateriais, linhaDoPedido, pedidosDeMaterial } from "./almoxarifado.ts";

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

const telas: Tela[] = [{ id: "fundicao_pedidos", modulo: M, rotulo: "Fundição › Pedidos de material", exige: PODE, serve: "pedir material e acompanhar os pedidos" }];

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
      const rejeitados = ativos.filter((p) => p.status === "rejeitada");
      if (rejeitados.length) saida.push({
        chave: `fundicao.rejeitados:${rejeitados.map((p) => p.numero).join(",")}`, nivel: "urgente",
        titulo: `${plural(rejeitados.length, "pedido rejeitado", "pedidos rejeitados")} pelo Compras`,
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
