import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { TERMO_VERSAO, termoDoPortal } = await import("../lib/fiscal/portal-termo.ts");
const sql = readFileSync(new URL("../supabase/migrations/202610120004_fiscal_portal_escritorio.sql", import.meta.url), "utf8");

test("portal: o termo leva o nome da empresa (multiempresa) e a versão que o banco exige", () => {
  const termo = termoDoPortal("EMPRESA EXEMPLO LTDA").join(" ");
  assert.match(termo, /EMPRESA EXEMPLO LTDA/);
  assert.match(termo, /13\.709\/2018/);
  assert.match(termo, /registrado/);
  assert.doesNotMatch(termo, /pecsil/i);
  // O banco bloqueia o escritório até o aceite da MESMA versão.
  assert.ok(sql.includes(`versao = '${TERMO_VERSAO}'`), "fiscal_portal_exigir confere a versão vigente");
  assert.ok(sql.includes(`if p_versao <> '${TERMO_VERSAO}'`));
});

test("portal: escrita só pelas funções, que conferem o lado", () => {
  for (const t of ["fiscal_competencias", "fiscal_competencia_itens", "fiscal_malotes", "fiscal_pendencias", "fiscal_pendencia_mensagens", "fiscal_portal_anexos", "fiscal_checklist_modelo"]) {
    assert.ok(sql.includes(`'${t}'`), `${t} na lista com RLS e sem escrita direta`);
  }
  assert.match(sql, /revoke insert, update, delete on public\.%I from anon, authenticated/);
  // Ações só da empresa e só do escritório.
  for (const fn of ["fiscal_portal_competencia_abrir", "fiscal_portal_item", "fiscal_portal_malote_registrar"]) {
    const corpo = sql.slice(sql.indexOf(`function public.${fn}(`));
    assert.match(corpo.slice(0, 600), /fiscal_portal_exigir\('empresa'\)/, fn);
  }
  assert.match(sql.slice(sql.indexOf("function public.fiscal_portal_malote_receber(")).slice(0, 600), /fiscal_portal_exigir\('escritorio'\)/);
  // O escritório confere; só a empresa fecha.
  assert.match(sql, /lado = 'escritorio' and p_situacao = 'conferida' and c\.situacao = 'enviada'/);
  assert.match(sql, /lado = 'empresa' and p_situacao = 'fechada' and c\.situacao = 'conferida'/);
  // Auditoria e avisos não são chamáveis pelo cliente.
  assert.match(sql, /revoke all on function public\.fiscal_portal_auditar\([^)]*\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.fiscal_portal_avisar\([^)]*\) from public, anon, authenticated;/);
});

test("portal: LGPD — o escritório vê só totais e só os anexos do portal; downloads na auditoria", () => {
  const indicadores = sql.slice(sql.indexOf("function public.fiscal_portal_indicadores("));
  assert.match(indicadores, /count\(\*\)/);
  const corpoIndic = indicadores.slice(0, indicadores.indexOf("end;"));
  assert.doesNotMatch(corpoIndic, /select \*|jsonb_agg|array_agg|string_agg|fornecedor|emitente/, "só agregados, nunca as linhas");
  const baixar = sql.slice(sql.indexOf("function public.fiscal_portal_baixar("), sql.indexOf("function public.fiscal_portal_indicadores("));
  assert.match(baixar, /from public\.fiscal_portal_anexos a where a\.document_id = p_document/);
  assert.match(baixar, /'fiscal_portal\.download'[\s\S]*'sensitive'/);
  // Anexos do portal ficam com a funcionalidade própria (o escritório não enxerga o resto de Documentos).
  assert.match(sql, /'fiscal', 'fiscal\.portal', left\(p_original_name, 200\)/);
  // Aceite e acesso também vão para a auditoria.
  assert.match(sql, /'fiscal_portal\.aceite'/);
  assert.match(sql, /'fiscal_portal\.acesso'/);
  // Modelo do checklist genérico (multiempresa).
  assert.doesNotMatch(sql, /pecsil|46\.?839/i);
});
