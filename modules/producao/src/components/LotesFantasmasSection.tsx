import React from 'react';
import type { DashboardData } from '../types';
import { Kpi, KpiGrid, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  data: DashboardData;
}

export function LotesFantasmasSection({ data }: Props) {
  const opsParadas = data.fantasmas.opsParadas;
  const turnos = data.fantasmas.turnosNaoFechados;

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">AUDITORIA DE APONTAMENTOS · CHÃO DE FÁBRICA</p>
          <h1>Lotes Fantasmas & Turnos</h1>
          <p>Detecção de lotes parados há mais de 4 horas sem movimentação e conferências pendentes.</p>
        </div>
        <Status tone={opsParadas.length > 0 ? "attention" : "success"}>
          {opsParadas.length > 0 ? `${opsParadas.length} OP(s) paradas (+4h)` : "Apontamentos em dia"}
        </Status>
      </div>

      <SectionLabel>Indicadores de Auditoria</SectionLabel>
      <KpiGrid>
        <Kpi label="OPs travadas" caption="Mais de 4h sem novo apontamento" value={opsParadas.length} tone={opsParadas.length > 0 ? "amber" : "neutral"} />
        <Kpi label="Turnos em aberto" caption="Operadores sem conferência ontem" value={turnos.length} tone={turnos.length > 0 ? "blue" : "neutral"} />
      </KpiGrid>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--sp-4)' }}>
        <Panel
          title="OPs Paradas há mais de 4h"
          subtitle="Carimbos abertos na etapa sem conclusão ou apontamento de peça"
          actions={<Status tone={opsParadas.length > 0 ? "attention" : "neutral"}>{opsParadas.length}</Status>}
        >
          {opsParadas.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>
              Nenhum lote parado sem apontamento ativo.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {opsParadas.map((op, i) => (
                <div key={i} className="producao-alert-item">
                  <div>
                    <strong style={{ fontFamily: 'var(--font-mono, monospace)' }}>{op.codigoGrv}</strong>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                      OP {op.codigoOp} · {op.etapa}
                    </span>
                  </div>
                  <strong style={{ color: 'var(--accent-amber)' }}>{op.horasParado}h sem apontamento</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Conferência de Turno Pendente"
          subtitle="Operadores ativos que não fecharam o turno anterior"
          actions={<Status tone={turnos.length > 0 ? "info" : "neutral"}>{turnos.length}</Status>}
        >
          {turnos.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>
              Todos os operadores fecharam seus turnos regularmente.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {turnos.map((t, i) => (
                <div key={i} className="producao-alert-item">
                  <span style={{ fontWeight: 'var(--fw-semibold)' }}>{t.operador}</span>
                  <Status tone="attention">fechamento pendente</Status>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
