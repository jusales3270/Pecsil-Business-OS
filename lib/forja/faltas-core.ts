/**
 * Falta de peças na chegada ao Desbaste (Forja), parte pura: ler o que a Forja manda, decidir o que
 * avisar ao chefe e montar o texto. Sem banco, para testar sem rede (tests/forja-faltas.test.mjs).
 *
 * Fonte: GET /api/integracao/faltas-chegada da Forja (abertas + resolvidas dos últimos 30 dias).
 * Regra do Domingo: o Desbaste segue com o que chegou; a Fundição fica avisada até mandar o restante
 * e o Desbaste confirmar. O chefe recebe um aviso quando a falta aparece e outro quando ela se resolve.
 */

export type FaltaForja = {
  id: string;
  osId: string;
  codigoGrv: string;
  cliente: string;
  artigoCodigo: string;
  artigoDescricao: string;
  numeroLote: number;
  esperado: number;
  contado: number;
  faltaInicial: number;
  enviadas: number;
  aguardandoConfirmacao: number;
  chegaramDepois: number;
  aceitas: number;
  faltam: number;
  situacao: "aberta" | "resolvida";
  resolucao: "pecas_chegaram" | "falta_aceita" | null;
  conferidoPor: string | null;
  conferidoEm: string;
  resolvidoPor: string | null;
  resolvidoEm: string | null;
  estacaoOrigem: string | null;
};

export type TipoAviso = "aberta" | "resolvida";
export type Aviso = { falta: FaltaForja; tipo: TipoAviso };

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const ou = (v: unknown) => (txt(v) || null);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Lê a lista da Forja. Linha sem id, sem OS ou sem data de conferência sai. */
export function parseFaltas(raw: unknown): { faltas: FaltaForja[]; rejeitados: number } {
  const lista = Array.isArray(raw) ? raw : [];
  const faltas: FaltaForja[] = [];
  let rejeitados = 0;
  for (const item of lista) {
    const f = rec(item);
    const id = txt(f.id);
    const codigoGrv = txt(f.codigoGrv);
    const conferidoEm = txt(f.conferidoEm);
    const situacao = f.situacao === "resolvida" ? "resolvida" : f.situacao === "aberta" ? "aberta" : null;
    if (!id || !codigoGrv || !conferidoEm || !situacao) { rejeitados++; continue; }
    const artigo = rec(f.artigo);
    faltas.push({
      id, osId: txt(f.osId), codigoGrv, cliente: txt(f.cliente),
      artigoCodigo: txt(artigo.codigo), artigoDescricao: txt(artigo.descricao),
      numeroLote: num(f.numeroLote), esperado: num(f.esperado), contado: num(f.contado),
      faltaInicial: num(f.faltaInicial), enviadas: num(f.enviadas), aguardandoConfirmacao: num(f.aguardandoConfirmacao),
      chegaramDepois: num(f.chegaramDepois), aceitas: num(f.aceitas), faltam: num(f.faltam),
      situacao,
      resolucao: f.resolucao === "pecas_chegaram" || f.resolucao === "falta_aceita" ? f.resolucao : null,
      conferidoPor: ou(f.conferidoPor), conferidoEm,
      resolvidoPor: ou(f.resolvidoPor), resolvidoEm: ou(f.resolvidoEm),
      estacaoOrigem: ou(f.estacaoOrigem),
    });
  }
  return { faltas, rejeitados };
}

export const chaveAviso = (id: string, tipo: TipoAviso) => `${id}:${tipo}`;

/**
 * O que avisar agora. `feitos` são as chaves (id:tipo) já avisadas.
 *  - aberta: falta aberta ainda não avisada;
 *  - resolvida: resolveu e ainda não foi avisado. Se a abertura nunca foi avisada (resolveu entre duas
 *    rodadas, ou é da carga inicial), só avisa se resolveu nas últimas 24h, para a primeira rodada
 *    depois do deploy não mandar o histórico inteiro.
 */
export function quaisAvisar(faltas: FaltaForja[], feitos: Set<string>, agora: Date): Aviso[] {
  const avisos: Aviso[] = [];
  for (const f of faltas) {
    if (f.situacao === "aberta") {
      if (!feitos.has(chaveAviso(f.id, "aberta"))) avisos.push({ falta: f, tipo: "aberta" });
      continue;
    }
    if (feitos.has(chaveAviso(f.id, "resolvida"))) continue;
    const recente = !!f.resolvidoEm && agora.getTime() - Date.parse(f.resolvidoEm) <= 24 * 3_600_000;
    if (feitos.has(chaveAviso(f.id, "aberta")) || recente) avisos.push({ falta: f, tipo: "resolvida" });
  }
  return avisos;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Título e corpo do sino e o texto do WhatsApp. `nome` é o primeiro nome de quem recebe. */
export function textoAviso({ falta: f, tipo }: Aviso, nome?: string | null): { titulo: string; corpo: string; whatsapp: string } {
  const os = `OS ${f.codigoGrv} · lote ${f.numeroLote}`;
  const peca = f.artigoCodigo ? ` (${f.artigoCodigo}${f.cliente ? ` · ${f.cliente}` : ""})` : f.cliente ? ` (${f.cliente})` : "";
  const ola = nome ? `${nome}, ` : "";
  if (tipo === "aberta") {
    const titulo = `Falta de peças: ${os} — chegaram ${f.contado} de ${f.esperado}`;
    const corpo =
      `Faltam ${f.faltam} peça(s) na chegada ao Desbaste${f.conferidoPor ? `, conferido por ${f.conferidoPor}` : ""} em ${hora(f.conferidoEm)}. ` +
      `O Desbaste segue com o que chegou; a ${f.estacaoOrigem ?? "Fundição"} foi avisada para mandar o restante.`;
    const whatsapp =
      `⚠ ${ola}falta de peças na ${os}${peca}: chegaram ${f.contado} de ${f.esperado} no Desbaste, faltam ${f.faltam}. ` +
      `${f.conferidoPor ? `Conferido por ${f.conferidoPor} ` : ""}em ${hora(f.conferidoEm)}. ` +
      `O Desbaste segue com o que chegou e a ${f.estacaoOrigem ?? "Fundição"} já foi avisada para mandar o restante.`;
    return { titulo, corpo, whatsapp };
  }
  const como = f.resolucao === "falta_aceita"
    ? `o PCP aceitou a falta de ${f.aceitas} peça(s)${f.chegaramDepois ? ` (chegaram ${f.chegaramDepois} depois)` : ""} e o lote seguiu com ${f.esperado - f.aceitas}`
    : `as ${f.faltaInicial} peça(s) que faltavam chegaram ao Desbaste`;
  const quem = f.resolvidoPor ? ` (${f.resolvidoPor}${f.resolvidoEm ? `, ${hora(f.resolvidoEm)}` : ""})` : f.resolvidoEm ? ` (${hora(f.resolvidoEm)})` : "";
  return {
    titulo: `Falta resolvida: ${os}`,
    corpo: `Na ${os}, ${como}${quem}.`,
    whatsapp: `✅ ${ola}a falta de peças da ${os}${peca} foi resolvida: ${como}${quem}.`,
  };
}
