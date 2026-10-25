/**
 * Envios agendados pelo WhatsApp: regras puras (sem dependências), testadas sem o banco.
 * Horário silencioso (decidido em 24/10/2026): nada sai entre 20h e 7h nem aos domingos, no horário de Brasília
 * (sem horário de verão desde 2019: UTC−3 fixo). O envio que cair nele espera o próximo horário permitido.
 */
const OFFSET_MS = 3 * 3600_000;

/** Hora e dia da semana em Brasília. */
function emBrasilia(d: Date) {
  const b = new Date(d.getTime() - OFFSET_MS);
  return { hora: b.getUTCHours(), dia: b.getUTCDay(), b };
}

export function silencioso(d: Date): boolean {
  const { hora, dia } = emBrasilia(d);
  return dia === 0 || hora >= 20 || hora < 7;
}

/** O próximo instante permitido a partir de `d` (o próprio `d`, se já for permitido): 7h de Brasília do próximo dia útil. */
export function proximoHorarioPermitido(d: Date): Date {
  if (!silencioso(d)) return d;
  const { hora, b } = emBrasilia(d);
  // Base: 7h00 de Brasília do mesmo dia (se ainda for madrugada) ou do dia seguinte.
  const alvo = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + (hora < 7 ? 0 : 1), 7, 0, 0) + OFFSET_MS);
  return silencioso(alvo) ? proximoHorarioPermitido(new Date(alvo.getTime() + 24 * 3600_000 - 60_000)) : alvo;
}

/** Depois de uma falha: tenta de novo em 10 minutos, até 3 tentativas. */
export const MAX_TENTATIVAS = 3;
export const proximaTentativa = (agora: Date) => new Date(agora.getTime() + 10 * 60_000);
