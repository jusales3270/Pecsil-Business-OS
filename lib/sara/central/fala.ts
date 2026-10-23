/**
 * O que o holograma da SARA central FALA (E7): o essencial da resposta, em frases. A resposta completa
 * (tabelas, fontes, o aviso do verificador) aparece no painel ao lado. Sai a marcação (negrito, títulos,
 * código), as linhas de tabela e os itens de lista; fica o texto corrido, até ~3 frases ou 420 caracteres.
 * O aviso "sem fonte conferida" é sempre dito (a pessoa precisa saber, mesmo só ouvindo).
 */

const AVISO = /⚠️?\s*Sem fonte conferida:[^\n]*/;

export function resumoFalado(texto: string, max = 420): string {
  const aviso = texto.match(AVISO)?.[0]?.replace(/⚠️?\s*/, "").trim() ?? null;
  const corrido = texto.replace(AVISO, "").split("\n")
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*[-*•]\s+/.test(l) && !/^\s*\d+[.)]\s+/.test(l) && !/^\s*```/.test(l) && !/^\s*#/.test(l))
    .join(" ")
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
  if (frases.length > 3 || corrido.length > fala.length + 20) fala = `${fala} O detalhe está no painel.`;
  return aviso ? `${fala} Atenção: ${aviso.replace(/\.?\s*Confira antes de usar.*$/, "")}.` : fala;
}
