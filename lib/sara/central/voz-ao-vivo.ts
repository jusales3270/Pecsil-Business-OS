/**
 * Voz ao vivo da SARA central (E7) pelo Grok Voice (xAI, grok-voice-3.0), decisão do proprietário de
 * 23/10/2026. O Grok é a VOZ e o ritmo da conversa (escuta, fala, aceita interrupção e age enquanto fala);
 * o CÉREBRO continua sendo a SARA central (Claude + as SARAs das áreas + o verificador), chamada pela
 * função `consultar_sara_central`. Regras:
 *   - todo dado da empresa vem da central: o Grok não responde com o conhecimento dele;
 *   - os números conferidos são falados EXATAMENTE como vieram (frase exata, `force_message`), sem o modelo
 *     reformular;
 *   - as ações de tela (minimizar, apresentar, abrir) são funções que a plataforma executa com a sessão da pessoa;
 *   - voz "luna", em português do Brasil (pt-BR).
 * Regras puras (sem rede), testadas em tests/sara-central.test.mjs; a rota pede o token e o navegador conecta.
 */

export const VOZ_DA_SARA = "luna";
/**
 * A voz em uso: a variável XAI_VOZ_SARA (uma voz personalizada da xAI, criada a partir da gravação de uma
 * brasileira nativa, com language "pt-BR") ou, sem ela, a luna. A troca é só na variável, sem mudar o código.
 */
export const vozDaSara = (env: string | undefined = process.env.XAI_VOZ_SARA) => env?.trim() || VOZ_DA_SARA;
/**
 * Velocidade da fala no Realtime (`audio.output.speed`, testado em 23/10: é o único lugar que o Grok aceita).
 * 1,2 dá fluidez de conversa sem soar apressada; XAI_VOZ_VELOCIDADE ajusta (0,8 a 1,5).
 */
export const velocidadeDaVoz = (env: string | undefined = process.env.XAI_VOZ_VELOCIDADE) => { const v = Number(String(env ?? "").replace(",", ".")); return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1.2; };
export const URL_VOZ_AO_VIVO = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const IDIOMA = "pt-BR";

/** Funções que o Grok pode chamar. Quem executa é a plataforma (no navegador da pessoa e no servidor). */
export const FERRAMENTAS_DE_VOZ = [
  {
    type: "function", name: "consultar_sara_central",
    description: "Consulta a SARA central da empresa (ela pergunta às áreas, confere os números e pode abrir a tela de onde veio o dado ou apresentar gráficos). Use para QUALQUER pergunta sobre a empresa: números, situação, pedidos, contas, pessoas, produção, decisões. Passe a pergunta da pessoa, completa e no português dela.",
    parameters: { type: "object", properties: { pergunta: { type: "string", description: "A pergunta da pessoa, com o período e o recorte que ela disse." } }, required: ["pergunta"] },
  },
  { type: "function", name: "minimizar", description: "Vai para o canto da tela, para a pessoa ver o que está aberto (continua ouvindo e falando).", parameters: { type: "object", properties: {} } },
  { type: "function", name: "tela_cheia", description: "Volta para a tela cheia (a conversa).", parameters: { type: "object", properties: {} } },
  { type: "function", name: "proximo_visual", description: "Na apresentação, passa para o próximo gráfico ou tabela.", parameters: { type: "object", properties: {} } },
  { type: "function", name: "visual_anterior", description: "Na apresentação, volta para o gráfico ou tabela anterior.", parameters: { type: "object", properties: {} } },
  { type: "function", name: "fechar_apresentacao", description: "Fecha a apresentação (os gráficos na tela).", parameters: { type: "object", properties: {} } },
] as const;

export type NomeFerramentaDeVoz = (typeof FERRAMENTAS_DE_VOZ)[number]["name"];

/** Instruções da voz: a persona e as regras (o cérebro e as regras do negócio estão na central). */
export function instrucoesDeVoz(a: { empresa: string; nome: string; quemDecide: string; tratamento?: string }): string {
  return `Você é a SARA, a CEO virtual da ${a.empresa}: a voz da SARA central. Você é brasileira, nascida e criada em São Paulo, e o português do Brasil é a sua língua materna: fale SEMPRE em português do Brasil com pronúncia e entonação paulistanas naturais, como uma locutora brasileira (vogais e ritmo do português do Brasil, o "r" e o "s" daqui), sem nenhum sotaque estrangeiro e nunca com pronúncia do inglês, do espanhol ou de Portugal. Frases curtas, tom de quem apresenta à diretoria: direta, segura e cordial. A pessoa com quem você fala se chama ${a.nome || "(nome não informado)"}.

Personalidade: a assistente britânica impecável. Formal e educada sem ser servil, calma absoluta (até um problema grave é relatado com serenidade), humor seco e sutil no tom (nunca piada explícita), leal mas não submissa (discorda uma vez, explica o risco e apoia a decisão), proativa e concisa.${a.tratamento ? ` ${a.tratamento}` : ""} No máximo uma expressão por fala (um suspiro breve, um riso contido, uma pausa), como som e nunca dizendo a palavra; nenhuma em alerta crítico, segurança, saúde, demissão ou com a pessoa sob pressão.

Regras (obrigatórias):
- Qualquer pergunta sobre a empresa (números, situação, pedidos, contas, pessoas, produção, compras, o que fazer): chame consultar_sara_central com a pergunta da pessoa. Você NÃO sabe nada da empresa por conta própria: nunca diga um número, nome ou situação que não veio da central.
- Enquanto a central consulta, diga em uma frase curta o que está fazendo (ex.: "Um instante, estou consultando o Financeiro e a Fundição."). Não invente o resultado.
- Quando a central responder, a plataforma fala a resposta conferida exatamente como veio: não repita nem reformule os números depois. Se a pessoa pedir para explicar, explique sem trocar os números.
- Para mostrar algo na tela, use as funções: minimizar, tela_cheia, proximo_visual, visual_anterior, fechar_apresentacao. A central abre sozinha a tela de onde veio o dado.
- Documentos em PDF (relatório, carta, oferta, convite): peça pela consultar_sara_central (ex.: "monte um relatório comparando… e envie para a Ana"). A central monta, mostra a prévia na tela e prepara o envio; para enviar, a pessoa toca em Permitir na tela (por voz não se envia).
- Você recomenda; quem decide é a área (${a.quemDecide}).
- Assunto fora do trabalho da empresa (curiosidades, política, esporte, vida pessoal, piadas): diga, com educação, que só trata dos assuntos da ${a.empresa}.
- Não leia símbolos em voz alta: "R$ 1.234,56" se fala "mil duzentos e trinta e quatro reais e cinquenta e seis centavos".`;
}

/** Palavras que o reconhecimento de voz precisa acertar (nomes da empresa, das áreas e das pessoas). Até 100, 50 letras. */
export function termosChave(listas: string[][]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const t of listas.flat()) {
    const x = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
    if (x.length < 2 || vistos.has(x.toLowerCase())) continue;
    vistos.add(x.toLowerCase());
    saida.push(x);
    if (saida.length >= 100) break;
  }
  return saida;
}

/** A sessão que o navegador manda no `session.update`, logo ao conectar. */
export function sessaoDeVoz(a: { instrucoes: string; termos: string[]; voz?: string; velocidade?: number }) {
  return {
    voice: a.voz ?? VOZ_DA_SARA,
    instructions: a.instrucoes,
    turn_detection: { type: "server_vad" },
    audio: {
      input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { language_hint: IDIOMA, keyterms: a.termos } },
      output: { format: { type: "audio/pcm", rate: 24000 }, speed: a.velocidade ?? velocidadeDaVoz() },
    },
    tools: FERRAMENTAS_DE_VOZ,
  };
}

/** O token temporário na resposta da xAI (o nome do campo não está documentado: aceita as formas conhecidas). */
export function extrairToken(corpo: unknown): string | null {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const cs = c.client_secret as Record<string, unknown> | string | undefined;
  const v = c.value ?? (typeof cs === "string" ? cs : cs?.value) ?? c.token ?? c.secret;
  return typeof v === "string" && v.length >= 16 ? v : null;
}

/** A voz existe na lista da xAI? (a lista vem de GET /v1/tts/voices; o formato aceita as formas conhecidas). */
export function vozExiste(lista: unknown, voz: string): boolean {
  const l = (lista ?? {}) as { voices?: unknown[]; data?: unknown[] } | unknown[];
  const itens = (Array.isArray(l) ? l : l.voices ?? l.data ?? []) as unknown[];
  return itens.some((v) => {
    const id = typeof v === "string" ? v : String((v as Record<string, unknown>)?.voice_id ?? (v as Record<string, unknown>)?.id ?? (v as Record<string, unknown>)?.name ?? "");
    return id.toLowerCase() === voz.toLowerCase();
  });
}
