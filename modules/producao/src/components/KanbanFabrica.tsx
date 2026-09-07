import React from 'react';
import type { KanbanEtapa, KanbanCard } from '../types';
import { Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  etapas: KanbanEtapa[];
  termoBusca?: string;
  onCardClick?: (card: KanbanCard) => void;
}

export function KanbanFabrica({ etapas, termoBusca = '', onCardClick }: Props) {
  const buscaNormalizada = termoBusca.trim().toLowerCase();

  const etapasFiltradas = etapas.map((etapa) => {
    const cardsFiltrados = etapa.cards.filter((card) => {
      if (!buscaNormalizada) return true;
      if (
        (buscaNormalizada === 'atrasada' || buscaNormalizada === 'atrasadas') &&
        card.diasAtePrazo < 0
      ) {
        return true;
      }
      if (
        (buscaNormalizada === 'urgente' || buscaNormalizada === 'urgentes') &&
        card.prioridade === 'urgente'
      ) {
        return true;
      }

      const texto = [
        card.codigoGrv,
        card.codigoOp,
        card.cliente,
        card.artigo,
        card.operador || '',
        card.programador || '',
        card.maquina || '',
        etapa.nome,
      ]
        .join(' ')
        .toLowerCase();

      return texto.includes(buscaNormalizada);
    });

    return {
      ...etapa,
      cards: cardsFiltrados,
    };
  });

  const totalCards = etapas.reduce((acc, e) => acc + e.cards.length, 0);

  return (
    <Panel
      title="Onde está cada lote"
      subtitle={`Mapa operacional de lotes em andamento por etapa do roteiro · ${totalCards} lotes ativos`}
      actions={<Status tone="info">{totalCards} em linha</Status>}
    >
      <SectionLabel>Etapas Fabris & Ordens de Produção</SectionLabel>

      <div className="kanban-scroll-track custom-horizontal-scroll">
        {etapasFiltradas.map((etapa) => (
          <div key={etapa.etapaId} className="kanban-column-box">
            <div className="kanban-col-head">
              <h3 title={etapa.nome}>{etapa.nome}</h3>
              <Status tone={etapa.cards.length > 0 ? "attention" : "neutral"}>
                {etapa.cards.length}
              </Status>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', maxHeight: '520px', overflowY: 'auto' }}>
              {etapa.cards.length === 0 ? (
                <div
                  style={{
                    height: '80px',
                    border: '1px dashed var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'var(--fs-micro)',
                    color: 'var(--text-muted)',
                  }}
                >
                  Nenhum lote nesta etapa
                </div>
              ) : (
                etapa.cards.map((card) => {
                  const isOverdue = card.diasAtePrazo < 0;
                  const classeSemaforo =
                    card.semaforo === 'vermelho'
                      ? 'vermelho'
                      : card.semaforo === 'amarelo'
                      ? 'amarelo'
                      : 'verde';

                  const corPrazo =
                    card.semaforo === 'vermelho'
                      ? 'var(--accent-red)'
                      : card.semaforo === 'amarelo'
                      ? 'var(--accent-amber)'
                      : 'var(--accent-green)';

                  return (
                    <div
                      key={card.opLoteId}
                      onClick={() => onCardClick?.(card)}
                      className={`kanban-card-item ${classeSemaforo}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="card-os">{card.codigoGrv}</span>
                        {card.prioridade === 'urgente' && (
                          <Status tone="danger">URGENTE</Status>
                        )}
                      </div>

                      <div className="card-client">
                        {card.cliente} · {card.artigo}
                      </div>

                      <div className="card-meta">
                        <span>
                          OP {card.codigoOp} · Lote {card.numeroLote}
                        </span>
                        <span style={{ fontWeight: 'var(--fw-bold)', color: corPrazo }}>
                          {isOverdue ? `${Math.abs(card.diasAtePrazo)}d atrasado` : `${card.diasAtePrazo}d`}
                        </span>
                      </div>

                      {(card.maquina || card.operador || card.programador) && (
                        <div
                          style={{
                            marginTop: '6px',
                            paddingTop: '4px',
                            borderTop: '1px solid var(--border-subtle)',
                            fontSize: 'var(--fs-micro)',
                            color: 'var(--text-muted)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '1px',
                          }}
                        >
                          {card.maquina && <div>Máq: {card.maquina}</div>}
                          {card.operador && <div>Operador: {card.operador}</div>}
                          {card.programador && <div>Prog: {card.programador}</div>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
