"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuleRuntimeProps } from "@/modules/runtime";
import { useModuleNav, type ModuleNavArea, type ModuleNavItem } from "@/lib/module-nav-context";
import { hasFeature, hasModuleAccess } from "@/modules/access-catalog";
import { Status } from "../../../packages/design-system";
import ComprasApp from "../../compras/src/App";
import { useStore as useComprasStore } from "../../compras/src/store";
import { availableViews, comprasCaps, currentView, tabsFor } from "../../compras/src/lib/access";
import type { Page as ComprasPage } from "../../compras/src/types";
import { CustomersPanel } from "../../../app/components/customers-panel";
import { ConexaoSection } from "./components/ConexaoSection";
import { FunilBoard } from "./components/FunilBoard";
import { Orcamentos } from "./vendas/Orcamentos";
import { Produtos } from "./vendas/Produtos";
import "./comercial.css";

/**
 * Casca do departamento Comercial.
 *
 * O Comercial não tem tela própria: ele abriga áreas. Hoje abriga o CRM, Vendas
 * (orçamentos e produtos) e o Compras (o módulo `compras`, inteiro, apenas embutido). Esta casca registra a
 * árvore do menu — Comercial › CRM › seções, e Comercial › Compras › abas do
 * Compras (Dashboard, Cotações, …, Fornecedores) — que a barra lateral desenha.
 */

type Area = "crm" | "vendas" | "compras";

/** Cada seção do CRM é uma funcionalidade liberável por usuário. */
const CRM_SECTIONS = [
  { id: "caixa", label: "Caixa de entrada", icon: "inbox", feature: "comercial.caixa" },
  { id: "funil", label: "Funil", icon: "grid", feature: "comercial.funil" },
  { id: "cobranca", label: "Cobrança", icon: "chart", feature: "comercial.cobranca" },
  { id: "clientes", label: "Clientes", icon: "users", feature: "comercial.clientes" },
  { id: "conexao", label: "Conexão", icon: "settings", feature: "comercial.conexao" },
] as const;

type CrmSection = (typeof CRM_SECTIONS)[number]["id"];

/** Vendas (docs/PLANO-ORCAMENTO.md): o orçamento que vira OS e nota, e o cadastro de produtos. */
const VENDAS_SECTIONS = [
  { id: "orcamentos", label: "Orçamentos", icon: "file", feature: "comercial.orcamentos" },
  { id: "produtos", label: "Produtos", icon: "box", feature: "comercial.produtos" },
] as const;

type VendasSection = (typeof VENDAS_SECTIONS)[number]["id"];

export default function ComercialApp({ access, onExit, onEvent, notify, initialArea, initialSection }: ModuleRuntimeProps) {
  const { registerNav } = useModuleNav();

  // Só as seções liberadas para esta pessoa. Sem nenhuma, o CRM não aparece.
  const secoesCrm = useMemo(
    () => CRM_SECTIONS.filter((secao) => hasFeature(access, secao.feature)),
    [access],
  );
  const podeCrm = secoesCrm.length > 0;
  const secoesVendas = useMemo(
    () => VENDAS_SECTIONS.filter((secao) => hasFeature(access, secao.feature)),
    [access],
  );
  const podeVendas = secoesVendas.length > 0;
  const podeCompras = hasModuleAccess(access, "compras");

  // Abre no CRM, que é a razão de o departamento existir; o atalho antigo
  // `/?module=compras` continua abrindo direto em Compras.
  // A seção pedida (link, SARA, Parados) decide a área quando ela é do CRM ou de Vendas.
  const secaoCrmPedida = secoesCrm.find((x) => x.id === initialSection)?.id;
  const secaoVendasPedida = secoesVendas.find((x) => x.id === initialSection)?.id;
  const [area, setArea] = useState<Area>(() => {
    if (initialArea === "compras" && podeCompras) return "compras";
    if (secaoCrmPedida) return "crm";
    if (secaoVendasPedida) return "vendas";
    if (initialArea === "crm" && podeCrm) return "crm";
    if (initialArea === "vendas" && podeVendas) return "vendas";
    return podeCrm ? "crm" : podeVendas ? "vendas" : "compras";
  });
  const [crmSection, setCrmSection] = useState<CrmSection>(() => secaoCrmPedida ?? secoesCrm[0]?.id ?? "caixa");
  // Avisa a casca qual área está aberta: Compras tem SARA própria, CRM e Vendas usam a do Comercial.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pecsil:area-ativa", { detail: { modulo: "comercial", area: area === "compras" ? "compras" : "comercial" } }));
  }, [area]);
  // Clicar na seção do menu (mesmo a já aberta) volta para a lista dela: remonta a tela.
  const [vendasVolta, setVendasVolta] = useState(0);
  const [vendasSection, setVendasSection] = useState<VendasSection>(() =>
    VENDAS_SECTIONS.some((s) => s.id === initialSection) ? (initialSection as VendasSection) : secoesVendas[0]?.id ?? "orcamentos");

  // Abas do Compras, as mesmas da barra do topo dele (mesmas regras de visão e
  // permissão). Menu e barra mexem no mesmo `currentPage`, então andam juntos.
  const comprasUser = useComprasStore((s) => s.user);
  const comprasPage = useComprasStore((s) => s.currentPage);
  const setComprasPage = useComprasStore((s) => s.setPage);
  const comprasTabs = useMemo(() => {
    if (!podeCompras) return [];
    const caps = comprasCaps(access);
    const view = currentView(availableViews(caps, access), comprasUser?.role);
    return tabsFor(view, caps);
  }, [podeCompras, access, comprasUser?.role]);

  // Áreas do departamento, na barra lateral.
  const areas = useMemo<ModuleNavArea[]>(
    () => [
      ...(podeCrm ? [{ id: "crm", label: "CRM", icon: "inbox" }] : []),
      ...(podeVendas ? [{ id: "vendas", label: "Vendas", icon: "file" }] : []),
      ...(podeCompras ? [{ id: "compras", label: "Compras", icon: "cart" }] : []),
    ],
    [podeCrm, podeVendas, podeCompras],
  );

  const items = useMemo<ModuleNavItem[]>(
    () =>
      area === "crm"
        ? secoesCrm.map(({ id, label, icon }) => ({ id, label, icon }))
        : area === "vendas"
          ? secoesVendas.map(({ id, label, icon }) => ({ id, label, icon }))
          : comprasTabs.map(({ page, label, icon }) => ({ id: page, label, icon })),
    [area, secoesCrm, secoesVendas, comprasTabs],
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
      activeId: area === "crm" ? crmSection : area === "vendas" ? vendasSection : comprasPage,
      onSelect: (id) => {
        if (area === "compras") {
          setComprasPage(id as ComprasPage);
          return;
        }
        if (area === "vendas") {
          setVendasSection(id as VendasSection);
          setVendasVolta((n) => n + 1);
          onEventRef.current(`Navegou para ${id} em Vendas`, "Comercial");
          return;
        }
        setArea("crm");
        setCrmSection(id as CrmSection);
        onEventRef.current(`Navegou para ${id} no CRM`, "Comercial");
      },
    });
  }, [registerNav, areas, items, area, crmSection, vendasSection, comprasPage, setComprasPage]);

  // Limpar só ao sair do módulo. Limpar a cada mudança de dependência zeraria a
  // navegação e derrubaria a comparação de igualdade do provedor — o registro
  // seguinte viria sempre como estado novo, e isso vira laço de renderização.
  useEffect(() => () => registerNav(null), [registerNav]);

  // A navegação do departamento é a árvore na barra lateral (Comercial › CRM ›
  // seções, e Comercial › Compras › abas). Dentro de Compras, a barra própria
  // do módulo continua no topo, ligada ao mesmo estado do menu.
  if (area === "compras") {
    return (
      <div className="comercial-shell">
        <div className="comercial-area">
          <ComprasApp embedded access={access} onExit={onExit} initialSection={initialSection} />
        </div>
      </div>
    );
  }

  if (area === "vendas") {
    const vendas = secoesVendas.find((item) => item.id === vendasSection) ?? secoesVendas[0];
    if (vendas?.id === "produtos") return <Produtos key={vendasVolta} notify={notify} />;
    return <Orcamentos key={vendasVolta} notify={notify} />;
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
