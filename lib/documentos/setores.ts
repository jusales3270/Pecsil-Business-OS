/**
 * Documentos por setor (Segundo Cérebro, Etapa 1). Cada setor é protegido por uma
 * funcionalidade que já existe: quem vê aquela tela vê os documentos do setor, e quem
 * opera nela pode enviar. O RH continua na guarda dele (Recursos Humanos › Documentos).
 * Sem dependência de servidor (testável).
 */
import { hasFeature, type AccessGrants, type AccessLevel } from "../../modules/access-catalog.ts";

export type Setor = {
  modulo: string;
  rotulo: string;
  /** Funcionalidade com que um envio manual entra no setor. */
  feature: string;
  /** Outras funcionalidades do setor que também guardam documentos (ex.: extrato em Bancos). */
  outras?: string[];
};

export const SETORES_DOCUMENTO: readonly Setor[] = [
  { modulo: "financeiro", rotulo: "Financeiro", feature: "financeiro.pagar", outras: ["financeiro.bancos", "financeiro.receber"] },
  { modulo: "fiscal", rotulo: "Fiscal", feature: "fiscal.icms" },
  { modulo: "compras", rotulo: "Compras", feature: "compras.cotacoes", outras: ["compras.realizadas", "compras.fornecedores"] },
  { modulo: "almoxarifado", rotulo: "Almoxarifado", feature: "almoxarifado.recebimento", outras: ["almoxarifado.solicitacoes"] },
  { modulo: "comercial", rotulo: "Comercial", feature: "comercial.clientes" },
  { modulo: "fundicao", rotulo: "Fundição", feature: "fundicao.pedidos" },
  { modulo: "producao", rotulo: "Produção", feature: "producao.os" },
];

export const setorPorModulo = (modulo: string) => SETORES_DOCUMENTO.find((s) => s.modulo === modulo) ?? null;
export const rotuloDoSetor = (modulo: string) => setorPorModulo(modulo)?.rotulo ?? modulo;

type Acesso = { isOwner?: boolean; grants: AccessGrants };

/** Setores cujos documentos a pessoa vê (alguma funcionalidade do setor em "ver"). */
export function setoresVisiveis(acesso: Acesso): Setor[] {
  return SETORES_DOCUMENTO.filter((s) => [s.feature, ...(s.outras ?? [])].some((f) => hasFeature(acesso, f, "ver")));
}

/** Setores em que a pessoa pode enviar documento manualmente (funcionalidade principal em "operar"). */
export function setoresDeEnvio(acesso: Acesso, nivel: AccessLevel = "operar"): Setor[] {
  return SETORES_DOCUMENTO.filter((s) => hasFeature(acesso, s.feature, nivel));
}

const SEM_ACENTO = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nome de arquivo seguro para o armazenamento: sem caminho, sem acento, até 120 caracteres, com a extensão. */
export function nomeSeguro(nome: string): string {
  const base = SEM_ACENTO(String(nome ?? "").split(/[\\/]/).pop() ?? "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_-]+/, "")
    .trim();
  const limpo = base || "arquivo";
  if (limpo.length <= 120) return limpo;
  const ponto = limpo.lastIndexOf(".");
  const ext = ponto > 0 && limpo.length - ponto <= 10 ? limpo.slice(ponto) : "";
  return limpo.slice(0, 120 - ext.length) + ext;
}

/** Caminho no bucket: {org}/{setor}/{id}/{nome}. O banco confere o prefixo da organização e do setor. */
export function caminhoDocumento(org: string, modulo: string, id: string, nome: string): string {
  if (!/^[a-z]+$/.test(modulo)) throw new Error("Setor inválido.");
  return `${org}/${modulo}/${id}/${nomeSeguro(nome)}`;
}
