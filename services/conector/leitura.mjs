/**
 * Trava de só leitura do conector (a mesma regra de lib/conector/regras.ts na plataforma; um teste confere as duas).
 * Uma consulta só, começando por SELECT ou WITH, sem ';' no meio e sem comando que grava. O usuário do banco também
 * tem de ser só de leitura (pedido à TI): esta trava é a segunda camada, não a única.
 */
function semTextos(sql) {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}
// REPLACE() e CHARACTER SET são leitura; REPLACE INTO e LOAD DATA … INTO caem no INTO.
const PROIBIDAS = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|exec|execute|call|into|lock|copy|attach|detach|pragma|begin|commit|rollback|savepoint|vacuum|reindex|cluster|handler|shutdown|kill|backup|restore|dbcc|openrowset|opendatasource|bulk|xp_\w+|sp_\w+)\b/i;

export function consultaSoLeitura(sql) {
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
