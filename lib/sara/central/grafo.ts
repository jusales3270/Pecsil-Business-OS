import type { SupabaseClient } from "@supabase/supabase-js";
import { TIPOS, tipoDe, type FocoGrafo, type NoGrafo, type Subgrafo } from "../../cerebro/visual.ts";
import { link, type Ferramenta, type Resultado } from "../base.ts";

/**
 * A SARA central foca o Segundo Cérebro (T1 do plano E7.T, 31/10/2026). O modelo só aponta nomes: quem acha o nó, monta
 * o subgrafo e conta é a plataforma, com a sessão de quem pergunta e as mesmas consultas da tela. Navegar não grava nada.
 * Só a central tem, para quem pode ver o cérebro (lib/sara/sessao.ts).
 */

const SEM_PERMISSAO = "Sem permissão para ver o Segundo Cérebro.";
const TIPOS_NO = TIPOS.map((t) => t.tipo);
const PROFUNDIDADE_ATE = 3;
/** Mesmo limite da tela, para o número falado bater com o que aparece. */
const LIMITE_DA_TELA = 5000;

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const rotuloDe = (n: NoGrafo) => `${n.nome} (${tipoDe(n.tipo).singular})`;

type Achado = { no: NoGrafo } | { erro: string } | { escolher: string[] };

/** Acha um nó pelo nome. Mais de um sem nome exato: a SARA pergunta qual; nunca escolhe por conta própria. */
export async function acharNo(sb: SupabaseClient, nome: unknown, tipo: unknown): Promise<Achado> {
  const termo = String(nome ?? "").trim().slice(0, 100);
  if (termo.length < 2) return { erro: "Diga o nome de quem você quer ver no cérebro." };
  const { data, error } = await sb.rpc("cerebro_buscar", { p_termo: termo, p_tipos: TIPOS_NO.includes(tipo as never) ? [tipo] : null, p_limite: 5 });
  if (error) return { erro: error.code === "42501" ? SEM_PERMISSAO : "Não consegui consultar o Segundo Cérebro." };
  const lista = (data ?? []) as NoGrafo[];
  if (!lista.length) return { erro: `Não achei "${termo}" no Segundo Cérebro (ou sem permissão).` };
  const exatos = lista.filter((n) => normal(n.nome) === normal(termo));
  if (exatos.length === 1) return { no: exatos[0] };
  if (lista.length === 1) return { no: lista[0] };
  return { escolher: (exatos.length ? exatos : lista).map(rotuloDe) };
}

/** O que vai ao modelo: só o apurado. Os 5 com mais ligações na empresa, fora o centro. */
function resumo(g: Subgrafo, centro: string | null) {
  const principais = g.nos.filter((n) => n.id !== centro).sort((a, b) => b.grau - a.grau).slice(0, 5)
    .map((n) => ({ nome: n.nome, tipo: tipoDe(n.tipo).singular, ligacoes_na_empresa: n.grau }));
  return { pontos: g.nos.length, ligacoes: g.ligacoes.length, principais };
}

const abrirEm = (nome: string) => ({ modulo: "warroom", secao: "Segundo Cérebro", rotulo: `War Room › Segundo Cérebro › ${nome}` });
const fontes = () => [{ rotulo: "War Room › Segundo Cérebro", link: link("warroom", "Segundo Cérebro") }];
const so = (dados: unknown): Resultado => ({ dados, fontes: [] });

async function consultar(sb: SupabaseClient, f: string, args: Record<string, unknown>): Promise<{ g: Subgrafo & { achou?: boolean; passos?: number } } | { erro: string }> {
  const { data, error } = await sb.rpc(f, args);
  if (error) return { erro: error.code === "42501" ? SEM_PERMISSAO : "Não consegui consultar o Segundo Cérebro." };
  const g = (data ?? {}) as Subgrafo & { achou?: boolean; passos?: number };
  return { g: { ...g, nos: g.nos ?? [], ligacoes: g.ligacoes ?? [] } };
}

export const MOSTRAR_GRAFO: Ferramenta = {
  nome: "mostrar_grafo", rotulo: "mostrou o Segundo Cérebro", exige: ["warroom.cerebro"],
  descricao: "Abre o Segundo Cérebro focado para a pessoa VER como as coisas se ligam: tudo que liga a alguém (vizinhanca), o que depende de algo (dependencias) ou o caminho entre dois (caminho). Passe os NOMES, nunca ids. Devolve os números apurados: fale só deles e nunca invente ligação. Se vier \"escolher\", pergunte à pessoa qual é.",
  esquema: { type: "object", properties: {
    modo: { type: "string", enum: ["vizinhanca", "dependencias", "caminho"] },
    nome: { type: "string", description: "vizinhanca e dependencias: o nome de quem focar." },
    tipo: { type: "string", enum: TIPOS_NO, description: "Se souber, ajuda a achar o certo." },
    profundidade: { type: "number", enum: [1, 2, 3], description: "vizinhanca: quantos passos (padrão 1)." },
    sentido: { type: "string", enum: ["jusante", "montante"], description: "dependencias: jusante = o que depende dele; montante = do que ele depende (padrão jusante)." },
    de: { type: "string", description: "caminho: nome de um dos dois." },
    para: { type: "string", description: "caminho: nome do outro." },
    tipo_de: { type: "string", enum: TIPOS_NO }, tipo_para: { type: "string", enum: TIPOS_NO },
  }, required: ["modo"] },
  rodar: async (sb, e): Promise<Resultado> => {
    if (e.modo === "caminho") {
      const [a, b] = await Promise.all([acharNo(sb, e.de, e.tipo_de), acharNo(sb, e.para, e.tipo_para)]);
      if ("erro" in a) return so(a);
      if ("erro" in b) return so(b);
      if ("escolher" in a) return so({ escolher: a.escolher, para_qual: "de" });
      if ("escolher" in b) return so({ escolher: b.escolher, para_qual: "para" });
      if (a.no.id === b.no.id) return so({ erro: "Os dois nomes são o mesmo ponto do cérebro." });
      const c = await consultar(sb, "cerebro_caminho", { p_de: a.no.id, p_para: b.no.id, p_max: 4 });
      if ("erro" in c) return so(c);
      if (c.g.achou === false) return so({ erro: "Não há caminho em até 4 passos." });
      const grafo: FocoGrafo = { modo: "caminho", de: a.no.id, para: b.no.id, nomes: [a.no.nome, b.no.nome] };
      return { dados: { passos: c.g.passos ?? c.g.ligacoes.length, caminho: c.g.nos.map((n) => n.nome), observacao: "O caminho aparece na tela." },
        fontes: fontes(), abrir: abrirEm(`${a.no.nome} até ${b.no.nome}`), grafo };
    }
    if (e.modo !== "vizinhanca" && e.modo !== "dependencias") return so({ erro: "Modo inválido: use vizinhanca, dependencias ou caminho." });
    const a = await acharNo(sb, e.nome, e.tipo);
    if ("erro" in a || "escolher" in a) return so(a);
    if (e.modo === "dependencias") {
      const sentido = e.sentido === "montante" ? "montante" : "jusante";
      const c = await consultar(sb, "cerebro_dependencias", { p_no: a.no.id, p_sentido: sentido, p_profundidade: 3 });
      if ("erro" in c) return so(c);
      const grafo: FocoGrafo = { modo: "dependencias", no: a.no.id, nome: a.no.nome, sentido };
      return { dados: { centro: a.no.nome, sentido, ...resumo(c.g, a.no.id), observacao: "As dependências aparecem na tela." }, fontes: fontes(), abrir: abrirEm(a.no.nome), grafo };
    }
    const pedida = Number(e.profundidade);
    const profundidade = Number.isInteger(pedida) && pedida >= 1 && pedida <= PROFUNDIDADE_ATE ? pedida : 1;
    const c = await consultar(sb, "cerebro_vizinhanca", { p_no: a.no.id, p_profundidade: profundidade, p_limite: LIMITE_DA_TELA });
    if ("erro" in c) return so(c);
    const grafo: FocoGrafo = { modo: "vizinhanca", no: a.no.id, nome: a.no.nome, profundidade };
    return { dados: { centro: a.no.nome, profundidade, ...resumo(c.g, a.no.id), observacao: "A vizinhança aparece na tela." }, fontes: fontes(), abrir: abrirEm(a.no.nome), grafo };
  },
};
