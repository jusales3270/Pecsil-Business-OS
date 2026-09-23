"use client";

import { createElement, type ComponentType } from "react";
import { FinanceModule } from "../app/components/finance-module";
import ComercialApp from "./comercial/src/ComercialApp";
import ComprasApp from "./compras/src/App";
import PortariaApp from "./portaria/src/PortariaApp";
import ProducaoApp from "./producao/src/ProducaoApp";
import type { ModuleAccessContext } from "./access";
// module-generator:imports

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
};

const moduleComponents: Record<string, ComponentType<ModuleRuntimeProps>> = {
  financeiro: FinanceModule,
  comercial: ComercialApp,
  compras: ComprasApp,
  portaria: PortariaApp,
  producao: ProducaoApp,
  // module-generator:entries
};

export function renderModuleComponent(moduleId: string, props: ModuleRuntimeProps) {
  const component = moduleComponents[moduleId];
  return component ? createElement(component, props) : null;
}
