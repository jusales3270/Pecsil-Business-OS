"use client";

import { useEffect } from "react";
import { useModuleNav } from "../../../lib/module-nav-context";
import type { ModuleRuntimeProps } from "../../runtime";
import { Cerebro } from "./Cerebro";

/**
 * War Room (docs/PLANO-WAR-ROOM-CEREBRO.md): o conselho da PecSil. Por enquanto só o proprietário entra
 * (W1). Submenus: Segundo Cérebro (o grafo); o Conselho, com a SARA principal, entra com o plano dela.
 */
export default function WarRoomApp({ notify }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  useEffect(() => {
    registerNav({
      moduleId: "warroom",
      moduleName: "War Room",
      sidebarTree: true,
      items: [{ id: "Segundo Cérebro", label: "Segundo Cérebro", icon: "rede" }],
      activeId: "Segundo Cérebro",
      onSelect: () => undefined,
    });
  }, [registerNav]);
  useEffect(() => () => registerNav(null), [registerNav]);
  return <Cerebro notify={notify} />;
}
