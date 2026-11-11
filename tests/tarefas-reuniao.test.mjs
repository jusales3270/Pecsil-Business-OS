import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { faltaPouco, juntarTrechos, motivoParaParar, relogio, REUNIAO, semAlucinacao } from "../lib/tarefas/reuniao.ts";

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("gravar reunião: 60 minutos (proprietário, 11/11/2026), pedaços de 50 s e o texto cabe no quadro", () => {
  assert.equal(REUNIAO.maxSegundos, 3600);
  assert.equal(REUNIAO.pedacoSegundos, 50);
  // O banco guarda até 60 mil caracteres no quadro (quadros.texto) e a leitura corta em 60 mil: a gravação para antes.
  assert.ok(REUNIAO.maxCaracteres < 60_000);
  assert.match(ler("supabase/migrations/202611100002_tarefas.sql"), /length\(texto\) <= 60000/);
  assert.equal(motivoParaParar(3599, 50_000), null);
  assert.equal(motivoParaParar(3600, 10), "tempo");
  assert.equal(motivoParaParar(1200, 58_000), "texto");
  assert.equal(faltaPouco(3000), null);
  assert.match(faltaPouco(3300), /Faltam 5 minutos para o limite de 60/);
  assert.match(faltaPouco(3550), /Faltam 1 minuto/);
  assert.equal(faltaPouco(3600), null);
});

test("relógio da gravação", () => {
  assert.equal(relogio(7), "0:07");
  assert.equal(relogio(754), "12:34");
  assert.equal(relogio(3600), "1:00:00");
  assert.equal(relogio(-3), "0:00");
});

test("o texto sai na ordem; trecho perdido vira marca com o horário; silêncio e o que está indo ficam de fora", () => {
  const texto = juntarTrechos([
    { i: 2, inicio: 100, fim: 150, situacao: "ok", texto: "O Rafa revisa o roteiro até sexta." },
    { i: 0, inicio: 0, fim: 50, situacao: "ok", texto: "Bom dia, vamos começar." },
    { i: 1, inicio: 50, fim: 100, situacao: "falhou" },
    { i: 3, inicio: 150, fim: 200, situacao: "silencio" },
    { i: 4, inicio: 200, fim: 250, situacao: "enviando" },
  ]);
  assert.equal(texto, "Bom dia, vamos começar.\n[trecho não transcrito 0:50–1:40]\nO Rafa revisa o roteiro até sexta.");
  assert.equal(juntarTrechos([]), "");
});

test("frases que o Whisper inventa no silêncio saem; fala de verdade fica", () => {
  assert.equal(semAlucinacao("Legendas pela comunidade Amara.org"), "");
  assert.equal(semAlucinacao("Obrigado por assistir!"), "");
  assert.equal(semAlucinacao("Obrigado."), "");
  assert.equal(semAlucinacao("  "), "");
  assert.equal(semAlucinacao("O Executor liga para a Cristal até sexta. Obrigado por assistir."), "O Executor liga para a Cristal até sexta.");
  assert.equal(semAlucinacao("Obrigado pela presença, a Ana confere o extrato amanhã."), "Obrigado pela presença, a Ana confere o extrato amanhã.");
});

test("gravar reunião: qualquer pessoa ativa transcreve, o áudio não é guardado, o texto não se perde", () => {
  const rota = ler("app/api/tarefas/transcrever/route.ts");
  assert.match(rota, /requireUserSession\(\)/);
  assert.match(rota, /status !== "active"/, "acesso inativo ou vencido não transcreve");
  assert.match(rota, /conferirAudio\(/);
  assert.doesNotMatch(rota, /storage|insert\(|upload/, "o áudio não é guardado");
  const tela = ler("app/components/gravar-reuniao.tsx");
  assert.match(tela, /Avise os presentes que a reunião está sendo transcrita/);
  assert.match(tela, /sessionStorage/, "o texto fica na aba até virar quadro");
  assert.match(tela, /beforeunload/, "recarregar gravando pergunta antes");
  assert.match(tela, /wakeLock/, "a tela não apaga sozinha");
  assert.match(tela, /REUNIAO\.tentativas/, "trecho que falha é tentado de novo");
  const tarefas = ler("app/components/tarefas.tsx");
  assert.match(tarefas, /lerAoAbrir=\{montar\.origem === "reuniao"\}/, "a reunião gravada já vai para a leitura da SARA");
  assert.match(ler("app/api/tarefas/route.ts"), /\["texto", "reuniao", "tela"\]/, "o quadro guarda a origem reunião");
});
