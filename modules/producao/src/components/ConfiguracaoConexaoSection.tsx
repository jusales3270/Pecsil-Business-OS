import React, { useState } from 'react';
import type { ForjaConnectionStatus } from '../types';
import { Button, Callout, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  status: ForjaConnectionStatus;
  onTestPing: () => void;
  isTesting: boolean;
}

export function ConfiguracaoConexaoSection({ status, onTestPing, isTesting }: Props) {
  const [copied, setCopied] = useState(false);

  const copiarEndpoint = () => {
    navigator.clipboard.writeText(status.endpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">INTEGRAÇÕES & INFRAESTRUTURA</p>
          <h1>Conexão com Forja API</h1>
          <p>Parâmetros de comunicação em tempo real entre o Business OS e o backend da fábrica.</p>
        </div>
        <Status tone={status.online ? "success" : "attention"}>
          {status.online ? "Conectado" : "Contingência"}
        </Status>
      </div>

      {!status.online && (
        <Callout variant="warning" title="Servidor Forja em contingência">
          O endpoint <code>{status.endpoint}</code> não respondeu no último heartbeat. O Business OS está utilizando a base demonstrativa segura.
        </Callout>
      )}

      <Panel
        title="Parâmetros de Conectividade"
        subtitle="Configuração REST / JWT para consumo de dados em chão de fábrica"
        actions={
          <Button variant="primary" compact onClick={onTestPing} disabled={isTesting}>
            {isTesting ? "Testando..." : "Testar Conexão (Ping)"}
          </Button>
        }
      >
        <SectionLabel>Detalhes Técnicos do Gateway</SectionLabel>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 'var(--sp-4)', fontSize: 'var(--fs-xs)' }}>
          <div>
            <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Endpoint de Integração
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <code style={{ background: 'var(--bg-canvas)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {status.endpoint}
              </code>
              <Button variant="secondary" compact onClick={copiarEndpoint}>
                {copied ? "✓" : "Copiar"}
              </Button>
            </div>
          </div>

          <div>
            <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Latência de Comunicação
            </span>
            <strong style={{ fontSize: 'var(--fs-md)', fontFamily: 'var(--font-mono, monospace)' }}>
              {status.latenciaMs !== undefined ? `${status.latenciaMs} ms` : "—"}
            </strong>
          </div>

          <div>
            <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Última Sincronização
            </span>
            <span>
              {status.ultimaAtualizacao
                ? new Date(status.ultimaAtualizacao).toLocaleString("pt-BR")
                : "Aguardando primeiro ping"}
            </span>
          </div>

          <div>
            <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Intervalo de Polling
            </span>
            <span>A cada 30 segundos (automático com recarga em segundo plano)</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
