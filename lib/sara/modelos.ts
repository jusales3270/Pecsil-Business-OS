/**
 * Modelos que podem ser escolhidos para um número de WhatsApp (e, depois, para outros canais). Hoje só a Anthropic;
 * o provedor já vem junto para abrir outros provedores mais tarde. Só entra aqui modelo com preço em custo.ts:
 * sem preço, o custo no painel do proprietário ficaria errado.
 */
export type Provedor = "anthropic";
export type ModeloOpcao = { provedor: Provedor; id: string; rotulo: string; nota: string };

export const MODELOS: ModeloOpcao[] = [
  { provedor: "anthropic", id: "claude-haiku-5-5", rotulo: "Claude Haiku 5.5", nota: "rápido e o mais barato; bom para perguntas do dia a dia" },
  { provedor: "anthropic", id: "claude-sonnet-5-5", rotulo: "Claude Sonnet 5.5", nota: "mais capaz para raciocínio e conversa longa; cerca de 20 vezes o custo do Haiku" },
];

export const modeloValido = (provedor: string, id: string) => MODELOS.some((m) => m.provedor === provedor && m.id === id);

/** O modelo que assume quando o escolhido está fora do ar (lib/sara/tentativas.ts). Haiku → Sonnet, Sonnet → Haiku. */
export const modeloReserva = (id: string) => MODELOS.find((m) => m.id !== id)?.id ?? null;
