/**
 * Sessão de integração com o Forja (lógica pura, sem rede).
 *
 * O Forja só entrega o painel a uma pessoa logada com o módulo
 * `painel_producao`, e o token dele vale 12h. Aqui o Business OS entra com a
 * conta de integração, reaproveita o token até perto do vencimento, refaz o
 * login uma vez quando o Forja recusa e segura novas tentativas por um tempo
 * depois de uma senha recusada — para não bater no Forja a cada 30s com PIN
 * errado. O transporte (HTTP) é injetado; `client.ts` liga o de verdade.
 */

import type { DashboardData } from "../../modules/producao/src/types";

export type ForjaFailure =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "FORBIDDEN_MODULE"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "BAD_RESPONSE";

export class ForjaError extends Error {
  code: ForjaFailure;
  constructor(code: ForjaFailure, message: string) {
    super(message);
    this.name = "ForjaError";
    this.code = code;
  }
}

export interface ForjaResponse {
  status: number;
  body: unknown;
}

export type ForjaTransport = (request: {
  method: "GET" | "POST";
  path: string;
  token?: string;
  body?: unknown;
}) => Promise<ForjaResponse>;

export interface ForjaSessionOptions {
  transport: ForjaTransport;
  credentials: { code: string; pin: string } | null;
  now?: () => number;
  cacheMs?: number;
  loginRetryMs?: number;
}

export interface ForjaDashboardResult {
  data: DashboardData;
  fetchedAt: number;
}

const TOKEN_MARGIN_MS = 5 * 60_000;
const TOKEN_FALLBACK_MS = 11 * 60 * 60_000;

export function createForjaSession({
  transport,
  credentials,
  now = Date.now,
  cacheMs = 15_000,
  loginRetryMs = 60_000,
}: ForjaSessionOptions) {
  let token: { value: string; renewAt: number } | null = null;
  let loginBlocked: { until: number; error: ForjaError } | null = null;
  let cache: ForjaDashboardResult | null = null;
  let inflight: Promise<ForjaDashboardResult> | null = null;

  async function login() {
    if (!credentials) throw new ForjaError("NOT_CONFIGURED", "Conta de integração do Forja não configurada.");
    if (loginBlocked && now() < loginBlocked.until) throw loginBlocked.error;

    const response = await transport({
      method: "POST",
      path: "/api/auth/login",
      body: { codigo_pessoal: credentials.code, pin: credentials.pin },
    });
    const value = readToken(response);
    if (!value) {
      const error = response.status === 400 || response.status === 401
        ? new ForjaError("AUTH_FAILED", "O Forja recusou o código ou o PIN da conta de integração.")
        : new ForjaError("BAD_RESPONSE", `O login no Forja respondeu ${response.status}.`);
      loginBlocked = { until: now() + loginRetryMs, error };
      throw error;
    }
    loginBlocked = null;
    const expiresAt = jwtExpiry(value) ?? now() + TOKEN_FALLBACK_MS;
    token = { value, renewAt: expiresAt - TOKEN_MARGIN_MS };
    return value;
  }

  async function validToken() {
    if (token && now() < token.renewAt) return token.value;
    return login();
  }

  async function fetchDashboard(): Promise<ForjaDashboardResult> {
    let response = await transport({ method: "GET", path: "/api/dashboard", token: await validToken() });
    if (response.status === 401) {
      // Token revogado ou chave do Forja trocada: um novo login resolve.
      token = null;
      response = await transport({ method: "GET", path: "/api/dashboard", token: await validToken() });
    }
    if (response.status === 401) throw new ForjaError("AUTH_FAILED", "O Forja recusou o token da conta de integração.");
    if (response.status === 403) {
      throw new ForjaError("FORBIDDEN_MODULE", "A conta de integração não tem o módulo Painel de Produção no Forja.");
    }
    if (response.status !== 200) throw new ForjaError("BAD_RESPONSE", `O painel do Forja respondeu ${response.status}.`);
    return { data: toDashboardData(response.body), fetchedAt: now() };
  }

  return {
    /** Painel do Forja, com cache curto e chamadas simultâneas agrupadas. */
    async getDashboard(): Promise<ForjaDashboardResult> {
      if (cache && now() - cache.fetchedAt < cacheMs) return cache;
      inflight ??= fetchDashboard()
        .then((result) => (cache = result))
        .finally(() => { inflight = null; });
      return inflight;
    },
  };
}

function readToken(response: ForjaResponse): string | null {
  if (response.status !== 200) return null;
  const token = record(record(response.body).data).token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

type Row = Record<string, unknown>;

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function nullableText(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function counts(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, total]) => [key, num(total)]));
}

/**
 * Recorta o painel pelas funcionalidades liberadas ao usuário: quem só vê
 * Paradas não recebe a lista de OS, clientes e prazos. O Painel é o resumo da
 * fábrica e leva tudo, menos envios externos e o histórico de pontualidade.
 */
export function pruneDashboard(
  data: DashboardData,
  can: (feature: string) => boolean,
  empty: DashboardData,
): DashboardData {
  const any = (...features: string[]) => features.some((feature) => can(`producao.${feature}`));
  return {
    geradoEm: data.geradoEm,
    osPorStatus: any("painel", "os", "bi") ? data.osPorStatus : empty.osPorStatus,
    osPorStatusLista: any("painel", "os") ? data.osPorStatusLista : empty.osPorStatusLista,
    osAtrasadas: any("painel", "os") ? data.osAtrasadas : empty.osAtrasadas,
    kanban: any("painel", "bi") ? data.kanban : empty.kanban,
    pipelines: any("painel", "fundicao") ? data.pipelines : empty.pipelines,
    inspecao: any("painel", "qualidade") ? data.inspecao : empty.inspecao,
    paradas: any("painel", "paradas", "bi") ? data.paradas : empty.paradas,
    fantasmas: any("painel", "fantasmas") ? data.fantasmas : empty.fantasmas,
    indicadores: {
      carteira: any("painel", "os", "bi") ? data.indicadores.carteira : empty.indicadores.carteira,
      historico: any("bi") ? data.indicadores.historico : empty.indicadores.historico,
    },
    gargalos: any("painel") ? data.gargalos : empty.gargalos,
    enviosExternos: any("externos") ? data.enviosExternos : empty.enviosExternos,
    totalOSExternas: any("externos") ? data.totalOSExternas : empty.totalOSExternas,
  };
}

/**
 * Recorta a resposta do Forja para o que a Produção usa. O Forja manda também
 * roteiros completos, listas de ids e cadastros de clientes — não vão ao
 * navegador, que só precisa do painel.
 */
export function toDashboardData(body: unknown): DashboardData {
  const raw = record(record(body).data ?? body);
  if (!("osPorStatus" in raw) || !("kanban" in raw)) {
    throw new ForjaError("BAD_RESPONSE", "O Forja respondeu num formato inesperado.");
  }

  const osResumo = (os: Row) => ({
    id: text(os.id),
    codigoGrv: text(os.codigoGrv),
    prazoEntrega: text(os.prazoEntrega),
    prioridade: text(os.prioridade),
    status: text(os.status),
    quantidadeTotal: num(os.quantidadeTotal),
    cliente: { nome: text(record(os.cliente).nome, "Cliente não informado") },
    artigo: {
      codigo: text(record(os.artigo).codigo),
      descricao: text(record(os.artigo).descricao),
    },
  });

  const passo = (value: unknown) => {
    const step = record(value);
    return step.estacao ? { estacao: text(step.estacao), tipoServico: text(step.tipoServico) } : null;
  };

  const indicadores = record(raw.indicadores);
  const carteira = record(indicadores.carteira);
  const historico = record(indicadores.historico);
  const grupo = (item: Row) => ({
    id: text(item.id),
    nome: text(item.nome),
    total: num(item.total),
    atrasadas: num(item.atrasadas),
    mediaDiasAtraso: num(item.mediaDiasAtraso),
  });

  const paradas = record(raw.paradas);
  const fantasmas = record(raw.fantasmas);

  return {
    geradoEm: text(raw.geradoEm, new Date(0).toISOString()),
    osPorStatus: counts(raw.osPorStatus),
    osPorStatusLista: Object.fromEntries(
      Object.entries(record(raw.osPorStatusLista)).map(([status, itens]) => [status, list(itens).map(osResumo)]),
    ),
    osAtrasadas: list(raw.osAtrasadas).map(osResumo),
    kanban: list(raw.kanban).map((etapa) => ({
      etapaId: text(etapa.etapaId),
      nome: text(etapa.nome),
      ordemPadrao: num(etapa.ordemPadrao),
      total: num(etapa.total),
      cards: list(etapa.cards).map((card) => ({
        opLoteId: text(card.opLoteId),
        codigoOp: text(card.codigoOp),
        codigoGrv: text(card.codigoGrv),
        numeroLote: num(card.numeroLote),
        cliente: text(card.cliente),
        artigo: text(card.artigo),
        status: text(card.status),
        prioridade: text(card.prioridade),
        diasAtePrazo: num(card.diasAtePrazo),
        semaforo: card.semaforo === "vermelho" || card.semaforo === "amarelo" ? card.semaforo : "verde",
        operador: nullableText(card.operador),
        programador: nullableText(card.programador),
        maquina: nullableText(card.maquina),
        externo: card.externo === true,
        fornecedor: nullableText(card.fornecedor),
        quantidade: num(card.quantidade),
        veioDe: passo(card.veioDe),
        proxima: passo(card.proxima),
      })),
    })),
    pipelines: list(raw.pipelines) as unknown as DashboardData["pipelines"],
    inspecao: counts(raw.inspecao),
    paradas: {
      ativas: list(paradas.ativas).map((parada) => ({
        id: text(parada.id),
        motivo: text(parada.motivo),
        planejado: parada.planejado === true,
        maquina: nullableText(parada.maquina),
        codigoOp: text(parada.codigoOp),
        etapa: text(parada.etapa),
        codigoGrv: text(parada.codigoGrv),
        cliente: text(parada.cliente),
        inicio: text(parada.inicio),
        minutosParado: num(parada.minutosParado),
      })),
      porMotivoHoje: Object.fromEntries(
        Object.entries(record(paradas.porMotivoHoje)).map(([motivo, info]) => {
          const item = record(info);
          return [motivo, { minutos: num(item.minutos), ocorrencias: num(item.ocorrencias), planejado: item.planejado === true }];
        }),
      ),
    },
    fantasmas: {
      opsParadas: list(fantasmas.opsParadas).map((op) => ({
        codigoOp: text(op.codigoOp),
        codigoGrv: text(op.codigoGrv),
        etapa: text(op.etapa),
        horasParado: num(op.horasParado),
      })),
      turnosNaoFechados: list(fantasmas.turnosNaoFechados).map((turno) => ({ operador: text(turno.operador) })),
    },
    indicadores: {
      carteira: {
        total: num(carteira.total),
        emDia: num(carteira.emDia),
        atrasadas: num(carteira.atrasadas),
      },
      historico: {
        dias: num(historico.dias),
        inicio: text(historico.inicio),
        fim: text(historico.fim),
        total: num(historico.total),
        emDia: num(historico.emDia),
        atrasadas: num(historico.atrasadas),
        pontualidade: historico.pontualidade == null ? null : num(historico.pontualidade),
        semDataConclusao: num(historico.semDataConclusao),
        porCliente: list(historico.porCliente).map(grupo),
        porTipo: list(historico.porTipo).map(grupo),
        evolucao: list(historico.evolucao).map((mes) => ({
          mes: text(mes.mes),
          emDia: num(mes.emDia),
          atrasadas: num(mes.atrasadas),
        })),
      },
    },
    gargalos: list(raw.gargalos).map((gargalo) => ({
      etapaId: text(gargalo.etapaId),
      nome: text(gargalo.nome),
      operacoes: num(gargalo.operacoes),
      pecas: num(gargalo.pecas),
      horasPlanejadas: num(gargalo.horasPlanejadas),
      osAtrasadas: num(gargalo.osAtrasadas),
    })),
    enviosExternos: list(raw.enviosExternos).map((envio) => ({
      opLoteId: text(envio.opLoteId),
      codigoGrv: text(envio.codigoGrv),
      codigoOp: text(envio.codigoOp),
      tipoServico: text(envio.tipoServico),
      numeroLote: num(envio.numeroLote),
      cliente: text(envio.cliente),
      artigo: text(envio.artigo),
      descricao: text(envio.descricao),
      fornecedor: nullableText(envio.fornecedor),
      quantidade: envio.quantidade == null ? null : num(envio.quantidade),
      enviadoEm: text(envio.enviadoEm),
      diasFora: num(envio.diasFora),
      prazoEntrega: text(envio.prazoEntrega),
      diasAtePrazo: num(envio.diasAtePrazo),
    })),
    totalOSExternas: num(raw.totalOSExternas),
  };
}
