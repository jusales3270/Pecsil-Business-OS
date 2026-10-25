/**
 * Valores da origem em JSON estável: número grande como texto, texto sem os espaços de enchimento (CHAR do Firebird e
 * do SQL Server vem completado com espaços), binário e BLOB só marcados (não vão para a plataforma nesta etapa).
 * Data e hora de ERP são LOCAIS e sem fuso: saem como estão no sistema de origem ("2020-01-02" ou
 * "2020-01-02T14:30:00"), nunca convertidas para UTC. O serviço roda no fuso de São Paulo (TZ no Dockerfile).
 */
const dois = (n) => String(n).padStart(2, "0");
export function dataLocal(d) {
  if (Number.isNaN(d.getTime())) return null;
  const dia = `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  if (!d.getHours() && !d.getMinutes() && !d.getSeconds() && !d.getMilliseconds()) return dia;
  return `${dia}T${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}${d.getMilliseconds() ? `.${String(d.getMilliseconds()).padStart(3, "0")}` : ""}`;
}
export function valor(v) {
  if (v == null) return null;
  if (v instanceof Date) return dataLocal(v);
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.replace(/\s+$/, "");
  if (typeof v === "boolean") return v;
  if (typeof v === "function") return "[blob]";
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `[binário ${v.length} bytes]`;
  if (Array.isArray(v)) return v.map(valor);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)]));
  return String(v);
}
export const registro = (linha) => Object.fromEntries(Object.entries(linha).map(([k, v]) => [String(k).trim(), valor(v)]));
