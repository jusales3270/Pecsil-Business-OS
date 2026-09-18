"use client";

import React, { useState, useEffect } from "react";
import type { ModuleRuntimeProps } from "@/modules/runtime";
import { useModuleNav } from "@/lib/module-nav-context";
import { Button, Segmented, Status } from "../../../packages/design-system";
import { useProducaoDashboard } from "./hooks/useProducaoDashboard";
import { PainelProducao } from "./components/PainelProducao";
import { PipelineFundicao } from "./components/PipelineFundicao";
import { OrdensServicoSection } from "./components/OrdensServicoSection";
import { ParadasSection } from "./components/ParadasSection";
import { QualidadeSection } from "./components/QualidadeSection";
import { LotesFantasmasSection } from "./components/LotesFantasmasSection";
import { GraficosAnalise } from "./components/GraficosAnalise";
import { ConfiguracaoConexaoSection } from "./components/ConfiguracaoConexaoSection";
import { ProducaoIcon } from "./components/ProducaoIcon";
import "./producao.css";

const sections = [
  ["Painel", "factory"],
  ["Ordens de serviço", "file"],
  ["Pipeline fundição", "arrow"],
  ["Paradas", "alert"],
  ["Qualidade", "check"],
  ["Lotes fantasmas", "clock"],
  ["BI & Análises", "chart"],
  ["Conexão Forja", "settings"],
] as const;

type ProducaoSection = (typeof sections)[number][0];

export default function ProducaoApp({ onExit, onEvent, notify, access }: ModuleRuntimeProps) {
  const [section, setSection] = useState<ProducaoSection>("Painel");

  const { registerNav } = useModuleNav();
  const {
    data,
    status,
    loading,
    isRefreshing,
    countdown,
    refetch,
  } = useProducaoDashboard(30);

  // Registro de subitens na barra lateral do Business OS
  useEffect(() => {
    registerNav({
      moduleId: "producao",
      moduleName: "Produção",
      items: sections.map(([label, icon]) => ({ id: label, label, icon })),
      activeId: section,
      onSelect: (id) => {
        setSection(id as ProducaoSection);
        onEvent(`Navegou para seção ${id}`, "Produção");
      },
    });

    return () => registerNav(null);
  }, [section, registerNav, onEvent]);

  if (loading) {
    return (
      <div style={{ padding: "var(--sp-8)", textAlign: "center", color: "var(--text-muted)" }}>
        <p style={{ fontSize: "var(--fs-sm)" }}>Sincronizando com a linha de produção (Forja)...</p>
      </div>
    );
  }

  const isOwner =
    access.role === "Proprietário" ||
    access.roleCode === "owner" ||
    access.roleCode === "director";

  const semConexao = !status.online;

  const renderSection = () => {
    // Sem a API do Forja não há produção para mostrar. Só a aba de conexão
    // continua útil (testar e ver o endereço configurado).
    if (semConexao && section !== "Conexão Forja") {
      return (
        <div className="producao-workspace">
          <div className="page-head">
            <div>
              <p className="eyebrow">PRODUÇÃO · {section.toUpperCase()}</p>
              <h1>{section}</h1>
              <p>Dados vindos da API do Forja.</p>
            </div>
            <Status tone="attention">Sem conexão</Status>
          </div>
          <div className="producao-empty">
            <b>Sem conexão com a API do Forja</b>
            <small>{status.erroMensagem ?? `Endpoint configurado: ${status.endpoint}`}</small>
            <Button variant="secondary" compact onClick={() => setSection("Conexão Forja")}>Ver conexão</Button>
          </div>
        </div>
      );
    }
    switch (section) {
      case "Painel":
        return (
          <PainelProducao
            data={data}
            status={status}
            isRefreshing={isRefreshing}
            countdown={countdown}
            onRefresh={() => {
              refetch();
              notify("Painel de produção sincronizado.");
            }}
          />
        );
      case "Ordens de serviço":
        return <OrdensServicoSection data={data} />;
      case "Pipeline fundição":
        return (
          <div className="producao-workspace">
            <div className="page-head">
              <div>
                <p className="eyebrow">FUNDIÇÃO · ROTEIRO DE FASES</p>
                <h1>Pipeline da Fundição</h1>
                <p>Sequenciamento de modelação, moldagem, vazamento e tratamento térmico.</p>
              </div>
              <Status tone="info">8 fases ativas</Status>
            </div>
            <PipelineFundicao pipeline={data.pipelines[0]} />
          </div>
        );
      case "Paradas":
        return <ParadasSection data={data} />;
      case "Qualidade":
        return <QualidadeSection data={data} />;
      case "Lotes fantasmas":
        return <LotesFantasmasSection data={data} />;
      case "BI & Análises":
        return <GraficosAnalise data={data} />;
      case "Conexão Forja":
        return (
          <ConfiguracaoConexaoSection
            status={status}
            onTestPing={async () => {
              await refetch();
              notify(
                status.online
                  ? "Conexão com a Forja API testada com sucesso!"
                  : "Aviso: Servidor Forja em contingência."
              );
            }}
            isTesting={isRefreshing}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="producao-module">
      {/* Barra de controle padrão do Design System Pecsil */}
      <div className="ds-module-bar">
        {isOwner && (
          <Button variant="secondary" compact onClick={onExit}>
            <ProducaoIcon name="back" /> Ecossistema
          </Button>
        )}
        <Segmented
          options={sections.map(([label]) => label)}
          value={section}
          onChange={(val) => setSection(val as ProducaoSection)}
          ariaLabel="Seções do módulo de Produção"
        />
        <Status tone={status.online ? "success" : "attention"}>
          {access.scopeLabel}
        </Status>
      </div>

      {/* Espaço de trabalho nativo */}
      <main className="producao-workspace">{renderSection()}</main>
    </div>
  );
}
