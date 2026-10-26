import type { SupabaseClient } from "@supabase/supabase-js";
import type { Abrir, Alerta } from "../sara/base.ts";
import { diasAte, montarCalendario, type DadosCalendario } from "./calendario.ts";

/**
 * Avisos do calendário fiscal (N-06) para a SARA do Fiscal e do Financeiro, e por elas para o Bom dia (sino e
 * WhatsApp): o que vence nos próximos 7 dias. A chave muda nos marcos D-7, D-3 e D-1, para o aviso voltar a
 * pulsar nesses dias; vence hoje ou amanhã = urgente. Usa a sessão da pessoa (fiscal_calendario_dados confere
 * a permissão). `somenteGuias`: o Financeiro só vê o que é pagamento.
 */
const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const quando = (hoje: string, data: string) => {
  const n = diasAte(hoje, data);
  const dia = `${data.slice(8, 10)}/${data.slice(5, 7)}, ${DIA_SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()]}`;
  return n === 0 ? `hoje (${dia})` : n === 1 ? `amanhã (${dia})` : `${dia} (em ${n} dias)`;
};
const marco = (n: number) => (n <= 1 ? 1 : n <= 3 ? 3 : 7);

export async function avisosDoCalendario(sb: SupabaseClient, hoje: string, o: { somenteGuias: boolean; abrir: Abrir; prefixo: string }): Promise<Alerta[]> {
  const { data, error } = await sb.rpc("fiscal_calendario_dados");
  if (error || !data) return [];
  const ate = new Date(Date.parse(`${hoje}T12:00:00Z`) + 7 * 86400_000).toISOString().slice(0, 10);
  const cal = montarCalendario(data as DadosCalendario, { de: hoje, ate, hoje });
  const proximos = cal.ocorrencias.filter((x) => x.vencimento && (!o.somenteGuias || x.tipo === "guia"));
  if (!proximos.length) return [];
  const urgente = proximos.some((x) => diasAte(hoje, x.vencimento!) <= 1);
  const lista = proximos.map((x) => `${x.nome} (${x.competencia}): ${quando(hoje, x.vencimento!)}${x.quem === "escritorio" ? " · escritório" : ""}`);
  return [{
    chave: `${o.prefixo}.calendario:${proximos.map((x) => `${x.codigo}@${x.vencimento}~${marco(diasAte(hoje, x.vencimento!))}`).join(",")}`,
    nivel: urgente ? "urgente" : "aviso",
    titulo: proximos.length === 1 ? `${o.somenteGuias ? "Guia" : "Obrigação fiscal"} vence ${quando(hoje, proximos[0].vencimento!)}` : `${proximos.length} ${o.somenteGuias ? "guias vencem" : "vencimentos fiscais"} nos próximos 7 dias`,
    detalhe: `${lista.slice(0, 5).join(" · ")}${lista.length > 5 ? ` · e mais ${lista.length - 5}` : ""}.${cal.aConferir ? " Prazos ainda a conferir pelo contador." : ""}`,
    abrir: o.abrir,
  }];
}
