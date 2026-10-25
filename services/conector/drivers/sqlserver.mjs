import { pagina } from "./paginas.mjs";

/** SQL Server (2012 ou mais novo, pela paginação OFFSET/FETCH). Pede ApplicationIntent=ReadOnly. */
export async function criar(cfg) {
  const { default: sql } = await import("mssql");
  const pool = await new sql.ConnectionPool({ server: cfg.host, port: cfg.porta ?? 1433, database: cfg.banco, user: cfg.usuario, password: cfg.senha, requestTimeout: 120_000, connectionTimeout: 15_000,
    options: { encrypt: cfg.cifrar ?? false, trustServerCertificate: true, readOnlyIntent: true, useUTC: false } }).connect();
  const q = async (s) => (await pool.request().query(s)).recordset;
  return {
    async descobrir() {
      const [v] = await q("select cast(serverproperty('ProductVersion') as varchar(40)) v");
      const cols = await q(`select c.TABLE_SCHEMA s, c.TABLE_NAME t, c.COLUMN_NAME n, c.DATA_TYPE d from INFORMATION_SCHEMA.COLUMNS c
        join INFORMATION_SCHEMA.TABLES t on t.TABLE_SCHEMA = c.TABLE_SCHEMA and t.TABLE_NAME = c.TABLE_NAME where t.TABLE_TYPE = 'BASE TABLE' order by 1, 2, c.ORDINAL_POSITION`);
      const linhas = await q(`select s.name s, t.name t, sum(p.rows) r from sys.tables t join sys.schemas s on s.schema_id = t.schema_id join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1) group by s.name, t.name`);
      const conta = new Map(linhas.map((x) => [`${x.s}.${x.t}`, Number(x.r)]));
      const tabelas = new Map();
      for (const x of cols) {
        const nome = x.s === "dbo" ? x.t : `${x.s}.${x.t}`;
        if (!tabelas.has(nome)) tabelas.set(nome, { nome, linhas: conta.get(`${x.s}.${x.t}`) ?? null, colunas: [] });
        tabelas.get(nome).colunas.push({ nome: x.n, tipo: x.d });
      }
      return { banco: { produto: "SQL Server", versao: v?.v ?? null }, tabelas: [...tabelas.values()] };
    },
    async ler(consulta, tamanho, deslocamento) { return q(pagina("sqlserver", consulta, tamanho, deslocamento)); },
    async fechar() { await pool.close().catch(() => null); },
  };
}
