import React from 'react';
import type { DashboardData } from '../types';
import { Kpi, KpiGrid, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  data: DashboardData;
}

export function ParadasSection({ data }: Props) {
  const ativas = data.paradas.ativas;
  const porMotivo = Object.entries(data.paradas.porMotivoHoje).sort(
    ([, a], [, b]) => b.minutos - a.minutos
  );

  const tempoTotal = porMotivo.reduce((acc, [, info]) => acc + info.minutos, 0);
  const totalEventos = porMotivo.reduce((acc, [, info]) => acc + info.ocorrencias, 0);

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">DISPONIBILIDADE INDUSTRIAL · MANUTENÇÃO</p>
          <h1>Paradas de Máquinas</h1>
          <p>Monitoramento de paradas ativas no instante e histórico diário por motivo.</p>
        </div>
        <Status tone={ativas.length > 0 ? "danger" : "success"}>
          {ativas.length > 0 ? `${ativas.length} máquina(s) parada(s)` : "Parque 100% operacional"}
        </Status>
      </div>

      <SectionLabel>Visão Geral de Disponibilidade</SectionLabel>
      <KpiGrid>
        <Kpi label="Paradas agora" caption="Máquinas interrompidas" value={ativas.length} tone={ativas.length > 0 ? "red" : "neutral"} />
        <Kpi label="Tempo parado hoje" caption="Acumulado de todas as paradas" value={`${tempoTotal} min`} tone={tempoTotal > 0 ? 'amber' : 'neutral'} />
        <Kpi label="Ocorrências" caption="Eventos registrados no turno" value={totalEventos} tone={totalEventos > 0 ? 'blue' : 'neutral'} />
      </KpiGrid>

      <Panel
        title="Máquinas Paradas em Tempo Real"
        subtitle="Registro aberto no tótem aguardando retomada da produção"
        actions={<Status tone={ativas.length > 0 ? "danger" : "neutral"}>{ativas.length} ativas</Status>}
      >
        <SectionLabel>Ocorrências em Aberto</SectionLabel>

        {ativas.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 'var(--sp-4) 0' }}>
            Nenhuma máquina em parada neste instante. Todas as operações estão em andamento.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '10px 8px' }}>Máquina</th>
                  <th style={{ padding: '10px 8px' }}>Etapa</th>
                  <th style={{ padding: '10px 8px' }}>OS / OP</th>
                  <th style={{ padding: '10px 8px' }}>Cliente</th>
                  <th style={{ padding: '10px 8px' }}>Motivo</th>
                  <th style={{ padding: '10px 8px' }}>Tipo</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Tempo Parado</th>
                </tr>
              </thead>
              <tbody>
                {ativas.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 'var(--fw-bold)' }}>{p.maquina || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{p.etapa}</td>
                    <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 'var(--fw-semibold)' }}>
                      {p.codigoGrv} · OP {p.codigoOp}
                    </td>
                    <td style={{ padding: '10px 8px' }}>{p.cliente}</td>
                    <td style={{ padding: '10px 8px', color: 'var(--accent-red)', fontWeight: 'var(--fw-semibold)' }}>
                      {p.motivo}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <Status tone={p.planejado ? "info" : "attention"}>
                        {p.planejado ? "Planejada" : "Corretiva"}
                      </Status>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'var(--fw-bold)', color: 'var(--accent-red)' }}>
                      {p.minutosParado} min
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
