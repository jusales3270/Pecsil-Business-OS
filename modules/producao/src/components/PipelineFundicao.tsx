import React from 'react';
import type { PipelineEtapa, FasePipeline } from '../types';
import { Panel, SectionLabel } from '../../../../packages/design-system';

interface Props {
  pipeline?: PipelineEtapa;
}

export function PipelineFundicao({ pipeline }: Props) {
  if (!pipeline || !pipeline.temFases || pipeline.fases.length === 0) {
    return null;
  }

  const totalGeral = pipeline.fases.reduce((acc, f) => acc + f.total, 0);

  return (
    <Panel
      title={`${pipeline.etapaNome} em detalhe`}
      subtitle={`Fluxo sequencial produtivo da ${pipeline.etapaNome} · ${totalGeral} ${totalGeral === 1 ? 'OP ativa' : 'OPs ativas'}`}
    >
      <SectionLabel>Fases da Linha de Fundição</SectionLabel>

      <div className="fundicao-pipeline-scroll custom-horizontal-scroll">
        {pipeline.fases.map((fase: FasePipeline, index: number) => {
          const isLast = index === pipeline.fases.length - 1;
          const isVazia = fase.total === 0;

          return (
            <React.Fragment key={fase.tipoServicoId || index}>
              <div className={`fundicao-fase-card ${isVazia ? 'empty' : ''}`}>
                <div>
                  <div className="fase-title" title={fase.nome}>
                    {fase.nome}
                  </div>

                  <div className="fase-count">{fase.total}</div>

                  {!isVazia && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px', fontSize: 'var(--fs-micro)' }}>
                      {fase.emProcesso > 0 && (
                        <span style={{ color: 'var(--accent-amber)', fontWeight: 'var(--fw-semibold)' }}>
                          ● {fase.emProcesso} rodando
                        </span>
                      )}
                      {fase.naFila > 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>
                          ○ {fase.naFila} na fila
                        </span>
                      )}
                      {fase.parado > 0 && (
                        <span style={{ color: 'var(--accent-red)', fontWeight: 'var(--fw-bold)' }}>
                          ■ {fase.parado} parado
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {fase.cards && fase.cards.length > 0 && (
                  <div style={{ marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
                    {fase.cards.slice(0, 3).map((c) => (
                      <div
                        key={c.opLoteId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 'var(--fs-micro)',
                          fontFamily: 'var(--font-mono, monospace)',
                          color: 'var(--text-secondary)',
                          marginBottom: '2px',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.codigoGrv}
                        </span>
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            flexShrink: 0,
                            background:
                              c.semaforo === 'vermelho'
                                ? 'var(--accent-red)'
                                : c.semaforo === 'amarelo'
                                ? 'var(--accent-amber)'
                                : 'var(--accent-green)',
                          }}
                        />
                      </div>
                    ))}
                    {fase.cards.length > 3 && (
                      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--text-muted)', display: 'block', textAlign: 'right' }}>
                        +{fase.cards.length - 3} mais
                      </span>
                    )}
                  </div>
                )}
              </div>

              {!isLast && <div className="fundicao-arrow">→</div>}
            </React.Fragment>
          );
        })}
      </div>
    </Panel>
  );
}
