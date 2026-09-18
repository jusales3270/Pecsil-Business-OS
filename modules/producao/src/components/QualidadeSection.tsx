import React from 'react';
import type { DashboardData } from '../types';
import { Kpi, KpiGrid, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  data: DashboardData;
}

export function QualidadeSection({ data }: Props) {
  const aprovado = data.inspecao['aprovado'] ?? 0;
  const comObs = data.inspecao['com_observacoes'] ?? 0;
  const reprovado = data.inspecao['reprovado'] ?? 0;
  const total = aprovado + comObs + reprovado;

  const taxaAprovacao = total > 0 ? Math.round((aprovado / total) * 100) : null;
  const taxaTexto = taxaAprovacao === null ? '—' : `${taxaAprovacao}%`;

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">CONTROLE DE QUALIDADE · METROLOGIA</p>
          <h1>Qualidade & Inspeções</h1>
          <p>Inspeção dimensional cota a cota com tolerâncias do Artigo e controle de volume.</p>
        </div>
        <Status tone={taxaAprovacao === null ? 'neutral' : 'success'}>
          {taxaAprovacao === null ? 'Sem inspeções concluídas' : `${taxaAprovacao}% conformidade`}
        </Status>
      </div>

      <SectionLabel>Indicadores de Metrologia</SectionLabel>
      <KpiGrid>
        <Kpi label="Conformidade direta" caption={`Aprovadas sem ressalva · ${total} inspeções`} value={taxaTexto} tone={taxaAprovacao === null ? 'neutral' : 'green'} />
        <Kpi label="Aprovadas" caption="Dentro de todas as tolerâncias" value={aprovado} tone={aprovado > 0 ? 'green' : 'neutral'} />
        <Kpi label="Com observações" caption="Desvios aceitos tecnicamente" value={comObs} tone={comObs > 0 ? 'amber' : 'neutral'} />
        <Kpi label="Reprovadas" caption="Refugo ou retrabalho fabril" value={reprovado} tone={reprovado > 0 ? 'red' : 'neutral'} />
      </KpiGrid>

      <Panel
        title="Critérios de Inspeção Dimensional"
        subtitle="Validação cota a cota cadastrada no Roteiro do Artigo"
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', margin: 0 }}>
          Os apontamentos de inspeção são realizados no tótem do controle de qualidade, verificando medidas nominais, tolerâncias bilaterais e pesagem de volume para liberação dos lotes às etapas seguintes.
        </p>
      </Panel>
    </div>
  );
}
