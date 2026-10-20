"use client";

import { useEffect, useMemo, useState } from "react";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";
import { Entregas } from "./Entregas";
import { Frota } from "./Frota";
import { MapaAoVivo } from "./MapaAoVivo";
import { OrigemConfig } from "./OrigemConfig";

/**
 * Logística (raia L, docs/PLANO-LOGISTICA.md): entregas com a frota própria. O motor é o Fleetbase, serviço
 * separado consumido pela API; aqui ficam as entregas, o mapa ao vivo, a frota e a origem.
 */
type Secao = "Ao vivo" | "Entregas" | "Frota" | "Origem";

export default function LogisticaApp({ access, notify, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const podeVer = canUseFeature(access, "logistica.entregas");
  const podeOperar = canUseFeature(access, "logistica.entregas", "operar");
  const secoes = useMemo(() => ([
    podeVer && { id: "Ao vivo" as Secao, icon: "map" },
    podeVer && { id: "Entregas" as Secao, icon: "truck" },
    podeVer && { id: "Frota" as Secao, icon: "users" },
    podeOperar && { id: "Origem" as Secao, icon: "settings" },
  ].filter(Boolean) as { id: Secao; icon: string }[]), [podeVer, podeOperar]);
  const [secao, setSecao] = useState<Secao>(() => secoes.find((s) => s.id === initialSection)?.id ?? secoes[0]?.id ?? "Ao vivo");

  useEffect(() => {
    registerNav({
      moduleId: "logistica",
      moduleName: "Logística",
      sidebarTree: true,
      items: secoes.map(({ id, icon }) => ({ id, label: id, icon })),
      activeId: secao,
      onSelect: (id) => setSecao(id as Secao),
    });
  }, [registerNav, secoes, secao]);
  useEffect(() => () => registerNav(null), [registerNav]);

  if (!secoes.length) return <div className="almox-modulo"><div className="finance-empty almox-vazio"><b>Sem acesso à Logística</b><small>Peça a permissão de entregas ao proprietário.</small></div></div>;

  return (
    <div className="almox-modulo">
      {secao === "Ao vivo" && <MapaAoVivo abrirEntregas={() => setSecao("Entregas")} />}
      {secao === "Entregas" && <Entregas notify={notify} />}
      {secao === "Frota" && <Frota />}
      {secao === "Origem" && <OrigemConfig notify={notify} />}
    </div>
  );
}
