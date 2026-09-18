import React from 'react';
import type { ForjaConnectionStatus } from '../types';
import { Button, Callout, Panel, SectionLabel, Status } from '../../../../packages/design-system';

interface Props {
  status: ForjaConnectionStatus;
  geradoEm: string;
  onTestPing: () => void;
  isTesting: boolean;
}

const rotuloModo: Record<ForjaConnectionStatus['modo'], string> = {
  live: 'Conectado',
  'sem-conexao': 'Sem conexão',
  'sem-acesso': 'Sem acesso',
  erro: 'Erro',
};

export function ConfiguracaoConexaoSection({ status, geradoEm, onTestPing, isTesting }: Props) {
  const temDado = status.online && geradoEm && !geradoEm.startsWith('1970');

  const detalhes: [string, React.ReactNode][] = [
    ['Origem dos dados', status.endpoint],
    ['Autenticação', 'Conta de integração do Business OS no Forja (papel Chefe)'],
    ['Latência da última leitura', status.latenciaMs !== undefined ? `${status.latenciaMs} ms` : '—'],
    ['Dado gerado pelo Forja em', temDado ? new Date(geradoEm).toLocaleString('pt-BR') : '—'],
    ['Atualização', 'A cada 30 segundos, com cache de 15 segundos no servidor'],
  ];

  return (
    <div className="producao-workspace">
      <div className="page-head">
        <div>
          <p className="eyebrow">INTEGRAÇÕES · FORJA</p>
          <h1>Conexão com o Forja</h1>
          <p>O Business OS lê o painel de produção do Forja pela rede interna do servidor. Nada é gravado no Forja.</p>
        </div>
        <Status tone={status.online ? 'success' : 'attention'}>{rotuloModo[status.modo]}</Status>
      </div>

      {!status.online && (
        <Callout variant="warning" title="O Forja não entregou dados">
          {status.erroMensagem ?? 'Sem resposta do Forja.'} Enquanto isso, a Produção fica vazia: nenhum número é exibido sem vir do Forja.
        </Callout>
      )}

      <Panel
        title="Parâmetros da integração"
        subtitle="Leitura somente do painel de produção"
        actions={
          <Button variant="primary" compact onClick={onTestPing} disabled={isTesting}>
            {isTesting ? 'Testando...' : 'Testar conexão'}
          </Button>
        }
      >
        <SectionLabel>Detalhes</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 'var(--sp-4)', fontSize: 'var(--fs-xs)' }}>
          {detalhes.map(([rotulo, valor]) => (
            <div key={rotulo}>
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{rotulo}</span>
              <strong style={{ overflowWrap: 'anywhere' }}>{valor}</strong>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
