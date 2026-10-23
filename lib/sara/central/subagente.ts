import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ferramenta, SaraModulo } from "../base.ts";

/**
 * SARA de um módulo como subagente da SARA central (E7, J1). A central não consulta direto: pergunta às
 * SARAs dos módulos que a pessoa pode usar, várias ao mesmo tempo (`paralela`), e cada uma roda com a
 * SESSÃO de quem perguntou — as permissões dela valem em toda consulta. A subagente responde à central
 * (não à pessoa): curto, com todos os números e de qual consulta vieram.
 */

export type UsoSubagente = { modulo: string; modelo: string; tokensEntrada: number; tokensSaida: number; cacheLido: number; cacheGravado: number; ok: boolean };
export type Rodar = (sb: SupabaseClient, modulo: string, pergunta: string) => Promise<{ texto: string; fontes: { rotulo: string; link: string }[]; consultas: string[]; uso: UsoSubagente }>;

/** O que a subagente recebe como instrução do momento (além do manual e das regras do módulo). */
export const REGRA_SUBAGENTE = "Quem está perguntando agora é a SARA central da empresa, em nome da pessoa (com as permissões dela). Responda só o que foi pedido, curto e objetivo, com TODOS os números e o período usado, dizendo de qual consulta veio cada um. Sem cumprimento, sem perguntas de volta e sem oferecer ações; se faltar um dado, diga qual faltou; se a pessoa não tiver permissão para algo, diga \"sem permissão para…\".";

/** Ferramentas da SARA do módulo que a subagente NÃO usa (agir, navegar e propor são da central e da pessoa). */
export const FORA_DA_SUBAGENTE = new Set(["abrir_tela", "abrir_lancamento", "mostrar", "registrar_lacuna", "propor_habilidade", "criar_guia"]);

export function ferramentaPerguntarASara(modulos: Pick<SaraModulo, "modulo" | "rotulo">[], rodar: Rodar, usos: UsoSubagente[]): Ferramenta {
  const lista = modulos.map((m) => `${m.modulo} (${m.rotulo})`).join(", ");
  return {
    nome: "perguntar_a_sara", rotulo: "perguntou à SARA da área", exige: [], paralela: true,
    descricao: `Pergunta à SARA de um módulo (ela consulta os dados do módulo e de outros que a pessoa pode ver, com as permissões da pessoa) e devolve a resposta com as fontes. Para uma pergunta que cruza áreas, chame VÁRIAS ao mesmo tempo, uma por área. Faça a pergunta de cada uma específica: o que precisa, o período e o recorte. Módulos disponíveis para esta pessoa: ${lista || "nenhum"}.`,
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
      try {
        const r = await rodar(sb, modulo, pergunta);
        usos.push(r.uso);
        return { dados: { area: m.rotulo, resposta: r.texto, consultas: r.consultas }, fontes: r.fontes };
      } catch (err) {
        usos.push({ modulo, modelo: "", tokensEntrada: 0, tokensSaida: 0, cacheLido: 0, cacheGravado: 0, ok: false });
        return { dados: { area: m.rotulo, erro: `A SARA da área não respondeu: ${err instanceof Error ? err.message.slice(0, 160) : "erro"}` }, fontes: [] };
      }
    },
  };
}
