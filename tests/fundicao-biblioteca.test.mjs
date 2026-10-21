import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { parseDesenhos, planejar, extensao, caminhoArquivo } = await import("../lib/forja/desenhos-core.ts");
const { agruparPorPeca, revisoesAtuais, termoDeBusca, lerEnvioAcervo, conferirArquivo, compararRevisao } = await import("../lib/fundicao/biblioteca-regras.ts");
const { createForjaSession } = await import("../lib/forja/forja-session.ts");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// Formato de GET /api/integracao/desenhos da Forja.
const daForja = (extra = {}) => ({
  id: "d-1", tipo: "forma", codigoDesenho: "DES-1", revisao: "B", dataRevisao: "2026-09-01T00:00:00.000Z", observacoes: null,
  arquivoKey: "k-1.pdf", arquivoTipo: "application/pdf", arquivoTamanho: 1234, arquivoNomeOriginal: "forma.pdf", atualizadoEm: "2026-10-01T10:00:00.000Z",
  artigo: { id: "a-1", codigo: "5-01-0001", descricao: "FORMA 1", tipoProduto: "forma", ativo: true },
  cliente: { id: "c-1", nome: "VERALLIA" },
  fundicao: { prevista: true, primeiraEm: "2026-10-01T10:00:00.000Z", ultimaEm: "2026-10-05T10:00:00.000Z", os: ["OS-2", "OS-1"] },
  ...extra,
});
const gravado = (d, extra = {}) => ({ id: `g-${d.forja_desenho_id}`, ...d, forja_arquivo_key: d.forja_arquivo_key, removido_na_forja_em: null, tem_arquivo: true, ...extra });

test("desenhos da Forja: lidos com selo da Fundição; sem arquivo, sem id ou sem artigo saem", () => {
  const { desenhos, rejeitados } = parseDesenhos([daForja(), daForja({ id: "d-2", arquivoKey: null }), daForja({ id: null }), daForja({ id: "d-3", artigo: {} }), daForja({ id: "d-4", tipo: "esquisito" })]);
  assert.equal(rejeitados, 3);
  assert.equal(desenhos.length, 2);
  const [d] = desenhos;
  assert.equal(d.artigo_codigo, "5-01-0001");
  assert.equal(d.data_revisao, "2026-09-01");
  assert.equal(d.fundicao_prevista, true);
  assert.deepEqual(d.os_codigos, ["OS-1", "OS-2"]);
  assert.equal(d.forja_arquivo_key, "k-1.pdf");
  assert.equal(desenhos[1].tipo, "outro", "tipo desconhecido vira outro");
});

test("plano: novo baixa; chave trocada baixa de novo; igual não mexe; sumiu fica marcado; voltou desmarca", () => {
  const [a] = parseDesenhos([daForja()]).desenhos;
  const [b] = parseDesenhos([daForja({ id: "d-2" })]).desenhos;
  const [c] = parseDesenhos([daForja({ id: "d-3" })]).desenhos;
  const lista = [a, { ...b, forja_arquivo_key: "k-novo.pdf" }, c];
  const plano = planejar(lista, [
    gravado(b),
    gravado(c, { removido_na_forja_em: "2026-10-10T00:00:00Z" }),
    gravado({ ...a, forja_desenho_id: "sumiu" }),
  ]);
  assert.deepEqual(plano.novos.map((d) => d.forja_desenho_id), ["d-1"]);
  assert.deepEqual(plano.baixar.map((x) => x.forja_desenho_id).sort(), ["d-1", "d-2"]);
  assert.deepEqual(plano.removidos, ["g-sumiu"]);
  assert.deepEqual(plano.voltaram, ["g-d-3"]);
  assert.equal(plano.alterados.length, 0);
});

test("plano: campo alterado na Forja (selo da Fundição) atualiza; sem arquivo guardado baixa", () => {
  const [a] = parseDesenhos([daForja()]).desenhos;
  const plano = planejar([{ ...a, ultima_fundicao_em: "2026-10-20T10:00:00.000Z" }], [gravado(a, { tem_arquivo: false, ultima_fundicao_em: "2026-10-05T10:00:00+00:00" })]);
  assert.equal(plano.alterados.length, 1);
  assert.deepEqual(plano.baixar.map((x) => x.forja_desenho_id), ["d-1"]);
  const igual = planejar([a], [gravado(a, { primeira_fundicao_em: "2026-10-01T10:00:00+00:00", os_codigos: ["OS-2", "OS-1"] })]);
  assert.equal(igual.iguais, 1, "data em outro formato e lista em outra ordem não contam como mudança");
});

test("arquivo guardado por sha256 no caminho da organização", () => {
  assert.equal(extensao("application/pdf; charset=binary", "x"), "pdf");
  assert.equal(extensao(null, "scan.JPG"), "jpg");
  assert.equal(extensao(null, "sem"), "bin");
  assert.equal(caminhoArquivo("org", "des", "abc", "pdf"), "org/des/abc.pdf");
});

test("revisão atual por peça, tipo e código; removido não conta", () => {
  const base = { artigo_chave: "P1", tipo: "forma", codigo: "D1", removido_na_forja_em: null };
  const atuais = revisoesAtuais([
    { ...base, id: "a", revisao: "B", data_revisao: null },
    { ...base, id: "b", revisao: "C", data_revisao: null },
    { ...base, id: "c", revisao: "D", data_revisao: null, removido_na_forja_em: "2026-10-01" },
    { ...base, id: "d", tipo: "cliente", revisao: "1", data_revisao: "2026-01-01" },
    { ...base, id: "e", tipo: "cliente", revisao: "9", data_revisao: "2025-01-01" },
  ]);
  assert.deepEqual([...atuais].sort(), ["b", "d"]);
  assert.ok(compararRevisao("10", "2") > 0, "número compara como número");
});

test("agrupa por peça com o selo de Fundição mais recente e a versão atual primeiro", () => {
  const d = (id, extra) => ({ id, origem: "forja", artigo_codigo: "5-01-1", artigo_chave: "5-01-1", artigo_descricao: "FORMA", cliente_nome: "PARGLASS", tipo: "forma", codigo: "D", revisao: "A", data_revisao: null,
    observacoes: null, fundicao_prevista: false, primeira_fundicao_em: null, ultima_fundicao_em: null, os_codigos: [], removido_na_forja_em: null, enviado_por: null, enviado_por_nome: null, created_at: "2026-10-01", ...extra });
  const [peca] = agruparPorPeca(
    [d("x", { ultima_fundicao_em: "2026-10-02", os_codigos: ["OS-1"] }), d("y", { revisao: "B", fundicao_prevista: true, ultima_fundicao_em: "2026-10-09", os_codigos: ["OS-3"] })],
    [{ id: "v1", desenho_id: "y", recebido_em: "2026-10-01", substituido_em: "2026-10-05" }, { id: "v2", desenho_id: "y", recebido_em: "2026-10-05", substituido_em: null }],
  );
  assert.equal(peca.fundidaEm, "2026-10-09");
  assert.deepEqual(peca.os, ["OS-1", "OS-3"]);
  assert.equal(peca.desenhos[0].id, "y", "revisão atual primeiro");
  assert.deepEqual(peca.desenhos[0].versoes.map((v) => v.id), ["v2", "v1"]);
});

test("busca segura para o filtro do banco", () => {
  assert.equal(termoDeBusca("a"), null);
  assert.equal(termoDeBusca(" forma, (x)*% "), "forma x");
  assert.equal(termoDeBusca(42), null);
});

test("envio de desenho antigo: exige peça e código; só PDF/PNG/JPEG até 50 MB", () => {
  const form = (campos) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
  assert.equal(lerEnvioAcervo(form({ codigo: "D" })).ok, false);
  assert.equal(lerEnvioAcervo(form({ artigo_codigo: "5-01-1" })).ok, false);
  const ok = lerEnvioAcervo(form({ artigo_codigo: "5-01-1", codigo: "ANT", tipo: "forma", data_revisao: "2020-05-01", product_id: "não-é-uuid" }));
  assert.equal(ok.ok, true);
  assert.equal(ok.dados.product_id, null);
  assert.equal(ok.dados.tipo, "forma");
  assert.equal(conferirArquivo({ type: "application/pdf", size: 10, name: "a.pdf" }).ok, true);
  assert.equal(conferirArquivo({ type: "application/zip", size: 10, name: "a.zip" }).ok, false);
  assert.equal(conferirArquivo({ type: "image/png", size: 51 * 1024 * 1024, name: "a.png" }).ok, false);
});

test("sessão da Forja: arquivo vem cru (sem JSON), com a chave atual; 404 vira null", async () => {
  const pedidos = [];
  const transport = async (r) => {
    pedidos.push(r);
    if (r.path === "/api/auth/login") return { status: 200, body: { data: { token: "t" } } };
    if (r.path.endsWith("/sumiu/arquivo")) return { status: 404, body: null };
    return { status: 200, body: Buffer.from("%PDF"), headers: { "content-type": "application/pdf", "x-arquivo-key": "k-9.pdf" } };
  };
  const forja = createForjaSession({ transport, credentials: { code: "c", pin: "p" } });
  const a = await forja.getArquivo("/api/integracao/desenhos/d-1/arquivo");
  assert.equal(a.dados.toString(), "%PDF");
  assert.equal(a.chave, "k-9.pdf");
  assert.equal(pedidos.at(-1).binario, true);
  assert.equal(await forja.getArquivo("/api/integracao/desenhos/sumiu/arquivo"), null);
});

test("rotas da Biblioteca: sessão de quem pede, sem chave de serviço; arquivo só depois da função do banco", () => {
  const rotas = ["app/api/fundicao/biblioteca/route.ts", "app/api/fundicao/biblioteca/arquivo/[id]/route.ts", "app/api/fundicao/biblioteca/notas/route.ts", "app/api/fundicao/biblioteca/acervo/route.ts", "app/api/fundicao/biblioteca/pecas/route.ts"];
  for (const r of rotas) {
    const src = ler(r);
    assert.doesNotMatch(src, /createSupabaseAdminClient|SERVICE_ROLE/, `${r}: sem chave de serviço na rota`);
    assert.match(src, /requireFeature\("fundicao\.biblioteca", "(ver|operar)"\)/, `${r}: exige a Biblioteca`);
  }
  const arquivo = ler("app/api/fundicao/biblioteca/arquivo/[id]/route.ts");
  assert.ok(arquivo.indexOf("fundicao_arquivo_abrir") < arquivo.indexOf("lerArquivo(a.storage_path)"), "confere e registra antes de ler o arquivo");
  for (const r of ["notas/route.ts", "acervo/route.ts", "pecas/route.ts"]) assert.doesNotMatch(ler(`app/api/fundicao/biblioteca/${r}`), /requireFeature\("fundicao\.biblioteca", "ver"\)/, `${r}: escrever exige operar`);
});

test("migração: bucket privado, leitura pela Biblioteca, escrita só pelas funções e download no histórico", () => {
  const m = ler("supabase/migrations/202610210001_fundicao_biblioteca.sql");
  assert.match(m, /\('fundicao-desenhos', 'fundicao-desenhos', false, 52428800\)/);
  assert.doesNotMatch(m, /on storage\.objects/, "sem política de usuário no bucket");
  assert.match(m, /revoke insert, update, delete on public\.fundicao_desenhos, public\.fundicao_desenho_arquivos, public\.fundicao_notas from anon, authenticated/);
  assert.equal((m.match(/has_feature\('fundicao\.biblioteca'\)\)\);/g) ?? []).length, 3, "as três tabelas leem pela Biblioteca");
  assert.match(m, /if p_baixar then\s+perform public\.emit_module_event\(org, 'fundicao', 'fundicao\.desenho\.baixado'/);
  assert.match(m, /if d\.origem <> 'acervo' then raise exception/, "desenho da Forja não se apaga pela Biblioteca");
  assert.match(m, /create unique index if not exists uq_fundicao_desenho_arquivo_atual on public\.fundicao_desenho_arquivos \(desenho_id\) where substituido_em is null/);
});

test("sincronização dos desenhos: depois do espelho das OS, falha vira aviso", () => {
  const rota = ler("app/api/producao/sync-os/route.ts");
  assert.ok(rota.indexOf("sincronizarOrdens(admin") < rota.indexOf("sincronizarDesenhos(admin"));
  assert.match(rota, /desenhos = \{ erro: e instanceof Error \? e\.message : String\(e\) \}/);
  const sync = ler("lib/forja/sync-desenhos.ts");
  assert.match(sync, /const LIMITE_ARQUIVOS = 30;/);
  assert.match(sync, /getData\("\/api\/integracao\/desenhos"\)/);
  assert.doesNotMatch(sync, /\.delete\(\)/, "nada que veio da Forja é apagado aqui");
});
