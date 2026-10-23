/**
 * Hora certa e situação da conversa da SARA, sempre no fuso de São Paulo (America/Sao_Paulo), pelo
 * relógio do servidor. Com isso ela cumprimenta certo (bom dia / boa tarde / boa noite), chama a
 * pessoa pelo nome e sabe se a mensagem continua a conversa ou se a conversa foi retomada depois.
 */

const FUSO = "America/Sao_Paulo";
/** Depois deste intervalo sem mensagens (ou em outro dia), a conversa conta como retomada. */
export const PAUSA_MS = 3 * 60 * 60 * 1000;

export type Agora = { dia: string; data: string; hora: string; hora24: number; semana: string };

export function agoraSP(d: Date = new Date()): Agora {
  const p = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, data: `${p.day}/${p.month}/${p.year}`, hora: `${p.hour}:${p.minute}`, hora24: Number(p.hour), semana: p.weekday };
}

export function saudacao(hora24: number): "Bom dia" | "Boa tarde" | "Boa noite" {
  if (hora24 >= 5 && hora24 < 12) return "Bom dia";
  if (hora24 >= 12 && hora24 < 18) return "Boa tarde";
  return "Boa noite";
}

/** Como a pessoa é chamada: o primeiro nome do cadastro de quem está logado. */
export function primeiroNome(nomeCompleto: string | null | undefined): string {
  return String(nomeCompleto ?? "").trim().split(/\s+/)[0] || "";
}

export type Situacao = { tipo: "nova" | "continua" | "retomada"; ultima: Agora | null; ontem: boolean };

/** Pela hora da última mensagem: conversa nova, continuação ou retomada (outro dia ou pausa longa). */
export function situacaoDaConversa(ultimaMensagem: string | Date | null | undefined, agora: Date = new Date()): Situacao {
  if (!ultimaMensagem) return { tipo: "nova", ultima: null, ontem: false };
  const quando = new Date(ultimaMensagem);
  const u = agoraSP(quando), a = agoraSP(agora);
  const ontem = agoraSP(new Date(agora.getTime() - 86_400_000)).dia === u.dia;
  const retomada = u.dia !== a.dia || agora.getTime() - quando.getTime() >= PAUSA_MS;
  return { tipo: retomada ? "retomada" : "continua", ultima: u, ontem };
}

/**
 * Abertura da resposta, montada pela plataforma (hora certa, sem depender do modelo): o cumprimento
 * no começo da conversa e, na retomada, o aviso de que está retomando. Na continuação, nada.
 */
export function abertura(a: { nome: string; situacao: Situacao; agora?: Date }): string | null {
  const ag = agoraSP(a.agora);
  const ola = `${saudacao(ag.hora24)}${a.nome ? `, ${a.nome}` : ""}.`;
  const s = a.situacao;
  if (s.tipo === "nova") return ola;
  if (s.tipo === "retomada" && s.ultima) {
    const quando = s.ultima.dia === ag.dia ? `de hoje, das ${s.ultima.hora}` : s.ontem ? "de ontem" : `de ${s.ultima.data}`;
    return `${ola} Retomando a nossa conversa ${quando}.`;
  }
  return null;
}

/** Parte do prompt com a hora, o nome e a situação da conversa. */
export function contextoDeTempo(a: { nome: string; situacao: Situacao; agora?: Date }): string {
  const ag = agoraSP(a.agora);
  const linhas = [
    `Agora: ${ag.semana}, ${ag.data}, ${ag.hora} (horário de Brasília).`,
    a.nome ? `Quem conversa: ${a.nome}. Chame a pessoa por esse nome quando for natural, mas não logo no começo da resposta (o cumprimento da plataforma já traz o nome).` : "Quem conversa: uma pessoa da empresa.",
  ];
  const s = a.situacao;
  if (s.tipo === "retomada" && s.ultima) {
    const quando = s.ultima.dia === ag.dia ? `hoje às ${s.ultima.hora}` : `${s.ontem ? "ontem" : `em ${s.ultima.data}`}, às ${s.ultima.hora}`;
    linhas.push(`A conversa foi retomada: a última mensagem foi ${quando}. Leve isso em conta (os dados podem ter mudado desde então).`);
  } else if (s.tipo === "continua") linhas.push("A conversa continua (a última mensagem foi há pouco).");
  linhas.push("A plataforma já abre a resposta com o cumprimento quando cabe: não cumprimente (nada de bom dia, boa tarde ou boa noite).");
  return linhas.join("\n");
}

const CUMPRIMENTO = /^\s*(bom dia|boa tarde|boa noite|olá|ola|oi)(?=[\s,.!?]|$)[^.!?\n]*[.!?]?\s*/i;
/**
 * Junta a abertura da plataforma à resposta, tirando o cumprimento que o modelo tenha escrito e o
 * nome logo no começo ("Bom dia, Ana." + "Ana, o total…" viraria repetição).
 */
export function comAbertura(texto: string, abrir: string | null, nome = ""): string {
  if (!abrir) return texto;
  let limpo = texto.replace(CUMPRIMENTO, "").trimStart();
  if (nome) {
    // O nome logo no começo (uma ou mais vezes: "QA QA, há…") sai: o cumprimento já o traz.
    const comNome = new RegExp(`^(?:${nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s,!:]*)+(?=\\S)`, "i");
    if (comNome.test(limpo)) { limpo = limpo.replace(comNome, ""); limpo = limpo.charAt(0).toUpperCase() + limpo.slice(1); }
  }
  return `${abrir}\n\n${limpo}`;
}
