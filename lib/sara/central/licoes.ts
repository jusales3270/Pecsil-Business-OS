import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ferramenta } from "../base";
import { SARAS } from "../modulos";
import { createSupabaseAdminClient } from "../../supabase/admin";
import { APRENDIZADO, aprendizadoDaVigia, blocoDeAprendizado, validarLicao, type AprendidoTipo, type LicaoAtiva, type LinhaHistorico } from "./aprendizado";

/**
 * J5 (docs/PLANO-MINDMASTER.md §4e): a lição que a SARA central propõe na conversa e a memória que entra no
 * texto das SARAs. A lição vai a quem decide na área (Decisões); só vale aprovada. A leitura usa a chave de
 * serviço porque a SARA da área também usa as lições dela (quem conversa já passou pela permissão da SARA).
 */

const rotulo = (m: string) => SARAS[m]?.rotulo ?? m;

export function ferramentaProporLicao(areas: { modulo: string; rotulo: string }[], ctx: { conversa: string | null }): Ferramenta {
  return {
    nome: "propor_licao", rotulo: "propôs uma lição para a área aprovar", exige: [],
    descricao: "Quando a pessoa CORRIGIR você ou explicar uma REGRA DO NEGÓCIO que vale daqui em diante (ex.: \"FINIMP vence por contrato com o banco, não é atraso\"; \"a conta 2.1.05 é câmbio\"), proponha a lição, em uma frase, na área a que ela pertence. Não use para fatos do dia, números, opiniões ou pedidos. A lição vai para quem decide naquela área aprovar (em Decisões) e só vale depois disso; se quem ensinou responde pela área, já vale. Diga à pessoa para quem foi. Lição é contexto: nunca tire número dela.",
    esquema: { type: "object", properties: {
      area: { type: "string", enum: areas.map((a) => a.modulo), description: "A área da regra." },
      texto: { type: "string", description: "A regra, em uma frase, como a pessoa explicou (até 500 caracteres)." },
    }, required: ["area", "texto"] },
    rodar: async (sb: SupabaseClient, e) => {
      const area = String(e.area ?? "");
      if (!areas.some((a) => a.modulo === area)) return { dados: { erro: "Área fora das que esta pessoa pode usar." }, fontes: [] };
      const v = validarLicao(e.texto);
      if (!v.ok) return { dados: { erro: v.erro }, fontes: [] };
      const { data, error } = await sb.rpc("sara_licao_propor", { p_modulo: area, p_texto: v.texto, p_conversa: ctx.conversa });
      if (error) return { dados: { erro: error.message }, fontes: [] };
      const r = data as { situacao: string; para?: string[]; aviso?: string };
      const dados = r.situacao === "ja_existe" ? { situacao: "já existe uma lição igual, em aprovação ou valendo" }
        : r.situacao === "ativa" ? { situacao: "valendo já (quem ensinou responde por esta área)" }
        : { situacao: "esperando a aprovação da área", para: r.para ?? [], aviso: r.aviso ?? null };
      return { dados: { area: rotulo(area), ...dados }, fontes: [{ rotulo: "Aprendizado da SARA", link: "/?module=warroom&secao=Conselho" }] };
    },
  };
}

/** As lições valendo nas áreas indicadas. */
export async function licoesAtivas(admin: SupabaseClient, modulos: string[]): Promise<LicaoAtiva[]> {
  if (!modulos.length) return [];
  const { data } = await admin.from("sara_licoes").select("modulo, texto, ensinada_por_nome, decidida_por_nome, efeito")
    .eq("situacao", "ativa").in("modulo", modulos).order("decidida_em", { ascending: false }).limit(APRENDIZADO.maxLicoes * 2);
  return ((data ?? []) as Omit<LicaoAtiva, "area">[]).map((l) => ({ ...l, area: rotulo(l.modulo) }));
}

/** O histórico dos achados da vigia (90 dias), para o que ela aprendeu. */
export async function historicoDaVigia(sb: SupabaseClient, agora: Date = new Date(), org?: string): Promise<LinhaHistorico[]> {
  const desde = new Date(agora.getTime() - APRENDIZADO.janelaDias * 86_400_000).toISOString();
  let q = sb.from("sara_achados").select("tipo, modulo, area, titulo, situacao, envios, created_at, resolvido_em").gte("created_at", desde);
  if (org) q = q.eq("organization_id", org);
  const { data } = await q.order("created_at").limit(2000);
  return (data ?? []) as LinhaHistorico[];
}

/** A memória da SARA: as lições das áreas e, na central, o que a vigia aprendeu nessas áreas. */
export async function memoriaDaSara(modulos: string[], comVigia: boolean): Promise<{ texto: string; tipos: AprendidoTipo[] }> {
  try {
    const admin = createSupabaseAdminClient();
    const [licoes, historico] = await Promise.all([licoesAtivas(admin, modulos), comVigia ? historicoDaVigia(admin) : Promise.resolve([])]);
    const tipos = aprendizadoDaVigia(historico.filter((l) => modulos.includes(l.modulo)));
    return { texto: blocoDeAprendizado(licoes, tipos), tipos };
  } catch (e) {
    // Sem a memória, a SARA responde do mesmo jeito (só não usa o que aprendeu).
    console.error("[sara] memória indisponível", e instanceof Error ? e.message : e);
    return { texto: "", tipos: [] };
  }
}
