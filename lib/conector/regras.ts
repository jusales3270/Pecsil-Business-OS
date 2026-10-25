import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Conector universal (docs/PLANO-CONECTOR.md): regras puras da plataforma, testadas sem banco. A mesma trava de só
 * leitura existe no serviço conector (services/conector/leitura.mjs); um teste confere que as duas concordam.
 */

export type TipoFonte = "postgres" | "sqlserver" | "firebird" | "mysql" | "pasta" | "api";
export const TIPOS: { tipo: TipoFonte; rotulo: string; degrau: 1 | 2 | 3 | 4 }[] = [
  { tipo: "firebird", rotulo: "Banco Firebird (só leitura)", degrau: 2 },
  { tipo: "sqlserver", rotulo: "Banco SQL Server (só leitura)", degrau: 2 },
  { tipo: "postgres", rotulo: "Banco PostgreSQL (só leitura)", degrau: 2 },
  { tipo: "mysql", rotulo: "Banco MySQL ou MariaDB (só leitura)", degrau: 2 },
  { tipo: "api", rotulo: "API do sistema", degrau: 1 },
  { tipo: "pasta", rotulo: "Pasta de arquivos e exportações", degrau: 3 },
];
export const DEGRAU: Record<number, string> = { 1: "API", 2: "Banco só leitura", 3: "Arquivos", 4: "Computer use" };

const texto = (v: unknown, max: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, max) : null; };

/** Fonte nova: nome, sistema de origem e tipo (o degrau vem do tipo). */
export function validarFonte(e: Record<string, unknown>): { nome: string; sistema: string | null; tipo: TipoFonte; degrau: number } | { erro: string } {
  const nome = texto(e.nome, 60);
  if (!nome || nome.length < 2) return { erro: "Dê um nome à fonte (ex.: GRV)." };
  const sistema = texto(e.sistema, 60);
  const t = TIPOS.find((x) => x.tipo === e.tipo);
  if (!t) return { erro: "Escolha o tipo da fonte." };
  return { nome, sistema, tipo: t.tipo, degrau: t.degrau };
}

/** Segredo do conector: aparece uma vez só; o banco guarda o sha256. */
export const novoSegredo = () => randomBytes(32).toString("base64url");
export const hashDoSegredo = (s: string) => createHash("sha256").update(s).digest("hex");
export function segredoConfere(recebido: string | null | undefined, hash: string): boolean {
  if (!recebido || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashDoSegredo(recebido), "hex"), Buffer.from(hash, "hex"));
}

/** Tira comentários e textos entre aspas (o que está dentro deles não é comando). */
function semTextos(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}
// REPLACE() e CHARACTER SET são leitura; REPLACE INTO e LOAD DATA … INTO caem no INTO.
const PROIBIDAS = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|exec|execute|call|into|lock|copy|attach|detach|pragma|begin|commit|rollback|savepoint|vacuum|reindex|cluster|handler|shutdown|kill|backup|restore|dbcc|openrowset|opendatasource|bulk|xp_\w+|sp_\w+)\b/i;

/** Só uma consulta de leitura: um SELECT (ou WITH … SELECT), sem `;` no meio e sem comando que grava. */
export function consultaSoLeitura(sql: unknown): { ok: true; consulta: string } | { erro: string } {
  const c = String(sql ?? "").trim().replace(/;\s*$/, "");
  if (!c) return { erro: "Escreva a consulta." };
  if (c.length > 4000) return { erro: "A consulta passou de 4.000 caracteres." };
  const limpa = semTextos(c);
  if (limpa.includes(";")) return { erro: "Uma consulta só (sem ';' no meio)." };
  if (!/^\s*(select|with)\b/i.test(limpa)) return { erro: "A consulta tem de começar com SELECT ou WITH." };
  const proibida = PROIBIDAS.exec(limpa);
  if (proibida) return { erro: `Só leitura: a consulta não pode ter "${proibida[1].toUpperCase()}".` };
  return { ok: true, consulta: c };
}

export type Objeto = { nome: string; consulta: string; chave: string[] };

/** Os objetos a extrair de uma fonte (até 50): nome, consulta só de leitura e os campos da chave (1 a 6). */
export function validarObjetos(lista: unknown): { objetos: Objeto[] } | { erro: string } {
  if (!Array.isArray(lista)) return { erro: "Lista de objetos inválida." };
  if (lista.length > 50) return { erro: "No máximo 50 objetos por fonte." };
  const objetos: Objeto[] = [];
  for (const [i, o] of lista.entries()) {
    const x = (o ?? {}) as Record<string, unknown>;
    const nome = String(x.nome ?? "").trim();
    if (!/^[A-Za-z0-9_.$-]{1,120}$/.test(nome)) return { erro: `Objeto ${i + 1}: nome com letras, números, ponto, hífen ou sublinhado.` };
    if (objetos.some((y) => y.nome.toLowerCase() === nome.toLowerCase())) return { erro: `Objeto "${nome}" repetido.` };
    const c = consultaSoLeitura(x.consulta);
    if ("erro" in c) return { erro: `${nome}: ${c.erro}` };
    const chave = (Array.isArray(x.chave) ? x.chave : String(x.chave ?? "").split(",")).map((k) => String(k).trim()).filter(Boolean);
    if (chave.length < 1 || chave.length > 6 || chave.some((k) => !/^[A-Za-z0-9_$]{1,60}$/.test(k))) return { erro: `${nome}: diga de 1 a 6 campos de chave, separados por vírgula.` };
    objetos.push({ nome, consulta: c.consulta, chave });
  }
  return { objetos };
}

export type Descoberta = { banco: { produto: string; versao: string | null } | null; tabelas: { nome: string; linhas: number | null; colunas: { nome: string; tipo: string }[] }[]; em: string };

/** A descoberta do esquema que o conector manda, limpa e com teto (2.000 tabelas, 300 colunas cada). */
export function lerDescoberta(d: unknown): Descoberta | { erro: string } {
  const x = (d ?? {}) as Record<string, unknown>;
  if (!Array.isArray(x.tabelas)) return { erro: "Descoberta sem tabelas." };
  const b = (x.banco ?? null) as Record<string, unknown> | null;
  const tabelas = x.tabelas.slice(0, 2000).map((t) => {
    const y = (t ?? {}) as Record<string, unknown>;
    const linhas = Number(y.linhas);
    return {
      nome: String(y.nome ?? "").slice(0, 120),
      linhas: Number.isFinite(linhas) && linhas >= 0 ? Math.round(linhas) : null,
      colunas: (Array.isArray(y.colunas) ? y.colunas : []).slice(0, 300).map((c) => ({ nome: String((c as Record<string, unknown>)?.nome ?? "").slice(0, 120), tipo: String((c as Record<string, unknown>)?.tipo ?? "").slice(0, 60) })).filter((c) => c.nome),
    };
  }).filter((t) => t.nome);
  return { banco: b ? { produto: String(b.produto ?? "").slice(0, 60), versao: b.versao ? String(b.versao).slice(0, 60) : null } : null, tabelas, em: new Date().toISOString() };
}

/** Situação da fonte para a tela, pelo último contato e o intervalo combinado. */
export function situacaoDaFonte(f: { ativo: boolean; ultimo_contato: string | null; intervalo_min: number; ultimo_erro: string | null }, agora = Date.now()): { estado: "desativada" | "nunca" | "ok" | "atrasada" | "erro"; rotulo: string } {
  if (!f.ativo) return { estado: "desativada", rotulo: "Desativada" };
  if (!f.ultimo_contato) return { estado: "nunca", rotulo: "O conector ainda não se conectou" };
  if (f.ultimo_erro) return { estado: "erro", rotulo: "Com erro" };
  const atraso = agora - Date.parse(f.ultimo_contato);
  return atraso > (f.intervalo_min * 2 + 10) * 60_000 ? { estado: "atrasada", rotulo: "Sem contato no intervalo combinado" } : { estado: "ok", rotulo: "Conectado" };
}
