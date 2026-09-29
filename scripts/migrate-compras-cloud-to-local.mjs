#!/usr/bin/env node
/**
 * Compras: Supabase Cloud (app compras-pecsil) → Supabase da PecSil.
 *
 * Enquanto o app antigo estiver em uso, a NUVEM é a fonte da verdade. Este
 * script copia o estado dela para o banco da plataforma:
 *   - cotações, itens, compras e notificações da nuvem entram ou substituem
 *     as linhas de mesmo id (a nuvem vence);
 *   - itens de cotação e notificações que só existem aqui e foram criados
 *     depois da última cópia (03/09/2026) são o que a plataforma lançou sobre
 *     dado desatualizado → são listados e, com --apply, removidos;
 *   - os contadores de id passam a continuar do maior id da nuvem.
 *
 * Os gatilhos de evento (trilha) ficam desligados só durante a gravação, na
 * mesma transação: o histórico importado não vira "cotação lançada agora".
 * O vínculo com o cadastro de fornecedores roda do jeito normal.
 *
 * Uso (simula por padrão; grava só com --apply):
 *   COMPRAS_CLOUD_URL=… COMPRAS_CLOUD_KEY=… \
 *   SUPABASE_INTERNAL_URL=http://181.224.8.145:8000 \
 *   node scripts/migrate-compras-cloud-to-local.mjs [--ensaio | --apply]
 *
 * A chave da nuvem é a mesma do app (as regras de lá liberam leitura). A cópia
 * extraída fica em ~/.config/pecsil/compras-snapshot.json (0600).
 *
 * DEPOIS DA VIRADA (plataforma passa a ser o sistema oficial), NÃO rode mais
 * com --apply: a nuvem sobrescreveria o que foi lançado na plataforma.
 */
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APLICAR = process.argv.includes("--apply");
/** Roda a transação inteira e desfaz no fim: prova o SQL sem mudar nada. */
const ENSAIO = process.argv.includes("--ensaio");
const ULTIMA_COPIA = "2026-09-03T19:00:00Z";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
    const t = linha.trim();
    const i = t.indexOf("=");
    if (!t || t.startsWith("#") || i < 0) continue;
    const chave = t.slice(0, i).trim();
    if (!(chave in env)) env[chave] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const NUVEM_URL = env.COMPRAS_CLOUD_URL;
const NUVEM_CHAVE = env.COMPRAS_CLOUD_KEY;
const LOCAL_URL = env.SUPABASE_INTERNAL_URL;
const LOCAL_CHAVE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!NUVEM_URL || !NUVEM_CHAVE || !LOCAL_URL || !LOCAL_CHAVE) {
  console.error("Defina COMPRAS_CLOUD_URL, COMPRAS_CLOUD_KEY, SUPABASE_INTERNAL_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/** Tabela da nuvem → tabela daqui, com as colunas que a nuvem manda. */
const TABELAS = [
  { nuvem: "cotacoes", local: "cotacoes", org: true },
  { nuvem: "cotacao_produtos", local: "cotacao_produtos", org: false },
  { nuvem: "compras", local: "compras", org: true },
  { nuvem: "notificacoes", local: "notificacoes_compras", org: true },
];
/** Só guardadas na cópia: a tela de ICMS ainda não existe na plataforma. */
const SO_COPIA = ["icms_planilhas", "icms_rows", "icms_livro"];

async function lerNuvem(tabela) {
  const linhas = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${NUVEM_URL}/rest/v1/${tabela}?select=*&order=id.asc&offset=${offset}&limit=1000`, {
      headers: { apikey: NUVEM_CHAVE, Authorization: `Bearer ${NUVEM_CHAVE}` },
    });
    if (!r.ok) throw new Error(`nuvem ${tabela}: HTTP ${r.status}`);
    const lote = await r.json();
    linhas.push(...lote);
    if (lote.length < 1000) return linhas;
  }
}

async function sql(query) {
  const r = await fetch(`${LOCAL_URL}/pg/query`, {
    method: "POST",
    headers: { apikey: LOCAL_CHAVE, Authorization: `Bearer ${LOCAL_CHAVE}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(texto.slice(0, 600));
  return JSON.parse(texto);
}

const literal = (valor) => `'${String(valor).replace(/'/g, "''")}'`;
const jsonb = (valor) => `${literal(JSON.stringify(valor))}::jsonb`;

// Compara valores vindos da API (número, ISO) e do Postgres (texto, "+00").
const normal = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v));
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d/.test(v)) return new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();
  return String(v);
};

// --- 1. Extração ----------------------------------------------------------
console.log(`Nuvem: ${new URL(NUVEM_URL).host.split(".")[0]} · ${APLICAR ? "GRAVANDO" : ENSAIO ? "ensaio (grava e desfaz)" : "simulação (use --apply para gravar)"}\n`);
const copia = { extraidoEm: new Date().toISOString(), tabelas: {} };
for (const nome of [...TABELAS.map((t) => t.nuvem), ...SO_COPIA]) copia.tabelas[nome] = await lerNuvem(nome);
const pasta = join(homedir(), ".config", "pecsil");
mkdirSync(pasta, { recursive: true, mode: 0o700 });
const arquivo = join(pasta, "compras-snapshot.json");
writeFileSync(arquivo, JSON.stringify(copia), { mode: 0o600 });
chmodSync(arquivo, 0o600);

const [{ id: organizacao }] = await sql("select id from public.organizations limit 1");

// --- 2. Comparação ----------------------------------------------------------
const relatorio = [];
const remover = {};
for (const tabela of TABELAS) {
  const nuvem = copia.tabelas[tabela.nuvem];
  const locais = await sql(`select * from public.${tabela.local}`);
  const porId = new Map(locais.map((l) => [String(l.id), l]));
  const idsNuvem = new Set(nuvem.map((n) => String(n.id)));
  let novas = 0, mudam = 0, iguais = 0;
  for (const n of nuvem) {
    const l = porId.get(String(n.id));
    if (!l) novas++;
    else if (Object.keys(n).some((c) => c in l && normal(n[c]) !== normal(l[c]))) mudam++;
    else iguais++;
  }
  const soAqui = locais.filter((l) => !idsNuvem.has(String(l.id)));
  // Só aqui e criado DEPOIS da última cópia: lançado na plataforma sobre dado velho.
  // Só aqui e criado ANTES: apagado depois na nuvem. Os dois saem.
  remover[tabela.local] = soAqui.map((l) => Number(l.id));
  relatorio.push({
    tabela: tabela.local,
    nuvem: nuvem.length,
    aqui: locais.length,
    novas,
    atualizadas: mudam,
    iguais,
    removidas: soAqui.length,
    removidasDepoisDaCopia: soAqui.filter((l) => new Date(l.created_at) > new Date(ULTIMA_COPIA)).map((l) => Number(l.id)),
  });
}
console.table(relatorio);

if (!APLICAR && !ENSAIO) {
  console.log(`\nCópia da nuvem em ${arquivo}. Nada foi gravado.`);
  process.exit(0);
}

// --- 3. Gravação (uma transação) -----------------------------------------
const colunas = (nome) => Object.keys(copia.tabelas[nome][0] ?? {});
const upsert = ({ nuvem, local, org }) => {
  const cols = colunas(nuvem);
  if (!cols.length) return "";
  const todas = org ? [...cols, "organization_id"] : cols;
  const origem = org
    ? `select ${cols.map((c) => `r.${c}`).join(", ")}, ${literal(organizacao)}::uuid as organization_id from jsonb_populate_recordset(null::public.${local}, ${jsonb(copia.tabelas[nuvem])}) r`
    : `select * from jsonb_populate_recordset(null::public.${local}, ${jsonb(copia.tabelas[nuvem])})`;
  return `
insert into public.${local} (${todas.join(", ")})
select ${todas.join(", ")} from (${origem}) x
on conflict (id) do update set ${cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")};`;
};

const script = `
begin;
alter table public.cotacoes disable trigger cotacoes_events;
alter table public.compras disable trigger compras_events;
${Object.entries(remover).filter(([, ids]) => ids.length).map(([t, ids]) => `delete from public.${t} where id in (${ids.join(",")});`).join("\n")}
${TABELAS.map(upsert).join("\n")}
alter table public.cotacoes enable trigger cotacoes_events;
alter table public.compras enable trigger compras_events;
-- Fornecedor em texto → cadastro (gatilho de fornecedor; o de evento só olha status).
update public.cotacoes set fornecedor = fornecedor where supplier_id is null and fornecedor is not null;
update public.compras set fornecedor = fornecedor where supplier_id is null and fornecedor is not null;
${TABELAS.map(({ local }) => `select setval(pg_get_serial_sequence('public.${local}', 'id'), greatest((select max(id) from public.${local}), 1));`).join("\n")}
${ENSAIO ? `select 'ensaio' as t, (select count(*) from public.cotacoes)::int as cotacoes, (select count(*) from public.cotacao_produtos)::int as itens,
  (select count(*) from public.compras)::int as compras, (select count(*) from public.notificacoes_compras)::int as notificacoes,
  (select count(*) from public.cotacoes where supplier_id is null)::int as cotacoes_sem_fornecedor;
rollback;` : "commit;"}`;

const resultado = await sql(script);
if (ENSAIO) {
  console.log("\nEnsaio: a transação rodou inteira e foi desfeita. Contagens dentro dela:");
  console.table(Array.isArray(resultado) ? resultado.filter((r) => r.t === "ensaio") : resultado);
  process.exit(0);
}

const depois = await sql(`
select 'cotacoes' t, count(*)::int n from public.cotacoes
union all select 'cotacao_produtos', count(*)::int from public.cotacao_produtos
union all select 'compras', count(*)::int from public.compras
union all select 'notificacoes_compras', count(*)::int from public.notificacoes_compras`);
console.log("\nGravado. Linhas agora:");
console.table(depois);
