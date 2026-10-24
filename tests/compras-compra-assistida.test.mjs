import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { foraDaCurva, mesmoItem, sugerirFornecedores, termos, unidadeNormal } from "../lib/compras/compra-assistida.ts";

const acoes = readFileSync(new URL("../lib/sara/acoes-areas.ts", import.meta.url), "utf8");
const rota = readFileSync(new URL("../app/api/sara/[modulo]/acoes/[id]/route.ts", import.meta.url), "utf8");
const guias = readFileSync(new URL("../lib/sara/guias-executar.ts", import.meta.url), "utf8");
const agente = readFileSync(new URL("../lib/sara/agentes/compras.ts", import.meta.url), "utf8");

const compra = (produto, fornecedor, preco, data, unidade = "kg", fornecedor_id = fornecedor) => ({ produto, fornecedor, fornecedor_id, cnpj: null, preco, unidade, data });
const cotado = (produto, fornecedor, data) => ({ produto, fornecedor, fornecedor_id: fornecedor, cnpj: null, preco: null, unidade: "kg", data, status: "PENDENTE" });

test("compra assistida: o mesmo item é achado pelo nome, com os números que distinguem", () => {
  assert.ok(mesmoItem("Ferro molibdênio 10/60", "FERRO MOLIBDÊNIO (60/65%) 10/60 MM - 200 KG"));
  assert.ok(mesmoItem("Lixa ferro grana 80", "LIXA FERRO GRANA 080 K246 NORTON"));
  assert.ok(mesmoItem("Oxigênio", "OXIGENIO INDUSTRIAL CIL 10M³"));
  // Parte I não é parte II; ferro titânio não é ferro molibdênio.
  assert.ok(!mesmoItem("Resina Comil CCS 10 parte I", "RESINA COMIL F.U SET CCS 20 PARTE II TB 210 KG"));
  assert.ok(mesmoItem("Resina Comil CCS 10 parte I", "RESINA COMIL F.U SET CCS 10 PARTE I TB 210 KG"));
  assert.ok(!mesmoItem("ferro titanio", "FERRO MOLIBDÊNIO (60/65%) 10/60 MM"));
  assert.ok(!mesmoItem("", "QUALQUER COISA"));
  // A quantidade que o sistema põe no fim não conta como número do item.
  assert.deepEqual(termos("FERRO SILÍCIO 75% 10/20 MM - 200kg"), { palavras: ["ferro", "silicio"], numeros: ["75", "10", "20"] });
  assert.equal(unidadeNormal("Pç"), "un");
  assert.equal(unidadeNormal("M³"), "m3");
});

test("compra assistida: sugere quem cobre mais itens, venda antes de cotação", () => {
  const comprados = [
    compra("FERRO MOLIBDÊNIO (60/65%) 10/60 MM", "Comil", 227, "2026-08-01"),
    compra("FERRO MOLIBDÊNIO (60/65%) 10/60 MM", "Comil", 244.74, "2026-09-10"),
    compra("FERRO VANÁDIO 50% 10/20 MM", "Comil", 137, "2026-08-05"),
    compra("FERRO VANÁDIO 50% 10/20 MM", "Metalurgica X", 198.99, "2026-09-20"),
  ];
  const cotados = [cotado("FERRO MOLIBDENIO 10/60", "Fornecedor Novo", "2026-10-01")];
  const s = sugerirFornecedores(["Ferro molibdênio 10/60", "Ferro vanádio 50% 10/20"], comprados, cotados);
  assert.equal(s[0].fornecedor, "Comil");
  assert.deepEqual(s[0].itens, ["Ferro molibdênio 10/60", "Ferro vanádio 50% 10/20"]);
  assert.equal(s[0].compras, 3);
  // O último preço pago é o mais recente, não o primeiro da lista.
  assert.equal(s[0].precos.find((p) => p.item === "Ferro molibdênio 10/60").ultimo, 244.74);
  assert.equal(s[1].fornecedor, "Metalurgica X");
  assert.equal(s.at(-1).fornecedor, "Fornecedor Novo");
  assert.equal(s.at(-1).compras, 0);
  assert.deepEqual(sugerirFornecedores(["Areia de fundição"], comprados, cotados), []);
});

test("compra assistida: preço fora da curva pela mediana das últimas compras, na mesma unidade", () => {
  const comprados = [
    compra("ESCORIFICANTE COMIL COESCOR SC 25KG", "Comil", 2.95, "2026-08-01"),
    compra("ESCORIFICANTE COMIL COESCOR SC 25KG", "Comil", 3.05, "2026-09-01"),
    compra("ESCORIFICANTE COMIL COESCOR SC 25KG", "Comil", 70, "2026-09-02", "un"), // saco: outra unidade, não entra
  ];
  const f = foraDaCurva("ESCORIFICANTE COMIL COESCOR SC 25KG", 3.6, "KG", comprados);
  assert.equal(f.referencia, 3);
  assert.equal(f.compras, 2);
  assert.ok(Math.abs(f.acima - 0.2) < 1e-9);
  assert.equal(foraDaCurva("ESCORIFICANTE COMIL COESCOR SC 25KG", 3.3, "kg", comprados), null); // 10%: dentro
  assert.equal(foraDaCurva("ESCORIFICANTE COMIL COESCOR SC 25KG", 3.6, "kg", comprados.slice(0, 1)), null); // 1 compra só
  assert.equal(foraDaCurva("ESCORIFICANTE COMIL COESCOR SC 25KG", 0, "kg", comprados), null);
  // Caso real (24/10): o calibre de 0,02 mm não se compara com o de 0,05 mm; o código do fabricante pode faltar.
  const calibres = [
    compra("CALIBRE DE FOLGA EM ROLO DE 5M 0,05MM - 4621-05 INSIZE", "World Tools", 98.4, "2026-08-01", "un"),
    compra("CALIBRE DE FOLGA EM ROLO DE 5M 0,05MM", "World Tools", 98.4, "2026-09-01", "un"),
  ];
  assert.equal(foraDaCurva("CALIBRE DE FOLGA EM ROLO DE 5M 0,02MM", 216.19, "un", calibres), null);
  assert.ok(foraDaCurva("CALIBRE DE FOLGA EM ROLO DE 5M 0,05MM", 125.51, "un", calibres));
  assert.deepEqual(termos("CALIBRE DE FOLGA EM ROLO DE 5M 0,02MM").numeros, ["5", "0.02"]);
  // Peso de embalagem não é número do item; medida de comprimento é.
  assert.deepEqual(termos("RESINA COMIL CCS 10 PARTE I TB 210KG").numeros, ["10"]);
  assert.deepEqual(termos("DISCO DE CORTE 115MM").numeros, ["115"]);
});

test("compra assistida: o link do convite aparece uma vez e nunca é gravado", () => {
  // A ação devolve o caminho fora de `dados` (que vai para o histórico da ação).
  assert.match(acoes, /umaVez: \{ rotulo: `Link para \$\{r\.fornecedor\.nome\}`, caminho: `\/cotar\/\$\{c\.codigo\}` \}/);
  assert.doesNotMatch(acoes.slice(acoes.indexOf("const CONVIDAR_FORNECEDOR"), acoes.indexOf("// --- Fiscal")), /feito: `[^`]*codigo/);
  // A rota grava só `resultado` (dados) e manda o link na resposta.
  assert.match(rota, /sara_acao_concluir", \{ p_id: id, p_ok: ok, p_resultado: resultado/);
  assert.match(rota, /abrir, umaVez \}\)/);
  // A guia nunca faz sozinha uma ação que só serve com a pessoa presente.
  assert.match(acoes, /nivel: "operar", modulos: \["compras"\], soComPessoa: true/);
  assert.match(guias, /!f\.acao\?\.soComPessoa/);
  // O aviso de pedido novo só propõe o convite; nada é feito sem o Permitir.
  assert.match(agente, /propor: \{ ferramenta: "convidar_fornecedor"/);
});
