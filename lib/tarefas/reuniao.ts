/**
 * Gravar reunião (I-29, PLANO-SARA-FERRAMENTAS etapa 4): regras puras, testadas em tests/tarefas-reuniao.test.mjs.
 * O navegador grava em pedaços de ~50 s; cada pedaço vira texto no Whisper da Cloudflare e o áudio é descartado
 * (nada fica guardado). No fim, o texto vai para "Montar quadro" (a SARA lista os combinados, a pessoa confere).
 * Limite de 60 minutos: decisão do proprietário em 11/11/2026 ("começar com 60"); o quadro guarda até 60 mil
 * caracteres, cerca de 1 hora de fala. Para passar de 60, é preciso aumentar o limite do banco (quadros.texto).
 */

export const REUNIAO = { maxSegundos: 60 * 60, pedacoSegundos: 50, maxCaracteres: 58_000, tentativas: 3, avisoAntesSegundos: 5 * 60 } as const;

export type Trecho = { i: number; inicio: number; fim: number; situacao: "enviando" | "ok" | "silencio" | "falhou"; texto?: string };

/** 0:07, 12:34, 1:00:00 (tempo de gravação, sem as pausas). */
export function relogio(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Frases que o Whisper "ouve" no silêncio ou no ruído (vício do treino com legendas de vídeo). Saem do trecho; se
 * não sobrar fala, o trecho conta como silêncio.
 */
const ALUCINACOES = [/legendas? (?:pela|por) comunidade amara\.?\s?org\.?/gi, /obrigad[oa] por assistir[.!]?/gi, /inscreva-se no (?:nosso )?canal[.!]?/gi, /^\s*(?:obrigad[oa]|tchau)[.!]?\s*$/i];
export function semAlucinacao(texto: string): string {
  let t = String(texto ?? "");
  for (const a of ALUCINACOES) t = t.replace(a, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t.replace(/[^\p{L}\p{N}]/gu, "").length < 2 ? "" : t;
}

/** O texto da reunião, na ordem. O trecho que falhou vira uma marca com o horário; silêncio e o que ainda está indo ficam de fora. */
export function juntarTrechos(trechos: Trecho[]): string {
  const partes: string[] = [];
  for (const t of [...trechos].sort((a, b) => a.i - b.i)) {
    if (t.situacao === "ok" && t.texto) partes.push(t.texto.trim());
    else if (t.situacao === "falhou") partes.push(`\n[trecho não transcrito ${relogio(t.inicio)}–${relogio(t.fim)}]\n`);
  }
  return partes.join(" ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** Para sozinha no limite de tempo ou quando o texto chega perto do que o quadro guarda. */
export function motivoParaParar(segundos: number, caracteres: number): "tempo" | "texto" | null {
  if (segundos >= REUNIAO.maxSegundos) return "tempo";
  if (caracteres >= REUNIAO.maxCaracteres) return "texto";
  return null;
}

/** "Faltam 5 minutos" perto do limite (null antes disso). */
export function faltaPouco(segundos: number): string | null {
  const resta = REUNIAO.maxSegundos - segundos;
  if (resta > REUNIAO.avisoAntesSegundos || resta <= 0) return null;
  const min = Math.ceil(resta / 60);
  return `Faltam ${min} ${min === 1 ? "minuto" : "minutos"} para o limite de ${REUNIAO.maxSegundos / 60}. Depois disso a gravação para sozinha e o quadro é montado com o que foi gravado.`;
}

/** Onde a tela guarda a reunião enquanto ela não vira quadro (sessionStorage: some quando a aba fecha). */
export const CHAVE_REUNIAO = "pecsil.tarefas.reuniao";
