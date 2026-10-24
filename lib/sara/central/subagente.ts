import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fonte, Ferramenta, SaraModulo } from "../base.ts";
import { comoAgente, iniciarPasso } from "../progresso.ts";
import { dicaVisual, type Visual } from "../visual.ts";

/**
 * SARA de um módulo como subagente da SARA central (E7, J1). A central não consulta direto: pergunta às
 * SARAs dos módulos que a pessoa pode usar, várias ao mesmo tempo (`paralela`), e cada uma roda com a
 * SESSÃO de quem perguntou — as permissões dela valem em toda consulta. A subagente responde à central
 * (não à pessoa): curto, com todos os números e de qual consulta vieram.
 */

export type UsoSubagente = { modulo: string; modelo: string; tokensEntrada: number; tokensSaida: number; cacheLido: number; cacheGravado: number; ok: boolean; tempos?: { etapa: string; ms: number }[] };
export type Rodar = (sb: SupabaseClient, modulo: string, pergunta: string) => Promise<{ texto: string; fontes: { rotulo: string; link: string }[]; consultas: string[]; uso: UsoSubagente; visuais: Visual[];
  /** O resultado bruto de cada consulta da área (para a central montar o painel; não vai ao modelo). */
  resultados?: { nome: string; rotulo?: string; dados: unknown; fontes?: Fonte[] }[] }>;

/** Consultas da área que não viram dado de painel. */
const SEM_PAINEL = new Set(["mostrar", "abrir_tela", "abrir_lancamento", "calcular", "periodo", "registrar_lacuna", "propor_habilidade", "criar_guia"]);

/**
 * O que a área consultou vira dado de painel da central: o nome ganha a área ("financeiro.contas_a_receber")
 * e o modelo recebe só a dica (caminhos e campos, nenhum número).
 */
export function dadosDePainel(modulo: string, area: string, resultados: NonNullable<Awaited<ReturnType<Rodar>>["resultados"]>) {
  const dados = resultados.filter((x) => !SEM_PAINEL.has(x.nome)).map((x) => ({ nome: `${modulo}.${x.nome}`, rotulo: `${area} › ${x.rotulo ?? x.nome.replace(/_/g, " ")}`, dados: x.dados, fontes: x.fontes ?? [] }));
  const dicas = dados.map((x) => dicaVisual(x.nome, x.dados)).filter((x): x is string => Boolean(x)).slice(0, 4);
  return { dados, dicas };
}

/** O que a subagente recebe como instrução do momento (além do manual e das regras do módulo). */
export const REGRA_SUBAGENTE = "Quem está perguntando agora é a SARA central da empresa, em nome da pessoa (com as permissões dela). Responda só o que foi pedido, curto e objetivo (no máximo 120 palavras, sem tabela longa: os 3 a 5 itens que importam), com TODOS os números e o período usado, dizendo de qual consulta veio cada um. Faça as consultas necessárias de uma vez, na mesma rodada. Sem cumprimento, sem perguntas de volta e sem oferecer ações; se faltar um dado, diga qual faltou; se a pessoa não tiver permissão para algo, diga \"sem permissão para…\". Se a central pedir gráfico, tabela ou indicadores, monte com a ferramenta mostrar (a plataforma apresenta na tela da pessoa).";

/** Ferramentas da SARA do módulo que a subagente NÃO usa (agir, navegar e propor são da central e da pessoa). O gráfico (mostrar) ela monta e devolve à central. */
export const FORA_DA_SUBAGENTE = new Set(["abrir_tela", "abrir_lancamento", "registrar_lacuna", "propor_habilidade", "criar_guia"]);

/** `respostas`: o que cada área devolveu (as fontes dos números dos documentos da central). */
export function ferramentaPerguntarASara(modulos: Pick<SaraModulo, "modulo" | "rotulo">[], rodar: Rodar, usos: UsoSubagente[], visuais: Visual[] = [], respostas: unknown[] = []): Ferramenta {
  const lista = modulos.map((m) => `${m.modulo} (${m.rotulo})`).join(", ");
  return {
    nome: "perguntar_a_sara", rotulo: "perguntou à SARA da área", exige: [], paralela: true,
    descricao: `Pergunta à SARA de um módulo (ela consulta os dados do módulo e de outros que a pessoa pode ver, com as permissões da pessoa) e devolve a resposta com as fontes. Para uma pergunta que cruza áreas, chame VÁRIAS ao mesmo tempo, uma por área. Faça a pergunta de cada uma específica: o que precisa, o período e o recorte. Para painel, gráfico ou tabela na tela: a resposta traz "para_mostrar_no_painel" (as consultas da área e os campos) e VOCÊ monta com mostrar. Módulos disponíveis para esta pessoa: ${lista || "nenhum"}.`,
    esquema: {
      type: "object",
      properties: {
        modulo: { type: "string", enum: modulos.map((m) => m.modulo), description: "A área a consultar." },
        pergunta: { type: "string", description: "A pergunta para a SARA da área, com o período e o que precisa." },
      },
      required: ["modulo", "pergunta"],
    },
    rodar: async (sb, e) => {
      const modulo = String(e.modulo ?? "");
      const m = modulos.find((x) => x.modulo === modulo);
      if (!m) return { dados: { erro: `Sem permissão para a SARA de "${modulo}" (ou o módulo não existe).` }, fontes: [] };
      const pergunta = String(e.pergunta ?? "").trim().slice(0, 1500);
      if (pergunta.length < 3) return { dados: { erro: "Faltou a pergunta." }, fontes: [] };
      // Na tela: "Conversando com a SARA · Financeiro", e os passos dela saem em nome da área.
      const passo = iniciarPasso("agente", `Conversando com a SARA · ${m.rotulo}: ${pergunta.length > 70 ? `${pergunta.slice(0, 69)}…` : pergunta}`);
      try {
        const r = await comoAgente(m.rotulo, () => rodar(sb, modulo, pergunta));
        passo.fim(true, `SARA · ${m.rotulo} respondeu`);
        usos.push(r.uso);
        visuais.push(...r.visuais);
        respostas.push({ area: m.rotulo, resposta: r.texto }, ...r.visuais);
        // O resultado bruto fica na plataforma (para o mostrar da central) e também é fonte dos números.
        const painel = dadosDePainel(modulo, m.rotulo, r.resultados ?? []);
        respostas.push(...painel.dados.map((x) => x.dados));
        return { dados: { area: m.rotulo, resposta: r.texto, consultas: r.consultas,
          ...(r.visuais.length ? { apresentado_na_tela: `${r.visuais.length} visual(is) — a plataforma mostra na tela; fale deles, não repita os números` } : {}),
          ...(painel.dicas.length ? { para_mostrar_no_painel: painel.dicas } : {}) }, fontes: r.fontes, paraVisual: painel.dados };
      } catch (err) {
        passo.fim(false, `SARA · ${m.rotulo} não respondeu`);
        usos.push({ modulo, modelo: "", tokensEntrada: 0, tokensSaida: 0, cacheLido: 0, cacheGravado: 0, ok: false });
        return { dados: { area: m.rotulo, erro: `A SARA da área não respondeu: ${err instanceof Error ? err.message.slice(0, 160) : "erro"}` }, fontes: [] };
      }
    },
  };
}
