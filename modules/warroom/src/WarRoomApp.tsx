"use client";

import { useEffect, useState } from "react";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";
import { Cerebro } from "./Cerebro";
import { Conselho } from "./Conselho";
import { SaraHolograma } from "./holograma/SaraHolograma";

/**
 * War Room (docs/PLANO-WAR-ROOM-CEREBRO.md): o conselho da PecSil. Por enquanto só o proprietário entra
 * (W1). Submenus: Conselho (a SARA central, docs/PLANO-MINDMASTER.md) e Segundo Cérebro (o grafo).
 */
const SECOES = [
  { id: "Conselho", icon: "spark", feature: "warroom.sara" },
  { id: "Segundo Cérebro", icon: "rede", feature: "warroom.cerebro" },
] as const;
type Secao = (typeof SECOES)[number]["id"];

export default function WarRoomApp({ access, notify, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const secoes = SECOES.filter((s) => canUseFeature(access, s.feature, "ver"));
  const [secao, setSecao] = useState<Secao>(() => secoes.find((s) => s.id === initialSection)?.id ?? secoes[0]?.id ?? "Segundo Cérebro");
  const ids = secoes.map((s) => s.id).join("|");
  useEffect(() => {
    registerNav({
      moduleId: "warroom",
      moduleName: "War Room",
      sidebarTree: true,
      items: SECOES.filter((s) => ids.split("|").includes(s.id)).map(({ id, icon }) => ({ id, label: id, icon })),
      activeId: secao,
      onSelect: (id) => setSecao(id as Secao),
    });
  }, [registerNav, secao, ids]);
  useEffect(() => () => registerNav(null), [registerNav]);
  // A SARA central aparece na War Room em holograma (a entrada dela), para quem tem a permissão.
  const central = canUseFeature(access, "warroom.sara", "ver");
  return (
    <>
      {secao === "Conselho" ? <Conselho /> : <Cerebro notify={notify} />}
      {central && <SaraHolograma />}
    </>
  );
}
