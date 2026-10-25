/** A consulta do objeto em páginas, no dialeto de cada banco (a consulta vira uma tabela derivada). */
export function pagina(tipo, consulta, tamanho, deslocamento) {
  const n = Math.max(1, Math.floor(tamanho)), o = Math.max(0, Math.floor(deslocamento));
  if (tipo === "firebird") return `SELECT FIRST ${n} SKIP ${o} * FROM (${consulta}) q`;
  // SQL Server não aceita ORDER BY dentro da tabela derivada: a consulta do objeto vem sem ORDER BY.
  if (tipo === "sqlserver") return `SELECT * FROM (${consulta}) AS q ORDER BY (SELECT NULL) OFFSET ${o} ROWS FETCH NEXT ${n} ROWS ONLY`;
  return `SELECT * FROM (${consulta}) AS q LIMIT ${n} OFFSET ${o}`;
}
