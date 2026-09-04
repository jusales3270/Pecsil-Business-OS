"use client";

import { createElement, type ComponentType } from "react";
import { FinanceModule } from "../app/components/finance-module";
import ComprasApp from "./compras/src/App";
import PortariaApp from "./portaria/src/PortariaApp";
import type { ModuleAccessContext } from "./access";
// module-generator:imports

export type ModuleRuntimeProps = {
  notify: (message: string) => void;
  onEvent: (message: string, module?: string) => void;
  onExit: () => void;
  access: ModuleAccessContext;
};

const moduleComponents: Record<string, ComponentType<ModuleRuntimeProps>> = {
  financeiro: FinanceModule,
  compras: ComprasApp,
  portaria: PortariaApp,
  // module-generator:entries
};

export function renderModuleComponent(moduleId: string, props: ModuleRuntimeProps) {
  const component = moduleComponents[moduleId];
  return component ? createElement(component, props) : null;
}
