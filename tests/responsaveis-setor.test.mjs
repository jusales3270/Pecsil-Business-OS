import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./ts-resolver.mjs";

const { listaDeResponsaveis, opcoesComAtual, opcoesDoFiltro, rotuloDoResponsavel, semMarcacaoDoRh } = await import("../modules/portaria/src/lib/responsaveis.ts");
const ler = (c) => readFileSync(new URL(`../${c}`, import.meta.url), "utf8");

test("responsáveis: rótulo Nome · Setor; a lista antiga só enquanto o RH não marcar ninguém (diretores não contam)", () => {
  assert.equal(rotuloDoResponsavel({ nome: " Rosana ", setor: "Recursos Humanos " }), "Rosana · Recursos Humanos");
  const dir = { nome: "Ana Claudia", setor: "Diretoria", tipo: "diretor" };
  const rh = { nome: "Rosana", setor: "Recursos Humanos", tipo: "colaborador" };
  assert.deepEqual(listaDeResponsaveis([dir, rh], ["Almoxarifado", "Rosana"]), ["Ana Claudia · Diretoria", "Rosana · Recursos Humanos"]);
  assert.deepEqual(listaDeResponsaveis([dir], ["Almoxarifado", "Rosana"]), ["Ana Claudia · Diretoria", "Almoxarifado", "Rosana"]);
  assert.deepEqual(listaDeResponsaveis([], ["Almoxarifado"]), ["Almoxarifado"]);
  assert.equal(semMarcacaoDoRh([dir]), true);
  assert.equal(semMarcacaoDoRh([dir, rh]), false);
});

test("diretoria: todo diretor ativo entra nos responsáveis da Portaria; edição do usuário muda vínculo e cargo", () => {
  const m = ler("supabase/migrations/202611040003_portaria_responsaveis_diretoria.sql");
  assert.match(m, /p\.job_title = 'diretor' and p\.status = 'active'/);
  assert.match(m, /'Diretoria'::text as setor/);
  const rota = ler("app/api/admin/users/[id]/route.ts");
  assert.match(rota, /core\.access\.user\.profile_change/, "a mudança vai para a Auditoria");
  assert.match(rota, /kind === "administrativo" && !isJobTitle\(jobTitle\)/, "administrativo exige cargo");
  const tela = ler("app/components/user-management.tsx");
  assert.match(tela, /users\.filter\(\(user\) => user\.jobTitle === "diretor"\)/, "aba Diretoria");
  assert.match(tela, /className=\{user\.isOwner \? "user-admin-editar vazio" : "user-admin-editar"\}/, "botão Editar em cada linha");
  assert.match(ler("app/page.tsx"), /tab==="Diretoria" \? <UserManagement key="diretoria" diretoria/);
});

test("responsáveis: visita antiga mantém o gravado; o filtro inclui o histórico sem repetir", () => {
  const lista = ["Rosana · Recursos Humanos"];
  assert.deepEqual(opcoesComAtual(lista, "Ricardo"), ["Ricardo", "Rosana · Recursos Humanos"]);
  assert.deepEqual(opcoesComAtual(lista, "Rosana · Recursos Humanos"), lista);
  assert.deepEqual(opcoesComAtual(lista, undefined), lista);
  assert.deepEqual(opcoesDoFiltro(lista, ["Ricardo", "Ana Claudia", "Ricardo", "", "Rosana · Recursos Humanos"]), ["Rosana · Recursos Humanos", "Ana Claudia", "Ricardo"]);
});

test("responsáveis: banco com credencial própria, trava no update comum e lista só dos marcados", () => {
  const m = ler("supabase/migrations/202611040001_responsaveis_setor.sql");
  assert.match(m, /'rh\.responsaveis', 'rh', 'Responsáveis pelo setor', '\{ver,operar\}'/);
  assert.match(m, /feature_code = 'rh\.colaboradores' and g\.level >= 'operar'/, "começa com quem opera Colaboradores (RH)");
  assert.match(m, /'Ferramentaria', 'FERRAMENTARIA', true/);
  assert.match(m, /has_feature\('rh\.responsaveis', 'operar'\)/);
  assert.match(m, /before update of responsavel_setor on public\.employees/, "o update comum do cadastro não marca");
  assert.match(m, /e\.responsavel_setor and e\.active/, "demitido sai da lista");
  assert.match(m, /q\.ativo and q\.responsavel_setor is not null/, "terceiro fora do quadro sai da lista");
  assert.match(m, /emit_module_event/, "vai para a Auditoria");
});

test("responsáveis: rota exige a credencial; telas só mostram o check para quem opera", () => {
  assert.match(ler("app/api/rh/responsaveis/route.ts"), /requireFeature\("rh\.responsaveis", "operar"\)/);
  const hr = ler("app/components/hr-module.tsx");
  assert.match(hr, /canMarkResponsavel=\{canUseFeature\(access, "rh\.responsaveis", "operar"\)\}/);
  assert.match(hr, /podeMarcar=\{canUseFeature\(access, "rh\.responsaveis", "operar"\)\}/);
  assert.match(hr, /\.\.\.departmentNames, \.\.\.allPeople/, "departamentos do cadastro (Ferramentaria) mesmo sem ninguém lotado");
  assert.match(ler("modules/access-catalog.ts"), /code: "rh\.responsaveis"/);
  const portaria = ler("modules/portaria/src/App.tsx");
  assert.match(portaria, /fetchResponsaveis\(\)/);
  assert.doesNotMatch(portaria, /RESPONSAVEIS\.map|DESTINATARIOS/, "as listas da tela saem do banco");
});
