/**
 * Coleta por módulo (decisão do proprietário, 10/10/2026). A coleta fica dentro de cada módulo,
 * e o proprietário escolhe nos acessos daquele módulo quem pode enviar ("Coletar arquivos",
 * `<setor>.coleta`, só operar). O setor do arquivo vem da credencial: quem coleta no Financeiro
 * guarda no Financeiro. "Coletar arquivos" não abre o resto do módulo.
 * Sem dependência de servidor (testável).
 */
import { hasFeature, type AccessGrants } from "../../modules/access-catalog.ts";

/** Setores com coleta (os mesmos da guarda de documentos; o RH tem a guarda própria). */
export const SETORES_COLETA = ["financeiro", "fiscal", "compras", "almoxarifado", "comercial", "fundicao", "producao"] as const;
export type SetorColeta = (typeof SETORES_COLETA)[number];

export const ehSetorColeta = (s: string): s is SetorColeta => (SETORES_COLETA as readonly string[]).includes(s);
export const featureColeta = (setor: SetorColeta) => `${setor}.coleta`;

/** Setores que abrem dentro de um módulo do menu: o Comercial é departamento e abriga o Compras. */
const SETORES_DO_MODULO: Record<string, readonly SetorColeta[]> = {
  comercial: ["comercial", "compras"],
};

export function setoresDoModulo(moduloId: string): readonly SetorColeta[] {
  return SETORES_DO_MODULO[moduloId] ?? (ehSetorColeta(moduloId) ? [moduloId] : []);
}

type Acesso = { isOwner?: boolean; grants?: AccessGrants };

/** Setores deste módulo em que a pessoa pode coletar. */
export function setoresDeColeta(acesso: Acesso, moduloId: string): SetorColeta[] {
  return setoresDoModulo(moduloId).filter((s) => hasFeature(acesso, featureColeta(s), "operar"));
}

/** Só coleta neste módulo: não tem nenhuma outra funcionalidade dele (nem das áreas que ele abriga). */
export function soColeta(acesso: Acesso, moduloId: string): boolean {
  if (acesso.isOwner || !setoresDeColeta(acesso, moduloId).length) return false;
  const modulos = new Set<string>([moduloId, ...setoresDoModulo(moduloId)]);
  return !Object.keys(acesso.grants ?? {}).some((code) => modulos.has(code.split(".")[0]) && !code.endsWith(".coleta"));
}
