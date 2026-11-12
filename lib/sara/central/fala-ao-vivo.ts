/**
 * Regras puras da conversa ao vivo no navegador (GPT-Live, 11/11/2026), separadas do motor para os testes
 * (tests/sara-voz-openai.test.mjs). Nada aqui fala com a rede.
 */

import { TAG_DE_VOZ } from "../personalidade.ts";

/** Sem atividade (fala, voz, pedido) por esse tempo, a sessão fecha: o GPT-Live cobra por minuto aberto. */
export const OCIOSA_MS = 120_000;
/** Cada texto mandado ao GPT-Live (instrução, contexto, fala) cabe em 500 tokens: com folga, em caracteres. */
export const MAX_TEXTO_DA_SESSAO = 1400;

export type Fala = { quem: "pessoa" | "sara"; texto: string };

const EXPRESSAO: Record<string, string> = { sigh: "um suspiro breve", laugh: "um riso contido", pause: "uma pausa breve", "long-pause": "uma pausa", cough: "um leve pigarro" };

/** As tags do motor de voz da personalidade viram uma indicação de som (o GPT-Live leria "[sigh]" em voz alta). */
export function semTagsDeVoz(texto: string): { texto: string; expressao: string | null } {
  const achada = texto.match(TAG_DE_VOZ)?.[0] ?? null;
  const nome = achada ? achada.replace(/<\/?soft>/g, "").replace(/[[\]]/g, "") : null;
  const limpo = texto.replace(TAG_DE_VOZ, " ").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return { texto: limpo, expressao: nome ? EXPRESSAO[nome] ?? null : null };
}

/** O nome da língua, para a instrução (as línguas que o roteador reconhece; o resto, "a língua da pessoa"). */
const NOME_DA_LINGUA: Record<string, string> = { en: "inglês", es: "espanhol", fr: "francês", it: "italiano", de: "alemão" };

/**
 * A instrução para dizer a resposta conferida palavra por palavra (o GPT-Live não tem a "frase exata" do Grok; o
 * guia da OpenAI indica a instrução para texto que precisa sair como está). Em português, exatamente como veio.
 * Pessoa em outra língua: a tradução fiel NA LÍNGUA DITA (sem ela, a voz falava o texto em português para quem
 * perguntou em inglês, espanhol ou francês: teste de 11/11), sem mexer em número, valor, data e nome.
 */
export function dizerExatamente(bruto: string, lingua: string = "pt"): string {
  const { texto, expressao } = semTagsDeVoz(bruto);
  const corpo = texto.slice(0, MAX_TEXTO_DA_SESSAO - 600);
  const som = expressao ? ` Faça ${expressao} antes de começar (o som, nunca a palavra).` : "";
  if (lingua === "pt") return `Diga agora, em voz alta e em português do Brasil, exatamente o texto entre « e », palavra por palavra, sem acrescentar, cortar ou trocar nada; depois fique em silêncio e escute. Leia valores e números como se fala (R$ 1.234,56 = mil duzentos e trinta e quatro reais e cinquenta e seis centavos).${som}\n«${corpo}»`;
  const nome = NOME_DA_LINGUA[lingua];
  const em = nome ? `em ${nome}` : "na língua em que a pessoa acabou de falar";
  return `A pessoa está falando ${nome ?? "outra língua"}: responda ${em}. Diga agora, em voz alta e ${em}, a tradução fiel e completa do texto entre « e », sem acrescentar nem cortar nada e sem mudar números, valores, datas e nomes; depois fique em silêncio e escute. Não diga o texto em português.${som}\n«${corpo}»`;
}

/** Para calar a voz (a pessoa tocou em silenciar ou fez outra pergunta digitada). */
export const PARE_DE_FALAR = "Pare de falar agora, mesmo no meio da frase, e fique em silêncio escutando. Não comente a parada.";

/** "em inglês", "em português do Brasil"…: a língua dita com todas as letras (sem ela, a voz repete a da fala anterior). */
export function naLingua(lingua: string): string {
  if (lingua === "pt") return "em português do Brasil";
  const nome = NOME_DA_LINGUA[lingua];
  return nome ? `em ${nome}` : "na língua em que a pessoa acabou de falar";
}

/**
 * O resultado de um comando de tela, para a voz confirmar em poucas palavras, na língua dita. No teste de 11/11,
 * "minimize a tela" pedido em português foi confirmado com "Done, minimized" (a língua da pergunta anterior).
 */
export function avisoDeTela(nome: string, saida: unknown, lingua: string = "pt"): string {
  const erro = (saida as { erro?: unknown } | null)?.erro;
  if (typeof erro === "string" && erro.trim()) return `Não deu certo na tela: ${erro.trim().slice(0, 300)}. Diga isso em uma frase curta, ${naLingua(lingua)}.`;
  return `Feito na tela (${nome.replace(/_/g, " ")}). Confirme em duas ou três palavras, ${naLingua(lingua)}, sem repetir detalhes.`;
}

/** Junta um pedaço da transcrição à conversa: continua a fala de quem já estava falando ou abre uma fala nova. */
export function juntarFala(conversa: Fala[], quem: Fala["quem"], pedaco: string, max = 40): Fala[] {
  if (!pedaco) return conversa;
  const ultima = conversa[conversa.length - 1];
  const nova = ultima && ultima.quem === quem
    ? [...conversa.slice(0, -1), { quem, texto: ultima.texto + pedaco }]
    : [...conversa, { quem, texto: pedaco.replace(/^\s+/, "") }];
  return nova.slice(-max);
}

/** A conversa para a sessão nova e para o roteador: falas com texto, sem espaços sobrando. */
export const conversaParaEnviar = (conversa: Fala[], max = 20): Fala[] =>
  conversa.map((f) => ({ quem: f.quem, texto: f.texto.replace(/\s+/g, " ").trim() })).filter((f) => f.texto).slice(-max);
