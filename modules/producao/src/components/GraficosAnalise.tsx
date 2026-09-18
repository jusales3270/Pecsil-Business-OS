import React from 'react';
import type { DashboardData, GrupoPontualidade } from '../types';
import { Bar, Card, Kpi, KpiGrid, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  data: DashboardData;
}

const TIPOS_PRODUTO: Record<string, string> = {
  forma: 'Forma',
  bloco: 'Bloco',
  fundo_forma: 'Fundo de forma',
  fundo_bloco: 'Fundo de bloco',
  molde: 'Molde',
  arruela: 'Arruela',
  cabeca_sopro: 'Cabeça de sopro',
  forminha: 'Forminha',
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function rotuloMes(mes: string) {
  const [ano, numero] = mes.split('-');
  return `${MESES[Number(numero) - 1] ?? numero}/${ano?.slice(2) ?? ''}`;
}

function pontualidade(grupo: GrupoPontualidade) {
  return grupo.total > 0 ? Math.round(((grupo.total - grupo.atrasadas) / grupo.total) * 100) : 0;
}

function legendaGrupo(grupo: GrupoPontualidade) {
  const base = `${grupo.total} ${grupo.total === 1 ? 'entrega' : 'entregas'}`;
  if (grupo.atrasadas === 0) return `${base} · todas no prazo · % no prazo`;
  return `${base} · ${grupo.atrasadas} com atraso (média ${grupo.mediaDiasAtraso.toLocaleString('pt-BR')} dias) · % no prazo`;
}

/**
 * Análises de entrega e paradas. Tudo vem do Forja: pontualidade das OS
 * finalizadas na janela do Forja (90 dias), paradas de hoje e lotes por etapa.
 */
export function GraficosAnalise({ data }: Props) {
  const { historico } = data.indicadores;
  const paradasOrdenadas = Object.entries(data.paradas.porMotivoHoje).sort(([, a], [, b]) => b.minutos - a.minutos);
  const tempoTotalParado = paradasOrdenadas.reduce((acc, [, info]) => acc + info.minutos, 0);
  const maiorMes = Math.max(...historico.evolucao.map((mes) => mes.emDia + mes.atrasadas), 1);
  const porCliente = [...historico.porCliente].sort((a, b) => b.total - a.total).slice(0, 8);
  const porTipo = [...historico.porTipo].sort((a, b) => b.total - a.total);
  const janela = historico.dias || 90;
  const etapasComLote = data.kanban.filter((et) => et.cards.length > 0);
  const etapasVazias = data.kanban.filter((et) => et.cards.length === 0);

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">INTELIGÊNCIA INDUSTRIAL · BI</p>
          <h1>BI & Análises</h1>
          <p>Pontualidade de entrega, causas de parada e distribuição dos lotes na fábrica, com dados do Forja.</p>
        </div>
        <Status tone="info">Últimos {janela} dias</Status>
      </div>

      <SectionLabel>Entregas finalizadas nos últimos {janela} dias</SectionLabel>
      <KpiGrid>
        <Kpi
          label="Pontualidade"
          caption="OS finalizadas dentro do prazo"
          value={historico.pontualidade === null ? '—' : `${historico.pontualidade}%`}
          tone={historico.pontualidade === null ? 'neutral' : historico.pontualidade >= 90 ? 'green' : 'amber'}
        />
        <Kpi label="Entregas" caption="OS finalizadas no período" value={historico.total} tone={historico.total > 0 ? 'blue' : 'neutral'} />
        <Kpi label="Com atraso" caption="Finalizadas depois do prazo" value={historico.atrasadas} tone={historico.atrasadas > 0 ? 'red' : 'neutral'} />
        <Kpi label="Tempo parado hoje" caption={`${paradasOrdenadas.length} ${paradasOrdenadas.length === 1 ? 'motivo registrado' : 'motivos registrados'}`} value={`${tempoTotalParado} min`} tone={tempoTotalParado > 0 ? 'amber' : 'neutral'} />
      </KpiGrid>
      {historico.semDataConclusao > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', margin: 0 }}>
          {historico.semDataConclusao} OS finalizadas sem data de conclusão registrada no Forja ficam fora da pontualidade.
        </p>
      )}

      <Panel title="Evolução mensal das entregas" subtitle="OS finalizadas por mês: no prazo e com atraso">
        {historico.evolucao.length === 0 || historico.total === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>
            Nenhuma OS finalizada no período.
          </p>
        ) : (
          <>
            <div className="producao-legend" aria-hidden>
              <span><i className="no-prazo" /> No prazo</span>
              <span><i className="atrasada" /> Com atraso</span>
            </div>
            <div className="producao-stack-list">
              {historico.evolucao.map((mes) => {
                const total = mes.emDia + mes.atrasadas;
                const resumo = `${mes.emDia} no prazo · ${mes.atrasadas} com atraso`;
                return (
                  <div key={mes.mes} className="producao-stack-row" title={`${rotuloMes(mes.mes)}: ${resumo}`}>
                    <span>{rotuloMes(mes.mes)}</span>
                    <div className="producao-stack-track" role="img" aria-label={`${rotuloMes(mes.mes)}: ${resumo}`}>
                      {mes.emDia > 0 && <i className="no-prazo" style={{ width: `${(mes.emDia / maiorMes) * 100}%` }} />}
                      {mes.atrasadas > 0 && <i className="atrasada" style={{ width: `${(mes.atrasadas / maiorMes) * 100}%` }} />}
                    </div>
                    <small>{total === 0 ? 'sem entregas' : resumo}</small>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 'var(--sp-4)' }}>
        <Panel title="Pontualidade por cliente" subtitle="Clientes com mais entregas no período">
          {porCliente.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>Nenhuma entrega no período.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {porCliente.map((grupo) => (
                <Bar key={grupo.id} label={grupo.nome} caption={legendaGrupo(grupo)} value={pontualidade(grupo)} max={100} tone="blue" />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Pontualidade por tipo de produto" subtitle="Entregas do período agrupadas pelo tipo do artigo">
          {porTipo.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>Nenhuma entrega no período.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {porTipo.map((grupo) => (
                <Bar
                  key={grupo.id}
                  label={TIPOS_PRODUTO[grupo.nome] ?? grupo.nome}
                  caption={legendaGrupo(grupo)}
                  value={pontualidade(grupo)}
                  max={100}
                  tone="blue"
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Causas de parada hoje"
        subtitle="Minutos parados por motivo, do maior para o menor. Valores em minutos."
        actions={<Status tone={paradasOrdenadas.length > 0 ? 'attention' : 'neutral'}>{paradasOrdenadas.length} {paradasOrdenadas.length === 1 ? 'causa' : 'causas'}</Status>}
      >
        {paradasOrdenadas.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>
            Nenhuma parada registrada hoje.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {paradasOrdenadas.map(([motivo, info]) => (
              <Bar
                key={motivo}
                label={motivo}
                caption={`${info.ocorrencias} ${info.ocorrencias === 1 ? 'ocorrência' : 'ocorrências'}${info.planejado ? ' · planejada' : ''}`}
                value={info.minutos}
                max={paradasOrdenadas[0][1].minutos || 1}
                tone="amber"
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Lotes por etapa" subtitle="Etapas com lotes em andamento agora">
        {etapasComLote.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>Nenhum lote em andamento.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--sp-3)' }}>
            {etapasComLote.map((et) => {
              const urgente = et.cards.some((c) => c.diasAtePrazo < 3);
              return (
                <Card key={et.etapaId} style={{ padding: 'var(--sp-3)', textAlign: 'center' }}>
                  <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {et.nome}
                  </span>
                  <strong style={{ fontSize: 'var(--fs-2xl)', display: 'block', margin: '4px 0', color: 'var(--text-primary)' }}>
                    {et.cards.length}
                  </strong>
                  <Status tone={urgente ? 'danger' : 'neutral'}>{urgente ? 'Prazo em até 3 dias' : 'No fluxo'}</Status>
                </Card>
              );
            })}
          </div>
        )}
        {etapasVazias.length > 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', margin: 'var(--sp-3) 0 0' }}>
            Sem lotes agora: {etapasVazias.map((et) => et.nome).join(', ')}.
          </p>
        )}
      </Panel>
    </div>
  );
}
