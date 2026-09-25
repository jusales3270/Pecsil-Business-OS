import assert from "node:assert/strict";
import test from "node:test";
import {
  classificar,
  normalizarCid,
  normalizarNome,
  parseData,
  parseDuracao,
  parseHistorico,
  parseIntervalo,
} from "../lib/rh/historico-parser.ts";

// Dados fictícios: nenhum nome, diagnóstico ou CID daqui existe no arquivo real.
const arquivo = (ferias, afastamento) => `# Histórico

## FULANO DE TAL

Aba: \`FULANO\`

### Alteração De Salário

| DATA | VALOR | MOTIVO | FUNÇÃO |
|---|---|---|---|
| 01/09/2024 | R$ 10,00 | Dissidio |  |

### Histórico De Férias

| PERÍODO AQUISITIVO | PERÍODO DE GOZO | DIAS |
|---|---|---|
${ferias.join("\n")}

### Histórico De Afastamento

| MOTIVO | DATA INICIO | DATA FIM | DIAS | OBS | CID |
|---|---|---|---|---|---|
${afastamento.join("\n")}
`;

test("data só entra se for data de calendário", () => {
  assert.equal(parseData("24/11/2021"), "2021-11-24");
  for (const quebrada of ["2005/2019", "24/11//2021", "06/05/20251", "08/05/205", "31/02/2024", "007/06/2023", ""]) {
    assert.equal(parseData(quebrada), null, quebrada);
  }
  assert.deepEqual(parseIntervalo("14/05/2026 a28/05/2026"), { start: "2026-05-14", end: "2026-05-28" });
  assert.deepEqual(parseIntervalo("09/01/2025  A 08/01/2026"), { start: "2025-01-09", end: "2026-01-08" });
  assert.equal(parseIntervalo("20/05/2026 a 10/05/2026"), null, "fim antes do início");
});

test("duração em dias, horas, minutos e meio período", () => {
  assert.deepEqual(parseDuracao("2 dias", 2), { days: 2, hours: null, dayPart: null, note: null });
  assert.equal(parseDuracao("2H50", 1).hours, 2.83);
  assert.equal(parseDuracao("0h50 - compensou", 1).note, "compensou");
  assert.equal(parseDuracao("40 min", 1).hours, 0.67);
  assert.equal(parseDuracao("Período da tarde", 1).dayPart, "tarde");
  assert.equal(parseDuracao("Perído da tarde", 1).dayPart, "tarde");
  assert.equal(parseDuracao("", 3).days, 3, "vazio usa as datas");
  assert.equal(parseDuracao("dia todo", 1).days, 1);
  // Não adivinha.
  for (const ambigua of ["3h5", "10,5 dias", "1 1/2 dia", "3 dias e 2h00", "5 dias (2 dias)"]) {
    assert.ok("error" in parseDuracao(ambigua, 1), ambigua);
  }
  assert.ok("error" in parseDuracao("1h45", 6), "horas espalhadas em seis dias");
});

test("tipo sai do motivo, sem depender de acento ou caixa", () => {
  assert.equal(classificar("Consulta c/afastamento (qualquer coisa)"), "medical_certificate");
  assert.equal(classificar("Consultac/afastamento"), "medical_certificate");
  assert.equal(classificar("Consulta médica"), "attendance_statement");
  assert.equal(classificar("Exame periódico"), "occupational_exam");
  assert.equal(classificar("Declaração acompanhamento filha"), "family_care");
  assert.equal(classificar("Doação de sangue"), "legal_leave");
  assert.equal(classificar("Delaração atestado óbito tio"), "legal_leave");
  assert.equal(classificar("Auxilio Paternidade"), "legal_leave");
  assert.equal(classificar("Declaração policia federal - retirar documento"), "justified_absence");
  assert.equal(classificar("Afastamento INSS"), "inss_leave");
  assert.equal(classificar("Licença maternida"), "maternity_leave");
  assert.equal(classificar("Acidente de trabalho"), "work_accident");
  assert.equal(classificar("Algo que ninguém previu"), null);
});

test("CID padronizado; o que não é CID fica à parte", () => {
  assert.deepEqual(normalizarCid("H102"), { codes: ["H10.2"], invalid: [] });
  assert.deepEqual(normalizarCid("Z76.3"), { codes: ["Z76.3"], invalid: [] });
  assert.deepEqual(normalizarCid("A01.1/B02"), { codes: ["A01.1", "B02"], invalid: [] });
  assert.deepEqual(normalizarCid("CID K08"), { codes: ["K08"], invalid: [] });
  assert.deepEqual(normalizarCid("Z 76.3"), { codes: ["Z76.3"], invalid: [] });
  assert.deepEqual(normalizarCid("S/CID"), { codes: [], invalid: [] });
  assert.deepEqual(normalizarCid("Raio-X"), { codes: [], invalid: ["Raio-X"] });
});

test("nome do cadastro e da planilha se encontram sem acento nem caixa", () => {
  assert.equal(normalizarNome("Júlio  César"), normalizarNome("JULIO CÉSAR"));
  assert.equal(normalizarNome("FULANO (aba modelo)"), "FULANO");
});

test("diagnóstico e CID não vão para o texto público", () => {
  const { employees, problems } = parseHistorico(arquivo([], [
    "| Consulta c/afastamento (Doença inventada) | 10/02/2025 | 12/02/2025 | 3 dias | 1 dia SAB | A01.1 |",
    "| Declaração policia federal | 03/03/2025 | 03/03/2025 | 2h00 | Justificado |  |",
  ]));
  assert.deepEqual(problems, []);
  const [saude, civil] = employees[0].absences;
  assert.equal(saude.type, "medical_certificate");
  assert.equal(saude.reason, "Atestado médico");
  assert.ok(!saude.reason.includes("inventada") && !saude.reason.includes("A01"));
  assert.deepEqual(saude.clinical, { cidCodes: ["A01.1"], diagnosis: "Consulta c/afastamento (Doença inventada)", note: "1 dia SAB" });
  assert.equal(saude.days, 3);
  // Fora da saúde, o motivo e a observação são públicos, e não há dado clínico.
  assert.equal(civil.type, "justified_absence");
  assert.equal(civil.reason, "Declaração policia federal · Justificado");
  assert.equal(civil.clinical, null);
  assert.equal(civil.hours, 2);
  assert.equal(civil.days, 0);
});

test("separador, repetida e linha quebrada", () => {
  const { employees, problems } = parseHistorico(arquivo([], [
    "| X-X-X--X--X-X |  |  |  |  |  |",
    "| PRÓXIMA PÁGINA |  |  |  |  |  |",
    "| Consulta médica | 16/03/2021 | 16/03/2021 | 1h00 |  |  |",
    "| Consulta médica | 16/03/2021 | 16/03/2021 | 1h00 |  |  |",
    "| Consulta médica | 2005/2019 | 2005/2019 | 1h00 |  |  |",
    "| Coisa sem regra (detalhe) | 01/01/2024 | 01/01/2024 | 1 dia |  |  |",
  ]));
  assert.equal(employees[0].absences.length, 1);
  assert.equal(employees[0].duplicates, 1);
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /início inválida/);
  const bloqueio = problems.find((p) => p.blocking);
  assert.ok(bloqueio, "motivo sem regra bloqueia");
  assert.ok(!bloqueio.message.includes("detalhe"), "o relatório não mostra o que está entre parênteses");
});

test("férias fracionadas, abono e período ainda sem gozo", () => {
  const { employees, problems } = parseHistorico(arquivo([
    "| 23/05/2023 A 22/05/2024 | 03/03/2025 a 17/03/2025 | 15 |",
    "| 23/05/2023 A 22/05/2024 | 15/04/2025 a 29/04/2025 | 15 |",
    "| 01/03/2021 a 28/02/2022 | 01/02/2023 a 20/02/2023 | 20 |",
    "| 01/03/2021 a 28/02/2022 | Abono pecuniário | 10 |",
    "| 01/03/2025 a 28/02/2026 |  |  |",
  ], []));
  assert.deepEqual(problems, []);
  const [fracionada, comAbono, semGozo] = employees[0].vacations;
  assert.equal(fracionada.gozos.length, 2);
  assert.equal(fracionada.expiresAt, "2025-05-22", "concessivo: 12 meses após o aquisitivo");
  assert.equal(comAbono.pecuniaryDays, 10);
  assert.equal(comAbono.gozos[0].days, 20);
  assert.equal(semGozo.gozos.length, 0);
});

test("período que passa de 30 dias ou com dias errados vai para o relatório inteiro", () => {
  const { employees, problems } = parseHistorico(arquivo([
    "| 26/03/2023 a 25/03/2024 | 20/02/2025 a 21/03/2025 | 30 |",
    "| 26/03/2023 a 25/03/2024 | 19/02/2026 a 20/03/2026 | 30 |",
    "| 01/01/2020 a 31/12/2020 | 01/02/2021 a 10/02/2021 | 15 |",
  ], []));
  assert.equal(employees[0].vacations.length, 0);
  assert.equal(problems.length, 2);
  assert.match(problems[0].message, /somam 60 dias/);
  assert.match(problems[1].message, /não bate/);
});
