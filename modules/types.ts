export type ModuleStatus = "Integrado" | "Planejado" | "Futuro";
export type ModuleTone = "success" | "attention" | "danger" | "info" | "neutral";
export type ModuleScope = "company" | "unit" | "department" | "team" | "module" | "self";
export type SharedService = "identity" | "organization" | "documents" | "notifications" | "audit" | "search";

export type ModuleManifest = {
  id: string;
  code: string;
  name: string;
  short: string;
  description: string;
  desc: string;
  version: string;
  route: `/modules/${string}`;
  icon: string;
  color: string;
  status: ModuleStatus;
  tone: ModuleTone;
  progress: number;
  enabled: boolean;
  /**
   * Id do módulo-departamento que abriga este. O módulo continua existindo por
   * inteiro (manifesto, permissões, runtime); ele só deixa de aparecer sozinho
   * no menu e passa a ser uma área dentro do departamento.
   * Ex.: Compras tem `department: "comercial"`.
   */
  department?: string;
  menu: {
    enabled: boolean;
    order: number;
  };
  access: {
    entryPermission: string;
    permissions: readonly string[];
    scopes: readonly ModuleScope[];
  };
  sharedServices: readonly SharedService[];
  auditEvents: readonly string[];
};

export function defineModule(manifest: ModuleManifest) {
  return Object.freeze(manifest);
}
