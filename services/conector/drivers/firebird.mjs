import { pagina } from "./paginas.mjs";

const TIPO = { 7: "SMALLINT", 8: "INTEGER", 10: "FLOAT", 12: "DATE", 13: "TIME", 14: "CHAR", 16: "BIGINT/NUMERIC", 23: "BOOLEAN", 27: "DOUBLE", 35: "TIMESTAMP", 37: "VARCHAR", 261: "BLOB" };

/**
 * Firebird (o banco mais comum em ERP brasileiro antigo). Cada consulta numa transação SÓ DE LEITURA. `banco` é o
 * caminho do arquivo .FDB/.GDB no servidor (ex.: C:\GRV\DADOS.FDB). A contagem de linhas é exata (count), com um
 * tempo total limitado: o que passar dele fica sem contagem.
 */
export async function criar(cfg) {
  const { default: Firebird } = await import("node-firebird");
  const db = await new Promise((ok, falha) => Firebird.attach({ host: cfg.host, port: cfg.porta ?? 3050, database: cfg.banco, user: cfg.usuario, password: cfg.senha,
    lowercase_keys: false, encoding: cfg.charset ?? "WIN1252", pageSize: 4096 }, (e, d) => (e ? falha(e) : ok(d))));
  const q = (sql) => new Promise((ok, falha) => db.transaction(Firebird.ISOLATION_READ_COMMITTED_READ_ONLY, (e, tr) => {
    if (e) return falha(e);
    tr.query(sql, [], (e2, rows) => { tr.commit(() => (e2 ? falha(e2) : ok(rows ?? []))); });
  }));
  return {
    async descobrir({ tempoContagemMs = 120_000 } = {}) {
      const v = (await q("select rdb$get_context('SYSTEM', 'ENGINE_VERSION') v from rdb$database").catch(() => [{}]))[0]?.V ?? null;
      const cols = await q(`select trim(r.rdb$relation_name) t, trim(rf.rdb$field_name) n, f.rdb$field_type d from rdb$relations r
        join rdb$relation_fields rf on rf.rdb$relation_name = r.rdb$relation_name join rdb$fields f on f.rdb$field_name = rf.rdb$field_source
        where coalesce(r.rdb$system_flag, 0) = 0 and r.rdb$view_blr is null order by 1, rf.rdb$field_position`);
      const tabelas = new Map();
      for (const x of cols) {
        if (!tabelas.has(x.T)) tabelas.set(x.T, { nome: x.T, linhas: null, colunas: [] });
        tabelas.get(x.T).colunas.push({ nome: x.N, tipo: TIPO[x.D] ?? String(x.D) });
      }
      const fim = Date.now() + tempoContagemMs;
      for (const t of tabelas.values()) {
        if (Date.now() > fim) break;
        t.linhas = Number((await q(`select count(*) c from "${t.nome.replace(/"/g, '""')}"`).catch(() => [{ C: null }]))[0]?.C ?? null);
      }
      return { banco: { produto: "Firebird", versao: v }, tabelas: [...tabelas.values()] };
    },
    async ler(consulta, tamanho, deslocamento) { return q(pagina("firebird", consulta, tamanho, deslocamento)); },
    async fechar() { await new Promise((ok) => db.detach(() => ok())); },
  };
}
