import { pagina } from "./paginas.mjs";

/** MySQL e MariaDB, sessão só de leitura. */
export async function criar(cfg) {
  const { default: mysql } = await import("mysql2/promise");
  const c = await mysql.createConnection({ host: cfg.host, port: cfg.porta ?? 3306, database: cfg.banco, user: cfg.usuario, password: cfg.senha, connectTimeout: 15_000, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true });
  await c.query("SET SESSION TRANSACTION READ ONLY");
  return {
    async descobrir() {
      const [[v]] = await c.query("select version() v");
      const [cols] = await c.query(`select table_name t, column_name n, data_type d from information_schema.columns where table_schema = database() order by table_name, ordinal_position`);
      const [tabs] = await c.query(`select table_name t, table_rows r from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE'`);
      const tabelas = new Map(tabs.map((x) => [x.t ?? x.TABLE_NAME, { nome: x.t ?? x.TABLE_NAME, linhas: x.r == null ? null : Number(x.r), colunas: [] }]));
      for (const x of cols) tabelas.get(x.t ?? x.TABLE_NAME)?.colunas.push({ nome: x.n ?? x.COLUMN_NAME, tipo: x.d ?? x.DATA_TYPE });
      return { banco: { produto: /mariadb/i.test(v?.v ?? "") ? "MariaDB" : "MySQL", versao: v?.v ?? null }, tabelas: [...tabelas.values()] };
    },
    async ler(consulta, tamanho, deslocamento) { const [rows] = await c.query(pagina("mysql", consulta, tamanho, deslocamento)); return rows; },
    async fechar() { await c.end().catch(() => null); },
  };
}
