import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const raiz = new URL("../../../", import.meta.url);
const ler = (p) => readFile(new URL(p, raiz), "utf8");
const manifest = await ler("modules/logistica/manifest.ts");
const catalogo = await ler("modules/access-catalog.ts");
const mig = await ler("supabase/migrations/202610200001_logistica_entregas.sql");

async function rotas(dir) {
  const fora = [];
  for (const e of await readdir(new URL(dir, raiz), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) fora.push(...await rotas(p));
    else if (e.name === "route.ts") fora.push([p, await ler(p)]);
  }
  return fora;
}

test("logística: módulo ativo, protegido e com a permissão no banco", () => {
  assert.match(manifest, /id: "logistica"/);
  assert.match(manifest, /entryPermission: LOGISTICA_PERMISSIONS\.view/);
  assert.match(catalogo, /code: "logistica\.entregas"/);
  assert.match(mig, /\('logistica\.entregas', 'logistica', 'Entregas e mapa ao vivo', '\{ver,operar\}', 10\)/);
});

test("logística: toda rota exige a permissão, menos o aviso do Fleetbase, que exige o token", async () => {
  for (const [p, src] of await rotas("app/api/logistica")) {
    if (p.endsWith("/aviso/route.ts")) {
      assert.match(src, /mesmoToken\(/, "o aviso confere o token");
      assert.match(src, /conferirAbertas\(true/, "o aviso só dispara a conferência");
      assert.doesNotMatch(src, /logistica_conferir/, "o aviso não grava o que veio nele");
      continue;
    }
    assert.match(src, /requireFeature\("logistica\.entregas", "(ver|operar)"\)/, p);
    assert.doesNotMatch(src, /createSupabaseAdminClient|SERVICE_ROLE/, `${p}: sem chave de serviço na rota`);
  }
});

test("logística: a chave do Fleetbase nunca vai para o navegador", async () => {
  const fleet = await ler("lib/logistica/fleetbase.ts");
  assert.match(fleet, /^import "server-only";/);
  assert.doesNotMatch(fleet + (await ler("lib/logistica/servidor.ts")), /NEXT_PUBLIC_/);
  for (const arq of await readdir(new URL("modules/logistica/src", raiz))) {
    assert.doesNotMatch(await ler(`modules/logistica/src/${arq}`), /FLEETBASE_API_KEY|lib\/logistica\/fleetbase/, arq);
  }
});

test("logística: o simulador só roda contra o Fleetbase local", async () => {
  const sim = await ler("scripts/fleetbase-simular-rota.mjs");
  assert.match(sim, /localhost\|127\\\.0\\\.0\\\.1/);
  assert.match(sim, /process\.exit\(1\)/);
});

test("logística: link do cliente só pelo hash, leitura só do servidor, sem dados do motorista", async () => {
  const mig = await ler("supabase/migrations/202610200002_logistica_link_cliente.sql");
  assert.match(mig, /token_hash\s+text not null unique/);
  assert.match(mig, /revoke all on public\.logistica_links from anon, authenticated;/);
  assert.doesNotMatch(mig.match(/grant select \(([^)]*)\)/)[1], /token_hash/, "o hash não sai para a tela");
  assert.match(mig, /revoke all on function public\.logistica_link_ler\(text\) from public, anon, authenticated;\s*grant execute on function public\.logistica_link_ler\(text\) to service_role;/);
  const rota = await ler("app/api/rastreio/[codigo]/route.ts");
  assert.match(rota, /rastreioParaCliente\(lido, posicao, andamento\)/, "a resposta passa pela lista fechada");
  assert.match(rota, /rastreioGuardado\(ordem\)/, "a rota do cliente usa a guarda de 3 min");
  assert.doesNotMatch(rota, /NextResponse\.json\(lido|NextResponse\.json\(data/, "nunca devolve a leitura crua (com a ordem e o motorista)");
});

test("logística: o nginx do Fleetbase fecha a consulta pública por número de rastreio", async () => {
  const conf = await ler("infra/fleetbase/vhost.conf");
  assert.match(conf, /location \^~ \/int\/v1\/fleet-ops\/lookup \{\s*return 404;/);
  const modelo = await ler("infra/fleetbase/docker-compose.override.example.yml");
  assert.doesNotMatch(modelo, /flb_live_|AIza[0-9A-Za-z_-]{20}|[0-9a-f]{32}/, "o modelo não leva segredo");
});

