/**
 * Leitura do vigia externo pelo Business OS (T-06, docs/PLANO-TI.md §5).
 *
 * O vigia (T-03) roda num projeto Supabase na nuvem. O módulo de TI lê de lá o estado
 * dos alvos e as quedas (RPC vigia_painel, infra/vigia/003_painel.sql) com o mesmo
 * token que o servidor usa para avisar que está de pé (VIGIA_TOKEN), e copia as quedas
 * para a plataforma (ti_incidentes), onde a TI confirma a causa.
 *
 * Usado pelas rotas do módulo, pela SARA de TI e pela tarefa do sinal de vida
 * (scripts/ti-sinal-cron.mjs), que copia as quedas a cada minuto. Sem dado de pessoa.
 */

/** Horas sem backup para o painel acusar atraso (o vigia alerta com 26 h). */
export const BACKUP_ATRASO_H = 26;

/**
 * Categoria provável a partir da causa que o vigia deduziu (por regra, sem modelo).
 * Vazio = a confirmar pela TI. Espelha as frases de infra/vigia/001_vigia.sql.
 */
export function categoriaDoVigia(alvo, causa) {
  const c = String(causa ?? "").toLowerCase();
  if (c.startsWith("alarme falso")) return "alarme_falso";
  if (alvo === "backup-pecsil" || c.includes("backup")) return "backup";
  if (c.includes("reiniciou durante a queda")) return "energia";
  if (c.includes("ficou ligado o tempo todo") || c.includes("internet da fábrica não chega")) return "internet";
  if (c.includes("porta 443") || c.includes("https")) return "rede";
  if (c.includes("travados")) return "servidor";
  return null;
}

/**
 * @typedef {{ id: string, nome: string, tipo: string, ativo: boolean, estado: string, estado_desde?: string, ultimo_sinal?: string | null,
 *   tolerancia_s?: number, info?: any, ultima_checagem?: { em: string, ok: boolean, status: number | null, erro: string | null } | null }} AlvoVigia
 * @typedef {{ id: string, alvo: string, alvo_nome?: string | null, inicio: string, fim?: string | null, causa?: string | null }} IncidenteVigia
 * @typedef {{ agora?: string, alvos: AlvoVigia[], incidentes?: IncidenteVigia[],
 *   alertas?: { destinatarios?: number, canal_configurado?: boolean, ultimos_30_dias?: Record<string, number> } }} PainelVigia
 */

/**
 * Lê o painel do vigia. Nunca lança: devolve { ok:false, erro } (o painel mostra "vigia sem resposta").
 * @param {{ url?: string, chave?: string, token?: string, alvo?: string, dias?: number, buscar?: typeof fetch, limiteMs?: number }} [opcoes]
 * @returns {Promise<{ ok: true, painel: PainelVigia } | { ok: false, erro: string }>}
 */
export async function lerPainel({ url, chave, token, alvo = "servidor-pecsil", dias = 400, buscar = fetch, limiteMs = 8000 } = {}) {
  if (!url || !chave || !token) return { ok: false, erro: "Vigia não configurado (VIGIA_URL, VIGIA_CHAVE e VIGIA_TOKEN)." };
  const cabecalhos = { "content-type": "application/json", apikey: chave };
  if (chave.startsWith("eyJ")) cabecalhos.authorization = `Bearer ${chave}`;
  try {
    const r = await buscar(`${url.replace(/\/$/, "")}/rest/v1/rpc/vigia_painel`, {
      method: "POST", headers: cabecalhos,
      body: JSON.stringify({ p_alvo: alvo, p_token: token, p_dias: dias }),
      signal: AbortSignal.timeout(limiteMs),
    });
    const texto = await r.text();
    if (!r.ok) return { ok: false, erro: `O vigia respondeu ${r.status}.` };
    const painel = JSON.parse(texto || "{}");
    if (!Array.isArray(painel.alvos)) return { ok: false, erro: "Resposta do vigia sem os alvos." };
    return { ok: true, painel };
  } catch (e) {
    return { ok: false, erro: e instanceof Error && e.name === "TimeoutError" ? "O vigia não respondeu a tempo." : "Sem contato com o vigia na nuvem." };
  }
}

/**
 * As quedas do vigia no formato de public.ti_sincronizar_vigia.
 * @param {Partial<PainelVigia> | null | undefined} painel
 */
export function paraCopiar(painel) {
  return (painel?.incidentes ?? []).map((i) => ({
    vigia_id: i.id, alvo: i.alvo, alvo_nome: i.alvo_nome ?? i.alvo, inicio: i.inicio, fim: i.fim ?? null,
    causa_vigia: i.causa ?? null, categoria: categoriaDoVigia(i.alvo, i.causa),
  }));
}

/**
 * Copia as quedas para a plataforma com a chave de serviço (só no servidor). A empresa é a
 * única da instalação, a não ser que `org` venha dado (o vigia é de um servidor só).
 */
/**
 * @param {{ supabaseUrl?: string, chaveServico?: string, org?: string, incidentes: ReturnType<typeof paraCopiar>, buscar?: typeof fetch, limiteMs?: number }} opcoes
 * @returns {Promise<number>}
 */
export async function copiarParaPlataforma({ supabaseUrl, chaveServico, org, incidentes, buscar = fetch, limiteMs = 8000 }) {
  if (!supabaseUrl || !chaveServico) throw new Error("SUPABASE_INTERNAL_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  if (!incidentes.length) return 0;
  const base = supabaseUrl.replace(/\/$/, "");
  const cab = { apikey: chaveServico, "content-type": "application/json", ...(chaveServico.startsWith("eyJ") ? { authorization: `Bearer ${chaveServico}` } : {}) };
  let empresa = org;
  if (!empresa) {
    const r = await buscar(`${base}/rest/v1/organizations?select=id&limit=2`, { headers: cab, signal: AbortSignal.timeout(limiteMs) });
    const lista = r.ok ? await r.json() : [];
    if (!Array.isArray(lista) || lista.length !== 1) throw new Error("Não deu para saber a empresa (informe TI_ORGANIZATION_ID).");
    empresa = lista[0].id;
  }
  const r = await buscar(`${base}/rest/v1/rpc/ti_sincronizar_vigia`, {
    method: "POST", headers: cab, body: JSON.stringify({ p_org: empresa, p_incidentes: incidentes }), signal: AbortSignal.timeout(limiteMs),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`cópia das quedas recusada (${r.status}): ${texto.slice(0, 160)}`);
  return Number(texto) || 0;
}

const horasDesde = (iso, agora) => (iso ? (agora - Date.parse(iso)) / 3_600_000 : null);

/**
 * O que o painel de saúde mostra, já interpretado: o servidor (com os serviços vistos
 * por dentro), o backup diário, os testes de fora e os alertas. Sem o nobreak: ele entra
 * quando o T-01 existir.
 * @param {Partial<PainelVigia> | null | undefined} painel
 * @param {number} [agora]
 * @returns {{
 *   lidoEm: string | null,
 *   servidor: null | { nome: string, estado: string, desde: string, ultimoSinal: string | null, ligadoHaS: number | null, discoLivrePct: number | null,
 *     memoriaLivrePct: number | null, carga1m: number | null, cpus: number | null, servicos: { nome: string, ok: boolean, ms: number | null }[] },
 *   backup: null | { estado: string, ultimo: string | null, horasDesde: number | null, atrasado: boolean, arquivos: { nome: string, bytes: number | null }[],
 *     totalBytes: number, duracaoS: number | null },
 *   externos: { id: string, nome: string, ativo: boolean, estado: string, ultimaChecagem: { em: string, ok: boolean, status: number | null, erro: string | null } | null }[],
 *   alertas: { destinatarios: number, canalConfigurado: boolean, ultimos30Dias: Record<string, number> },
 *   foraAgora: { alvo: string, nome: string, desde: string, causa: string }[],
 * }}
 */
export function resumoSaude(painel, agora = Date.now()) {
  const alvos = painel?.alvos ?? [];
  const servidor = alvos.find((a) => a.id === "servidor-pecsil") ?? alvos.find((a) => a.tipo === "sinal" && a.id !== "backup-pecsil") ?? null;
  const backup = alvos.find((a) => a.id === "backup-pecsil") ?? null;
  const host = servidor?.info?.host ?? {};
  const servicos = Object.entries(servidor?.info?.servicos ?? {}).map(([nome, s]) => ({ nome, ok: Boolean(s?.ok), ms: s?.ms ?? null }));
  const arquivos = Array.isArray(backup?.info?.arquivos) ? backup.info.arquivos : [];
  const horasBackup = horasDesde(backup?.ultimo_sinal, agora);
  const abertos = (painel?.incidentes ?? []).filter((i) => !i.fim);
  return {
    lidoEm: painel?.agora ?? null,
    servidor: !servidor ? null : {
      nome: servidor.nome,
      estado: servidor.estado,
      desde: servidor.estado_desde ?? "",
      ultimoSinal: servidor.ultimo_sinal ?? null,
      ligadoHaS: host.uptime_s ?? null,
      discoLivrePct: host.disco_livre_pct ?? null,
      memoriaLivrePct: host.memoria_livre_pct ?? null,
      carga1m: host.carga_1m ?? null,
      cpus: host.cpus ?? null,
      servicos,
    },
    backup: !backup ? null : {
      estado: backup.estado,
      ultimo: backup.ultimo_sinal ?? null,
      horasDesde: horasBackup === null ? null : Math.round(horasBackup * 10) / 10,
      atrasado: horasBackup === null || horasBackup > BACKUP_ATRASO_H,
      arquivos: arquivos.map((a) => ({ nome: a.nome, bytes: a.bytes ?? null })),
      totalBytes: arquivos.reduce((s, a) => s + (Number(a.bytes) || 0), 0),
      duracaoS: backup.info?.duracao_s ?? null,
    },
    externos: alvos.filter((a) => a.tipo === "http").map((a) => ({
      id: a.id, nome: a.nome, ativo: a.ativo, estado: a.estado, ultimaChecagem: a.ultima_checagem ?? null,
    })),
    alertas: {
      destinatarios: painel?.alertas?.destinatarios ?? 0,
      canalConfigurado: Boolean(painel?.alertas?.canal_configurado),
      ultimos30Dias: painel?.alertas?.ultimos_30_dias ?? {},
    },
    foraAgora: abertos.map((i) => ({ alvo: i.alvo, nome: i.alvo_nome ?? i.alvo, desde: i.inicio, causa: i.causa ?? "a confirmar" })),
  };
}
