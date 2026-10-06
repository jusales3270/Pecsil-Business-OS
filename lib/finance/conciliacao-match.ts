/**
 * Casamento entre lançamentos do extrato (saídas) e baixas do contas a pagar.
 * Tudo local e determinístico; nada vai a serviço externo e nada aqui grava.
 *
 * Três níveis, do mais seguro ao menos:
 *  1. mesma data e mesmo valor (um lançamento ↔ uma baixa);
 *  2. data até 3 dias de diferença, mesmo valor, quando só há um par possível;
 *  3. um lançamento ↔ várias baixas (lote SISPAG): a soma das baixas do dia dá o
 *     valor do lançamento e só existe uma combinação que fecha.
 * O que sobra fica sem vínculo e vai para a revisão da pessoa.
 *
 * Valores em centavos inteiros e positivos (o sentido já foi decidido por quem chama).
 */

export type EntradaMatch = { id: string; data: string; centavos: number; contraparte: string | null };
export type BaixaMatch = { id: string; data: string; centavos: number; contraparte: string | null };

export type Vinculo = {
  entradaId: string;
  baixaIds: string[];
  /** 1 = data e valor iguais · 2 = data deslocada · 3 = lote do dia (soma única) */
  nivel: 1 | 2 | 3;
  /** alta: par único; media: havia mais de um valor igual no dia ou a data deslocou. */
  confianca: "alta" | "media";
};

export type ResultadoMatch = {
  vinculos: Vinculo[];
  entradasSemVinculo: string[];
  baixasSemVinculo: string[];
  /** Lançamentos de lote que não foram testados por terem baixas demais no dia. */
  lotesGrandesIgnorados: number;
};

const SUFIXOS = new Set(["LTDA", "ME", "EPP", "EIRELI", "SA", "S/A", "DE", "DA", "DO", "E", "COMERCIO", "INDUSTRIA", "SERVICOS"]);

const tokens = (nome: string | null) =>
  (nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !SUFIXOS.has(t));

/** 0 a 1: quanto os nomes se parecem (palavras em comum sobre as do menor). */
export function parecenca(a: string | null, b: string | null): number {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  const comuns = ta.filter((t) => tb.has(t)).length;
  return comuns / Math.min(ta.length, tb.size);
}

const dias = (data: string) => Math.round(Date.parse(`${data}T00:00:00Z`) / 86_400_000);
const distancia = (a: string, b: string) => Math.abs(dias(a) - dias(b));

const LIMITE_LOTE = 34;

/** Subconjunto (2 ou mais itens) cuja soma é o alvo — só se a solução for única. */
export function subconjuntoUnico(itens: BaixaMatch[], alvo: number): BaixaMatch[] | null {
  if (itens.length < 2 || itens.length > LIMITE_LOTE) return null;
  const meio = Math.floor(itens.length / 2);
  const A = itens.slice(0, meio);
  const B = itens.slice(meio);

  const somas = (lista: BaixaMatch[]) => {
    const resultado: { soma: number; mascara: number }[] = [];
    const total = 1 << lista.length;
    for (let m = 0; m < total; m++) {
      let soma = 0;
      for (let i = 0; i < lista.length; i++) if (m & (1 << i)) soma += lista[i].centavos;
      resultado.push({ soma, mascara: m });
    }
    return resultado;
  };

  const porSoma = new Map<number, number[]>();
  for (const { soma, mascara } of somas(A)) {
    const atual = porSoma.get(soma);
    if (!atual) porSoma.set(soma, [mascara]);
    else if (atual.length < 2) atual.push(mascara);
  }

  const achados: { a: number; b: number }[] = [];
  for (const { soma, mascara } of somas(B)) {
    const lado = porSoma.get(alvo - soma);
    if (!lado) continue;
    for (const ma of lado) {
      if (ma === 0 && mascara === 0) continue;
      achados.push({ a: ma, b: mascara });
      if (achados.length > 1) return null;
    }
  }
  if (achados.length !== 1) return null;
  const { a, b } = achados[0];
  const escolhidos = [...A.filter((_, i) => a & (1 << i)), ...B.filter((_, i) => b & (1 << i))];
  return escolhidos.length >= 2 ? escolhidos : null;
}

export function conciliarSaidas(entradas: EntradaMatch[], baixas: BaixaMatch[]): ResultadoMatch {
  const livresE = new Map(entradas.map((e) => [e.id, e]));
  const livresB = new Map(baixas.map((b) => [b.id, b]));
  const vinculos: Vinculo[] = [];
  let lotesGrandesIgnorados = 0;

  const ligar = (e: EntradaMatch, bs: BaixaMatch[], nivel: Vinculo["nivel"], confianca: Vinculo["confianca"]) => {
    vinculos.push({ entradaId: e.id, baixaIds: bs.map((b) => b.id), nivel, confianca });
    livresE.delete(e.id);
    for (const b of bs) livresB.delete(b.id);
  };

  // Nível 1: mesma data e mesmo valor.
  const grupos = new Map<string, { es: EntradaMatch[]; bs: BaixaMatch[] }>();
  const chave = (data: string, centavos: number) => `${data}|${centavos}`;
  for (const e of entradas) {
    let grupo = grupos.get(chave(e.data, e.centavos));
    if (!grupo) {
      grupo = { es: [], bs: [] };
      grupos.set(chave(e.data, e.centavos), grupo);
    }
    grupo.es.push(e);
  }
  for (const b of baixas) grupos.get(chave(b.data, b.centavos))?.bs.push(b);
  for (const { es, bs } of grupos.values()) {
    if (!es.length || !bs.length) continue;
    const confianca: Vinculo["confianca"] = es.length === 1 && bs.length === 1 ? "alta" : "media";
    const restantes = [...bs];
    for (const e of es) {
      if (!restantes.length) break;
      let melhor = 0;
      for (let i = 1; i < restantes.length; i++) if (parecenca(e.contraparte, restantes[i].contraparte) > parecenca(e.contraparte, restantes[melhor].contraparte)) melhor = i;
      ligar(e, [restantes[melhor]], 1, confianca);
      restantes.splice(melhor, 1);
    }
  }

  // Nível 2: mesmo valor, até 3 dias de diferença, só se o par for único dos dois lados.
  const candidatosDe = (e: EntradaMatch) => [...livresB.values()].filter((b) => b.centavos === e.centavos && distancia(b.data, e.data) <= 3);
  const pares: [EntradaMatch, BaixaMatch][] = [];
  for (const e of livresE.values()) {
    const cs = candidatosDe(e);
    if (cs.length !== 1) continue;
    const donos = [...livresE.values()].filter((o) => o.centavos === cs[0].centavos && distancia(o.data, cs[0].data) <= 3);
    if (donos.length === 1) pares.push([e, cs[0]]);
  }
  for (const [e, b] of pares) ligar(e, [b], 2, "media");

  // Nível 3: lote do dia — a soma das baixas que sobraram na data do lançamento (ou até 3 dias antes).
  const ordenadas = [...livresE.values()].sort((x, y) => y.centavos - x.centavos);
  for (const e of ordenadas) {
    const pool = [...livresB.values()].filter((b) => b.centavos < e.centavos && dias(e.data) - dias(b.data) >= 0 && dias(e.data) - dias(b.data) <= 3);
    const mesmoDia = pool.filter((b) => b.data === e.data);
    for (const candidatos of [mesmoDia, pool]) {
      if (candidatos.length > LIMITE_LOTE) {
        lotesGrandesIgnorados++;
        continue;
      }
      const achou = subconjuntoUnico(candidatos, e.centavos);
      if (achou) {
        ligar(e, achou, 3, candidatos === mesmoDia ? "alta" : "media");
        break;
      }
    }
  }

  return { vinculos, entradasSemVinculo: [...livresE.keys()], baixasSemVinculo: [...livresB.keys()], lotesGrandesIgnorados };
}

export type SugestaoBaixa = { baixaId: string; motivo: "valor" | "valor_e_nome" | "nome"; distanciaDias: number };

/**
 * Candidatos para a tela, quando o casamento automático não resolveu: baixas sem
 * vínculo com valor igual (±R$ 0,05) e data até 3 dias, ou nome parecido com
 * valor até 2% de diferença. Até 5.
 */
export function sugerirBaixas(entrada: EntradaMatch, baixas: BaixaMatch[]): SugestaoBaixa[] {
  const resultado: (SugestaoBaixa & { nota: number })[] = [];
  for (const b of baixas) {
    const d = distancia(b.data, entrada.data);
    if (d > 3) continue;
    const mesmoValor = Math.abs(b.centavos - entrada.centavos) <= 5;
    const nome = parecenca(entrada.contraparte, b.contraparte);
    const quase = Math.abs(b.centavos - entrada.centavos) <= entrada.centavos * 0.02;
    if (mesmoValor && nome >= 0.5) resultado.push({ baixaId: b.id, motivo: "valor_e_nome", distanciaDias: d, nota: 3 - d * 0.1 });
    else if (mesmoValor) resultado.push({ baixaId: b.id, motivo: "valor", distanciaDias: d, nota: 2 - d * 0.1 });
    else if (quase && nome >= 0.6) resultado.push({ baixaId: b.id, motivo: "nome", distanciaDias: d, nota: 1 - d * 0.1 });
  }
  return resultado
    .sort((a, b) => b.nota - a.nota)
    .slice(0, 5)
    .map((r) => ({ baixaId: r.baixaId, motivo: r.motivo, distanciaDias: r.distanciaDias }));
}
