/**
 * O que o holograma da SARA central FALA (E7): o essencial da resposta, em frases. A resposta completa
 * (tabelas, fontes, o aviso do verificador) aparece no painel ao lado. Sai a marcação (negrito, títulos,
 * código), as linhas de tabela e os itens de lista; fica o texto corrido, até ~3 frases ou 420 caracteres.
 * O aviso "sem fonte conferida" é sempre dito (a pessoa precisa saber, mesmo só ouvindo).
 */

const AVISO = /⚠️?\s*Sem fonte conferida:[^\n]*/;
/** Tags do motor de voz (personalidade): passam intactas pela limpeza da marcação. */
const TAG = /<soft>\[laugh\]<\/soft>|\[(?:sigh|laugh|pause|long-pause|cough)\]/g;

export function resumoFalado(entrada: string, max = 420): string {
  const tags: string[] = [];
  const texto = entrada.replace(TAG, (m) => { tags.push(m); return ` §${tags.length - 1}§ `; });
  // O primeiro parágrafo de texto corrido é o que a central escreveu para ser falado; o resto fica no painel.
  const paragrafos = texto.replace(AVISO, "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const primeiro = paragrafos.find((x) => !/^\s*(\||[-*•]\s|\d+[.)]\s|#|```|\*\*[^*]+\*\*:?\s*$)/.test(x));
  const temMais = paragrafos.length > 1;
  const aviso = texto.match(AVISO)?.[0]?.replace(/⚠️?\s*/, "").trim() ?? null;
  const linhas = (primeiro ?? texto.replace(AVISO, "")).split("\n").filter((l) => l.trim());
  // Fora da fala: tabela, lista, código, título (# ou linha só em negrito, como "**Servidor (TI)**").
  const faladas = linhas.filter((l) => !/^\s*\|/.test(l) && !/^\s*[-*•]\s+/.test(l) && !/^\s*\d+[.)]\s+/.test(l) && !/^\s*```/.test(l) && !/^\s*#/.test(l) && !/^\s*\*\*[^*]+\*\*:?\s*$/.test(l));
  const ficouDeFora = faladas.length < linhas.length || temMais;
  const corrido = faladas
    .join(" ")
    // O que está entre parênteses (fonte, data de referência) fica no painel: na fala, trava o ritmo.
    .replace(/\s*\([^()]*\)/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ").trim();
  // Sem texto corrido (só tabela ou lista): avisa que o detalhe está no painel.
  const base = corrido || "A resposta está no painel ao lado.";
  // Fim de frase é o ponto seguido de espaço: o ponto de "R$ 48.200" não corta a frase.
  const frases = base.split(/(?<=[.!?])\s+/).map((f) => f.trim()).filter(Boolean);
  let fala = "";
  for (const f of frases.slice(0, 3)) {
    if ((fala + " " + f).trim().length > max && fala) break;
    fala = `${fala} ${f}`.trim();
  }
  if (fala.length > max) fala = `${fala.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
  if (corrido && (frases.length > 3 || corrido.length > fala.length + 20 || ficouDeFora)) fala = `${fala} O detalhe está no painel.`;
  const final = aviso ? `${fala} Atenção: ${aviso.replace(/\.?\s*Confira antes de usar.*$/, "")}.` : fala;
  return final.replace(/\s*§(\d+)§\s*/g, (_m, i) => ` ${tags[Number(i)] ?? ""} `).replace(/\s{2,}/g, " ").trim();
}
