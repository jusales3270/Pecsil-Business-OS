"use client";

import React, { useState, useEffect, useMemo } from "react";
import type { ModuleRuntimeProps } from "@/modules/runtime";
import { useModuleNav } from "@/lib/module-nav-context";
import { canUseFeature, hasMultipleModules } from "@/modules/access";
import { Button, Segmented, Status } from "../../../packages/design-system";
import { useProducaoDashboard } from "./hooks/useProducaoDashboard";
import { PainelProducao } from "./components/PainelProducao";
import { PipelineFundicao } from "./components/PipelineFundicao";
import { OrdensServicoSection } from "./components/OrdensServicoSection";
import { ParadasSection } from "./components/ParadasSection";
import { QualidadeSection } from "./components/QualidadeSection";
import { LotesFantasmasSection } from "./components/LotesFantasmasSection";
import { GraficosAnalise } from "./components/GraficosAnalise";
import { EnviosExternosSection } from "./components/EnviosExternosSection";
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
  ["Envios externos", "truck"],
  ["BI & Análises", "chart"],
  ["Conexão Forja", "settings"],
] as const;

type ProducaoSection = (typeof sections)[number][0];

/** Cada seção é uma funcionalidade liberável por usuário. */
const SECTION_FEATURE: Record<ProducaoSection, string> = {
  "Painel": "producao.painel",
  "Ordens de serviço": "producao.os",
  "Pipeline fundição": "producao.fundicao",
  "Paradas": "producao.paradas",
  "Qualidade": "producao.qualidade",
  "Lotes fantasmas": "producao.fantasmas",
  "Envios externos": "producao.externos",
  "BI & Análises": "producao.bi",
  "Conexão Forja": "producao.conexao",
};

export default function ProducaoApp({ onExit, onEvent, notify, access }: ModuleRuntimeProps) {
  const allowedSections = useMemo(
    () => sections.filter(([label]) => canUseFeature(access, SECTION_FEATURE[label])),
    [access],
  );
  const [section, setSection] = useState<ProducaoSection>(() => allowedSections[0]?.[0] ?? "Painel");

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
      items: allowedSections.map(([label, icon]) => ({ id: label, label, icon })),
      activeId: section,
      onSelect: (id) => {
        setSection(id as ProducaoSection);
        onEvent(`Navegou para seção ${id}`, "Produção");
      },
    });

    return () => registerNav(null);
  }, [section, registerNav, onEvent, allowedSections]);

  if (loading) {
    return (
      <div style={{ padding: "var(--sp-8)", textAlign: "center", color: "var(--text-muted)" }}>
        <p style={{ fontSize: "var(--fs-sm)" }}>Sincronizando com a linha de produção (Forja)...</p>
      </div>
    );
  }

  const isOwner = hasMultipleModules(access);

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
            <Status tone="attention">{status.modo === "sem-acesso" ? "Sem acesso" : "Sem conexão"}</Status>
          </div>
          <div className="producao-empty">
            <b>{status.modo === "sem-acesso" ? "Sem acesso à Produção" : "Sem conexão com o Forja"}</b>
            <small>{status.erroMensagem ?? "O Forja não respondeu. Nenhum dado de produção disponível."}</small>
            {status.modo !== "sem-acesso" && canUseFeature(access, "producao.conexao") && (
              <Button variant="secondary" compact onClick={() => setSection("Conexão Forja")}>Ver conexão</Button>
            )}
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
                <h1>Pipeline {data.pipelines[0] ? `· ${data.pipelines[0].etapaNome}` : 'da Fundição'}</h1>
                <p>Lotes fase a fase nas etapas com operações internas, como o tótem da fábrica mostra.</p>
              </div>
              <Status tone="info">
                {data.pipelines[0] ? `${data.pipelines[0].fases.length} fases` : 'Sem fases cadastradas'}
              </Status>
            </div>
            {data.pipelines[0] ? (
              <PipelineFundicao pipeline={data.pipelines[0]} />
            ) : (
              <div className="producao-empty">
                <b>Nenhuma etapa com fases no Forja</b>
                <small>O pipeline aparece quando uma etapa tem operações internas cadastradas.</small>
              </div>
            )}
          </div>
        );
      case "Paradas":
        return <ParadasSection data={data} />;
      case "Qualidade":
        return <QualidadeSection data={data} />;
      case "Lotes fantasmas":
        return <LotesFantasmasSection data={data} />;
      case "Envios externos":
        return <EnviosExternosSection data={data} />;
      case "BI & Análises":
        return <GraficosAnalise data={data} />;
      case "Conexão Forja":
        return (
          <ConfiguracaoConexaoSection
            status={status}
            geradoEm={data.geradoEm}
            onTestPing={async () => {
              await refetch();
              notify("Conexão com o Forja verificada. Veja o resultado nesta tela.");
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
          options={allowedSections.map(([label]) => label)}
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
