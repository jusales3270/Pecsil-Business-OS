/**
 * Modelos da SARA (I-32, roteador de modelo e esforço, 14/11/2026).
 *
 * O CATÁLOGO é do fornecedor (igual para todas as empresas do ECOS): preço, esforços aceitos e as regras da API
 * de cada modelo, conferidas na documentação da Anthropic em 14/11/2026:
 *   - Haiku 5.5: desliga o "pensar" ({type:"disabled"}) só com esforço até high; esforço padrão medium.
 *   - Sonnet 5.5: "disabled" dá erro 400; o pensar desligado é {type:"between_tools"} (só o Sonnet 5.5 aceita),
 *     com esforço até high; esforço padrão high; ferramenta forçada (tool_choice any/tool) dá 400.
 *   - Opus 5.5: o pensar não desliga (adaptativo); esforço padrão medium; ferramenta forçada dá 400.
 *   - Fable 5.2: pensar sempre ligado; esforço padrão high; ferramenta forçada dá 400; exige retenção de 30 dias.
 * O MONTADOR (`pedidoPara`) devolve o `thinking`, o `output_config` e o `tool_choice` válidos para o modelo: nenhuma
 * combinação do catálogo vai à API com erro. Qual modelo e qual esforço cada empresa usa é a POLÍTICA dela
 * (banco), não este arquivo.
 *
 * `MODELOS` continua sendo a lista que o proprietário pode escolher para um número de WhatsApp.
 */
export type Provedor = "anthropic";
export type Esforco = "low" | "medium" | "high" | "xhigh" | "max";
export const ESFORCOS: Esforco[] = ["low", "medium", "high", "xhigh", "max"];

export type ModeloDoCatalogo = {
  provedor: Provedor;
  id: string;
  rotulo: string;
  /** US$ por milhão de tokens. `leituraCache`: a leitura do cache (cada modelo tem a sua); gravação = 1,25× a entrada. */
  preco: { entrada: number; saida: number; leituraCache: number };
  esforcos: Esforco[];
  esforcoPadrao: Esforco;
  /** O pensar no mínimo: "disabled" (Haiku), "between_tools" (Sonnet 5.5) ou "adaptive" (não desliga). */
  pensarMinimo: "disabled" | "between_tools" | "adaptive";
  /** O pensar desligado só vale até este esforço (acima disso, o pensar fica adaptativo). */
  desligaAte: Esforco | null;
  /** Aceita obrigar o uso de uma ferramenta (tool_choice any/tool). */
  ferramentaForcada: boolean;
  /** Quem assume quando este está fora do ar (lib/sara/tentativas.ts). */
  reserva: string | null;
  /** Exige que a Anthropic guarde os dados por 30 dias (organização sem retenção zero). */
  exigeRetencao: boolean;
};

export const CATALOGO: ModeloDoCatalogo[] = [
  { provedor: "anthropic", id: "claude-haiku-5-5", rotulo: "Claude Haiku 5.5", preco: { entrada: 0.1, saida: 0.5, leituraCache: 0.01 },
    esforcos: ESFORCOS, esforcoPadrao: "medium", pensarMinimo: "disabled", desligaAte: "high", ferramentaForcada: true, reserva: "claude-sonnet-5-5", exigeRetencao: false },
  { provedor: "anthropic", id: "claude-sonnet-5-5", rotulo: "Claude Sonnet 5.5", preco: { entrada: 2, saida: 10, leituraCache: 0.1 },
    esforcos: ESFORCOS, esforcoPadrao: "high", pensarMinimo: "between_tools", desligaAte: "high", ferramentaForcada: false, reserva: "claude-haiku-5-5", exigeRetencao: false },
  { provedor: "anthropic", id: "claude-opus-5-5", rotulo: "Claude Opus 5.5", preco: { entrada: 4, saida: 20, leituraCache: 0.2 },
    esforcos: ESFORCOS, esforcoPadrao: "medium", pensarMinimo: "adaptive", desligaAte: null, ferramentaForcada: false, reserva: "claude-sonnet-5-5", exigeRetencao: false },
  { provedor: "anthropic", id: "claude-fable-5-2", rotulo: "Claude Fable 5.2", preco: { entrada: 8, saida: 40, leituraCache: 0.2 },
    esforcos: ESFORCOS, esforcoPadrao: "high", pensarMinimo: "adaptive", desligaAte: null, ferramentaForcada: false, reserva: "claude-opus-5-5", exigeRetencao: true },
];

export const doCatalogo = (id: string): ModeloDoCatalogo | null => CATALOGO.find((m) => m.id === id) ?? null;

export type ModeloOpcao = { provedor: Provedor; id: string; rotulo: string; nota: string };

/** O que o proprietário pode escolher para um número de WhatsApp. */
export const MODELOS: ModeloOpcao[] = [
  { provedor: "anthropic", id: "claude-haiku-5-5", rotulo: "Claude Haiku 5.5", nota: "rápido e o mais barato; bom para perguntas do dia a dia" },
  { provedor: "anthropic", id: "claude-sonnet-5-5", rotulo: "Claude Sonnet 5.5", nota: "mais capaz para raciocínio e conversa longa; cerca de 20 vezes o custo do Haiku" },
];

export const modeloValido = (provedor: string, id: string) => MODELOS.some((m) => m.provedor === provedor && m.id === id);

/** O modelo que assume quando o escolhido está fora do ar (lib/sara/tentativas.ts), pelo catálogo. */
export const modeloReserva = (id: string) => doCatalogo(id)?.reserva ?? null;

const posicao = (e: Esforco) => ESFORCOS.indexOf(e);

/** O esforço que o modelo aceita mais perto do pedido (sem pedido: o padrão do modelo). */
export function esforcoValido(modelo: string, pedido?: Esforco | null): Esforco {
  const m = doCatalogo(modelo);
  if (!m) return pedido ?? "medium";
  if (!pedido) return m.esforcoPadrao;
  return m.esforcos.includes(pedido) ? pedido : m.esforcoPadrao;
}

export type PedidoDoModelo = {
  thinking: { type: "disabled" } | { type: "between_tools" } | { type: "adaptive" };
  output_config?: { effort: Esforco };
  /** O tool_choice que o modelo aceita: forçado vira "auto" (e `instrucao` diz no texto qual ferramenta usar). */
  tool_choice?: { type: "auto" } | { type: "any" } | { type: "tool"; name: string };
  instrucao?: string;
};

/**
 * O pedido válido para o modelo, com o esforço e o pensar que ele aceita.
 *   - `pensar: false` (o padrão): o pensar desligado, no modo do modelo, se o esforço permitir; senão adaptativo.
 *   - `esforco` omitido: não manda o campo (o modelo usa o padrão dele, como até hoje).
 *   - `forcar`: o nome da ferramenta (ou "any") que tem de ser usada; onde o modelo não aceita, vira "auto" com a
 *     instrução no texto.
 */
export function pedidoPara(modelo: string, o: { esforco?: Esforco | null; pensar?: boolean; forcar?: string | null } = {}): PedidoDoModelo {
  const m = doCatalogo(modelo);
  const esforco = o.esforco ? esforcoValido(modelo, o.esforco) : null;
  const efetivo = esforco ?? m?.esforcoPadrao ?? "medium";
  let thinking: PedidoDoModelo["thinking"] = { type: "adaptive" };
  if (!o.pensar && m && m.pensarMinimo !== "adaptive" && m.desligaAte && posicao(efetivo) <= posicao(m.desligaAte)) thinking = { type: m.pensarMinimo };
  else if (!m && !o.pensar) thinking = /haiku/i.test(modelo) ? { type: "disabled" } : { type: "between_tools" };
  const saida: PedidoDoModelo = { thinking, ...(esforco ? { output_config: { effort: esforco } } : {}) };
  if (o.forcar) {
    const aceita = m ? m.ferramentaForcada : /haiku/i.test(modelo);
    if (aceita) saida.tool_choice = o.forcar === "any" ? { type: "any" } : { type: "tool", name: o.forcar };
    else {
      saida.tool_choice = { type: "auto" };
      saida.instrucao = o.forcar === "any" ? "Responda chamando uma das ferramentas disponíveis (obrigatório)." : `Responda chamando a ferramenta ${o.forcar} (obrigatório).`;
    }
  }
  return saida;
}

/** A escolha de modelo de uma rotina (vem da política da empresa; sem ela, o modelo de sempre da rotina). */
export type EscolhaDeModelo = { modelo: string; esforco?: Esforco | null };

/**
 * Os campos do pedido de uma rotina, prontos para o chamarClaude: modelo, limite de saída (com folga quando o pensar
 * é adaptativo: o raciocínio conta no limite), pensar, esforço e a ferramenta obrigatória. `instrucao`: quando o
 * modelo não aceita ferramenta forçada, o texto que vai no fim do sistema dizendo qual usar.
 */
export function camposDaRotina(escolha: EscolhaDeModelo | null | undefined, deSempre: string, maxTokens: number, forcar?: string | null) {
  const modelo = escolha?.modelo && doCatalogo(escolha.modelo) ? escolha.modelo : deSempre;
  const p = pedidoPara(modelo, { esforco: escolha?.modelo === modelo ? escolha?.esforco ?? null : null, forcar: forcar ?? null });
  return {
    campos: {
      model: modelo,
      max_tokens: p.thinking.type === "adaptive" ? Math.max(maxTokens, 8000) : maxTokens,
      thinking: p.thinking,
      ...(p.output_config ? { output_config: p.output_config } : {}),
      ...(p.tool_choice ? { tool_choice: p.tool_choice } : {}),
    },
    modelo,
    instrucao: p.instrucao ?? null,
  };
}
