/**
 * Como o grafo do Segundo Cérebro aparece (War Room › Segundo Cérebro): os grupos por tipo e as cores,
 * os nomes das ligações, o tamanho dos nós e a ficha de cada um. Puro (sem navegador), para os testes.
 */

export type TipoNo = "fornecedor" | "cliente" | "item" | "material" | "produto" | "conta" | "setor";
export type NoGrafo = {
  id: string; tipo: TipoNo | string; nome: string; termos: string[]; setor: string | null; resumo: Record<string, unknown>;
  grau: number; link: string | null; x: number | null; y: number | null;
};
export type LigacaoGrafo = {
  id: string; origem: string; destino: string; tipo: string; familia: string; quantidade: number | null; total: number | null;
  primeira: string | null; ultima: string | null; resumo: Record<string, unknown>; procedencia: string; situacao: string;
};
export type Subgrafo = { nos: NoGrafo[]; ligacoes: LigacaoGrafo[]; centro?: string };

/** Os grupos, na ordem da legenda. A cor é um token do tema (claro e escuro). */
export const TIPOS: { tipo: TipoNo; rotulo: string; singular: string; cor: string }[] = [
  { tipo: "fornecedor", rotulo: "Fornecedores", singular: "Fornecedor", cor: "--accent-blue" },
  { tipo: "cliente", rotulo: "Clientes", singular: "Cliente", cor: "--accent-green" },
  { tipo: "item", rotulo: "Itens comprados", singular: "Item comprado", cor: "--accent-amber" },
  { tipo: "conta", rotulo: "Contas do plano", singular: "Conta do plano", cor: "--accent-purple" },
  { tipo: "setor", rotulo: "Setores", singular: "Setor", cor: "--accent-red" },
  { tipo: "material", rotulo: "Materiais", singular: "Material", cor: "--accent-neutral" },
  { tipo: "produto", rotulo: "Peças dos clientes", singular: "Peça", cor: "--accent-teal" },
];
export const tipoDe = (t: string) => TIPOS.find((x) => x.tipo === t) ?? { tipo: t as TipoNo, rotulo: t, singular: t, cor: "--accent-neutral" };

/** Tipos que abrem na visão inicial. As peças (3,9 mil) entram quando a pessoa pede. */
export const TIPOS_INICIAIS: TipoNo[] = ["fornecedor", "cliente", "item", "conta", "setor", "material"];

export const LIGACOES: Record<string, { rotulo: string; inverso: string }> = {
  vendeu: { rotulo: "vendeu", inverso: "comprado de" },
  cotou: { rotulo: "cotou", inverso: "cotado por" },
  lancado_em: { rotulo: "lançado em", inverso: "lançamentos de" },
  abastece: { rotulo: "abastece", inverso: "depende de" },
  pertence_a: { rotulo: "pertence a", inverso: "contém" },
  tem_peca: { rotulo: "peça", inverso: "peça de" },
  e: { rotulo: "é o material", inverso: "comprado como" },
};
export const rotuloLigacao = (tipo: string, deOrigem: boolean) => (LIGACOES[tipo] ? (deOrigem ? LIGACOES[tipo].rotulo : LIGACOES[tipo].inverso) : tipo.replace(/_/g, " "));

export const FAMILIAS: { familia: string; rotulo: string }[] = [
  { familia: "transacao", rotulo: "Transações (compras, cotações, lançamentos)" },
  { familia: "dependencia", rotulo: "Dependências (abastece, sustenta)" },
  { familia: "estrutura", rotulo: "Estrutura (grupos, peças)" },
  { familia: "responsabilidade", rotulo: "Responsabilidade (quem decide)" },
  { familia: "mencao", rotulo: "Menções (documentos)" },
];

/** Tamanho do nó pelo número de ligações (raiz, para os grandes não engolirem a tela). */
export function tamanhoDoNo(grau: number, escala = 1): number {
  return Math.round(Math.min(26, Math.max(2.5, (2.5 + Math.sqrt(Math.max(0, grau)) * 1.4) * escala)) * 10) / 10;
}

/** Posição inicial estável (a mesma para o mesmo nó), antes do ForceAtlas2 arrumar. */
export function posicaoInicial(id: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const a = ((h >>> 0) % 36000) / 36000 * Math.PI * 2;
  const r = 10 + ((h >>> 8) % 1000) / 10;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
export const dataBR = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : v);

/** Campos da ficha: rótulo e como mostrar, na ordem. O que não está aqui não aparece. */
const CAMPOS: Record<string, [string, string, "moeda" | "numero" | "data" | "texto" | "dias" | "simnao"][]> = {
  fornecedor: [["comprado", "Comprado (desde jul/2026)", "moeda"], ["compras", "Compras", "numero"], ["ultima_compra", "Última compra", "data"],
    ["pago", "Pago (histórico)", "moeda"], ["em_aberto", "Em aberto", "moeda"], ["titulos", "Títulos", "numero"], ["primeiro_lancamento", "Desde", "data"],
    ["ultimo_lancamento", "Último lançamento", "data"], ["cotacoes", "Cotações", "numero"], ["condicao_pagamento", "Condição de pagamento", "texto"],
    ["categoria", "Categoria", "texto"], ["cidade", "Cidade", "texto"], ["uf", "UF", "texto"]],
  cliente: [["faturado", "Faturado (histórico)", "moeda"], ["recebido", "Recebido", "moeda"], ["em_aberto", "Em aberto", "moeda"], ["vencido", "Vencido", "moeda"],
    ["atraso_medio_dias", "Atraso médio para pagar", "dias"], ["pecas", "Peças cadastradas", "numero"], ["os", "OS", "numero"], ["titulos", "Títulos", "numero"],
    ["ultimo_lancamento", "Último lançamento", "data"], ["municipio", "Município", "texto"], ["uf", "UF", "texto"]],
  item: [["comprado", "Comprado", "moeda"], ["compras", "Compras", "numero"], ["fornecedores", "Fornecedores", "numero"], ["ultimo_preco", "Último preço", "moeda"],
    ["menor_preco", "Menor preço", "moeda"], ["maior_preco", "Maior preço", "moeda"], ["unidade", "Unidade", "texto"], ["ultima_compra", "Última compra", "data"],
    ["nomes", "Nomes diferentes nas compras", "numero"]],
  conta: [["codigo", "Código", "texto"], ["lancado", "Lançado (histórico)", "moeda"], ["titulos", "Títulos", "numero"], ["tipo", "Tipo", "texto"]],
  produto: [["codigo", "Código", "texto"], ["tipo_peca", "Tipo de peça", "texto"], ["material", "Material", "texto"], ["desenho", "Desenho", "texto"], ["ncm", "NCM", "texto"]],
  material: [["codigo", "Código", "texto"], ["grupo", "Grupo", "texto"], ["unidade", "Unidade", "texto"], ["ncm", "NCM", "texto"]],
  setor: [],
};

export function linhasDaFicha(tipo: string, resumo: Record<string, unknown>): { rotulo: string; valor: string }[] {
  return (CAMPOS[tipo] ?? []).flatMap(([k, rotulo, f]) => {
    const v = resumo?.[k];
    if (v === null || v === undefined || v === "") return [];
    const n = Number(v);
    const valor = f === "moeda" && Number.isFinite(n) ? moeda(n)
      : f === "numero" && Number.isFinite(n) ? numero(n)
      : f === "dias" && Number.isFinite(n) ? `${numero(n)} dia${n === 1 ? "" : "s"}`
      : f === "data" ? dataBR(String(v))
      : f === "simnao" ? (v ? "sim" : "não")
      : String(v);
    return [{ rotulo, valor }];
  });
}

/** Uma linha da ligação: "3 compras · R$ 11.573,10 · 04/08 a 18/08/2026 · último preço R$ 18,37". */
export function resumoDaLigacao(l: LigacaoGrafo): string {
  const partes: string[] = [];
  const n = l.quantidade ?? 0;
  const nome = l.tipo === "vendeu" ? ["compra", "compras"] : l.tipo === "cotou" ? ["cotação", "cotações"] : l.tipo === "lancado_em" ? ["título", "títulos"] : ["registro", "registros"];
  if (n) partes.push(`${n.toLocaleString("pt-BR")} ${n === 1 ? nome[0] : nome[1]}`);
  if (l.total !== null && l.total !== undefined && Number.isFinite(Number(l.total))) partes.push(moeda(Number(l.total)));
  if (l.primeira && l.ultima) partes.push(l.primeira === l.ultima ? dataBR(l.ultima) : `${dataBR(l.primeira)} a ${dataBR(l.ultima)}`);
  const up = Number(l.resumo?.ultimo_preco ?? l.resumo?.ultimo_valor);
  if (Number.isFinite(up) && up > 0) partes.push(`último preço ${moeda(up)}`);
  if (l.tipo === "cotou" && Number(l.resumo?.aprovadas) > 0) partes.push(`${l.resumo.aprovadas} aprovada(s)`);
  if (l.situacao === "proposta") partes.push("proposta (a confirmar)");
  return partes.join(" · ");
}

/** Os nós e ligações que ficam visíveis com os filtros (tipos e famílias), sem ligação solta. */
export function filtrar(g: Subgrafo, tipos: Set<string>, familias: Set<string>, desde: string | null): Subgrafo {
  const nos = g.nos.filter((n) => tipos.has(n.tipo) || n.id === g.centro);
  const ids = new Set(nos.map((n) => n.id));
  const ligacoes = g.ligacoes.filter((l) => ids.has(l.origem) && ids.has(l.destino) && familias.has(l.familia) && (!desde || !l.ultima || l.ultima >= desde));
  return { ...g, nos, ligacoes };
}
