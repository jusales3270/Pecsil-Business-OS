import { SARAS } from "./modulos.ts";

/**
 * Contexto da tela (T2 do E7.T, 31/10/2026): a SARA sabe o que a pessoa está vendo. O navegador nunca manda texto
 * para o prompt: módulo e seção são só apontadores, conferidos contra o catálogo, e o rótulo que entra é o do catálogo.
 * O que não for conhecido é descartado, com a mesma permissão da tela. Puro, testado em tests/sara-tela.test.mjs.
 */

type Acesso = { canModule: (m: string) => boolean; can: (f: string, nivel: "ver") => boolean };

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, " ").trim();

/** O rótulo do que a pessoa vê, do catálogo, ou null. Seção fora da lista ou sem permissão: fica só o módulo. */
export function rotuloDaTela(entrada: unknown, acesso: Acesso): string | null {
  const e = entrada as { modulo?: unknown; secao?: unknown } | null;
  const modulo = typeof e?.modulo === "string" ? e.modulo : "";
  const sara = /^[a-z_]{2,30}$/.test(modulo) && Object.hasOwn(SARAS, modulo) ? SARAS[modulo] : null;
  if (!sara || !acesso.canModule(sara.feature)) return null;
  const base = sara.central ? "War Room" : sara.rotulo;
  if (typeof e?.secao !== "string" || e.secao.length > 60) return base;
  // A página manda "CRM › Funil": vale o último trecho.
  const secao = normal(e.secao.split("›").at(-1) ?? "");
  const tela = sara.telas.find((t) => t.modulo === modulo && secao && (normal(t.secao ?? "") === secao || normal(t.rotulo.split("›").at(-1) ?? "") === secao));
  return tela && tela.exige.some((f) => acesso.can(f, "ver")) ? tela.rotulo : base;
}

/** A linha do prompt. Não é fonte de número: para qualquer valor, a SARA consulta. */
export const linhaDaTela = (rotulo: string | null) =>
  rotulo ? `\nA pessoa está vendo agora: ${rotulo}. "Isso", "esse" e "aqui" se referem a essa tela. Isto não é fonte de número: para qualquer valor, consulte.` : "";
