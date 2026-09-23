"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleRuntimeProps } from "@/modules/runtime";
import { useModuleNav, type ModuleNavArea, type ModuleNavItem } from "@/lib/module-nav-context";
import { hasFeature, hasModuleAccess } from "@/modules/access-catalog";
import { Status } from "../../../packages/design-system";
import ComprasApp from "../../compras/src/App";
import { CustomersPanel } from "../../../app/components/customers-panel";
import { ConexaoSection } from "./components/ConexaoSection";
import { FunilBoard } from "./components/FunilBoard";
import "./comercial.css";

/**
 * Casca do departamento Comercial.
 *
 * O Comercial não tem tela própria: ele abriga áreas. Hoje abriga o CRM e o
 * Compras (o módulo `compras`, inteiro, apenas embutido). Esta casca registra a
 * árvore do menu — Comercial › CRM › seções, e Comercial › Compras — que a
 * barra lateral desenha. A tela não repete essa navegação em seletor nenhum.
 */

type Area = "crm" | "compras";

/** Cada seção do CRM é uma funcionalidade liberável por usuário. */
const CRM_SECTIONS = [
  { id: "caixa", label: "Caixa de entrada", icon: "inbox", feature: "comercial.caixa" },
  { id: "funil", label: "Funil", icon: "grid", feature: "comercial.funil" },
  { id: "cobranca", label: "Cobrança", icon: "chart", feature: "comercial.cobranca" },
  { id: "clientes", label: "Clientes", icon: "users", feature: "comercial.clientes" },
  { id: "conexao", label: "Conexão", icon: "settings", feature: "comercial.conexao" },
] as const;

type CrmSection = (typeof CRM_SECTIONS)[number]["id"];

export default function ComercialApp({ access, onExit, onEvent, notify, initialArea }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();

  // Só as seções liberadas para esta pessoa. Sem nenhuma, o CRM não aparece.
  const secoesCrm = useMemo(
    () => CRM_SECTIONS.filter((secao) => hasFeature(access, secao.feature)),
    [access],
  );
  const podeCrm = secoesCrm.length > 0;
  const podeCompras = hasModuleAccess(access, "compras");

  // Abre no CRM, que é a razão de o departamento existir; o atalho antigo
  // `/?module=compras` continua abrindo direto em Compras.
  const [area, setArea] = useState<Area>(() => {
    if (initialArea === "compras" && podeCompras) return "compras";
    if (initialArea === "crm" && podeCrm) return "crm";
    return podeCrm ? "crm" : "compras";
  });
  const [crmSection, setCrmSection] = useState<CrmSection>(() => secoesCrm[0]?.id ?? "caixa");

  // Áreas do departamento, na barra lateral. O Compras é folha aqui: as abas
  // dele continuam na barra própria do módulo, como sempre foram.
  const areas = useMemo<ModuleNavArea[]>(
    () => [
      ...(podeCrm ? [{ id: "crm", label: "CRM", icon: "inbox" }] : []),
      ...(podeCompras ? [{ id: "compras", label: "Compras", icon: "cart" }] : []),
    ],
    [podeCrm, podeCompras],
  );

  const items = useMemo<ModuleNavItem[]>(
    () => (area === "crm" ? secoesCrm.map(({ id, label, icon }) => ({ id, label, icon })) : []),
    [area, secoesCrm],
  );

  // `onEvent` muda de identidade a cada render da casca da plataforma; guardá-lo
  // numa referência evita registrar o menu de novo só por causa disso.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    registerNav({
      moduleId: "comercial",
      moduleName: "Comercial",
      areas,
      activeAreaId: area,
      onSelectArea: (id) => setArea(id as Area),
      items,
      activeId: crmSection,
      onSelect: (id) => {
        setArea("crm");
        setCrmSection(id as CrmSection);
        onEventRef.current(`Navegou para ${id} no CRM`, "Comercial");
      },
    });
  }, [registerNav, areas, items, area, crmSection]);

  // Limpar só ao sair do módulo. Limpar a cada mudança de dependência zeraria a
  // navegação e derrubaria a comparação de igualdade do provedor — o registro
  // seguinte viria sempre como estado novo, e isso vira laço de renderização.
  useEffect(() => () => registerNav(null), [registerNav]);

  // A navegação do departamento é a árvore na barra lateral (Comercial › CRM ›
  // seções). A tela não repete isso em seletor nenhum; dentro de Compras, quem
  // manda continua sendo a barra própria do Compras.
  if (area === "compras") {
    return (
      <div className="comercial-shell">
        <div className="comercial-area">
          <ComprasApp embedded access={access} onExit={onExit} />
        </div>
      </div>
    );
  }

  const secao = secoesCrm.find((item) => item.id === crmSection) ?? secoesCrm[0];

  if (secao?.id === "conexao") return <ConexaoSection notify={notify} />;
  if (secao?.id === "funil") return <FunilBoard notify={notify} />;
  if (secao?.id === "clientes") {
    return (
      <div className="comercial-workspace">
        <div className="page-head">
          <div>
            <p className="eyebrow">COMERCIAL · CRM</p>
            <h1>Clientes</h1>
            <p>Quem compra da PecSil, com os e-mails por onde cada um escreve.</p>
          </div>
        </div>
        {/* O mesmo cadastro de Fundação › Cadastros › Clientes: uma tela só. */}
        <CustomersPanel notify={notify} />
      </div>
    );
  }

  return (
    <div className="comercial-shell">
      <div className="comercial-workspace">
        <div className="page-head">
          <div>
            <p className="eyebrow">COMERCIAL · CRM</p>
            <h1>{secao?.label}</h1>
            <p>Entrada de e-mails, qualificação, funil e cobrança dos clientes da PecSil.</p>
          </div>
          <Status tone="attention">Em construção</Status>
        </div>
        <div className="comercial-empty">
          <b>Esta área ainda não está ligada</b>
          <small>
            O CRM vai ler a caixa comercial por e-mail, classificar o que chega (pedido, cobrança,
            dúvida) e abrir um card para acompanhamento. Nada aqui mostra dado inventado: enquanto a
            conexão de e-mail não existir, a área fica vazia de propósito.
          </small>
          {podeCompras && (
            <button type="button" onClick={() => setArea("compras")}>
              Ir para Compras
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
