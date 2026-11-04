/** Scanner XML monotônico: nenhum regex tenta novamente um fechamento ausente a cada '<'. */
export class XmlInvalido extends Error {}
export type OrcamentoXml = ReturnType<typeof orcamentoXml>;
export function orcamentoXml({ prazoMs = 2_000, elementos = 500_000, profundidade = 128, agora = () => performance.now() } = {}) {
  const prazo = agora() + prazoMs;
  let vistos = 0;
  const verificar = () => { if (agora() >= prazo) throw new XmlInvalido("O XML ultrapassa o prazo de leitura segura."); };
  return {
    verificar,
    contar: (nivel: number) => {
      verificar();
      if (++vistos > elementos || nivel > profundidade) throw new XmlInvalido("O XML ultrapassa os limites de leitura segura.");
    },
  };
}
type Marca = { nome: string | null; atributos: string; inicio: number; fim: number; fechando: boolean; sozinho: boolean; texto?: string };
const espaco = (s: string) => s === " " || s === "\t" || s === "\r" || s === "\n";

function* marcasXml(xml: string, limite: OrcamentoXml, estrito = true): Generator<Marca> {
  const pilha: string[] = [];
  let cursor = 0;
  for (;;) {
    limite.verificar();
    const inicio = xml.indexOf("<", cursor);
    if (inicio < 0) break;
    if (xml.startsWith("<!--", inicio) || xml.startsWith("<![CDATA[", inicio) || xml.startsWith("<?", inicio)) {
      const comentario = xml.startsWith("<!--", inicio), cdata = xml.startsWith("<![CDATA[", inicio);
      const prefixo = comentario ? 4 : cdata ? 9 : 2, terminador = comentario ? "-->" : cdata ? "]]>" : "?>";
      const fecha = xml.indexOf(terminador, inicio + prefixo);
      if (fecha < 0) throw new XmlInvalido("XML truncado.");
      limite.contar(pilha.length);
      cursor = fecha + terminador.length;
      yield { nome: null, atributos: "", inicio, fim: cursor, fechando: false, sozinho: true, texto: cdata ? xml.slice(inicio + prefixo, fecha) : undefined };
      continue;
    }
    // Cada tag tem tamanho limitado e é percorrida uma vez, respeitando aspas de atributos.
    let fim = inicio + 1, aspas = "";
    for (; fim < xml.length && fim - inicio <= 4_096; fim++) {
      const ch = xml[fim];
      if (aspas) { if (ch === aspas) aspas = ""; }
      else if (ch === '"' || ch === "'") aspas = ch;
      else if (ch === ">") break;
      else if (ch === "<") throw new XmlInvalido("Tag XML inválida.");
    }
    if (fim >= xml.length || fim - inicio > 4_096) throw new XmlInvalido("Tag XML inválida ou acima do limite de leitura segura.");
    const corpo = xml.slice(inicio + 1, fim);
    const cabecalho = /^\/?([A-Za-z_][\w:.-]*)/.exec(corpo);
    if (!cabecalho) throw new XmlInvalido("Marcação XML não suportada."); // Inclui DTD/entidades externas.
    const nome = cabecalho[1], fechando = corpo[0] === "/", sozinho = !fechando && corpo.endsWith("/");
    const atributos = corpo.slice(cabecalho[0].length, sozinho ? -1 : undefined);
    if (atributos && !espaco(atributos[0])) throw new XmlInvalido("Atributos XML inválidos.");
    if (fechando && estrito) {
      if (atributos.trim() || pilha.pop() !== nome) throw new XmlInvalido("XML com fechamento inválido.");
    } else if (!fechando && !sozinho && estrito) pilha.push(nome);
    limite.contar(pilha.length);
    cursor = fim + 1;
    yield { nome, atributos, inicio, fim: cursor, fechando, sozinho };
  }
  limite.verificar();
  if (pilha.length) throw new XmlInvalido("XML truncado (elemento sem fechamento).");
}

export function* elementosXml(xml: string, nome: string, limite: OrcamentoXml): Generator<{ atributos: string; conteudo: string }> {
  let aberto: Marca | null = null, nivelAlvo = 0;
  for (const marca of marcasXml(xml, limite)) {
    if (marca.nome !== nome) continue;
    if (marca.fechando) {
      if (!aberto) throw new XmlInvalido("XML com fechamento inválido.");
      if (--nivelAlvo === 0) {
        const entrada = aberto; aberto = null;
        yield { atributos: entrada.atributos, conteudo: xml.slice(entrada.fim, marca.inicio) };
      }
    } else if (marca.sozinho) {
      if (!aberto) yield { atributos: marca.atributos, conteudo: "" };
    } else {
      // Ex.: parágrafo de uma caixa de texto dentro de outro parágrafo DOCX.
      // Emite só o elemento externo, sem duplicar texto nem voltar o cursor.
      if (!aberto) aberto = marca;
      nivelAlvo++;
    }
  }
}

/** Atributos limitados pelo scanner; leitura com cursor, sem backtracking de aspas ausentes. */
export function atributoXml(atributos: string, procurado: string): string | null {
  let cursor = 0;
  while (cursor < atributos.length) {
    while (espaco(atributos[cursor])) cursor++;
    if (cursor >= atributos.length) break;
    const inicio = cursor;
    while (cursor < atributos.length && !espaco(atributos[cursor]) && atributos[cursor] !== "=") cursor++;
    const nome = atributos.slice(inicio, cursor);
    while (espaco(atributos[cursor])) cursor++;
    if (!nome || atributos[cursor++] !== "=") throw new XmlInvalido("Atributo XML inválido.");
    while (espaco(atributos[cursor])) cursor++;
    const aspas = atributos[cursor++];
    if (aspas !== '"' && aspas !== "'") throw new XmlInvalido("Atributo XML sem aspas.");
    const fim = atributos.indexOf(aspas, cursor);
    if (fim < 0) throw new XmlInvalido("Atributo XML truncado.");
    if (nome === procurado) return atributos.slice(cursor, fim);
    cursor = fim + 1;
  }
  return null;
}

/** Texto fora das marcas. Junta apenas até o teto, antes de alocar strings de saída extensas. */
export function textoSemMarcas(xml: string, limite: OrcamentoXml, max: number, separador = "", word = false, estrito = true): string {
  const partes: string[] = [];
  let cursor = 0, tamanho = 0;
  const juntar = (valor: string) => { const parte = valor.slice(0, max - tamanho); partes.push(parte); tamanho += parte.length; };
  for (const marca of marcasXml(xml, limite, estrito)) {
    juntar(xml.slice(cursor, marca.inicio));
    if (marca.texto !== undefined) juntar(marca.texto);
    else if (word && marca.nome === "w:tab" && !marca.fechando) juntar("\t");
    else if (word && marca.nome === "w:br" && !marca.fechando) juntar("\n");
    else juntar(separador);
    cursor = marca.fim;
    if (tamanho >= max) return partes.join("");
  }
  juntar(xml.slice(cursor));
  return partes.join("");
}

export function referenciaCelula(ref: string, maxLinhas = 100_000): { linha: number; coluna: number } {
  const m = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
  if (!m) throw new XmlInvalido("A planilha ultrapassa o limite de linhas ou colunas.");
  let coluna = 0;
  for (const letra of m[1]) coluna = coluna * 26 + letra.charCodeAt(0) - 64;
  const linha = Number(m[2]);
  if (coluna > 16_384 || linha > maxLinhas) throw new XmlInvalido("A planilha ultrapassa o limite de linhas ou colunas.");
  return { linha, coluna: coluna - 1 };
}

export function validarDimensao(xml: string, limite: OrcamentoXml) {
  for (const { atributos } of elementosXml(xml, "dimension", limite)) {
    const ref = atributoXml(atributos, "ref");
    if (!ref) continue;
    const partes = ref.split(":");
    if (partes.length > 2) throw new XmlInvalido("Dimensão da planilha inválida.");
    // Dimensões são só metadados: NUNCA alocar uma matriz a partir delas.
    const inicio = referenciaCelula(partes[0], 1_048_576), fim = referenciaCelula(partes.at(-1)!, 1_048_576);
    if (fim.linha < inicio.linha || fim.coluna < inicio.coluna) throw new XmlInvalido("Dimensão da planilha inválida.");
  }
}
