import React from 'react';
import type { DashboardData } from '../types';
import { Kpi, KpiGrid, Panel, Status } from '../../../../packages/design-system';

interface Props {
  data: DashboardData;
}

const dataCurta = (valor: string) => (valor ? new Date(valor).toLocaleDateString('pt-BR') : '—');

/** Lotes fora da fábrica (metalização externa), do mais antigo para o mais recente. */
export function EnviosExternosSection({ data }: Props) {
  const envios = data.enviosExternos;
  const maisAntigo = envios[0]?.diasFora ?? 0;
  const pecasFora = envios.reduce((acc, envio) => acc + (envio.quantidade ?? 0), 0);

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">TERCEIROS · METALIZAÇÃO EXTERNA</p>
          <h1>Envios externos</h1>
          <p>Lotes enviados a fornecedores e ainda não recebidos de volta, com o tempo fora e o prazo da OS.</p>
        </div>
        <Status tone={envios.length > 0 ? 'info' : 'neutral'}>
          {envios.length} {envios.length === 1 ? 'lote fora' : 'lotes fora'}
        </Status>
      </div>

      <KpiGrid>
        <Kpi label="Lotes fora" caption="Enviados e não recebidos" value={envios.length} tone={envios.length > 0 ? 'purple' : 'neutral'} />
        <Kpi label="OS envolvidas" caption="Ordens com lote em terceiro" value={data.totalOSExternas} tone={data.totalOSExternas > 0 ? 'blue' : 'neutral'} />
        <Kpi label="Peças fora" caption="Quantidade enviada aos fornecedores" value={pecasFora} tone="neutral" />
        <Kpi
          label="Maior tempo fora"
          caption="Lote enviado há mais tempo"
          value={envios.length > 0 ? `${maisAntigo} ${maisAntigo === 1 ? 'dia' : 'dias'}` : '—'}
          tone={maisAntigo > 7 ? 'amber' : 'neutral'}
        />
      </KpiGrid>

      <Panel title="Lotes em fornecedores" subtitle="Ordenados pelo tempo fora da fábrica">
        <div className="producao-table-wrap">
          <table className="producao-table">
            <thead>
              <tr>
                <th>OS</th>
                <th>OP / Lote</th>
                <th>Cliente</th>
                <th>Artigo</th>
                <th>Serviço</th>
                <th>Fornecedor</th>
                <th className="num">Peças</th>
                <th className="num">Enviado em</th>
                <th className="num">Dias fora</th>
                <th className="num">Prazo da OS</th>
              </tr>
            </thead>
            <tbody>
              {envios.length === 0 ? (
                <tr>
                  <td colSpan={10} className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
                    Nenhum lote em fornecedor externo no momento.
                  </td>
                </tr>
              ) : (
                envios.map((envio) => (
                  <tr key={envio.opLoteId}>
                    <td data-label="OS" className="mono">{envio.codigoGrv}</td>
                    <td data-label="OP / Lote">OP {envio.codigoOp} · Lote {envio.numeroLote}</td>
                    <td data-label="Cliente">{envio.cliente}</td>
                    <td data-label="Artigo" title={envio.descricao}>{envio.artigo}</td>
                    <td data-label="Serviço">{envio.tipoServico}</td>
                    <td data-label="Fornecedor">{envio.fornecedor ?? 'Não informado'}</td>
                    <td data-label="Peças" className="num">{envio.quantidade ?? '—'}</td>
                    <td data-label="Enviado em" className="num">{dataCurta(envio.enviadoEm)}</td>
                    <td data-label="Dias fora" className="num">
                      <Status tone={envio.diasFora > 7 ? 'attention' : 'neutral'}>
                        {envio.diasFora} {envio.diasFora === 1 ? 'dia' : 'dias'}
                      </Status>
                    </td>
                    <td data-label="Prazo da OS" className="num">
                      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 }}>
                        {dataCurta(envio.prazoEntrega)}
                        {envio.diasAtePrazo < 0 && (
                          <Status tone="danger">{Math.abs(envio.diasAtePrazo)}d atraso</Status>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
