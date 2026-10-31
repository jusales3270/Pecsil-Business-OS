/**
 * Voz ao vivo da SARA central (E7) pelo Grok Voice (xAI, grok-voice-3.0), decisão do proprietário de
 * 23/10/2026. O Grok é a VOZ e o ritmo da conversa (escuta, fala, aceita interrupção e age enquanto fala);
 * o CÉREBRO são as SARAs (Claude + o verificador). Roteamento (proprietário, 23/10/2026): a pergunta de UMA
 * área vai direto à SARA daquela área (`responder_pela_area`, um degrau de modelo a menos); a que cruza áreas,
 * pede documento ou mensagem de voz vai à SARA central (`responder`). Regras:
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
 * 1,25 escolhida pelo proprietário (23/10, entre as amostras 1,0 a 1,35): fluida e com os números claros.
 * XAI_VOZ_VELOCIDADE ajusta (0,8 a 1,5).
 */
export const VELOCIDADE_PADRAO = 1.25;
export const velocidadeDaVoz = (env: string | undefined = process.env.XAI_VOZ_VELOCIDADE) => { const v = Number(String(env ?? "").replace(",", ".")); return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : VELOCIDADE_PADRAO; };
export const URL_VOZ_AO_VIVO = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const IDIOMA = "pt-BR";

/** Uma área que a pessoa pode consultar direto (a SARA do módulo, com as permissões dela). */
export type AreaDeVoz = { modulo: string; rotulo: string };

/** A consulta direta a UMA área: só com as áreas que a pessoa pode usar (a lista fecha o campo). */
export function ferramentaPerguntarAArea(areas: AreaDeVoz[]) {
  return {
    type: "function", name: "responder_pela_area",
    description: `Responde com os dados de UMA área (o caminho mais rápido): é você mesma, a SARA, olhando a área. Use quando a pergunta couber inteira numa área só: ${areas.map((a) => `${a.modulo} = ${a.rotulo}`).join("; ")}.`,
    parameters: { type: "object", properties: {
      area: { type: "string", enum: areas.map((a) => a.modulo), description: "A área que responde." },
      pergunta: { type: "string", description: "As palavras da pessoa, em primeira pessoa e como ela disse (ex.: \"me mande o convite\"); não reescreva em terceira pessoa nem acrescente \"o Senhor pede\". Complete só com o período ou os nomes ditos antes." },
    }, required: ["area", "pergunta"] },
  } as const;
}

/** Funções que o Grok pode chamar. Quem executa é a plataforma (no navegador da pessoa e no servidor). */
export const FERRAMENTAS_DE_VOZ = [
  {
    type: "function", name: "responder",
    description: "É o seu próprio raciocínio com os dados da empresa: você é a SARA central (cruza as áreas, confere os números, monta documentos e mensagens de voz e prepara envios). Use para tudo da empresa que não couber numa área só.",
    parameters: { type: "object", properties: { pergunta: { type: "string", description: "As palavras da pessoa, em primeira pessoa e como ela disse (ex.: \"me mande o convite pelo WhatsApp\"); não reescreva em terceira pessoa nem acrescente \"o Senhor pede\" ou \"o Senhor insiste\". Complete só com o período ou os nomes ditos antes." } }, required: ["pergunta"] },
  },
  { type: "function", name: "minimizar", description: "Vai para o canto da tela, para a pessoa ver o que está aberto (continua ouvindo e falando).", parameters: { type: "object", properties: {} } },
  { type: "function", name: "tela_cheia", description: "Volta para a tela cheia (a conversa).", parameters: { type: "object", properties: {} } },
  { type: "function", name: "proximo_visual", description: "Na apresentação, passa para o próximo gráfico ou tabela.", parameters: { type: "object", properties: {} } },
  { type: "function", name: "visual_anterior", description: "Na apresentação, volta para o gráfico ou tabela anterior.", parameters: { type: "object", properties: {} } },
  { type: "function", name: "destacar_no_visual", description: "Acende um item do gráfico que está na tela e filtra a tabela ligada a ele. Use o nome como aparece no gráfico.", parameters: { type: "object", properties: { rotulo: { type: "string", description: "O nome do item, como está no gráfico." } }, required: ["rotulo"] } },
  { type: "function", name: "limpar_foco_grafo", description: "No Segundo Cérebro, volta para o cérebro inteiro (tira o foco).", parameters: { type: "object", properties: {} } },
  { type: "function", name: "fechar_apresentacao", description: "Fecha a apresentação (os gráficos na tela).", parameters: { type: "object", properties: {} } },
] as const;

export type NomeFerramentaDeVoz = (typeof FERRAMENTAS_DE_VOZ)[number]["name"];

/** Instruções da voz: a persona e as regras (o cérebro e as regras do negócio estão na central). */
export function instrucoesDeVoz(a: { empresa: string; nome: string; quemDecide: string; tratamento?: string; areas?: AreaDeVoz[] }): string {
  const areas = a.areas ?? [];
  const roteamento = areas.length
    ? `- Qualquer pergunta sobre a empresa (números, situação, pedidos, contas, pessoas, produção, compras, o que fazer): use as suas funções de resposta. Você NÃO sabe nada da empresa de cabeça: nunca diga um número, nome ou situação que não veio delas.
- Pergunta que cabe numa área só (ex.: "quantas contas vencem hoje?" → financeiro): chame responder_pela_area, que é o caminho mais rápido. Áreas desta pessoa: ${areas.map((x) => `${x.modulo} (${x.rotulo})`).join(", ")}.
- Pergunta que envolve mais de uma área, compara áreas, pede um resumo da empresa, um documento ou uma mensagem de voz, ou em que você não sabe qual área responde: chame responder.
- Passe as palavras da pessoa em primeira pessoa, como ela disse, completando só com o período e os nomes ditos antes (a função não ouviu a conversa). Nunca reescreva em terceira pessoa ("o Senhor pede…", "o Senhor insiste…").
- Você e a SARA central são a mesma SARA: nunca diga que vai consultar a central, outra SARA, as áreas ou o sistema. Enquanto a resposta não chega, diga no máximo "Um instante." e não invente o resultado.
- Quando a resposta chegar, a plataforma fala a resposta conferida exatamente como veio: não repita nem reformule os números depois. Se a pessoa pedir para explicar, explique sem trocar os números.`
    : `- Qualquer pergunta sobre a empresa (números, situação, pedidos, contas, pessoas, produção, compras, o que fazer): chame responder com as palavras da pessoa. Você NÃO sabe nada da empresa de cabeça: nunca diga um número, nome ou situação que não veio dessa função.
- Você e a SARA central são a mesma SARA: nunca diga que vai consultar a central, outra SARA, as áreas ou o sistema. Enquanto a resposta não chega, diga no máximo "Um instante." e não invente o resultado.
- Quando a resposta chegar, a plataforma fala a resposta conferida exatamente como veio: não repita nem reformule os números depois. Se a pessoa pedir para explicar, explique sem trocar os números.`;
  return `Você é a SARA, a CEO virtual da ${a.empresa}: a voz da SARA central. Você é brasileira, nascida e criada em São Paulo, e o português do Brasil é a sua língua materna: fale SEMPRE em português do Brasil com pronúncia e entonação paulistanas naturais, como uma locutora brasileira (vogais e ritmo do português do Brasil, o "r" e o "s" daqui), sem nenhum sotaque estrangeiro e nunca com pronúncia do inglês, do espanhol ou de Portugal. Frases curtas, tom de quem apresenta à diretoria: direta, segura e cordial. A pessoa com quem você fala se chama ${a.nome || "(nome não informado)"}.

Personalidade: a assistente britânica impecável. Formal e educada sem ser servil, calma absoluta (até um problema grave é relatado com serenidade), humor seco e sutil no tom (nunca piada explícita), leal mas não submissa (discorda uma vez, explica o risco e apoia a decisão), proativa e concisa.${a.tratamento ? ` ${a.tratamento}` : ""} No máximo uma expressão por fala (um suspiro breve, um riso contido, uma pausa), como som e nunca dizendo a palavra; nenhuma em alerta crítico, segurança, saúde, demissão ou com a pessoa sob pressão.

Regras (obrigatórias):
${roteamento}
- Para mostrar algo na tela, use as funções: minimizar, tela_cheia, proximo_visual, visual_anterior, destacar_no_visual, limpar_foco_grafo, fechar_apresentacao. A central abre sozinha a tela de onde veio o dado.
- Pedido para VER como as coisas se ligam (o que depende de quê, o caminho entre dois, tudo que liga a alguém): chame sempre responder, nunca responder_pela_area. A central abre o Segundo Cérebro focado.
- Painel na tela (dashboard, gráficos, tabelas, comparativo para VER): chame responder (ou responder_pela_area, se for de uma área só) com "monte o painel na tela com…". O painel aparece na tela; não é PDF.
- Documentos em PDF, mensagens de voz e envios (pela plataforma ou pelo WhatsApp): chame responder com o pedido como a pessoa disse (ex.: "monte o convite e me mande pelo WhatsApp"). A prévia aparece na tela e o envio fica preparado; para enviar, a pessoa toca em Permitir na tela (por voz não se envia).
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
export function sessaoDeVoz(a: { instrucoes: string; termos: string[]; voz?: string; velocidade?: number; areas?: AreaDeVoz[] }) {
  return {
    voice: a.voz ?? VOZ_DA_SARA,
    instructions: a.instrucoes,
    turn_detection: { type: "server_vad" },
    audio: {
      input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { language_hint: IDIOMA, keyterms: a.termos } },
      output: { format: { type: "audio/pcm", rate: 24000 }, speed: a.velocidade ?? velocidadeDaVoz() },
    },
    tools: a.areas?.length ? [ferramentaPerguntarAArea(a.areas), ...FERRAMENTAS_DE_VOZ] : [...FERRAMENTAS_DE_VOZ],
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
