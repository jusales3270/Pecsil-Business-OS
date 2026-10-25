import { pagina } from "./paginas.mjs";

/** PostgreSQL, sessão só de leitura. */
export async function criar(cfg) {
  const { default: pg } = await import("pg");
  // DATE e TIMESTAMP sem fuso como texto, do jeito que estão no banco (sem passar por UTC).
  for (const oid of [1082, 1114]) pg.types.setTypeParser(oid, (x) => x);
  const c = new pg.Client({ host: cfg.host, port: cfg.porta ?? 5432, database: cfg.banco, user: cfg.usuario, password: cfg.senha, statement_timeout: 120_000, connectionTimeoutMillis: 15_000 });
  await c.connect();
  await c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  return {
    async descobrir() {
      const versao = (await c.query("select current_setting('server_version') v")).rows[0]?.v ?? null;
      const cols = (await c.query(`select c.table_schema s, c.table_name t, c.column_name n, c.data_type d from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where t.table_type = 'BASE TABLE' and c.table_schema not in ('pg_catalog', 'information_schema') order by 1, 2, c.ordinal_position`)).rows;
      const linhas = (await c.query(`select n.nspname s, c.relname t, c.reltuples::bigint r from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r'`)).rows;
      const conta = new Map(linhas.map((x) => [`${x.s}.${x.t}`, Number(x.r)]));
      const tabelas = new Map();
      for (const x of cols) {
        const nome = x.s === "public" ? x.t : `${x.s}.${x.t}`;
        const r = conta.get(`${x.s}.${x.t}`);
        if (!tabelas.has(nome)) tabelas.set(nome, { nome, linhas: r != null && r >= 0 ? r : null, colunas: [] });
        tabelas.get(nome).colunas.push({ nome: x.n, tipo: x.d });
      }
      return { banco: { produto: "PostgreSQL", versao }, tabelas: [...tabelas.values()] };
    },
    async ler(consulta, tamanho, deslocamento) { return (await c.query(pagina("postgres", consulta, tamanho, deslocamento))).rows; },
    async fechar() { await c.end().catch(() => null); },
  };
}
