import React, { useState } from 'react';
import type { DashboardData, ForjaConnectionStatus, KanbanCard, OSResumo } from '../types';
import { Button, Callout, Card, Kpi, KpiGrid, Panel, SectionLabel, Status } from '../../../../packages/design-system';
import { PipelineFundicao } from './PipelineFundicao';
import { KanbanFabrica } from './KanbanFabrica';
import { ProducaoIcon } from './ProducaoIcon';

interface Props {
  data: DashboardData;
  status: ForjaConnectionStatus;
  isRefreshing: boolean;
  countdown: number;
  onRefresh: () => void;
  onNavigateSection?: (section: string) => void;
}

const LABELS_STATUS: Record<string, { label: string; sub: string; tone: "neutral" | "amber" | "green" | "red" }> = {
  aberta: { label: 'Abertas', sub: 'Aguardando início', tone: 'neutral' },
  em_producao: { label: 'Em produção', sub: 'Em linha ativa', tone: 'amber' },
  finalizada: { label: 'Finalizadas', sub: 'Concluídas no mês', tone: 'green' },
  atrasada: { label: 'Atrasadas', sub: 'Prazo vencido', tone: 'red' },
  cancelada: { label: 'Canceladas', sub: 'Encerradas', tone: 'neutral' },
};

export function PainelProducao({
  data,
  status,
  isRefreshing,
  countdown,
  onRefresh,
}: Props) {
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState<{
    tipo: 'lista' | 'card';
    titulo: string;
    itens?: OSResumo[];
    card?: KanbanCard;
  } | null>(null);

  const horaFormatada = new Date(data.geradoEm || Date.now()).toLocaleTimeString('pt-BR');

  return (
    <div className="producao-workspace">
      {/* Cabeçalho nativo da página (page-head do Pecsil Business OS) */}
      <div className="page-head">
        <div>
          <p className="eyebrow">CHÃO DE FÁBRICA · FORJA</p>
          <h1>Painel de Produção</h1>
          <p>
            Acompanhamento ao vivo das ordens, paradas de máquinas e ritmo da linha fabril. Sincronização a cada 30s ({horaFormatada}).
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Status tone={status.online ? 'success' : 'attention'}>
            {status.online ? 'AO VIVO' : 'CONTINGÊNCIA'}
          </Status>
          <Button variant="secondary" compact onClick={onRefresh} disabled={isRefreshing}>
            <ProducaoIcon name="refresh" size={14} /> {isRefreshing ? 'Atualizando...' : `${countdown}s`}
          </Button>
        </div>
      </div>

      {/* Alerta editorial quando em modo de contingência */}
      {!status.online && (
        <Callout variant="warning" title="Conexão com a Forja API em contingência">
          Exibindo dados sincronizados recentemente. A comunicação com o servidor em <code>{status.endpoint}</code> está temporariamente offline.
        </Callout>
      )}

      {/* Barra de Busca Rápida */}
      <div className="producao-toolbar">
        <div className="producao-search-box">
          <ProducaoIcon name="search" size={16} />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, OS, OP, etapa, operador, máquina, 'urgente' ou 'atrasadas'..."
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 5 KPIs de Status de OS (Design System nativo) */}
      <div>
        <SectionLabel>Status Global das Ordens de Serviço</SectionLabel>
        <KpiGrid>
          {Object.entries(LABELS_STATUS).map(([key, info]) => {
            const total = data.osPorStatus[key] ?? 0;
            const itens = data.osPorStatusLista[key] ?? [];

            return (
              <div
                key={key}
                onClick={() =>
                  setModal({
                    tipo: 'lista',
                    titulo: `Ordens de Serviço: ${info.label}`,
                    itens,
                  })
                }
                style={{ cursor: 'pointer' }}
                title="Clique para ver a lista de OSs"
              >
                <Kpi
                  label={info.label}
                  caption={info.sub}
                  value={total}
                  tone={key === 'atrasada' && total > 0 ? 'red' : info.tone}
                />
              </div>
            );
          })}
        </KpiGrid>
      </div>

      {/* 4 Blocos de Alerta Operacional Imediato */}
      <div>
        <SectionLabel>Alertas Operacionais & Gargalos Imediatos</SectionLabel>
        <div className="producao-alerts-grid">
          {/* 1: Máquinas paradas agora */}
          <Panel
            title="Máquinas paradas agora"
            subtitle="Estações de trabalho interrompidas no chão de fábrica"
            actions={
              <Status tone={data.paradas.ativas.length > 0 ? "danger" : "neutral"}>
                {data.paradas.ativas.length} {data.paradas.ativas.length === 1 ? "parada" : "paradas"}
              </Status>
            }
          >
            {data.paradas.ativas.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                Nenhuma parada em aberto. Todas as máquinas estão em operação ativa.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {data.paradas.ativas.map((p) => (
                  <div key={p.id} className="producao-alert-item">
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>{p.maquina || 'Máquina s/ vínculo'}</strong>
                      <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                        · {p.codigoGrv} ({p.etapa}) — {p.motivo}
                      </span>
                      {p.planejado && (
                        <Status tone="info">planejada</Status>
                      )}
                    </div>
                    <strong style={{ color: 'var(--accent-red)' }}>{p.minutosParado} min</strong>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* 2: Tempo parado hoje por motivo */}
          <Panel
            title="Tempo parado hoje, por motivo"
            subtitle="Acúmulo de horas improdutivas nas estações de trabalho"
            actions={
              <Status tone="neutral">
                {Object.keys(data.paradas.porMotivoHoje).length} motivos
              </Status>
            }
          >
            {Object.keys(data.paradas.porMotivoHoje).length === 0 ? (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                Nenhuma parada registrada no turno de hoje.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {Object.entries(data.paradas.porMotivoHoje)
                  .sort(([, a], [, b]) => b.minutos - a.minutos)
                  .map(([motivo, info]) => (
                    <div key={motivo} className="producao-alert-item">
                      <span>
                        {motivo} {info.planejado ? '(planejada)' : ''} ({info.ocorrencias}x)
                      </span>
                      <strong style={{ color: info.planejado ? 'var(--accent-blue)' : 'var(--accent-amber)' }}>
                        {info.minutos} min
                      </strong>
                    </div>
                  ))}
              </div>
            )}
          </Panel>

          {/* 3: OPs paradas (+4h) */}
          <Panel
            title="OPs paradas (4h+)"
            subtitle="Lotes com carimbo aberto sem novo apontamento do operador"
            actions={
              <Status tone={data.fantasmas.opsParadas.length > 0 ? "attention" : "neutral"}>
                {data.fantasmas.opsParadas.length} pendências
              </Status>
            }
          >
            {data.fantasmas.opsParadas.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                Nenhum lote travado. Apontamentos atualizados no chão de fábrica.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {data.fantasmas.opsParadas.map((op, i) => (
                  <div key={i} className="producao-alert-item">
                    <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 'var(--fw-semibold)' }}>
                      {op.codigoGrv} · OP {op.codigoOp} ({op.etapa})
                    </span>
                    <strong style={{ color: 'var(--accent-amber)' }}>{op.horasParado}h</strong>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* 4: Turnos não fechados (ontem) */}
          <Panel
            title="Turnos não fechados (ontem)"
            subtitle="Operadores que encerraram o expediente sem conferência"
            actions={
              <Status tone={data.fantasmas.turnosNaoFechados.length > 0 ? "info" : "neutral"}>
                {data.fantasmas.turnosNaoFechados.length} operadores
              </Status>
            }
          >
            {data.fantasmas.turnosNaoFechados.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                Todos os operadores fecharam o turno regularmente.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {data.fantasmas.turnosNaoFechados.map((t, i) => (
                  <div key={i} className="producao-alert-item">
                    <span>{t.operador}</span>
                    <Status tone="attention">conferência pendente</Status>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Faixa da Fundição */}
      {data.pipelines && data.pipelines.length > 0 && (
        <PipelineFundicao pipeline={data.pipelines[0]} />
      )}

      {/* Kanban da Fábrica */}
      <KanbanFabrica
        etapas={data.kanban}
        termoBusca={busca}
        onCardClick={(card) =>
          setModal({
            tipo: 'card',
            titulo: `OS ${card.codigoGrv} · Lote ${card.numeroLote}`,
            card,
          })
        }
      />

      {/* Inspeção & Qualidade */}
      <div>
        <SectionLabel>Inspeção Dimensional & Controle de Volume</SectionLabel>
        <KpiGrid>
          <Kpi
            label="Aprovadas"
            caption="Liberadas de primeira sem ressalva"
            value={data.inspecao['aprovado'] ?? 0}
            tone="green"
          />
          <Kpi
            label="Com observações"
            caption="Desvios dimensionais tolerados"
            value={data.inspecao['com_observacoes'] ?? 0}
            tone="amber"
          />
          <Kpi
            label="Reprovadas"
            caption="Refugo ou re-fusão na fundição"
            value={data.inspecao['reprovado'] ?? 0}
            tone="red"
          />
        </KpiGrid>
      </div>

      {/* Modal de Detalhe Nativo do Business OS */}
      {modal && (
        <div className="producao-modal-overlay" onClick={() => setModal(null)}>
          <div className="producao-modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 'var(--sp-3)' }}>
              <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', margin: 0, color: 'var(--text-primary)' }}>
                {modal.titulo}
              </h2>
              <button
                onClick={() => setModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--fs-md)' }}
              >
                ✕
              </button>
            </div>

            {modal.tipo === 'lista' && modal.itens && (
              modal.itens.length === 0 ? (
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 'var(--sp-4) 0' }}>
                  Nenhuma Ordem de Serviço encontrada neste status.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '8px 4px' }}>OS</th>
                        <th style={{ padding: '8px 4px' }}>Cliente</th>
                        <th style={{ padding: '8px 4px' }}>Artigo</th>
                        <th style={{ padding: '8px 4px', textAlign: 'right' }}>Qtd</th>
                        <th style={{ padding: '8px 4px', textAlign: 'right' }}>Prazo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modal.itens.map((os) => (
                        <tr key={os.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '8px 4px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 'var(--fw-bold)' }}>
                            {os.codigoGrv}
                          </td>
                          <td style={{ padding: '8px 4px' }}>{os.cliente.nome}</td>
                          <td style={{ padding: '8px 4px' }}>{os.artigo.codigo}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 'var(--fw-semibold)' }}>
                            {os.quantidadeTotal}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                            {new Date(os.prazoEntrega).toLocaleDateString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {modal.tipo === 'card' && modal.card && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
                <Card style={{ padding: 'var(--sp-4)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--sp-3)' }}>
                  <div>
                    <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-muted)', display: 'block' }}>Cliente</span>
                    <strong>{modal.card.cliente}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-muted)', display: 'block' }}>Artigo</span>
                    <strong>{modal.card.artigo}</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-muted)', display: 'block' }}>OP / Lote</span>
                    <strong style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                      OP {modal.card.codigoOp} · Lote {modal.card.numeroLote}
                    </strong>
                  </div>
                  <div>
                    <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-muted)', display: 'block' }}>Status</span>
                    <strong style={{ textTransform: 'capitalize' }}>{modal.card.status.replace('_', ' ')}</strong>
                  </div>
                </Card>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', fontSize: 'var(--fs-xs)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Prazo de Entrega</span>
                    <strong>
                      {modal.card.diasAtePrazo < 0
                        ? `${Math.abs(modal.card.diasAtePrazo)} dias atrasado`
                        : `${modal.card.diasAtePrazo} dias restantes`}
                    </strong>
                  </div>

                  {modal.card.maquina && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Máquina alocada</span>
                      <strong>{modal.card.maquina}</strong>
                    </div>
                  )}

                  {modal.card.operador && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Operador responsável</span>
                      <strong>{modal.card.operador}</strong>
                    </div>
                  )}

                  {modal.card.programador && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Programador CNC</span>
                      <strong>{modal.card.programador}</strong>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
