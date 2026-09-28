import React, { useState } from 'react';
import type { DashboardData, OSResumo } from '../types';
import { Panel, SectionLabel, Status } from '../../../../packages/design-system';
import { ProducaoIcon } from './ProducaoIcon';

interface Props {
  data: DashboardData;
}

export function OrdensServicoSection({ data }: Props) {
  const [filtroStatus, setFiltroStatus] = useState<string>('todas');
  const [busca, setBusca] = useState<string>('');

  // "atrasada" no Forja é calculada pelo prazo: a mesma OS também está na lista
  // do status gravado (aberta ou em produção). Aqui ela aparece uma vez só.
  const idsAtrasadas = new Set((data.osPorStatusLista.atrasada ?? []).map((os) => os.id));
  const todasOS: (OSResumo & { statusReal: string })[] = Object.entries(data.osPorStatusLista)
    .filter(([status]) => status !== 'atrasada')
    .flatMap(([status, lista]) => lista.map((os) => ({ ...os, statusReal: idsAtrasadas.has(os.id) ? 'atrasada' : status })));

  const osFiltradas = todasOS.filter((os) => {
    if (filtroStatus !== 'todas' && os.statusReal !== filtroStatus) return false;
    if (!busca) return true;
    const b = busca.toLowerCase();
    return (
      os.codigoGrv.toLowerCase().includes(b) ||
      os.cliente.nome.toLowerCase().includes(b) ||
      os.artigo.codigo.toLowerCase().includes(b) ||
      os.artigo.descricao.toLowerCase().includes(b)
    );
  });

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">GESTÃO DE ORDENS · PROGRAMAÇÃO</p>
          <h1>Ordens de Serviço & Lotes</h1>
          <p>Visão tabular de todas as ordens de fabricação, artigos de molde e prazos contratuais.</p>
        </div>
        <Status tone="info">{todasOS.length} ordens cadastradas</Status>
      </div>

      <div className="producao-toolbar">
        <div className="producao-search-box">
          <ProducaoIcon name="search" size={16} />
          <input
            type="text"
            placeholder="Buscar por código de OS, cliente ou artigo..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value)}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-primary)',
            padding: '0 var(--sp-3)',
            height: '40px',
            fontSize: 'var(--fs-xs)',
            outline: 'none',
          }}
        >
          <option value="todas">Todos os Status</option>
          <option value="aberta">Abertas</option>
          <option value="em_producao">Em produção</option>
          <option value="finalizada">Finalizadas</option>
          <option value="atrasada">Atrasadas</option>
          <option value="cancelada">Canceladas</option>
        </select>
      </div>

      <Panel
        title="Listagem Analítica de OSs"
        subtitle={`${osFiltradas.length} ordens exibidas conforme filtros selecionados`}
      >
        <SectionLabel>Tabela de Ordens</SectionLabel>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '10px 8px' }}>Código OS</th>
                <th style={{ padding: '10px 8px' }}>Cliente</th>
                <th style={{ padding: '10px 8px' }}>Artigo</th>
                <th style={{ padding: '10px 8px' }}>Descrição</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>Prioridade</th>
                <th style={{ padding: '10px 8px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Qtd</th>
                <th style={{ padding: '10px 8px', textAlign: 'right' }}>Prazo de Entrega</th>
              </tr>
            </thead>
            <tbody>
              {osFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhuma Ordem de Serviço encontrada com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                osFiltradas.map((os) => (
                  <tr key={os.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 'var(--fw-bold)' }}>
                      {os.codigoGrv}
                    </td>
                    <td style={{ padding: '10px 8px' }}>{os.cliente.nome}</td>
                    <td style={{ padding: '10px 8px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)' }}>
                      {os.artigo.codigo}
                    </td>
                    <td style={{ padding: '10px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {os.artigo.descricao}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <Status tone={os.prioridade === 'urgente' ? 'danger' : 'neutral'}>
                        {os.prioridade}
                      </Status>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <Status
                        tone={
                          os.statusReal === 'em_producao'
                            ? 'attention'
                            : os.statusReal === 'finalizada'
                            ? 'success'
                            : os.statusReal === 'atrasada'
                            ? 'danger'
                            : 'neutral'
                        }
                      >
                        {os.statusReal.replace('_', ' ')}
                      </Status>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 'var(--fw-bold)' }}>
                      {os.quantidadeTotal}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      {String(os.prazoEntrega).slice(0, 10).split('-').reverse().join('/')}
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
