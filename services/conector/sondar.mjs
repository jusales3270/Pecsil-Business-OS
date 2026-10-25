import net from "node:net";

/** Portas padrão dos bancos de ERP: para descobrir qual banco responde num servidor (antes de pedir o usuário). */
export const PORTAS = [
  { porta: 3050, banco: "Firebird / InterBase" }, { porta: 1433, banco: "SQL Server" }, { porta: 5432, banco: "PostgreSQL" },
  { porta: 3306, banco: "MySQL / MariaDB" }, { porta: 1521, banco: "Oracle" }, { porta: 50000, banco: "DB2" }, { porta: 8080, banco: "API HTTP (comum em ERP)" },
];

export function portaAberta(host, porta, ms = 1500) {
  return new Promise((ok) => {
    const s = net.connect({ host, port: porta });
    const fim = (r) => { s.destroy(); ok(r); };
    s.setTimeout(ms, () => fim(false));
    s.once("connect", () => fim(true));
    s.once("error", () => fim(false));
  });
}

export async function sondar(host, portas = PORTAS, ms = 1500) {
  return Promise.all(portas.map(async (p) => ({ ...p, aberta: await portaAberta(host, p.porta, ms) })));
}
