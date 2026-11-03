/**
 * Envio avulso pela tela (Fundação › WhatsApp, 03/11/2026): o proprietário escreve um texto e escolhe um ou mais números
 * da allowlist; sai pelos envios agendados (agora ou num horário marcado), respeitando o horário silencioso. Puro.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DESTINOS = 30;

export function validarAvulso(e: unknown, agora: number): { contatos: string[]; texto: string; quando: string } | { erro: string } {
  const x = (e ?? {}) as { contatos?: unknown; texto?: unknown; quando?: unknown };
  const texto = typeof x.texto === "string" ? x.texto.trim() : "";
  if (!texto) return { erro: "Escreva a mensagem." };
  if (texto.length > 4000) return { erro: "A mensagem passou de 4.000 caracteres." };
  const contatos = Array.isArray(x.contatos) ? [...new Set(x.contatos.map(String).filter((c) => UUID.test(c)))] : [];
  if (!contatos.length) return { erro: "Escolha ao menos um número." };
  if (contatos.length > MAX_DESTINOS) return { erro: `No máximo ${MAX_DESTINOS} números por envio: o WhatsApp pelo QR Code não é para disparo em massa.` };
  let quando = new Date(agora).toISOString();
  if (typeof x.quando === "string" && x.quando.trim()) {
    const t = Date.parse(x.quando);
    if (Number.isNaN(t)) return { erro: "Data e hora inválidas." };
    if (t < agora - 5 * 60_000) return { erro: "Esse horário já passou." };
    if (t > agora + 60 * 86_400_000) return { erro: "Agende para no máximo 60 dias à frente." };
    quando = new Date(t).toISOString();
  }
  return { contatos, texto, quando };
}
