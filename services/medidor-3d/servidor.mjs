/**
 * Medidor 3D — serviço separado que mede peças de arquivos STEP para o orçamento (ROADMAP C-19).
 *
 *  - roda o motor do SolidCraft (solidcraft-cli, MIT/Apache) sem tela: abre o STEP, lista a montagem,
 *    mede volume, área e medidas externas de cada corpo, lê as faces (eixo e área das pontas) e
 *    desenha cada peça destacada na montagem (PNG, sem placa de vídeo);
 *  - toda chamada (menos /saude) exige o cabeçalho x-medidor-secret (MEDIDOR_SECRET, 32+);
 *  - sem estado: o arquivo fica numa pasta temporária só durante a medição e é apagado;
 *  - uma medição por vez (o motor usa todos os núcleos); as outras esperam na fila.
 *
 * POST /v1/medir?nome=peca.step   corpo = bytes do STEP
 *   → { ok: true, resultado: { versao_motor, tempo_ms, corpos: [...], imagens: { montagem, <corpo>: base64 } } }
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corposDosComponentes, montarCorpos } from "./geometria.mjs";

const PORTA = Number(process.env.PORT ?? 3200);
const SEGREDO = process.env.MEDIDOR_SECRET?.trim() ?? "";
const CLI = process.env.SOLIDCRAFT_CLI ?? "/opt/solidcraft/bin/solidcraft-cli";
const LIMITE = Number(process.env.MEDIDOR_LIMITE_MB ?? 100) * 1024 * 1024;
const TEMPO_MAX = Number(process.env.MEDIDOR_TEMPO_MAX_S ?? 300) * 1000;
const FILA_MAX = 5;
/** Corpo abaixo disso (cm³) não ganha imagem: parafuso, pino, chaveta. */
const VOLUME_IMAGEM_CM3 = 20;
const MAX_IMAGENS = 12;

export function segredoConfere(recebido, esperado = SEGREDO) {
  if (!esperado || typeof recebido !== "string") return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cli(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { cwd, timeout: TEMPO_MAX, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SOLIDCRAFT_GPU: "cpu" } }, (erro, stdout, stderr) => {
      if (erro) {
        const linha = String(stderr || stdout || erro.message).split("\n").find((l) => l.startsWith("error:")) ?? String(stderr || erro.message).trim().split("\n").pop();
        reject(new Error(erro.killed ? "O motor passou do tempo máximo." : linha || "O motor falhou."));
      } else resolve(stdout);
    });
  });
}

let VERSAO_MOTOR = null;
async function versaoMotor() {
  if (!VERSAO_MOTOR) VERSAO_MOTOR = (await cli(["--version"])).trim();
  return VERSAO_MOTOR;
}

/** Mede um STEP. `dados` = bytes do arquivo. */
export async function medir(dados, { imagens = true } = {}) {
  const inicio = Date.now();
  const pasta = await mkdtemp(join(tmpdir(), "medidor-"));
  try {
    const step = join(pasta, "peca.step");
    const design = join(pasta, "peca.sc");
    await writeFile(step, dados);

    // 1) Abre o STEP uma vez, guarda o projeto (as próximas chamadas não releem o STEP) e lista a montagem.
    await writeFile(join(pasta, "abrir.json"), JSON.stringify({ commands: [{ command: "component.list", params: { bodies: true } }] }));
    await cli(["run", "abrir.json", "--in", step, "--save", design, "--results", "--json-out", "r1.json"], { cwd: pasta });
    const [lista] = JSON.parse(await readFile(join(pasta, "r1.json"), "utf8"));
    const componentes = corposDosComponentes(lista);
    const nomes = [...componentes.keys()];
    if (!nomes.length) throw new Error("O arquivo não tem nenhum sólido para medir.");

    // 2) Mede tudo e lê as faces de cada corpo numa passada só.
    const comandos = [{ command: "document.inspect", params: { measure: true } }, ...nomes.map((body) => ({ command: "model.faces", params: { body } }))];
    await writeFile(join(pasta, "medir.json"), JSON.stringify({ commands: comandos }));
    await cli(["run", "medir.json", "--in", design, "--results", "--json-out", "r2.json"], { cwd: pasta });
    const [inspecao, ...faces] = JSON.parse(await readFile(join(pasta, "r2.json"), "utf8"));
    const facesPorCorpo = new Map(faces.map((f) => [f.body, f.faces ?? []]));
    const corpos = montarCorpos(inspecao, facesPorCorpo, componentes);

    // 3) Imagens: a montagem e cada peça de verdade destacada (as outras ficam transparentes).
    const figuras = {};
    if (imagens) {
      const alvos = corpos.filter((c) => c.volume_mm3 / 1000 >= VOLUME_IMAGEM_CM3).sort((a, b) => b.volume_mm3 - a.volume_mm3).slice(0, MAX_IMAGENS);
      const tarefas = [{ chave: "montagem", args: [] }, ...alvos.map((c, i) => ({ chave: c.nome, args: ["--tool", c.nome], arquivo: `p${i}.png` }))];
      for (const t of tarefas) {
        const arquivo = t.arquivo ?? "montagem.png";
        try {
          await cli(["snapshot", "--in", design, "--out", arquivo, "--view", "iso", "--width", "720", "--height", "540", "--no-grid", "--no-axes", ...t.args], { cwd: pasta });
          figuras[t.chave] = (await readFile(join(pasta, arquivo))).toString("base64");
        } catch (e) {
          console.error(`Imagem de ${t.chave} falhou:`, e instanceof Error ? e.message : e);
        }
      }
    }
    return { versao_motor: await versaoMotor(), tempo_ms: Date.now() - inicio, corpos, imagens: figuras };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

function responder(res, status, corpo) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(texto) });
  res.end(texto);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on("data", (p) => {
      total += p.length;
      if (total > LIMITE) { reject(Object.assign(new Error("Arquivo acima do limite."), { status: 413 })); req.destroy(); return; }
      partes.push(p);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

/** Fila de uma medição por vez. */
let corrente = Promise.resolve();
let esperando = 0;
function naFila(tarefa) {
  esperando += 1;
  const vez = corrente.then(tarefa, tarefa);
  corrente = vez.catch(() => {}).finally(() => { esperando -= 1; });
  return vez;
}

const pareceStep = (dados) => dados.subarray(0, 64).toString("latin1").includes("ISO-10303-21");

export function criarServidor() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://medidor");
    if (req.method === "GET" && url.pathname === "/saude") {
      try { return responder(res, 200, { ok: true, motor: await versaoMotor(), fila: esperando }); } catch { return responder(res, 503, { ok: false, erro: { codigo: "MOTOR", mensagem: "O motor não respondeu." } }); }
    }
    if (!segredoConfere(req.headers["x-medidor-secret"])) return responder(res, 401, { ok: false, erro: { codigo: "NAO_AUTORIZADO", mensagem: "Segredo ausente ou errado." } });
    if (req.method !== "POST" || url.pathname !== "/v1/medir") return responder(res, 404, { ok: false, erro: { codigo: "ROTA", mensagem: "Use POST /v1/medir." } });
    if (esperando >= FILA_MAX) return responder(res, 429, { ok: false, erro: { codigo: "FILA", mensagem: "Medidor ocupado: tente de novo em alguns minutos." } });
    try {
      const dados = await lerCorpo(req);
      if (!dados.length || !pareceStep(dados)) return responder(res, 400, { ok: false, erro: { codigo: "ARQUIVO", mensagem: "Envie um arquivo STEP (.step ou .stp)." } });
      const resultado = await naFila(() => medir(dados, { imagens: url.searchParams.get("imagens") !== "0" }));
      return responder(res, 200, { ok: true, resultado });
    } catch (e) {
      const status = e?.status ?? 502;
      console.error("Medição falhou:", e instanceof Error ? e.message : e);
      return responder(res, status, { ok: false, erro: { codigo: status === 413 ? "TAMANHO" : "MOTOR", mensagem: e instanceof Error ? e.message : "Falha ao medir." } });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (SEGREDO.length < 32) { console.error("MEDIDOR_SECRET ausente ou curto (mínimo 32 caracteres)."); process.exit(1); }
  criarServidor().listen(PORTA, () => console.log(`Medidor 3D na porta ${PORTA} (motor em ${CLI})`));
}
