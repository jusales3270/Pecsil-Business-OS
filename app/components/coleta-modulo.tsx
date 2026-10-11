"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ModuleNavContext, mesmoEstadoNav, useModuleNav, type ModuleNavItem, type ModuleNavState } from "../../lib/module-nav-context";
import { setoresDeColeta, soColeta, type SetorColeta } from "../../lib/coleta/modulos";
import { rotuloDoSetor } from "../../lib/documentos/setores";
import type { ModuleAccessContext } from "../../modules/access";
import { ColetaArquivosView } from "./coleta-arquivos";

/**
 * Põe "Coletar arquivos" no menu de qualquer módulo, sem mexer no módulo: o menu que o módulo
 * registra passa por aqui e ganha o item (ou, num departamento como o Comercial, uma área). Só
 * aparece para quem tem "Coletar arquivos" no setor. Com a coleta aberta, o módulo fica montado
 * e escondido (não perde o que estava aberto). Quem só tem a coleta no módulo vê só a coleta.
 */
const ID = "coleta:";
const AREA = "coleta";

export function ModuloComColeta({ moduloId, moduloNome, access, notify, children }: {
  moduloId: string;
  moduloNome: string;
  access: ModuleAccessContext;
  notify: (msg: string) => void;
  children: ReactNode;
}) {
  const { registerNav: externo } = useModuleNav();
  const setores = useMemo(() => setoresDeColeta(access, moduloId), [access, moduloId]);
  const so = useMemo(() => soColeta(access, moduloId), [access, moduloId]);
  const [estadoModulo, setEstadoModulo] = useState<ModuleNavState | null>(null);
  const [coleta, setColeta] = useState<SetorColeta | null>(so ? setores[0] ?? null : null);
  const aberta = so ? coleta ?? setores[0] ?? null : coleta;

  // O módulo registra o menu aqui; só guarda quando o conteúdo muda (evita laço de render).
  const registrarModulo = useCallback((s: ModuleNavState | null) => setEstadoModulo((prev) => (mesmoEstadoNav(prev, s) ? prev : s)), []);
  const contexto = useMemo(() => ({ navState: null, registerNav: registrarModulo }), [registrarModulo]);

  useEffect(() => {
    if (!setores.length) { externo(estadoModulo); return; }
    const itens = (comSetor: boolean): ModuleNavItem[] => setores.map((s) => ({
      id: `${ID}${s}`,
      label: comSetor ? `Coleta · ${rotuloDoSetor(s)}` : setores.length > 1 ? `Coletar arquivos · ${rotuloDoSetor(s)}` : "Coletar arquivos",
      icon: "download",
    }));
    const escolher = (id: string) => setColeta(id.slice(ID.length) as SetorColeta);
    const activeId = aberta ? `${ID}${aberta}` : estadoModulo?.activeId ?? "";
    if (so) {
      externo({ moduleId: moduloId, moduleName: moduloNome, sidebarTree: true, items: itens(false), activeId, onSelect: escolher });
      return;
    }
    if (!estadoModulo) return;
    const base = estadoModulo;
    const voltar = (id: string) => { setColeta(null); base.onSelect(id); };
    if (base.areas?.length) {
      externo({
        ...base,
        areas: [...base.areas, { id: AREA, label: "Coletar arquivos", icon: "download" }],
        activeAreaId: aberta ? AREA : base.activeAreaId,
        onSelectArea: (id) => { if (id === AREA) setColeta(setores[0]); else { setColeta(null); base.onSelectArea?.(id); } },
        // Dentro da área: com um setor só, nada abaixo dela; com mais de um, "Coleta · Compras".
        items: aberta ? (setores.length > 1 ? itens(true) : []) : base.items,
        activeId,
        onSelect: (id) => (id.startsWith(ID) ? escolher(id) : voltar(id)),
      });
      return;
    }
    externo({ ...base, items: [...base.items, ...itens(false)], activeId, onSelect: (id) => (id.startsWith(ID) ? escolher(id) : voltar(id)) });
  }, [externo, estadoModulo, setores, so, aberta, moduloId, moduloNome]);
  useEffect(() => () => externo(null), [externo]);

  return (
    <ModuleNavContext.Provider value={contexto}>
      {!so && <div style={{ display: aberta ? "none" : "contents" }}>{children}</div>}
      {aberta && <ColetaArquivosView key={aberta} notify={notify} setor={aberta} />}
    </ModuleNavContext.Provider>
  );
}
