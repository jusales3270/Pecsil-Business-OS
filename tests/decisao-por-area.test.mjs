import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regra do proprietário (16/10/2026): decisão do negócio vai para quem responde pela área, nunca
// para "só o proprietário". O proprietário cuida da construção e dos recursos da plataforma.
const sql = readFileSync(new URL("../supabase/migrations/202610160008_decisoes_por_area.sql", import.meta.url), "utf8");
/** Corpo da ÚLTIMA definição da função na migração (vale a que fica no banco). */
const corpo = (nome) => {
  const partes = sql.split(new RegExp(`create or replace function public\\.${nome}\\(`, "i"));
  assert.ok(partes.length > 1, `função ${nome} na migração`);
  const ultima = partes.at(-1);
  const fim = ultima.search(/\$(function)?\$;/);
  return ultima.slice(0, fim);
};

test("decisões de área não dependem do proprietário", () => {
  for (const nome of ["comercial_orcamento_definir_proximo", "comercial_treino_apagar", "finance_pode_decidir", "finance_aprovar_titulo", "finance_alcada_salvar", "indicadores_editar", "indicadores_desfazer_edicao", "indicadores_registrar", "indicadores_pode_medir"]) {
    assert.doesNotMatch(corpo(nome), /is_owner\(\)/, `${nome} não pode ter atalho do proprietário`);
  }
  assert.match(corpo("comercial_orcamento_definir_proximo"), /has_feature\('comercial\.orcamentos', 'operar'\)/);
  assert.match(corpo("fiscal_config_salvar"), /has_feature\('fiscal\.nfe', 'aprovar'\)/);
  assert.match(corpo("indicadores_editar"), /tem_permissao_da_area\(m\.responsavel_feature/);
});

test("linha de base: cada indicador tem a área que revisa", () => {
  const area = corpo("indicadores_area");
  for (const f of ["financeiro.receber", "financeiro.pagar", "compras.aprovacoes", "producao.entrada"]) assert.match(area, new RegExp(f.replace(".", "\\.")));
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pagina.match(/const OWNER_ONLY_VIEWS[^;]*;/)[0], /Linha de base/, "Linha de base não é tela só do proprietário");
});
