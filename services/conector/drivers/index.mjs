/** O driver do tipo da fonte (carregado só quando usado: quem lê Firebird não precisa do driver do SQL Server). */
const DRIVERS = { postgres: () => import("./postgres.mjs"), mysql: () => import("./mysql.mjs"), sqlserver: () => import("./sqlserver.mjs"), firebird: () => import("./firebird.mjs") };
export const TIPOS_BANCO = Object.keys(DRIVERS);
export async function criarDriver(cfg) {
  const d = DRIVERS[cfg.tipo];
  if (!d) throw new Error(`Tipo de origem não suportado: ${cfg.tipo}. Use ${TIPOS_BANCO.join(", ")}.`);
  return (await d()).criar(cfg);
}
