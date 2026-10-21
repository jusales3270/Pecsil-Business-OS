"use client";

import { useEffect, useState } from "react";
import { useModuleNav } from "../../../lib/module-nav-context";
import { canUseFeature } from "../../access";
import type { ModuleRuntimeProps } from "../../runtime";
import { Biblioteca } from "./Biblioteca";
import { PedidosDeMaterial } from "./PedidosDeMaterial";

/**
 * Fundição: Biblioteca de desenhos (o acervo de tudo o que a Forja tem, mais os desenhos
 * antigos da pasta física) e Pedidos de material ao Compras. Cada seção aparece para quem
 * tem a permissão dela; quem só tem uma cai direto nela.
 */

const SECOES = [
  { id: "Biblioteca", icon: "file", feature: "fundicao.biblioteca" },
  { id: "Pedidos de material", icon: "inbox", feature: "fundicao.pedidos" },
] as const;
type Secao = (typeof SECOES)[number]["id"];

export default function FundicaoApp({ access, notify, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();
  const secoes = SECOES.filter((s) => canUseFeature(access, s.feature, "ver"));
  const [secao, setSecao] = useState<Secao>(() => secoes.find((s) => s.id === initialSection)?.id ?? secoes[0]?.id ?? "Pedidos de material");
  const ids = secoes.map((s) => s.id).join("|");

  useEffect(() => {
    registerNav({
      moduleId: "fundicao",
      moduleName: "Fundição",
      sidebarTree: true,
      items: SECOES.filter((s) => ids.split("|").includes(s.id)).map(({ id, icon }) => ({ id, label: id, icon })),
      activeId: secao,
      onSelect: (id) => setSecao(id as Secao),
    });
  }, [registerNav, secao, ids]);
  useEffect(() => () => registerNav(null), [registerNav]);

  return secao === "Biblioteca" ? <Biblioteca notify={notify} /> : <PedidosDeMaterial notify={notify} />;
}
