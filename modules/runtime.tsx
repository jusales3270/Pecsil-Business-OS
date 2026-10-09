"use client";

import { createElement, type ComponentType } from "react";
import { FinanceModule } from "../app/components/finance-module";
import ComercialApp from "./comercial/src/ComercialApp";
import ComprasApp from "./compras/src/App";
import PortariaApp from "./portaria/src/PortariaApp";
import ProducaoApp from "./producao/src/ProducaoApp";
import AlmoxarifadoApp from "./almoxarifado/src/AlmoxarifadoApp";
import FiscalApp from "./fiscal/src/FiscalApp";
import type { ModuleAccessContext } from "./access";
// module-generator:imports
import FundicaoApp from "./fundicao/src/FundicaoApp";

export type ModuleRuntimeProps = {
  notify: (message: string) => void;
  onEvent: (message: string, module?: string) => void;
  onExit: () => void;
  access: ModuleAccessContext;
  /**
   * Área em que o módulo deve abrir. Só faz sentido para departamento
   * (ex.: abrir o Comercial já em Compras, vindo do atalho `/?module=compras`).
   */
  initialArea?: string;
  /** Seção em que o módulo deve abrir (ex.: "Recebimento"), vinda de um aviso ou do endereço `&secao=`. */
  initialSection?: string;
};

const moduleComponents: Record<string, ComponentType<ModuleRuntimeProps>> = {
  financeiro: FinanceModule,
  comercial: ComercialApp,
  compras: ComprasApp,
  portaria: PortariaApp,
  producao: ProducaoApp,
  almoxarifado: AlmoxarifadoApp,
  fiscal: FiscalApp,
  // module-generator:entries
  fundicao: FundicaoApp,
};

export function renderModuleComponent(moduleId: string, props: ModuleRuntimeProps) {
  const component = moduleComponents[moduleId];
  return component ? createElement(component, props) : null;
}
