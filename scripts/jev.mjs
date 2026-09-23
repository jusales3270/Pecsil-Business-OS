#!/usr/bin/env node
/**
 * Consulta o Jev (TypeSafe · System One) e imprime a resposta DELE em AZUL.
 *
 * Regra da casa: tudo que sai do Jev aparece em azul; o que é do Claude segue
 * na cor normal do terminal. Assim dá para saber, de bater o olho, de onde veio
 * cada julgamento. Mensagens de erro também ficam fora do azul: falha de rede
 * ou de chave é do serviço, não é julgamento do Jev.
 *
 *   node scripts/jev.mjs "<estado/texto>" <pergunta...>
 *
 * Tipos de pergunta (contrato em https://docs.typesafe.ai/api.md):
 *
 *   noul:<nome>=<pergunta>[|<quando é verdade>;<quando é falso>]
 *       → valor de 0 a 1 (o quanto a afirmação é verdadeira)
 *
 *   choice:<nome>=<pergunta>|<opção[:descrição]>,<opção[:descrição]>,...
 *       → escolhe uma opção, com probabilidade de cada uma e confiança
 *
 *   score:<nome>=<pergunta>|<nível menor>,<nível médio>,<nível maior>
 *       → nota entre os níveis (2 a 10 níveis, em ordem), com confiança
 *
 * Exemplos:
 *
 *   node scripts/jev.mjs "BOMBANA DE LORENZI | BOMBANA E DE LORENZI S.R.L" \
 *     "noul:mesma_empresa=Os dois nomes se referem à mesma empresa?"
 *
 *   node scripts/jev.mjs "Compra de rolamento para a fundição" \
 *     "choice:destino=Classifique o gasto|producao:insumo ou peça de produção,manutencao:conserto de máquina,administrativo:escritório"
 *
 *   node scripts/jev.mjs "Máquina parada há 6 horas, OS urgente atrasada" \
 *     "score:gravidade=Qual a gravidade para a fábrica?|baixa,média,alta"
 *
 * A chave sai de TYPESAFE_API_KEY (.env.local ou ambiente). Nada é gravado em disco.
 */
import { existsSync, readFileSync } from "node:fs";

const AZUL = "\x1b[38;5;39m";
const AZUL_FORTE = "\x1b[1;38;5;33m";
const CINZA = "\x1b[2m";
const FIM = "\x1b[0m";
const azul = (texto) => `${AZUL}${texto}${FIM}`;
const cinza = (texto) => `${CINZA}${texto}${FIM}`;
const pct = (valor) => `${Math.round(valor * 100)}%`;

function lerChave() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  if (!existsSync(".env.local")) return "";
  for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
    const texto = linha.trim();
    if (texto.startsWith("TYPESAFE_API_KEY=")) {
      return texto.slice("TYPESAFE_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

/** "producao:insumo de produção" → ["producao", "insumo de produção"]. Sem descrição, o rótulo serve de critério. */
function opcao(item) {
  const separador = item.indexOf(":");
  const rotulo = (separador < 0 ? item : item.slice(0, separador)).trim();
  const descricao = separador < 0 ? rotulo : item.slice(separador + 1).trim();
  return [rotulo, descricao || rotulo];
}

/** "tipo:nome=pergunta|extras" → entrada da API. */
function interpretar(argumento) {
  const igual = argumento.indexOf("=");
  if (igual < 0) throw new Error(`Pergunta sem "=": ${argumento}`);
  const [tipo, nome] = argumento.slice(0, igual).split(":");
  const corpo = argumento.slice(igual + 1);
  const barra = corpo.indexOf("|");
  const instructions = (barra < 0 ? corpo : corpo.slice(0, barra)).trim();
  const extras = barra < 0 ? "" : corpo.slice(barra + 1).trim();
  if (!nome || !instructions) throw new Error(`Pergunta incompleta: ${argumento}`);

  if (tipo === "noul") {
    if (!extras) return [nome, { type: "noul", instructions }];
    const [verdadeiro, falso] = extras.split(";").map((parte) => parte.trim());
    return [nome, { type: "noul", instructions, criteria: { true: verdadeiro, false: falso ?? "" } }];
  }
  if (tipo === "choice") {
    if (!extras) throw new Error(`"choice" precisa das opções depois de "|": ${argumento}`);
    return [nome, { type: "choice", instructions, criteria: Object.fromEntries(extras.split(",").map(opcao)) }];
  }
  if (tipo === "score") {
    const niveis = extras.split(",").map((nivel) => nivel.trim()).filter(Boolean);
    if (niveis.length < 2) throw new Error(`"score" precisa de 2 a 10 níveis em ordem: ${argumento}`);
    return [nome, { type: "score", instructions, criteria: niveis }];
  }
  throw new Error(`Tipo desconhecido "${tipo}" (use noul, choice ou score).`);
}

/** Probabilidades em uma linha, da maior para a menor. */
function distribuicao(probabilidades, legenda) {
  if (!probabilidades) return "";
  const itens = Object.entries(probabilidades)
    .filter(([, valor]) => valor > 0.005)
    .sort(([, a], [, b]) => b - a)
    .map(([chave, valor]) => `${legenda?.[chave] ?? chave} ${pct(valor)}`);
  return itens.length ? cinza(`    ${itens.join(" · ")}`) : "";
}

/** Uma resposta do Jev: sempre em azul, com a confiança quando existir. */
function mostrar(nome, resposta) {
  const confianca = typeof resposta.confidence === "number" ? cinza(` (confiança ${pct(resposta.confidence)})`) : "";
  const titulo = `${AZUL_FORTE}  ${nome}:${FIM}`;
  if (resposta.type === "noul") {
    const leitura = resposta.noul >= 0.8 ? "sim" : resposta.noul <= 0.2 ? "não" : "incerto";
    return [`${titulo} ${azul(`${leitura} · ${pct(resposta.noul)}`)}${confianca}`];
  }
  if (resposta.type === "choice") {
    return [`${titulo} ${azul(resposta.choice)}${confianca}`, distribuicao(resposta.probabilities)];
  }
  if (resposta.type === "score") {
    const nivel = resposta.legend?.[String(Math.round(resposta.score))];
    const valor = `${resposta.score.toFixed(2)}${nivel ? ` · ${nivel}` : ""}`;
    return [`${titulo} ${azul(valor)}${confianca}`, distribuicao(resposta.probabilities, resposta.legend)];
  }
  return [`${titulo} ${azul(JSON.stringify(resposta))}`];
}

const [estado, ...perguntas] = process.argv.slice(2);
if (!estado || perguntas.length === 0) {
  console.error('Uso: node scripts/jev.mjs "<texto>" "noul:nome=pergunta" ["choice:nome=pergunta|a,b"] ["score:nome=pergunta|baixo,alto"]');
  process.exit(2);
}
const chave = lerChave();
if (!chave) {
  console.error("TYPESAFE_API_KEY não encontrada (.env.local ou ambiente).");
  process.exit(2);
}

let questions;
try {
  questions = Object.fromEntries(perguntas.map(interpretar));
} catch (erro) {
  console.error(erro.message);
  process.exit(2);
}

const inicio = Date.now();
let resposta;
try {
  resposta = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state: estado, model: "jev-latest", questions }),
  });
} catch (erro) {
  console.error(`Não foi possível falar com a TypeSafe: ${erro.message}`);
  process.exit(1);
}
const ms = Date.now() - inicio;
const corpo = await resposta.json().catch(() => ({}));

if (!resposta.ok) {
  const detalhe = corpo.detail ? JSON.stringify(corpo.detail) : corpo.error?.message ?? JSON.stringify(corpo);
  console.error(`Jev respondeu ${resposta.status}: ${detalhe.slice(0, 400)}`);
  process.exit(1);
}

console.log(`${AZUL_FORTE}▌ Jev${FIM} ${cinza("(TypeSafe · resposta em azul)")}`);
for (const [nome, item] of Object.entries(corpo.answers ?? {})) {
  for (const linha of mostrar(nome, item)) if (linha) console.log(linha);
}
console.log(cinza(`  ${corpo.model} · ${ms} ms · ${corpo.usage?.input_tokens ?? "?"}+${corpo.usage?.output_tokens ?? "?"} tokens`));
