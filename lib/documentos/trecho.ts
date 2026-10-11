/**
 * Trecho achado pela busca (Etapa 5): o banco marca as palavras achadas com [[ ]]. Aqui vira uma
 * lista de pedaços para a tela destacar SEM injetar HTML (o texto do documento é de terceiros).
 * Sem dependência de servidor (testável).
 */
export type Pedaco = { texto: string; achado: boolean };

export function pedacosDoTrecho(trecho: string | null | undefined): Pedaco[] {
  if (!trecho) return [];
  const pedacos: Pedaco[] = [];
  for (const parte of trecho.replace(/\s+/g, " ").split(/(\[\[[^\]]*\]\])/)) {
    if (!parte) continue;
    const achado = parte.startsWith("[[") && parte.endsWith("]]");
    pedacos.push({ texto: achado ? parte.slice(2, -2) : parte, achado });
  }
  return pedacos;
}
