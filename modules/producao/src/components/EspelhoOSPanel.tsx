"use client";

import { useEffect, useState } from 'react';
import { Callout, Kpi, KpiGrid, Panel, Status } from '../../../../packages/design-system';

/**
 * Situação do espelho das OS do Forja no Business OS (etapa 2 do plano de
 * custo e margem). A sincronização roda por tarefa agendada a cada 10 minutos;
 * esta tela só lê o resultado (`GET /api/producao/sync-os`).
 */

type Rodada = {
  mode: 'apply' | 'simulate';
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  error: string | null;
  counts: { ordens?: { novas?: number; alteradas?: number; removidas?: number }; clientes?: { criados?: number } };
};

type Situacao = {
  ultimaSincronizacao: string | null;
  ultimaRodada: Rodada | null;
  ordens: number;
  semCliente: number;
  removidasNoForja: number;
  rodadas: Rodada[];
};

type Estado = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Situacao };

/** Mais que isso sem rodada aplicada com sucesso = a tarefa agendada parou. */
const ATRASO_MIN = 30;

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');

export function EspelhoOSPanel() {
  const [estado, setEstado] = useState<Estado>({ status: 'loading' });
  const [agora] = useState(() => Date.now());

  useEffect(() => {
    let ativo = true;
    fetch('/api/producao/sync-os', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as Situacao;
      })
      .then((data) => { if (ativo) setEstado({ status: 'ready', data }); })
      .catch(() => { if (ativo) setEstado({ status: 'error' }); });
    return () => { ativo = false; };
  }, []);

  if (estado.status === 'loading') {
    return <Panel title="Espelho das OS" subtitle="Carregando…"><p style={{ color: 'var(--text-muted)' }}>Lendo a situação da sincronização.</p></Panel>;
  }
  if (estado.status === 'error') {
    return <Panel title="Espelho das OS"><Callout variant="warning" title="Não foi possível ler a situação da sincronização">Tente de novo em instantes.</Callout></Panel>;
  }

  const { data } = estado;
  const minutos = data.ultimaSincronizacao ? Math.round((agora - Date.parse(data.ultimaSincronizacao)) / 60_000) : null;
  const atrasada = minutos === null || minutos > ATRASO_MIN;
  const ultima = data.ultimaRodada;

  return (
    <Panel
      title="Espelho das OS"
      subtitle="As OS do Forja como referência para Compras, Financeiro e Comercial. Só leitura; o Forja continua a fonte."
      actions={<Status tone={atrasada ? 'attention' : 'success'}>{data.ultimaSincronizacao ? (atrasada ? 'Atrasada' : 'Em dia') : 'Ainda não sincronizado'}</Status>}
    >
      {ultima && ultima.ok === false && (
        <Callout variant="danger" title="A última rodada falhou">{ultima.error ?? 'Erro sem detalhe.'}</Callout>
      )}
      {data.ultimaSincronizacao && atrasada && (
        <Callout variant="warning" title={`Sem sincronizar há ${minutos} minutos`}>A tarefa agendada roda a cada 10 minutos. Verifique a tarefa no Coolify e a conexão com o Forja.</Callout>
      )}
      <KpiGrid>
        <Kpi label="OS espelhadas" value={String(data.ordens)} caption="Presentes no Forja agora" tone="blue" />
        <Kpi label="Sem cliente vinculado" value={String(data.semCliente)} caption={data.semCliente ? 'Conferir o cadastro de clientes' : 'Todas com cliente único'} tone={data.semCliente ? 'amber' : 'green'} />
        <Kpi label="Removidas no Forja" value={String(data.removidasNoForja)} caption="Marcadas, não apagadas" tone="neutral" />
        <Kpi label="Última sincronização" value={minutos === null ? '—' : minutos < 1 ? 'agora' : `${minutos} min`} caption={quando(data.ultimaSincronizacao)} tone={atrasada ? 'amber' : 'green'} />
      </KpiGrid>
    </Panel>
  );
}
