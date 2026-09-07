import React from 'react';
import type { DashboardData } from '../types';
import { Bar, Card, Donut, Kpi, KpiGrid, Legend, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  data: DashboardData;
}

export function GraficosAnalise({ data }: Props) {
  const paradasOrdenadas = Object.entries(data.paradas.porMotivoHoje)
    .sort(([, a], [, b]) => b.minutos - a.minutos);

  const tempoTotalParado = paradasOrdenadas.reduce((acc, [, info]) => acc + info.minutos, 0);

  // OEE Estimado Chão de Fábrica
  const minutosTurnoPadrao = 480;
  const disponibilidade = Math.max(0, Math.min(100, Math.round(((minutosTurnoPadrao - tempoTotalParado) / minutosTurnoPadrao) * 100)));

  const totalLotes = data.kanban.reduce((acc, e) => acc + e.cards.length, 0);
  const lotesNoPrazo = data.kanban.reduce(
    (acc, e) => acc + e.cards.filter((c) => c.diasAtePrazo >= 0).length,
    0
  );
  const desempenho = totalLotes > 0 ? Math.round((lotesNoPrazo / totalLotes) * 100) : 95;

  const totalInspecoes =
    (data.inspecao['aprovado'] ?? 0) +
    (data.inspecao['com_observacoes'] ?? 0) +
    (data.inspecao['reprovado'] ?? 0);
  const qualidade =
    totalInspecoes > 0
      ? Math.round(((data.inspecao['aprovado'] ?? 0) / totalInspecoes) * 100)
      : 100;

  const oeeGeral = Math.round((disponibilidade * desempenho * qualidade) / 10000);

  const oeeSlices = [
    { label: "Disponibilidade", value: disponibilidade, tone: "blue" as const },
    { label: "Desempenho", value: desempenho, tone: "amber" as const },
    { label: "Qualidade", value: qualidade, tone: "green" as const },
  ];

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">INTELIGÊNCIA INDUSTRIAL · BI</p>
          <h1>BI & Análises Produtivas</h1>
          <p>Métricas de Eficiência Global de Equipamentos (OEE), causas de parada e gargalos de fluxo.</p>
        </div>
        <Status tone="info">SomaFlow Analytics</Status>
      </div>

      <SectionLabel>Pilares de Eficiência Operacional (OEE)</SectionLabel>
      <KpiGrid>
        <Kpi label="OEE Global" caption="Meta industrial: 85%" value={`${oeeGeral}%`} tone="amber" />
        <Kpi label="Disponibilidade" caption={`${tempoTotalParado} min parados hoje`} value={`${disponibilidade}%`} tone="blue" />
        <Kpi label="Desempenho" caption="Lotes no prazo fabril" value={`${desempenho}%`} tone="green" />
        <Kpi label="Qualidade (FPY)" caption="Aprovação direta sem refugo" value={`${qualidade}%`} tone="purple" />
      </KpiGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--sp-4)' }}>
        {/* Curva de Pareto */}
        <Panel
          title="Curva de Pareto: Causas de Parada"
          subtitle="Identificação das maiores fontes de tempo improdutivo nas máquinas"
          actions={<Status tone="attention">{paradasOrdenadas.length} causas</Status>}
        >
          {paradasOrdenadas.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
              Nenhuma parada registrada no turno para gerar curva comparativa.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {paradasOrdenadas.map(([motivo, info]) => (
                <Bar
                  key={motivo}
                  label={motivo}
                  caption={`${info.ocorrencias} ocorrências ${info.planejado ? '· planejada' : ''}`}
                  value={info.minutos}
                  max={Math.max(...paradasOrdenadas.map(([, i]) => i.minutos), 1)}
                  tone={info.planejado ? "blue" : "amber"}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* Composição OEE em Donut Nativo */}
        <Panel
          title="Composição dos Pilares Fabris"
          subtitle="Distribuição relativa dos fatores de rendimento industrial"
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-4)', padding: 'var(--sp-2) 0' }}>
            <Donut slices={oeeSlices} total={oeeGeral} caption="OEE consolidado" size={170} />
            <Legend slices={oeeSlices} />
          </div>
        </Panel>
      </div>

      {/* Distribuição por Etapas */}
      <Panel
        title="Volume de Lotes por Etapa"
        subtitle="Contagem de lotes em andamento em cada seção da fábrica para balanceamento"
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--sp-3)' }}>
          {data.kanban.map((et) => (
            <Card key={et.etapaId} style={{ padding: 'var(--sp-3)', textAlign: 'center' }}>
              <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {et.nome}
              </span>
              <strong style={{ fontSize: 'var(--fs-2xl)', display: 'block', margin: '4px 0', color: 'var(--text-primary)' }}>
                {et.total}
              </strong>
              <Status tone={et.cards.some(c => c.diasAtePrazo < 3) ? "danger" : "neutral"}>
                {et.cards.some(c => c.diasAtePrazo < 3) ? "Atraso iminente" : "No fluxo"}
              </Status>
            </Card>
          ))}
        </div>
      </Panel>
    </div>
  );
}
