#!/usr/bin/env node
/**
 * Remonta o grafo do Segundo Cérebro (docs/PLANO-WAR-ROOM-CEREBRO.md, etapa G1).
 *
 * Roda como tarefa agendada do Coolify, dentro do contêiner do Business OS, a cada 10 minutos.
 * Chama public.cerebro_montar com a chave de serviço do banco da plataforma: a função monta tudo
 * por regra e aplica só a diferença (na prática, segundos). A empresa é a única da instalação, a
 * não ser que TI_ORGANIZATION_ID diga outra.
 */
const { SUPABASE_INTERNAL_URL, SUPABASE_SERVICE_ROLE_KEY, TI_ORGANIZATION_ID } = process.env;
if (!SUPABASE_INTERNAL_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_INTERNAL_URL ou SUPABASE_SERVICE_ROLE_KEY ausente.");
  process.exit(1);
}
const base = SUPABASE_INTERNAL_URL.replace(/\/$/, "");
const cab = { apikey: SUPABASE_SERVICE_ROLE_KEY, "content-type": "application/json", ...(SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ") ? { authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}) };
try {
  let org = TI_ORGANIZATION_ID;
  if (!org) {
    const r = await fetch(`${base}/rest/v1/organizations?select=id&limit=2`, { headers: cab, signal: AbortSignal.timeout(15_000) });
    const lista = r.ok ? await r.json() : [];
    if (!Array.isArray(lista) || lista.length !== 1) throw new Error("não deu para saber a empresa (informe TI_ORGANIZATION_ID)");
    org = lista[0].id;
  }
  const r = await fetch(`${base}/rest/v1/rpc/cerebro_montar`, { method: "POST", headers: cab, body: JSON.stringify({ p_org: org }), signal: AbortSignal.timeout(120_000) });
  const texto = await r.text();
  if (!r.ok) throw new Error(`montagem recusada (${r.status}): ${texto.slice(0, 200)}`);
  const x = JSON.parse(texto);
  console.log(new Date().toISOString(), `grafo montado em ${x.ms} ms`, JSON.stringify({ nos: x.nos, ligacoes: x.ligacoes }));
} catch (error) {
  console.error(new Date().toISOString(), "falha:", error instanceof Error ? error.message : error);
  process.exit(1);
}
