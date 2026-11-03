import type { SupabaseClient } from "@supabase/supabase-js";
import { DIAS_DA_SEMANA } from "./bom-dia.ts";
import { VIGIA } from "./vigia.ts";

/**
 * Vigia configurável pela tela (proprietário, 03/11/2026): dias, hora, envio pelo WhatsApp e lista de transmissão ficam no
 * banco (sara_vigia_config), não no código. Sem a configuração, vale o padrão de VIGIA. Puro, menos `lerConfigVigia`.
 */

export type ConfigVigia = { dias: number[]; hora: string; whatsapp: boolean };
export const PADRAO_VIGIA: ConfigVigia = { dias: [...VIGIA.dias], hora: VIGIA.hora, whatsapp: false };
/** A rodada pode começar até 3h30 depois da hora marcada (a tarefa roda de 10 em 10 minutos). */
const FOLGA_MIN = 210;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutos = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function janelaDaVigia(c: ConfigVigia) {
  return { dias: c.dias, hora: c.hora, ate: hhmm(Math.min(minutos(c.hora) + FOLGA_MIN, 23 * 60 + 59)) };
}

/** "de segunda a sexta, às 6h30" — o texto do painel sai daqui, para nunca mais ficar diferente da regra. */
export function textoDaAgenda(c: ConfigVigia): string {
  const [h, m] = c.hora.split(":");
  const hora = `${Number(h)}h${m === "00" ? "" : m}`;
  const dias = [...c.dias].sort((a, b) => a - b);
  if (!dias.length) return "desligada (nenhum dia marcado)";
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const nome = (d: number) => DIAS_DA_SEMANA[d];
  const quando = dias.length === 7 ? "todo dia" : dias.length === 1 ? `às ${nome(dias[0])}s` : seguidos && dias.length > 2 ? `de ${nome(dias[0])} a ${nome(dias.at(-1) as number)}`
    : `${dias.slice(0, -1).map(nome).join(", ")} e ${nome(dias.at(-1) as number)}`;
  return `${quando}, às ${hora}`;
}

/** Confere o que veio da tela. */
export function validarConfig(e: unknown): ConfigVigia | { erro: string } {
  const x = (e ?? {}) as { dias?: unknown; hora?: unknown; whatsapp?: unknown };
  const dias = Array.isArray(x.dias) ? [...new Set(x.dias.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b) : null;
  if (!dias) return { erro: "Escolha os dias da vigia." };
  if (typeof x.hora !== "string" || !HORA.test(x.hora)) return { erro: "Hora inválida (use HH:MM)." };
  return { dias, hora: x.hora, whatsapp: x.whatsapp === true };
}

export async function lerConfigVigia(sb: SupabaseClient): Promise<ConfigVigia> {
  const { data, error } = await sb.from("sara_vigia_config").select("dias, hora, whatsapp").limit(1).maybeSingle<ConfigVigia>();
  if (error || !data) return PADRAO_VIGIA;
  return { dias: (data.dias ?? []).map(Number), hora: data.hora, whatsapp: Boolean(data.whatsapp) };
}

/** A mensagem da Vigia no WhatsApp: só os gargalos que a pessoa enxerga. Sem modelo: o texto é da plataforma. */
export function mensagemDaVigia(a: { nome: string; dia: string; achados: { area: string; titulo: string; por_que: string | null; impacto: string | null }[]; base: string }): string {
  const [ano, mes, d] = a.dia.split("-");
  const linhas = a.achados.slice(0, 8).map((x) => `• *${x.area}*${x.impacto === "alto" ? " (impacto alto)" : ""}: ${x.titulo}${x.por_que ? `\n  ${x.por_que.slice(0, 220)}` : ""}`);
  const mais = a.achados.length > 8 ? `\n…e mais ${a.achados.length - 8}.` : "";
  return `*Vigia da SARA* · ${d}/${mes}/${ano}\n${a.nome ? `${a.nome}, ` : ""}${a.achados.length === 1 ? "um gargalo pede a sua atenção" : `${a.achados.length} gargalos pedem a sua atenção`}:\n\n${linhas.join("\n")}${mais}\n\nResponda em Decisões para você: ${a.base}/?decisoes=1\n_SARA · em fase de teste_`.slice(0, 4000);
}
